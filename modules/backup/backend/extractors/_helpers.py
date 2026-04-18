"""
Shared utility helpers for backup extractors.

These were originally defined in request/backup/extractor.py and imported
by all four extractors. Now centralised in the backup module.
"""
from __future__ import annotations

import re
from datetime import datetime
from io import BytesIO
from typing import Any, Optional

import pandas as pd


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


def build_excel_bytes(df: pd.DataFrame) -> bytes:
    buf = BytesIO()
    df.to_excel(buf, index=False, engine="openpyxl")
    buf.seek(0)
    return buf.read()


def is_google_sheets_destination(destination_type: Optional[str]) -> bool:
    return str(destination_type or "").strip().lower() == "gsheets"


def normalize_google_sheet_filename(filename: str) -> str:
    lowered = filename.lower()
    for extension in (".xlsx", ".xls", ".csv", ".tsv"):
        if lowered.endswith(extension):
            return filename[: -len(extension)]
    return filename
