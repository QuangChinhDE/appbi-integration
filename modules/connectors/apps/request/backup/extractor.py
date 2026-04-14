"""
request_runner.py
-----------------
Backup runner for the "Request" app (request.base.com.vn).

Flow:
  1. Decrypt access token from flow.source
  2. Get a valid Google Drive token for the destination connection
  3. Create "Requests" root folder in GDrive (under user-chosen folder)
  4. Fetch all groups via paginated API → create GDrive sub-folder per group
  5. For each group, fetch all requests and for each request:
       a. Append row to in-memory group Excel
       b. Create request sub-folder in group folder
       c. If files → create "Tệp đính kèm" → download & upload each file
       d. input-table / select-master forms → decode → upload .xlsx
       e. Other custom fields → upload "Thông tin trường tùy chỉnh.xlsx"
       f. Posts + comments → upload "post_and_comment.txt"
  6. Upload group Excel once all requests are processed
  7. Process [direct] Đề xuất trực tiếp (group_id = 0)
"""

import asyncio
import base64
import json
import re
import traceback
from datetime import datetime, timedelta, timezone
from io import BytesIO
from typing import Any, Awaitable, Callable, Dict, List, Optional, Tuple, Union

import httpx
import pandas as pd
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from packages.database.src.models import BackupFlow, BackupFlowRun
from packages.database.src.session import async_session

# ── Google Drive REST endpoints ───────────────────────────────────────────────
GDRIVE_FILES_API = "https://www.googleapis.com/drive/v3/files"
GDRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3/files"
GoogleDriveTokenProvider = Callable[[bool], Awaitable[str]]
GoogleDriveTokenSource = Union[str, GoogleDriveTokenProvider]
GoogleDriveTokenLoader = Callable[[bool], Awaitable[tuple[str, Optional[datetime]]]]
GDRIVE_TOKEN_PROACTIVE_REFRESH_WINDOW = timedelta(minutes=10)

# ── Excel column definition (mirrors group.py) ────────────────────────────────
REQUEST_COLUMNS = [
    "ID",
    "Tên request",
    "Thời gian tạo",
    "Thời gian cập nhật",
    "Người theo dõi",
    "Người sở hữu",
    "Người duyệt",
    "Người từ chối",
    "ID nhóm request",
    "Số lượng bài đăng",
    "Số lượng files",
    "Số lượng TTC dạng bảng",
    "Folder request",
    "Files",
]


# ─────────────────────────────────────────────────────────────────────────────
# Utility helpers
# ─────────────────────────────────────────────────────────────────────────────

def sanitize_name(name: str) -> str:
    """Remove characters that are invalid in folder/file names."""
    return re.sub(r'[/\\:*?"<>|]', "_", name or "").strip(". ")


def truncate_name(name: str, max_length: int = 50) -> str:
    if len(name) <= max_length:
        return name
    return name[:max_length] + "..."


def ts_to_str(timestamp: Any) -> str:
    """Convert Unix timestamp → 'dd/MM/yyyy HH:MM:SS' string."""
    try:
        if timestamp:
            return datetime.fromtimestamp(int(timestamp)).strftime("%d/%m/%Y %H:%M:%S")
    except Exception:
        pass
    return ""


def extract_usernames(users: Any) -> str:
    if not users or not isinstance(users, list):
        return ""
    return ", ".join(
        filter(None, [u.get("username", "") for u in users if isinstance(u, dict)])
    )


def count_table_fields(form: Any) -> int:
    if not form or not isinstance(form, list):
        return 0
    return sum(
        1
        for item in form
        if isinstance(item, dict) and item.get("type") in ["input-table", "select-master"]
    )


def strip_html(text: str) -> str:
    return re.sub(r"<[^>]+>", "", text or "").strip()


def get_api_base(domain: str) -> str:
    """Build Base API base URL from domain string."""
    if domain.startswith("http"):
        return domain.rstrip("/") + "/extapi/v1"
    return f"https://{domain}/extapi/v1"


def build_excel_bytes(df: pd.DataFrame) -> bytes:
    buf = BytesIO()
    df.to_excel(buf, index=False, engine="openpyxl")
    buf.seek(0)
    return buf.read()


# ─────────────────────────────────────────────────────────────────────────────
# Google Drive helpers
# ─────────────────────────────────────────────────────────────────────────────

async def _resolve_gdrive_token(token_source: GoogleDriveTokenSource, force_refresh: bool = False) -> str:
    if callable(token_source):
        return await token_source(force_refresh)
    return token_source


def _normalize_gdrive_token_expiry(expires_at: Optional[datetime]) -> Optional[datetime]:
    if expires_at is not None and expires_at.tzinfo is None:
        return expires_at.replace(tzinfo=timezone.utc)
    return expires_at


def build_cached_gdrive_token_provider(
    load_token: GoogleDriveTokenLoader,
    refresh_window: timedelta = GDRIVE_TOKEN_PROACTIVE_REFRESH_WINDOW,
) -> GoogleDriveTokenProvider:
    cached_token: Optional[str] = None
    cached_expiry: Optional[datetime] = None

    async def provider(force_refresh: bool = False) -> str:
        nonlocal cached_token, cached_expiry

        expires_at = _normalize_gdrive_token_expiry(cached_expiry)
        proactive_refresh = (
            cached_token is not None
            and expires_at is not None
            and expires_at <= datetime.now(timezone.utc) + refresh_window
        )

        if force_refresh or cached_token is None or proactive_refresh:
            cached_token, cached_expiry = await load_token(force_refresh or proactive_refresh)

        if cached_token is None:
            raise ValueError("Google Drive access token could not be loaded")

        return cached_token

    return provider


async def _gdrive_request(
    client: httpx.AsyncClient,
    method: str,
    url: str,
    token_source: GoogleDriveTokenSource,
    **kwargs: Any,
) -> httpx.Response:
    base_headers = dict(kwargs.pop("headers", {}) or {})
    attempts = 2 if callable(token_source) else 1
    response: Optional[httpx.Response] = None

    for attempt in range(attempts):
        token = await _resolve_gdrive_token(token_source, force_refresh=attempt > 0)
        headers = dict(base_headers)
        headers["Authorization"] = f"Bearer {token}"
        response = await client.request(method, url, headers=headers, **kwargs)
        if response.status_code != 401:
            return response

    assert response is not None
    return response


async def gdrive_find_folders(
    token: GoogleDriveTokenSource,
    name: str,
    parent_id: str,
    *,
    drive_id: str | None = None,
) -> List[Dict[str, str]]:
    """Find all folders with an exact name inside parent."""
    # Escape single quotes in name for GDrive query
    safe_name = name.replace("\\", "\\\\").replace("'", "\\'")
    params = {
        "q": (
            f"name='{safe_name}' and '{parent_id}' in parents "
            "and mimeType='application/vnd.google-apps.folder' and trashed=false"
        ),
        "fields": "files(id,name)",
        "pageSize": "100",
        "supportsAllDrives": "true",
        "includeItemsFromAllDrives": "true",
    }
    if drive_id and drive_id != "root":
        params["driveId"] = drive_id
        params["corpora"] = "drive"
    else:
        params["corpora"] = "allDrives"

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await _gdrive_request(
            client,
            "GET",
            GDRIVE_FILES_API,
            token,
            params=params,
        )
        resp.raise_for_status()
        return [
            {"id": file_info["id"], "name": file_info.get("name", "")}
            for file_info in resp.json().get("files", [])
            if isinstance(file_info, dict) and file_info.get("id")
        ]


async def gdrive_find_folder(
    token: GoogleDriveTokenSource,
    name: str,
    parent_id: str,
    *,
    drive_id: str | None = None,
) -> Optional[str]:
    """Find a folder by exact name inside parent. Returns ID or None."""
    files = await gdrive_find_folders(token, name, parent_id, drive_id=drive_id)
    if files:
        return files[0]["id"]
    return None


async def _gdrive_create_new_folder(token: GoogleDriveTokenSource, name: str, parent_id: str) -> str:
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await _gdrive_request(
            client,
            "POST",
            GDRIVE_FILES_API,
            token,
            headers={
                "Content-Type": "application/json",
            },
            json={
                "name": name,
                "mimeType": "application/vnd.google-apps.folder",
                "parents": [parent_id],
            },
            params={"supportsAllDrives": "true"},
        )
        resp.raise_for_status()
        return resp.json()["id"]


async def gdrive_archive_item(
    token: GoogleDriveTokenSource,
    item_id: str,
    *,
    ignore_missing: bool = False,
) -> bool:
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await _gdrive_request(
            client,
            "PATCH",
            f"{GDRIVE_FILES_API}/{item_id}",
            token,
            headers={
                "Content-Type": "application/json",
            },
            params={"supportsAllDrives": "true"},
            json={"trashed": True},
        )
        if ignore_missing and resp.status_code == 404:
            return False
        resp.raise_for_status()
        return True


async def gdrive_recreate_folder(
    token: GoogleDriveTokenSource,
    name: str,
    parent_id: str,
    *,
    drive_id: str | None = None,
) -> tuple[str, int]:
    existing_folders = await gdrive_find_folders(token, name, parent_id, drive_id=drive_id)
    archived_count = 0
    for folder in existing_folders:
        archived = await gdrive_archive_item(token, folder["id"], ignore_missing=True)
        if archived:
            archived_count += 1

    if existing_folders:
        remaining_folders = await gdrive_find_folders(token, name, parent_id, drive_id=drive_id)
        if remaining_folders:
            raise ValueError(
                f"Cannot recreate '{name}' in Google Drive because {len(remaining_folders)} folder(s) with the same name still remain in the selected destination. "
                "This destination lets the current Google identity create files, but it is not allowing the existing backup root to be archived cleanly. "
                "Move the old folder(s) to trash manually or grant a Shared Drive role that can trash items in this destination, then run the backup again."
            )

    return await _gdrive_create_new_folder(token, name, parent_id), archived_count


async def gdrive_create_folder(
    token: GoogleDriveTokenSource,
    name: str,
    parent_id: str,
    *,
    drive_id: str | None = None,
) -> str:
    """Get-or-create a folder. Returns its Google Drive ID."""
    existing = await gdrive_find_folder(token, name, parent_id, drive_id=drive_id)
    if existing:
        return existing
    return await _gdrive_create_new_folder(token, name, parent_id)


async def gdrive_upload_bytes(
    token: GoogleDriveTokenSource,
    filename: str,
    content: bytes,
    mime_type: str,
    parent_id: str,
) -> str:
    """Upload bytes as a file to Google Drive. Returns new file ID."""
    metadata = json.dumps({"name": filename, "parents": [parent_id]})
    boundary = "gdrive_boundary_2026"
    body = (
        f"--{boundary}\r\n"
        f"Content-Type: application/json; charset=UTF-8\r\n\r\n"
        f"{metadata}\r\n"
        f"--{boundary}\r\n"
        f"Content-Type: {mime_type}\r\n\r\n"
    ).encode("utf-8") + content + f"\r\n--{boundary}--".encode("utf-8")

    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await _gdrive_request(
            client,
            "POST",
            GDRIVE_UPLOAD_API,
            token,
            headers={
                "Content-Type": f"multipart/related; boundary={boundary}",
            },
            params={"uploadType": "multipart", "supportsAllDrives": "true"},
            content=body,
        )
        resp.raise_for_status()
        return resp.json()["id"]


# ─────────────────────────────────────────────────────────────────────────────
# Base Request API calls
# ─────────────────────────────────────────────────────────────────────────────

async def fetch_groups(access_token: str, domain: str) -> List[Dict]:
    """Fetch all groups (paginated, stop when page returns < 20 items)."""
    api = get_api_base(domain)
    groups: List[Dict] = []
    page = 1
    async with httpx.AsyncClient(timeout=30.0) as client:
        while True:
            resp = await client.post(
                f"{api}/group/list",
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                data={"access_token_v2": access_token, "page": str(page)},
            )
            resp.raise_for_status()
            page_groups = resp.json().get("groups", [])
            groups.extend(page_groups)
            if len(page_groups) < 20:
                break
            page += 1
    return groups


async def fetch_requests_for_group(
    access_token: str, domain: str, group_id: str
) -> List[Dict]:
    """Fetch all requests for a group (paginated, limit=10, stop when < 10)."""
    api = get_api_base(domain)
    all_requests: List[Dict] = []
    page = 0
    async with httpx.AsyncClient(timeout=30.0) as client:
        while True:
            resp = await client.post(
                f"{api}/request/list",
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                data={
                    "access_token_v2": access_token,
                    "group": group_id,
                    "page": str(page),
                    "limit": "10",
                },
            )
            resp.raise_for_status()
            page_reqs = resp.json().get("requests", [])
            if not page_reqs:
                break
            all_requests.extend(page_reqs)
            if len(page_reqs) < 10:
                break
            page += 1
    return all_requests


async def fetch_posts(access_token: str, domain: str, request_id: str) -> List[Dict]:
    """Fetch all posts for a request (paginated by last_id, stop when < 10)."""
    api = get_api_base(domain)
    all_posts: List[Dict] = []
    last_id = ""
    async with httpx.AsyncClient(timeout=30.0) as client:
        while True:
            resp = await client.post(
                f"{api}/request/post/load",
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                data={
                    "access_token_v2": access_token,
                    "id": request_id,
                    "last_id": last_id,
                },
            )
            if resp.status_code != 200:
                break
            posts = resp.json().get("posts", [])
            if not posts:
                break
            all_posts.extend(posts)
            if len(posts) < 10:
                break
            last_id = posts[-1].get("id", "")
    return all_posts


async def fetch_comments(access_token: str, domain: str, hid: str) -> List[Dict]:
    """Fetch all comments for a post hid."""
    api = get_api_base(domain)
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            f"{api}/request/comment/load",
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            data={
                "access_token_v2": access_token,
                "hid": hid,
                "method": "prev",
                "position": "0",
            },
        )
        if resp.status_code == 200:
            return resp.json().get("comments", [])
    return []


# ─────────────────────────────────────────────────────────────────────────────
# Form table decoding (mirrors request.py logic)
# ─────────────────────────────────────────────────────────────────────────────

def _b64_decode(s: str) -> bytes:
    """Clean whitespace, add padding, then urlsafe-decode."""
    clean = "".join(s.split())
    clean += "=" * ((4 - len(clean) % 4) % 4)
    return base64.urlsafe_b64decode(clean.encode("ascii"))


def decode_table_placeholder(placeholder: str) -> Tuple[List[str], Optional[str]]:
    """
    Extract column headers from a form placeholder.
    Returns (headers, format_type) — format_type is 'simple-br', 'select-master',
    'simple-json', or None.
    """
    if "--br--" in placeholder:
        headers = [h.strip() for h in placeholder.split("--br--") if h.strip()]
        return headers, "simple-br"
    try:
        decoded = _b64_decode(placeholder).decode("utf-8")
        data = json.loads(decoded)
        if isinstance(data, list) and data and isinstance(data[0], dict):
            item_type = data[0].get("type")
            headers = [
                item.get("name", "")
                for item in data
                if isinstance(item, dict) and item.get("name")
            ]
            if item_type == "select-master":
                return headers, "select-master"
            elif item_type:
                return headers, "simple-json"
    except Exception:
        pass
    return [], None


def decode_simple_table_value(value: str) -> List[List]:
    try:
        data = json.loads(_b64_decode(value).decode("utf-8"))
        if isinstance(data, list):
            return data
    except Exception:
        pass
    return []


def decode_select_master_value(value: str) -> List[List]:
    try:
        items = json.loads(_b64_decode(value).decode("utf-8"))
        if not isinstance(items, list):
            return []
        rows: List[List] = []
        for item in items:
            if not isinstance(item, list):
                continue
            row: List = []
            for col_idx, cell_enc in enumerate(item):
                try:
                    if not isinstance(cell_enc, str):
                        row.append(str(cell_enc))
                        continue
                    cell_data = json.loads(_b64_decode(cell_enc).decode("utf-8"))
                    if col_idx == 0:
                        vals = (
                            cell_data.get("vals", [])
                            if isinstance(cell_data, dict)
                            else []
                        )
                        row.append(vals[0].get("value", "") if vals else "")
                    else:
                        row.append(
                            cell_data.get("value", "")
                            if isinstance(cell_data, dict)
                            else str(cell_data)
                        )
                except Exception:
                    row.append("")
            rows.append(row)
        return rows
    except Exception:
        pass
    return []


def build_table_excel(form_item: dict) -> Optional[Tuple[str, bytes]]:
    """Decode a form table item and return (filename, xlsx_bytes), or None on failure."""
    table_name = truncate_name(sanitize_name(form_item.get("name", "table")), 50)
    placeholder = form_item.get("placeholder", "")
    value = form_item.get("value", "")

    headers, fmt = decode_table_placeholder(placeholder)
    if not headers:
        return None

    if fmt == "select-master":
        rows = decode_select_master_value(value)
    else:
        rows = decode_simple_table_value(value)

    # Pad/trim rows to match header count
    col_count = len(headers)
    padded_rows = []
    for row in rows:
        if isinstance(row, list):
            padded_rows.append(
                [str(c) if c is not None else "" for c in row[:col_count]]
                + [""] * max(0, col_count - len(row))
            )

    df = pd.DataFrame(padded_rows, columns=headers)
    return (f"{table_name}.xlsx", build_excel_bytes(df))


# ─────────────────────────────────────────────────────────────────────────────
# Post / comment formatting
# ─────────────────────────────────────────────────────────────────────────────

def format_post_line(item: dict, is_post: bool = True) -> str:
    since = ts_to_str(item.get("since", ""))
    username = item.get("username", "Unknown")
    content = strip_html(item.get("content", ""))
    title = strip_html(item.get("title", ""))
    if is_post:
        if title and content:
            return f"{since} --- [{title}] {username}: {content}"
        return f"{since} --- {username}: {content or title or '(No content)'}"
    text = content or title or "(No content)"
    return f"{since} --- [comment] {username}: {text}"


# ─────────────────────────────────────────────────────────────────────────────
# Request row builder (for group Excel)
# ─────────────────────────────────────────────────────────────────────────────

def build_request_row(req: dict) -> dict:
    stats = req.get("stats") or {}
    return {
        "ID": req.get("id", ""),
        "Tên request": req.get("name", ""),
        "Thời gian tạo": ts_to_str(req.get("since")),
        "Thời gian cập nhật": ts_to_str(req.get("last_update")),
        "Người theo dõi": extract_usernames(req.get("followers")),
        "Người sở hữu": extract_usernames(req.get("owners")),
        "Người duyệt": extract_usernames(req.get("approvals")),
        "Người từ chối": extract_usernames(req.get("rejecters")),
        "ID nhóm request": req.get("group_id", ""),
        "Số lượng bài đăng": stats.get("posts", 0) if isinstance(stats, dict) else 0,
        "Số lượng files": len(req.get("files") or []),
        "Số lượng TTC dạng bảng": count_table_fields(req.get("form")),
        "Folder request": "",
        "Files": "",
    }


# ─────────────────────────────────────────────────────────────────────────────
# Single request processor
# ─────────────────────────────────────────────────────────────────────────────

async def process_single_request(
    req: dict,
    gdrive_token: GoogleDriveTokenSource,
    group_folder_id: str,
    access_token: str,
    domain: str,
    log_lines: List[str],
) -> dict:
    """
    Process one request: create sub-folder, upload attachments, tables,
    custom fields, and posts+comments. Returns the Excel row dict.
    """
    req_id = str(req.get("id", ""))
    req_name = req.get("name", "unnamed")
    truncated = truncate_name(sanitize_name(req_name), 50)
    folder_name = f"[{req_id}] {truncated}"

    log_lines.append(f"    → [{req_id}] {truncated}")

    # 1. Create request sub-folder
    req_folder_id = await gdrive_create_folder(gdrive_token, folder_name, group_folder_id)

    # 2. Download file attachments → "Tệp đính kèm" sub-folder
    files = req.get("files") or []
    if files:
        att_folder_id = await gdrive_create_folder(
            gdrive_token, "Tệp đính kèm", req_folder_id
        )
        async with httpx.AsyncClient(timeout=120.0) as client:
            for file_item in files:
                if not isinstance(file_item, dict):
                    continue
                ext_url = file_item.get("ext_download", "")
                filename = sanitize_name(file_item.get("name", "file"))
                if not ext_url or not filename:
                    continue
                try:
                    r = await client.get(ext_url)
                    if r.status_code == 200:
                        await gdrive_upload_bytes(
                            gdrive_token,
                            filename,
                            r.content,
                            "application/octet-stream",
                            att_folder_id,
                        )
                        log_lines.append(f"      ✓ attachment: {filename}")
                    else:
                        log_lines.append(
                            f"      ✗ attachment {filename}: HTTP {r.status_code}"
                        )
                except Exception as e:
                    log_lines.append(f"      ✗ attachment {filename}: {e}")

    # 3. Process form table items (input-table / select-master) → .xlsx per table
    form = req.get("form") or []
    table_items = [
        x
        for x in form
        if isinstance(x, dict) and x.get("type") in ["input-table", "select-master"]
    ]
    for item in table_items:
        result = build_table_excel(item)
        if result:
            fname, fbytes = result
            try:
                await gdrive_upload_bytes(
                    gdrive_token,
                    fname,
                    fbytes,
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    req_folder_id,
                )
                log_lines.append(f"      ✓ table: {fname}")
            except Exception as e:
                log_lines.append(f"      ✗ table {fname}: {e}")

    # 4. Process other custom fields → "Thông tin trường tùy chỉnh.xlsx"
    other_items = [
        x
        for x in form
        if isinstance(x, dict) and x.get("type") not in ["input-table", "select-master"]
    ]
    if other_items:
        custom = {
            x.get("name", ""): x.get("value", "")
            for x in other_items
            if x.get("name")
        }
        if custom:
            try:
                df = pd.DataFrame([custom])
                await gdrive_upload_bytes(
                    gdrive_token,
                    "Thông tin trường tùy chỉnh.xlsx",
                    build_excel_bytes(df),
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    req_folder_id,
                )
                log_lines.append(f"      ✓ custom fields excel")
            except Exception as e:
                log_lines.append(f"      ✗ custom fields: {e}")

    # 5. Fetch posts + comments → "post_and_comment.txt"
    try:
        posts = await fetch_posts(access_token, domain, req_id)
        txt_lines: List[str] = []
        for post in posts:
            txt_lines.append(format_post_line(post, is_post=True))
            hid = post.get("hid", "")
            if hid:
                comments = await fetch_comments(access_token, domain, hid)
                for c in comments:
                    txt_lines.append(format_post_line(c, is_post=False))
        if txt_lines:
            await gdrive_upload_bytes(
                gdrive_token,
                "post_and_comment.txt",
                "\n".join(txt_lines).encode("utf-8"),
                "text/plain; charset=UTF-8",
                req_folder_id,
            )
            log_lines.append(
                f"      ✓ posts+comments ({len(posts)} posts, {len(txt_lines) - len(posts)} comments)"
            )
    except Exception as e:
        log_lines.append(f"      ✗ posts/comments: {e}")

    return build_request_row(req)


# ─────────────────────────────────────────────────────────────────────────────
# Group processor
# ─────────────────────────────────────────────────────────────────────────────

async def process_group(
    group_id: str,
    group_name: str,
    requests_folder_id: str,
    gdrive_token: GoogleDriveTokenSource,
    access_token: str,
    domain: str,
    log_lines: List[str],
) -> int:
    """
    Process one group: create GDrive folder, fetch all requests, process each,
    then upload the group Excel. Returns the number of requests processed.
    """
    folder_label = truncate_name(sanitize_name(group_name), 50)
    folder_name = f"[{group_id}] {folder_label}"
    log_lines.append(f"\n  Group: {folder_name}")

    group_folder_id = await gdrive_create_folder(
        gdrive_token, folder_name, requests_folder_id
    )

    reqs = await fetch_requests_for_group(access_token, domain, group_id)
    log_lines.append(f"    {len(reqs)} requests found")

    rows: List[dict] = []
    for req in reqs:
        try:
            row = await process_single_request(
                req, gdrive_token, group_folder_id, access_token, domain, log_lines
            )
            rows.append(row)
        except Exception as e:
            log_lines.append(
                f"    ✗ error on request {req.get('id', '')}: {e}"
            )

    # Upload group Excel (thong_tin_requests.xlsx)
    df = pd.DataFrame(rows if rows else [], columns=REQUEST_COLUMNS)
    excel_bytes = build_excel_bytes(df)
    try:
        await gdrive_upload_bytes(
            gdrive_token,
            "thong_tin_requests.xlsx",
            excel_bytes,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            group_folder_id,
        )
        log_lines.append(f"    ✓ group Excel uploaded ({len(rows)} rows)")
    except Exception as e:
        log_lines.append(f"    ✗ group Excel upload failed: {e}")

    return len(rows)


# ─────────────────────────────────────────────────────────────────────────────
# Main entry point
# ─────────────────────────────────────────────────────────────────────────────

async def run_request_backup(flow_id: str, run_id: str) -> None:
    """
    Main async runner.  Creates its own DB session so it can safely run
    as a background task after the HTTP response has been sent.
    """
    async with async_session() as db:
        await _execute_backup(flow_id, run_id, db)


MANUALLY_STOPPED_RUN_MESSAGE = "Interrupted because the backup was manually stopped. Start the flow again to resume with a fresh run."


async def _execute_backup(flow_id: str, run_id: str, db: AsyncSession) -> None:
    # Load records
    flow = (
        await db.execute(select(BackupFlow).where(BackupFlow.id == flow_id))
    ).scalar_one_or_none()
    run = (
        await db.execute(select(BackupFlowRun).where(BackupFlowRun.id == run_id))
    ).scalar_one_or_none()

    if not flow or not run:
        return

    run.status = "running"
    log_lines: List[str] = [f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Backup started"]
    total_requests = 0
    total_groups = 0
    completed_groups = 0
    root_folder_id = None
    requests_folder_id = None
    current_step_label = "Initializing Request backup"

    async def persist_progress(
        phase: str,
        step_label: str,
        progress_percent: int,
        *,
        structure_path: Optional[str] = None,
        current_group_id: Optional[str] = None,
        current_group_name: Optional[str] = None,
    ) -> None:
        nonlocal current_step_label
        current_step_label = step_label
        run.execution_details = {
            "app": "request",
            "phase": phase,
            "step_label": step_label,
            "progress_percent": progress_percent,
            "root_folder_id": root_folder_id,
            "base_folder_id": requests_folder_id,
            "base_folder_name": "Requests" if requests_folder_id else None,
            "structure_path": structure_path,
            "total_groups": total_groups,
            "completed_groups": completed_groups,
            "total_requests": total_requests,
            "current_group_id": current_group_id,
            "current_group_name": current_group_name,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        run.logs = "\n".join(log_lines)
        flow.last_run_at = datetime.now(timezone.utc)
        flow.last_run_status = run.status
        flow.last_run_message = run.error_message or step_label
        await db.commit()

    await persist_progress("starting", current_step_label, 5)

    try:
        # ── Decrypt access token ────────────────────────────────────────────
        source = flow.source or {}
        enc_token = source.get("access_token_encrypted")
        if not enc_token:
            raise ValueError(
                "No encrypted access token in flow source. "
                "Please complete the wizard and re-save the flow."
            )

        from modules.credentials.backend.services.google_auth_service import decrypt_value
        access_token = decrypt_value(enc_token)
        domain = source.get("domain", "request.base.com.vn")
        log_lines.append(f"[INFO] Domain: {domain}")

        # ── Get Google Drive access token ───────────────────────────────────
        dest = flow.destination or {}
        auth = dest.get("auth") or {}
        from modules.credentials.backend.services.google_auth_service import (
            GoogleAuthService,
            validate_service_account_drive_destination,
        )
        validate_service_account_drive_destination(auth)
        google_auth_service = GoogleAuthService(db)

        async def load_gdrive_token(force_refresh: bool = False) -> tuple[str, Optional[datetime]]:
            return await google_auth_service.get_destination_access_token_details(
                auth,
                force_refresh=force_refresh,
            )

        get_gdrive_token = build_cached_gdrive_token_provider(load_gdrive_token)

        # Root folder: user-picked folder → selected drive → My Drive root
        root_folder_id = (
            auth.get("folder_id")
            or auth.get("drive_id")
            or "root"
        )
        log_lines.append(f"[INFO] GDrive root: {root_folder_id}")

        # ── Create "Requests" base folder in GDrive ─────────────────────────
        requests_folder_id, archived_root_folders = await gdrive_recreate_folder(
            get_gdrive_token,
            "Requests",
            root_folder_id,
            drive_id=auth.get("drive_id"),
        )
        if archived_root_folders:
            log_lines.append(
                f"[INFO] Moved {archived_root_folders} existing Requests folder(s) to trash before rebuilding backup tree"
            )
        log_lines.append(f"[INFO] Requests folder ready (id={requests_folder_id})")
        await persist_progress(
            "preparing_destination",
            "Created Requests root structure in Google Drive",
            20,
            structure_path="Requests",
        )

        # ── Fetch all groups ────────────────────────────────────────────────
        log_lines.append("[INFO] Fetching groups...")
        groups = await fetch_groups(access_token, domain)
        total_groups = len(groups)
        log_lines.append(f"[INFO] {total_groups} group(s) found")
        await persist_progress(
            "discovering_groups",
            f"Discovered {total_groups} request group(s)",
            25,
            structure_path="Requests",
        )

        # ── Process each group ──────────────────────────────────────────────
        for group in groups:
            g_id = str(group.get("id", ""))
            g_name = group.get("name", f"group_{g_id}")
            current_structure_path = f"Requests / [{g_id}] {g_name}"
            await persist_progress(
                "processing_groups",
                f"Processing group [{g_id}] {g_name}",
                25 + int((completed_groups / max(total_groups, 1)) * 55),
                structure_path=current_structure_path,
                current_group_id=g_id,
                current_group_name=g_name,
            )
            try:
                count = await process_group(
                    g_id, g_name, requests_folder_id,
                    get_gdrive_token, access_token, domain, log_lines,
                )
                total_requests += count
            except Exception as e:
                log_lines.append(f"  ✗ group [{g_id}] {g_name}: {e}")
            completed_groups += 1

            await persist_progress(
                "processing_groups",
                f"Finished group [{g_id}] {g_name}",
                25 + int((completed_groups / max(total_groups, 1)) * 55),
                structure_path=current_structure_path,
                current_group_id=g_id,
                current_group_name=g_name,
            )

        # ── Process [direct] Đề xuất trực tiếp (group_id = "0") ────────────
        log_lines.append("\n[INFO] Processing direct requests (group 0)...")
        await persist_progress(
            "processing_direct_requests",
            "Processing direct requests folder",
            88,
            structure_path="Requests / [direct] Đề xuất trực tiếp",
        )
        direct_folder_id = await gdrive_create_folder(
            get_gdrive_token, "[direct] Đề xuất trực tiếp", requests_folder_id
        )
        try:
            direct_reqs = await fetch_requests_for_group(access_token, domain, "0")
            log_lines.append(f"  {len(direct_reqs)} direct request(s) found")
            direct_rows: List[dict] = []
            for req in direct_reqs:
                try:
                    row = await process_single_request(
                        req, gdrive_token, direct_folder_id, access_token, domain, log_lines
                    )
                    direct_rows.append(row)
                    total_requests += 1
                except Exception as e:
                    log_lines.append(f"  ✗ direct request {req.get('id', '')}: {e}")

            df = pd.DataFrame(direct_rows if direct_rows else [], columns=REQUEST_COLUMNS)
            await gdrive_upload_bytes(
                get_gdrive_token,
                "thong_tin_requests.xlsx",
                build_excel_bytes(df),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                direct_folder_id,
            )
            log_lines.append(
                f"  ✓ direct Excel uploaded ({len(direct_rows)} rows)"
            )
        except Exception as e:
            log_lines.append(f"  ✗ direct requests error: {e}")

        # ── Finalise ────────────────────────────────────────────────────────
        await persist_progress(
            "finalizing",
            "Finalizing Request backup artifacts",
            95,
            structure_path="Requests",
        )
        run.status = "completed"
        run.completed_at = datetime.now(timezone.utc)
        log_lines.append(
            f"\n[DONE] {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} — "
            f"{total_groups} group(s), {total_requests} request(s) backed up."
        )
        await persist_progress(
            "completed",
            f"Completed Request backup: {total_requests} request(s) across {total_groups} group(s)",
            100,
            structure_path="Requests",
        )

    except asyncio.CancelledError:
        run.status = "failed"
        run.completed_at = datetime.now(timezone.utc)
        run.error_message = run.error_message or MANUALLY_STOPPED_RUN_MESSAGE
        log_lines.append(f"\n[INTERRUPTED] {MANUALLY_STOPPED_RUN_MESSAGE}")
        await persist_progress(
            "failed",
            f"Request backup was manually stopped: {current_step_label}",
            int((run.execution_details or {}).get("progress_percent") or 0),
            structure_path=(run.execution_details or {}).get("structure_path"),
            current_group_id=(run.execution_details or {}).get("current_group_id"),
            current_group_name=(run.execution_details or {}).get("current_group_name"),
        )
    except Exception as e:
        run.status = "failed"
        run.error_message = str(e)
        log_lines.append(f"\n[ERROR] {e}\n{traceback.format_exc()}")
        await persist_progress(
            "failed",
            f"Failed while running Request backup: {current_step_label}",
            int((run.execution_details or {}).get("progress_percent") or 0),
            structure_path=(run.execution_details or {}).get("structure_path"),
            current_group_id=(run.execution_details or {}).get("current_group_id"),
            current_group_name=(run.execution_details or {}).get("current_group_name"),
        )

    finally:
        run.logs = "\n".join(log_lines)
        # Update parent flow's last_run info
        flow_upd = (
            await db.execute(select(BackupFlow).where(BackupFlow.id == flow_id))
        ).scalar_one_or_none()
        if flow_upd:
            flow_upd.last_run_at = datetime.now(timezone.utc)
            flow_upd.last_run_status = run.status
            flow_upd.last_run_message = (
                run.error_message
                or f"{total_requests} request(s) backed up across {total_groups} group(s)"
            )
        await db.commit()
