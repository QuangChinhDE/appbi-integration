from typing import Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from modules.backup.backend.services.backup_flow_service import BackupFlowService
from modules.credentials.backend.services.google_auth_service import (
    AppConfigService,
    resolve_destination_google_auth_mode,
)
from modules.destinations.shared.types import (
    DestinationProfileApplyResponse,
    DestinationProfileCreate,
    DestinationProfileDetail,
    DestinationProfileListItem,
    DestinationProfileUpdate,
)
from packages.database.src.models import DestinationProfile, GoogleConnection


DESTINATION_NAME_MAP = {
    "gdrive": "Google Drive",
    "gsheets": "Google Sheets",
}


class DestinationProfileService:
    def __init__(self, db: AsyncSession):
        self.db = db

    @staticmethod
    def _parse_uuid(raw_value: str, label: str = "destination profile") -> UUID:
        try:
            return UUID(str(raw_value))
        except (TypeError, ValueError) as exc:
            raise ValueError(f"Invalid {label} ID") from exc

    @staticmethod
    def _build_connection_label(auth: dict) -> Optional[str]:
        return (
            auth.get("display_name")
            or auth.get("email")
            or auth.get("google_oauth_email")
            or auth.get("service_account_email")
            or None
        )

    @classmethod
    def _build_list_item(cls, profile: DestinationProfile) -> DestinationProfileListItem:
        auth = dict(profile.auth or {})
        return DestinationProfileListItem(
            id=profile.id,
            name=profile.name,
            description=profile.description,
            destination_type=profile.destination_type,
            destination_name=DESTINATION_NAME_MAP.get(profile.destination_type, profile.destination_type),
            auth_mode=profile.auth_mode,
            connection_label=cls._build_connection_label(auth),
            folder_name=auth.get("folder_name"),
            drive_name=auth.get("drive_name"),
            created_at=profile.created_at,
            updated_at=profile.updated_at,
        )

    @classmethod
    def _build_detail(cls, profile: DestinationProfile) -> DestinationProfileDetail:
        item = cls._build_list_item(profile)
        return DestinationProfileDetail(**item.model_dump(), auth=dict(profile.auth or {}))

    @classmethod
    def _build_destination_snapshot(cls, profile: DestinationProfile) -> dict:
        return {
            "destination_profile_id": str(profile.id),
            "type": profile.destination_type,
            "name": DESTINATION_NAME_MAP.get(profile.destination_type, profile.destination_type),
            "auth": dict(profile.auth or {}),
        }

    async def list_destinations(self, destination_type: Optional[str] = None) -> list[DestinationProfileListItem]:
        stmt = select(DestinationProfile).order_by(DestinationProfile.updated_at.desc(), DestinationProfile.created_at.desc())
        if destination_type:
            stmt = stmt.where(DestinationProfile.destination_type == destination_type)
        result = await self.db.execute(stmt)
        return [self._build_list_item(item) for item in result.scalars().all()]

    async def get_destination(self, destination_id: str) -> Optional[DestinationProfileDetail]:
        model = await self._get_model(destination_id)
        if not model:
            return None
        return self._build_detail(model)

    async def get_destination_snapshot(self, destination_id: str) -> Optional[DestinationProfileApplyResponse]:
        model = await self._get_model(destination_id)
        if not model:
            return None
        return DestinationProfileApplyResponse(id=model.id, destination=self._build_destination_snapshot(model))

    async def create_destination(self, payload: DestinationProfileCreate) -> DestinationProfileDetail:
        prepared_auth, auth_mode = await self._prepare_auth(payload.destination_type, payload.auth)
        model = DestinationProfile(
            name=payload.name.strip(),
            description=(payload.description or "").strip() or None,
            destination_type=payload.destination_type,
            auth_mode=auth_mode,
            auth=prepared_auth,
        )
        self.db.add(model)
        await self.db.commit()
        await self.db.refresh(model)
        return self._build_detail(model)

    async def update_destination(self, destination_id: str, payload: DestinationProfileUpdate) -> Optional[DestinationProfileDetail]:
        model = await self._get_model(destination_id)
        if not model:
            return None

        next_type = payload.destination_type or model.destination_type
        next_auth_input = payload.auth if payload.auth is not None else dict(model.auth or {})
        prepared_auth, auth_mode = await self._prepare_auth(next_type, next_auth_input)

        if payload.name is not None:
            model.name = payload.name.strip()
        if payload.description is not None:
            model.description = payload.description.strip() or None
        if payload.destination_type is not None:
            model.destination_type = payload.destination_type
        model.auth_mode = auth_mode
        model.auth = prepared_auth

        await self.db.commit()
        await self.db.refresh(model)
        return self._build_detail(model)

    async def delete_destination(self, destination_id: str) -> bool:
        model = await self._get_model(destination_id)
        if not model:
            return False
        await self.db.delete(model)
        await self.db.commit()
        return True

    async def _prepare_auth(self, destination_type: str, auth: dict) -> tuple[dict, str]:
        prepared = BackupFlowService.prepare_destination({
            "type": destination_type,
            "name": DESTINATION_NAME_MAP.get(destination_type, destination_type),
            "auth": dict(auth or {}),
        })
        prepared_auth = dict(prepared.get("auth") or {})
        auth_mode = resolve_destination_google_auth_mode(prepared_auth)

        if auth_mode == "google_oauth":
            connection_id = prepared_auth.get("connection_id") or prepared_auth.get("google_oauth_connection_id")
            if not connection_id:
                raise ValueError("Select a saved Google OAuth connection for this destination")
            parsed_connection_id = self._parse_uuid(connection_id, label="Google connection")
            connection = await self.db.get(GoogleConnection, parsed_connection_id)
            if not connection:
                raise ValueError("Selected Google connection was not found")
            prepared_auth["connection_id"] = str(connection.id)
            prepared_auth["google_oauth_connection_id"] = str(connection.id)
            prepared_auth["email"] = prepared_auth.get("email") or connection.email
            prepared_auth["google_oauth_email"] = prepared_auth.get("google_oauth_email") or connection.email
            prepared_auth["display_name"] = prepared_auth.get("display_name") or connection.display_name or connection.email
            prepared_auth["picture_url"] = prepared_auth.get("picture_url") or connection.picture_url or ""
            return prepared_auth, "google_oauth"

        if prepared_auth.get("uses_platform_service_account"):
            platform_config = await AppConfigService(self.db).get_platform_service_account_config()
            if not platform_config.get("configured"):
                raise ValueError("Shared platform service account is not configured")
            prepared_auth["service_account_email"] = (
                prepared_auth.get("service_account_email")
                or platform_config.get("service_account_email")
            )
        elif not prepared_auth.get("service_account_json_encrypted"):
            raise ValueError("Provide a Google service account JSON key or use the shared platform credential")

        return prepared_auth, "service_account"

    async def _get_model(self, destination_id: str) -> Optional[DestinationProfile]:
        parsed_id = self._parse_uuid(destination_id)
        result = await self.db.execute(select(DestinationProfile).where(DestinationProfile.id == parsed_id))
        return result.scalar_one_or_none()