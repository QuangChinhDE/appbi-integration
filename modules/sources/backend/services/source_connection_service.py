from typing import Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from modules.credentials.backend.services.google_auth_service import decrypt_value, encrypt_value
from modules.sources.shared.types import (
    SUPPORTED_SOURCE_APPS,
    SourceConnectionApplyResponse,
    SourceConnectionCreate,
    SourceConnectionDetail,
    SourceConnectionListItem,
    SourceConnectionUpdate,
)
from packages.database.src.models import SourceConnection


APPS_REQUIRING_DOMAIN = {"request", "workflow", "wework", "service"}


class SourceConnectionService:
    def __init__(self, db: AsyncSession):
        self.db = db

    @staticmethod
    def _parse_uuid(raw_value: str) -> UUID:
        try:
            return UUID(str(raw_value))
        except (TypeError, ValueError) as exc:
            raise ValueError("Invalid source connection ID") from exc

    @staticmethod
    def _resolve_app_name(app_id: str, app_name: Optional[str]) -> str:
        return (app_name or SUPPORTED_SOURCE_APPS.get(app_id) or app_id).strip()

    @staticmethod
    def _validate_domain(app_id: str, domain: Optional[str]) -> None:
        if app_id in APPS_REQUIRING_DOMAIN and not str(domain or "").strip():
            raise ValueError(f"domain is required for {app_id} sources")

    @classmethod
    def _build_list_item(cls, source: SourceConnection) -> SourceConnectionListItem:
        return SourceConnectionListItem(
            id=source.id,
            name=source.name,
            description=source.description,
            app_id=source.app_id,
            app_name=source.app_name,
            domain=source.domain,
            config=source.config,
            created_at=source.created_at,
            updated_at=source.updated_at,
        )

    @classmethod
    def _build_detail(cls, source: SourceConnection) -> SourceConnectionDetail:
        detail = cls._build_list_item(source)
        return SourceConnectionDetail(
            **detail.model_dump(),
            access_token=decrypt_value(source.access_token_encrypted),
        )

    @classmethod
    def _build_source_snapshot(cls, source: SourceConnection) -> dict:
        payload = {
            "source_connection_id": str(source.id),
            "app": source.app_id,
            "app_name": source.app_name,
            "domain": source.domain,
            "access_token": decrypt_value(source.access_token_encrypted),
        }
        if source.config:
            payload.update(dict(source.config))
        return payload

    async def list_sources(self, app_id: Optional[str] = None) -> list[SourceConnectionListItem]:
        stmt = select(SourceConnection).order_by(SourceConnection.updated_at.desc(), SourceConnection.created_at.desc())
        if app_id:
            stmt = stmt.where(SourceConnection.app_id == app_id)
        result = await self.db.execute(stmt)
        return [self._build_list_item(item) for item in result.scalars().all()]

    async def get_source(self, source_id: str) -> Optional[SourceConnectionDetail]:
        model = await self._get_model(source_id)
        if not model:
            return None
        return self._build_detail(model)

    async def get_source_snapshot(self, source_id: str) -> Optional[SourceConnectionApplyResponse]:
        model = await self._get_model(source_id)
        if not model:
            return None
        return SourceConnectionApplyResponse(id=model.id, source=self._build_source_snapshot(model))

    async def create_source(self, payload: SourceConnectionCreate) -> SourceConnectionDetail:
        self._validate_domain(payload.app_id, payload.domain)
        model = SourceConnection(
            name=payload.name.strip(),
            description=(payload.description or "").strip() or None,
            app_id=payload.app_id,
            app_name=self._resolve_app_name(payload.app_id, payload.app_name),
            domain=payload.domain,
            access_token_encrypted=encrypt_value(payload.access_token),
            config=payload.config or None,
        )
        self.db.add(model)
        await self.db.commit()
        await self.db.refresh(model)
        return self._build_detail(model)

    async def update_source(self, source_id: str, payload: SourceConnectionUpdate) -> Optional[SourceConnectionDetail]:
        model = await self._get_model(source_id)
        if not model:
            return None

        next_app_id = payload.app_id or model.app_id
        next_domain = payload.domain if payload.domain is not None else model.domain
        self._validate_domain(next_app_id, next_domain)

        if payload.name is not None:
            model.name = payload.name.strip()
        if payload.description is not None:
            model.description = payload.description.strip() or None
        if payload.app_id is not None:
            model.app_id = payload.app_id
            model.app_name = self._resolve_app_name(payload.app_id, payload.app_name or model.app_name)
        elif payload.app_name is not None:
            model.app_name = self._resolve_app_name(model.app_id, payload.app_name)
        if payload.domain is not None:
            model.domain = payload.domain
        if payload.access_token is not None:
            model.access_token_encrypted = encrypt_value(payload.access_token)
        if payload.config is not None:
            model.config = payload.config or None

        await self.db.commit()
        await self.db.refresh(model)
        return self._build_detail(model)

    async def delete_source(self, source_id: str) -> bool:
        model = await self._get_model(source_id)
        if not model:
            return False
        await self.db.delete(model)
        await self.db.commit()
        return True

    async def _get_model(self, source_id: str) -> Optional[SourceConnection]:
        parsed_id = self._parse_uuid(source_id)
        result = await self.db.execute(select(SourceConnection).where(SourceConnection.id == parsed_id))
        return result.scalar_one_or_none()