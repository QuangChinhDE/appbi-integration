import asyncio
import json
import os
import hashlib
import base64
from datetime import datetime, timedelta, timezone
from typing import Optional, List, Dict, Any, Mapping
from urllib.parse import parse_qs, urlencode, urlparse

import httpx
from cryptography import x509
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from google.auth.transport.requests import Request as GoogleRequest
from google.oauth2 import service_account
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from modules.backup.shared.types import GoogleConnectionResponse
from packages.database.src.models import AppConfig, GoogleConnection

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"
GOOGLE_DRIVE_API = "https://www.googleapis.com/drive/v3"

SCOPES = [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/spreadsheets",
    "email",
    "profile",
    "openid",
]

SERVICE_ACCOUNT_SCOPES = [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/spreadsheets",
]

ACCESS_TOKEN_RENEWAL_WINDOW = timedelta(minutes=5)

# ── Shared encryption helpers (no DB needed) ─────────────────────────────────

def _get_fernet() -> Fernet:
    secret = os.getenv("SECRET_KEY", "change-this-secret-key-in-production-2026")
    key = base64.urlsafe_b64encode(hashlib.sha256(secret.encode()).digest())
    return Fernet(key)

def encrypt_value(value: str) -> str:
    return _get_fernet().encrypt(value.encode()).decode()

def decrypt_value(encrypted: str) -> str:
    return _get_fernet().decrypt(encrypted.encode()).decode()


def normalize_service_account_info(value: Any) -> Dict[str, Any]:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError as exc:
            raise ValueError("Invalid service account JSON") from exc

    if not isinstance(value, Mapping):
        raise ValueError("service account payload must be a JSON object")

    data = dict(value)
    required_keys = ["type", "client_email", "private_key", "token_uri"]
    missing_keys = [key for key in required_keys if not str(data.get(key) or "").strip()]
    if missing_keys:
        raise ValueError(f"Service account JSON is missing required keys: {', '.join(missing_keys)}")

    if data.get("type") != "service_account":
        raise ValueError("Uploaded JSON is not a Google service account key")

    private_key = str(data.get("private_key") or "")
    if "\\n" in private_key and "\n" not in private_key:
        private_key = private_key.replace("\\n", "\n")
    data["private_key"] = private_key.strip()

    if not data["private_key"].startswith("-----BEGIN PRIVATE KEY-----"):
        raise ValueError(
            "Service account private_key is malformed. Use the original JSON key downloaded from Google Cloud IAM."
        )

    return data


def extract_google_drive_folder_id(value: str) -> str:
    raw_value = str(value or "").strip()
    if not raw_value:
        raise ValueError("Folder ID or Google Drive folder link is required")

    parsed = urlparse(raw_value)
    if not parsed.scheme and not parsed.netloc:
        return raw_value

    path_parts = [part for part in parsed.path.split("/") if part]
    if "folders" in path_parts:
        folder_index = path_parts.index("folders")
        if folder_index + 1 < len(path_parts):
            return path_parts[folder_index + 1]

    query_params = parse_qs(parsed.query)
    for key in ("id", "folderId"):
        values = query_params.get(key)
        if values:
            return values[0]

    raise ValueError("Could not extract a Google Drive folder ID from the provided link")


def resolve_destination_google_auth_mode(auth: Mapping[str, Any]) -> str:
    raw_mode = str(auth.get("auth_mode") or auth.get("auth_method") or "").strip().lower()
    if raw_mode == "service_account":
        return "service_account"
    if raw_mode in {"google_oauth", "oauth"}:
        return "google_oauth"
    if (
        auth.get("credentials_json")
        or auth.get("service_account_json")
        or auth.get("service_account_json_encrypted")
        or auth.get("uses_platform_service_account")
    ):
        return "service_account"
    return "google_oauth"


def validate_service_account_drive_destination(auth: Dict[str, Any]) -> None:
    if resolve_destination_google_auth_mode(auth) != "service_account":
        return

    # Service accounts can read or even create folders in regular My Drive shares,
    # but Google blocks file uploads there because the service account has no quota.
    # Require a Shared Drive destination for backup artifact uploads.
    if not auth.get("drive_id"):
        raise ValueError(
            "This folder is shared with the service account, but it still belongs to regular My Drive, not a Shared Drive. "
            "Google service accounts can browse directly shared My Drive folders, but they cannot upload backup files there because they have no storage quota. "
            "Choose a folder inside a Shared Drive or switch this destination to OAuth User authentication."
        )


def _normalize_token_expiry(expiry: Optional[datetime]) -> Optional[datetime]:
    if expiry is not None and expiry.tzinfo is None:
        return expiry.replace(tzinfo=timezone.utc)
    return expiry


def _build_service_account_token_bundle(service_account_info: Dict[str, Any]) -> tuple[str, Optional[datetime]]:
    credentials = service_account.Credentials.from_service_account_info(
        service_account_info,
        scopes=SERVICE_ACCOUNT_SCOPES,
    )
    credentials.refresh(GoogleRequest())
    if not credentials.token:
        raise ValueError("Unable to obtain access token from service account")
    return credentials.token, _normalize_token_expiry(credentials.expiry)


async def inspect_service_account_keypair(service_account_info: Dict[str, Any]) -> Dict[str, Any]:
    normalized = normalize_service_account_info(service_account_info)
    client_x509_cert_url = str(normalized.get("client_x509_cert_url") or "").strip()
    private_key_id = str(normalized.get("private_key_id") or "").strip()

    result = {
        "private_key_id": private_key_id,
        "client_email": normalized.get("client_email"),
        "google_key_found": False,
        "local_keypair_valid": False,
        "google_cert_count": 0,
    }

    if not client_x509_cert_url:
        result["diagnostic_message"] = "client_x509_cert_url is missing from the service account JSON"
        return result

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(client_x509_cert_url)
        response.raise_for_status()
        cert_map = response.json()

    if not isinstance(cert_map, Mapping):
        result["diagnostic_message"] = "Google did not return a valid certificate map for this service account"
        return result

    result["google_cert_count"] = len(cert_map)
    certificate_pem = cert_map.get(private_key_id)
    if not certificate_pem:
        result["diagnostic_message"] = (
            "private_key_id from the uploaded file was not found in Google's active certificate list. "
            "This usually means the key was deleted or rotated."
        )
        return result

    result["google_key_found"] = True

    private_key = serialization.load_pem_private_key(
        str(normalized["private_key"]).encode(),
        password=None,
    )
    certificate = x509.load_pem_x509_certificate(str(certificate_pem).encode())
    public_key = certificate.public_key()
    challenge = b"copilot-service-account-check"
    signature = private_key.sign(challenge, padding.PKCS1v15(), hashes.SHA256())
    public_key.verify(signature, challenge, padding.PKCS1v15(), hashes.SHA256())
    result["local_keypair_valid"] = True
    result["diagnostic_message"] = "Service account private key matches Google's published certificate for this key id"
    return result


# ── AppConfigService ──────────────────────────────────────────────────────────

class AppConfigService:
    """Read/write key-value application config from the DB."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get(self, key: str, default: str = "") -> str:
        result = await self.db.execute(select(AppConfig).where(AppConfig.key == key))
        row = result.scalar_one_or_none()
        if row is None:
            return default
        return decrypt_value(row.value) if row.is_secret else row.value

    async def set(self, key: str, value: str, is_secret: bool = False, description: str = "") -> None:
        result = await self.db.execute(select(AppConfig).where(AppConfig.key == key))
        row = result.scalar_one_or_none()
        stored = encrypt_value(value) if is_secret else value
        if row is None:
            row = AppConfig(key=key, value=stored, is_secret=is_secret, description=description)
            self.db.add(row)
        else:
            row.value = stored
            row.is_secret = is_secret
            if description:
                row.description = description
        await self.db.commit()

    async def get_google_config(self) -> Dict[str, str]:
        """Return Google OAuth credentials (DB first, env fallback)."""
        client_id = await self.get("google_client_id") or os.getenv("GOOGLE_CLIENT_ID", "")
        client_secret = await self.get("google_client_secret") or os.getenv("GOOGLE_CLIENT_SECRET", "")
        redirect_uri = (
            await self.get("google_redirect_uri")
            or os.getenv("GOOGLE_REDIRECT_URI", "http://localhost:8010/api/google/callback")
        )
        return {
            "client_id": client_id,
            "client_secret": client_secret,
            "redirect_uri": redirect_uri,
            "configured": bool(client_id and client_secret),
        }

    async def get_platform_service_account_config(self) -> Dict[str, Any]:
        """Return the shared Google service account config (DB first, env fallback)."""
        raw_json = (
            await self.get("gcp_service_account_json")
            or os.getenv("GCP_SERVICE_ACCOUNT_JSON", "")
        )
        email = (
            await self.get("gcp_service_account_email")
            or os.getenv("GCP_SERVICE_ACCOUNT_EMAIL", "")
        ).strip()

        normalized_payload: Optional[Dict[str, Any]] = None
        if str(raw_json or "").strip():
            normalized_payload = normalize_service_account_info(raw_json)
            if not email:
                email = str(normalized_payload.get("client_email") or "").strip()

        return {
            "configured": normalized_payload is not None,
            "service_account_json": normalized_payload,
            "service_account_email": email or None,
        }


# ── GoogleAuthService ─────────────────────────────────────────────────────────

class GoogleAuthService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self._client_id: Optional[str] = None
        self._client_secret: Optional[str] = None
        self._redirect_uri: Optional[str] = None

    async def _load_credentials(self) -> None:
        """Load credentials from DB (with env-var fallback)."""
        if self._client_id is not None:
            return
        cfg = await AppConfigService(self.db).get_google_config()
        self._client_id = cfg["client_id"]
        self._client_secret = cfg["client_secret"]
        self._redirect_uri = cfg["redirect_uri"]

    async def _require_credentials(self) -> None:
        await self._load_credentials()
        if not self._client_id or not self._client_secret:
            raise ValueError("google_not_configured")

    # ── Encryption helpers ──────────────────────────────────────────────────

    @staticmethod
    def _get_fernet() -> Fernet:
        return _get_fernet()

    def encrypt(self, value: str) -> str:
        return encrypt_value(value)

    def decrypt(self, encrypted: str) -> str:
        return self._get_fernet().decrypt(encrypted.encode()).decode()

    # ── OAuth helpers ───────────────────────────────────────────────────────

    async def get_auth_url(self, state: str) -> str:
        """Return the Google OAuth consent screen URL."""
        await self._require_credentials()
        params = {
            "client_id": self._client_id,
            "redirect_uri": self._redirect_uri,
            "response_type": "code",
            "scope": " ".join(SCOPES),
            "access_type": "offline",
            "prompt": "consent",
            "state": state,
        }
        return f"{GOOGLE_AUTH_URL}?{urlencode(params)}"

    async def exchange_code(self, code: str) -> Dict[str, Any]:
        """Exchange the authorization code for access + refresh tokens."""
        await self._load_credentials()
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                GOOGLE_TOKEN_URL,
                data={
                    "code": code,
                    "client_id": self._client_id,
                    "client_secret": self._client_secret,
                    "redirect_uri": self._redirect_uri,
                    "grant_type": "authorization_code",
                },
            )
            resp.raise_for_status()
            return resp.json()

    async def get_userinfo(self, access_token: str) -> Dict[str, Any]:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                GOOGLE_USERINFO_URL,
                headers={"Authorization": f"Bearer {access_token}"},
            )
            resp.raise_for_status()
            return resp.json()

    async def _refresh_access_token(self, refresh_token: str) -> Dict[str, Any]:
        await self._load_credentials()
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                GOOGLE_TOKEN_URL,
                data={
                    "refresh_token": refresh_token,
                    "client_id": self._client_id,
                    "client_secret": self._client_secret,
                    "grant_type": "refresh_token",
                },
            )
            resp.raise_for_status()
            return resp.json()

    # ── DB operations ───────────────────────────────────────────────────────

    async def save_connection(
        self, token_data: Dict[str, Any], userinfo: Dict[str, Any]
    ) -> GoogleConnection:
        """Upsert a Google connection (same email → update tokens)."""
        email = userinfo["email"]
        result = await self.db.execute(
            select(GoogleConnection).where(GoogleConnection.email == email)
        )
        conn = result.scalar_one_or_none()

        if conn is None:
            conn = GoogleConnection(email=email)
            self.db.add(conn)

        conn.google_id = userinfo.get("id", "")
        conn.display_name = userinfo.get("name", email)
        conn.picture_url = userinfo.get("picture", "")
        conn.access_token_encrypted = self.encrypt(token_data["access_token"])

        # refresh_token is only returned on first consent; preserve existing one if absent
        if "refresh_token" in token_data:
            conn.refresh_token_encrypted = self.encrypt(token_data["refresh_token"])

        conn.scopes = token_data.get("scope", " ".join(SCOPES))

        if "expires_in" in token_data:
            conn.token_expiry = datetime.now(timezone.utc) + timedelta(
                seconds=int(token_data["expires_in"])
            )

        await self.db.commit()
        await self.db.refresh(conn)
        return conn

    async def get_valid_access_token_details(
        self,
        connection_id: str,
        *,
        force_refresh: bool = False,
    ) -> tuple[str, Optional[datetime]]:
        """Return a valid access token plus expiry, auto-refreshing when needed."""
        result = await self.db.execute(
            select(GoogleConnection).where(GoogleConnection.id == connection_id)
        )
        conn = result.scalar_one_or_none()
        if conn is None:
            raise ValueError("Google connection not found")

        now = datetime.now(timezone.utc)
        expiry = _normalize_token_expiry(conn.token_expiry)

        if not force_refresh and expiry is not None and expiry > now + ACCESS_TOKEN_RENEWAL_WINDOW:
            return self.decrypt(conn.access_token_encrypted), expiry

        if not conn.refresh_token_encrypted:
            raise ValueError("No refresh token stored; user must re-authenticate")

        refresh_token = self.decrypt(conn.refresh_token_encrypted)
        new_tokens = await self._refresh_access_token(refresh_token)

        conn.access_token_encrypted = self.encrypt(new_tokens["access_token"])
        token_expiry = None
        if "expires_in" in new_tokens:
            token_expiry = now + timedelta(seconds=int(new_tokens["expires_in"]))
            conn.token_expiry = token_expiry

        await self.db.commit()
        return new_tokens["access_token"], token_expiry

    async def get_valid_access_token(self, connection_id: str) -> str:
        token, _ = await self.get_valid_access_token_details(connection_id)
        return token

    async def get_service_account_access_token_details(
        self,
        service_account_info: Dict[str, Any],
    ) -> tuple[str, Optional[datetime]]:
        normalized = normalize_service_account_info(service_account_info)
        try:
            return await asyncio.to_thread(_build_service_account_token_bundle, normalized)
        except Exception as exc:
            error_text = str(exc)
            lowered = error_text.lower()

            if "invalid_grant" in lowered and "invalid jwt signature" in lowered:
                raise ValueError(
                    "Google rejected the service account key with 'Invalid JWT Signature'. "
                    "This usually means the uploaded JSON is not the original active key from Google Cloud IAM, "
                    "the key has been rotated/deleted, or the private_key value was modified/escaped incorrectly. "
                    "Download a fresh JSON key from Google Cloud Console -> IAM & Admin -> Service Accounts -> Keys and upload that exact file."
                ) from exc

            if "could not deserialize key data" in lowered or "no key could be detected" in lowered:
                raise ValueError(
                    "The uploaded service account JSON contains an invalid private key. "
                    "Use the original JSON key file from Google Cloud IAM and avoid copying it through env files or editors that may alter line breaks."
                ) from exc

            raise

    async def get_service_account_access_token(self, service_account_info: Dict[str, Any]) -> str:
        token, _ = await self.get_service_account_access_token_details(service_account_info)
        return token

    async def get_destination_access_token_details(
        self,
        auth: Dict[str, Any],
        *,
        force_refresh: bool = False,
    ) -> tuple[str, Optional[datetime]]:
        auth_mode = resolve_destination_google_auth_mode(auth)

        if auth_mode == "service_account":
            service_account_payload = auth.get("credentials_json")
            if service_account_payload is None:
                service_account_payload = auth.get("service_account_json")
            if service_account_payload is None and auth.get("service_account_json_encrypted"):
                service_account_payload = decrypt_value(auth["service_account_json_encrypted"])
            if service_account_payload is None:
                platform_cfg = await AppConfigService(self.db).get_platform_service_account_config()
                service_account_payload = platform_cfg["service_account_json"]
            if service_account_payload is None:
                raise ValueError(
                    "Service account mode is selected, but no service account JSON is available. "
                    "Upload a JSON key or configure a platform service account first."
                )
            normalized = normalize_service_account_info(service_account_payload)
            return await self.get_service_account_access_token_details(normalized)

        connection_id = auth.get("google_oauth_connection_id") or auth.get("connection_id")
        if not connection_id:
            raise ValueError("Google OAuth connection ID not found in destination auth")
        return await self.get_valid_access_token_details(connection_id, force_refresh=force_refresh)

    async def get_destination_access_token(self, auth: Dict[str, Any]) -> str:
        token, _ = await self.get_destination_access_token_details(auth)
        return token

    async def analyze_service_account(self, service_account_info: Dict[str, Any]) -> Dict[str, Any]:
        normalized = normalize_service_account_info(service_account_info)
        keypair_diagnostics = await inspect_service_account_keypair(normalized)

        if not keypair_diagnostics.get("google_key_found"):
            raise ValueError(keypair_diagnostics.get("diagnostic_message") or "Service account key id was not found in Google's published certificates")

        if not keypair_diagnostics.get("local_keypair_valid"):
            raise ValueError(keypair_diagnostics.get("diagnostic_message") or "Service account private key does not match Google's published certificate")

        await self.get_service_account_access_token(normalized)
        drives = await self.list_drives_for_auth({
            "auth_mode": "service_account",
            "auth_method": "service_account",
            "service_account_json": normalized,
        })
        return {
            "auth_mode": "service_account",
            "auth_method": "service_account",
            "type": normalized.get("type"),
            "project_id": normalized.get("project_id"),
            "private_key_id": normalized.get("private_key_id"),
            "client_email": normalized.get("client_email"),
            "client_id": normalized.get("client_id"),
            "token_uri": normalized.get("token_uri"),
            "scopes": SERVICE_ACCOUNT_SCOPES,
            "drives": drives,
            "keypair_diagnostics": keypair_diagnostics,
        }

    async def list_connections(self) -> List[GoogleConnectionResponse]:
        result = await self.db.execute(select(GoogleConnection))
        return [GoogleConnectionResponse.model_validate(c) for c in result.scalars().all()]

    async def delete_connection(self, connection_id: str) -> bool:
        result = await self.db.execute(
            select(GoogleConnection).where(GoogleConnection.id == connection_id)
        )
        conn = result.scalar_one_or_none()
        if conn is None:
            return False
        await self.db.delete(conn)
        await self.db.commit()
        return True

    # ── Drive API ────────────────────────────────────────────────────────────

    async def list_drives(self, connection_id: str) -> List[Dict[str, str]]:
        """Return My Drive + all Shared Drives the user has access to."""
        token = await self.get_valid_access_token(connection_id)
        return await self._list_drives_with_token(token)

    async def list_drives_for_auth(self, auth: Dict[str, Any]) -> List[Dict[str, str]]:
        token = await self.get_destination_access_token(auth)
        return await self._list_drives_with_token(token)

    async def _list_drives_with_token(self, token: str) -> List[Dict[str, str]]:
        headers = {"Authorization": f"Bearer {token}"}

        drives = [{"id": "root", "name": "My Drive", "kind": "my_drive"}]

        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{GOOGLE_DRIVE_API}/drives",
                headers=headers,
                params={"pageSize": 50},
            )
            if resp.status_code == 200:
                for d in resp.json().get("drives", []):
                    drives.append({"id": d["id"], "name": d["name"], "kind": "shared_drive"})

        return drives

    async def list_folders(
        self,
        connection_id: str,
        parent_id: str = "root",
        drive_id: Optional[str] = None,
    ) -> List[Dict[str, str]]:
        """List sub-folders inside a given parent folder."""
        token = await self.get_valid_access_token(connection_id)
        return await self._list_folders_with_token(token, parent_id=parent_id, drive_id=drive_id)

    async def list_folders_for_auth(
        self,
        auth: Dict[str, Any],
        parent_id: str = "root",
        drive_id: Optional[str] = None,
    ) -> List[Dict[str, str]]:
        token = await self.get_destination_access_token(auth)
        return await self._list_folders_with_token(token, parent_id=parent_id, drive_id=drive_id)

    async def list_shared_folders_for_auth(
        self,
        auth: Dict[str, Any],
        query: str = "",
    ) -> List[Dict[str, Optional[str]]]:
        token = await self.get_destination_access_token(auth)
        return await self._list_shared_folders_with_token(token, query=query)

    async def get_folder_info_for_auth(
        self,
        auth: Dict[str, Any],
        folder_id_or_url: str,
    ) -> Dict[str, Optional[str]]:
        token = await self.get_destination_access_token(auth)
        return await self._get_folder_info_with_token(token, folder_id_or_url)

    async def _list_folders_with_token(
        self,
        token: str,
        parent_id: str = "root",
        drive_id: Optional[str] = None,
    ) -> List[Dict[str, str]]:
        headers = {"Authorization": f"Bearer {token}"}

        params: Dict[str, Any] = {
            "q": (
                f"'{parent_id}' in parents "
                "and mimeType='application/vnd.google-apps.folder' "
                "and trashed=false"
            ),
            "fields": "files(id,name)",
            "orderBy": "name",
            "pageSize": 100,
        }

        if drive_id and drive_id != "root":
            params["driveId"] = drive_id
            params["includeItemsFromAllDrives"] = "true"
            params["supportsAllDrives"] = "true"
            params["corpora"] = "drive"

        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{GOOGLE_DRIVE_API}/files",
                headers=headers,
                params=params,
            )
            resp.raise_for_status()
            return resp.json().get("files", [])

    async def _list_shared_folders_with_token(
        self,
        token: str,
        query: str = "",
    ) -> List[Dict[str, Optional[str]]]:
        headers = {"Authorization": f"Bearer {token}"}
        safe_query = str(query or "").strip().replace("\\", "\\\\").replace("'", "\\'")
        base_query_parts = [
            "mimeType='application/vnd.google-apps.folder'",
            "trashed=false",
        ]
        if safe_query:
            base_query_parts.insert(0, f"name contains '{safe_query}'")

        async def fetch_folders(*extra_query_parts: str) -> List[Dict[str, Any]]:
            params: Dict[str, Any] = {
                "q": " and ".join([*base_query_parts, *extra_query_parts]),
                "fields": "files(id,name,driveId,webViewLink,ownedByMe,shared)",
                "orderBy": "name",
                "pageSize": 100,
                "supportsAllDrives": "true",
                "includeItemsFromAllDrives": "true",
            }

            async with httpx.AsyncClient() as client:
                resp = await client.get(
                    f"{GOOGLE_DRIVE_API}/files",
                    headers=headers,
                    params=params,
                )
                resp.raise_for_status()
                return resp.json().get("files", [])

        direct_shared = await fetch_folders("sharedWithMe=true")
        broad_candidates = await fetch_folders()

        folders: List[Dict[str, Optional[str]]] = []
        seen_ids: set[str] = set()

        for item in [
            *direct_shared,
            *[
                candidate
                for candidate in broad_candidates
                if candidate.get("shared") and not candidate.get("ownedByMe")
            ],
        ]:
            folder_id = item.get("id")
            if not folder_id or folder_id in seen_ids:
                continue
            seen_ids.add(folder_id)
            folders.append({
                "id": folder_id,
                "name": item.get("name"),
                "drive_id": item.get("driveId"),
                "web_view_link": item.get("webViewLink"),
            })

        return folders

    async def _get_folder_info_with_token(
        self,
        token: str,
        folder_id_or_url: str,
    ) -> Dict[str, Optional[str]]:
        folder_id = extract_google_drive_folder_id(folder_id_or_url)
        headers = {"Authorization": f"Bearer {token}"}

        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{GOOGLE_DRIVE_API}/files/{folder_id}",
                headers=headers,
                params={
                    "fields": "id,name,driveId,mimeType,webViewLink",
                    "supportsAllDrives": "true",
                },
            )

        if resp.status_code in {403, 404}:
            raise ValueError(
                "Folder not found or this Google account/service account does not have access to it"
            )

        resp.raise_for_status()
        folder = resp.json()
        if folder.get("mimeType") != "application/vnd.google-apps.folder":
            raise ValueError("The provided Google Drive link or ID is not a folder")

        return {
            "id": folder.get("id"),
            "name": folder.get("name"),
            "drive_id": folder.get("driveId"),
            "web_view_link": folder.get("webViewLink"),
        }
