from typing import List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from modules.backup.shared.types import BackupSourceAppResponse
from packages.database.src.models import BackupSourceApp


class BackupSourceAppService:
    """Service for accessing source app API definitions."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_source_apps(self) -> List[BackupSourceAppResponse]:
        query = select(BackupSourceApp).where(BackupSourceApp.is_active == True)
        result = await self.db.execute(query)
        apps = result.scalars().all()
        return [BackupSourceAppResponse.model_validate(app) for app in apps]

    async def get_source_app(self, app_id: str) -> Optional[BackupSourceAppResponse]:
        query = select(BackupSourceApp).where(
            BackupSourceApp.app_id == app_id,
            BackupSourceApp.is_active == True,
        )
        result = await self.db.execute(query)
        app = result.scalar_one_or_none()
        if not app:
            return None
        return BackupSourceAppResponse.model_validate(app)