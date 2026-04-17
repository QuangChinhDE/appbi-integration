from __future__ import annotations

import os

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from packages.auth.src.password import hash_password
from packages.auth.src.permissions import PRESETS
from packages.database.src.models import AuthProvider, User


def _env_flag(name: str, default: bool = False) -> bool:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default
    return raw_value.strip().lower() in {'1', 'true', 'yes', 'on'}


async def ensure_bootstrap_admin(db: AsyncSession) -> None:
    if not _env_flag('AUTH_BOOTSTRAP_ENABLED', True):
        return

    email = os.getenv('AUTH_BOOTSTRAP_EMAIL', 'admin@appbi.local').strip().lower()
    password = os.getenv('AUTH_BOOTSTRAP_PASSWORD', 'Admin123!').strip()
    full_name = os.getenv('AUTH_BOOTSTRAP_NAME', 'Platform Admin').strip() or 'Platform Admin'

    if not email or not password:
        return

    result = await db.execute(select(User).where(func.lower(User.email) == email))
    existing_user = result.scalar_one_or_none()
    if existing_user:
        return

    db.add(
        User(
            email=email,
            full_name=full_name,
            password_hash=hash_password(password),
            auth_provider=AuthProvider.PASSWORD,
            permissions=PRESETS['admin'].copy(),
        )
    )
    await db.commit()