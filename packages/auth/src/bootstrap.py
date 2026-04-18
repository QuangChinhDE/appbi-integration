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


def _first_env(*names: str, default: str = '') -> str:
    """Return the first non-empty env var among the given names."""
    for name in names:
        value = os.getenv(name)
        if value is not None and value.strip():
            return value
    return default


def _resolve_bootstrap_permissions() -> dict[str, str]:
    preset_name = _first_env('AUTH_BOOTSTRAP_PRESET', 'ADMIN_PERMISSION_PRESET', default='admin').strip().lower()
    if preset_name not in PRESETS:
        preset_name = 'admin'
    return PRESETS[preset_name].copy()


async def ensure_bootstrap_admin(db: AsyncSession) -> None:
    # Accept the appbi-ai style names (ADMIN_*) and fall back to the
    # legacy AUTH_BOOTSTRAP_* names so existing .env files keep working.
    if not _env_flag('AUTH_BOOTSTRAP_ENABLED', True):
        return

    email = _first_env('ADMIN_EMAIL', 'AUTH_BOOTSTRAP_EMAIL', default='admin@appbi.local').strip().lower()
    password = _first_env('ADMIN_PASSWORD', 'AUTH_BOOTSTRAP_PASSWORD', default='CHANGE_ME').strip()
    full_name = (
        _first_env('ADMIN_NAME', 'AUTH_BOOTSTRAP_NAME', default='Platform Admin').strip()
        or 'Platform Admin'
    )

    if not email or not password:
        return

    bootstrap_permissions = _resolve_bootstrap_permissions()

    result = await db.execute(select(User).where(func.lower(User.email) == email))
    existing_user = result.scalar_one_or_none()
    if existing_user:
        current_permissions = dict(existing_user.permissions or {})
        missing_permissions = {
            key: value
            for key, value in bootstrap_permissions.items()
            if key not in current_permissions
        }
        if missing_permissions:
            current_permissions.update(missing_permissions)
            existing_user.permissions = current_permissions
            await db.commit()
        return

    db.add(
        User(
            email=email,
            full_name=full_name,
            password_hash=hash_password(password),
            auth_provider=AuthProvider.PASSWORD,
            permissions=bootstrap_permissions,
        )
    )
    await db.commit()