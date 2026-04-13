import os
import hashlib
import base64
from datetime import datetime, timedelta, timezone
from typing import Optional, List, Dict, Any
from urllib.parse import urlencode

import httpx
from cryptography.fernet import Fernet
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from models import GoogleConnection, AppConfig
from schemas import GoogleConnectionResponse, GoogleDriveItem, GoogleFolderItem

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

# ── Shared encryption helpers (no DB needed) ─────────────────────────────────

def _get_fernet() -> Fernet:
    secret = os.getenv("SECRET_KEY", "change-this-secret-key-in-production-2026")
    key = base64.urlsafe_b64encode(hashlib.sha256(secret.encode()).digest())
    return Fernet(key)

def encrypt_value(value: str) -> str:
    return _get_fernet().encrypt(value.encode()).decode()

def decrypt_value(encrypted: str) -> str:
    return _get_fernet().decrypt(encrypted.encode()).decode()


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
            or os.getenv("GOOGLE_REDIRECT_URI", "https://n8n.base-datateam.com/rest/oauth2-credential/callback")
        )
        return {
            "client_id": client_id,
            "client_secret": client_secret,
            "redirect_uri": redirect_uri,
            "configured": bool(client_id and client_secret),
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

    async def get_valid_access_token(self, connection_id: str) -> str:
        """Return a valid access token, auto-refreshing if expired."""
        result = await self.db.execute(
            select(GoogleConnection).where(GoogleConnection.id == connection_id)
        )
        conn = result.scalar_one_or_none()
        if conn is None:
            raise ValueError("Google connection not found")

        now = datetime.now(timezone.utc)
        expiry = conn.token_expiry
        if expiry is not None and expiry.tzinfo is None:
            expiry = expiry.replace(tzinfo=timezone.utc)

        if expiry is not None and expiry > now + timedelta(minutes=5):
            return self.decrypt(conn.access_token_encrypted)

        if not conn.refresh_token_encrypted:
            raise ValueError("No refresh token stored; user must re-authenticate")

        refresh_token = self.decrypt(conn.refresh_token_encrypted)
        new_tokens = await self._refresh_access_token(refresh_token)

        conn.access_token_encrypted = self.encrypt(new_tokens["access_token"])
        if "expires_in" in new_tokens:
            conn.token_expiry = now + timedelta(seconds=int(new_tokens["expires_in"]))

        await self.db.commit()
        return new_tokens["access_token"]

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
