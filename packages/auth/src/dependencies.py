from __future__ import annotations

from uuid import UUID

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from packages.auth.src.jwt import decode_access_token
from packages.auth.src.module_registry import get_module_definition
from packages.auth.src.permissions import LEVEL_ORDER, get_user_permissions
from packages.database.src import get_db
from packages.database.src.models import User, UserStatus


_bearer = HTTPBearer(auto_error=False)


def _extract_token(request: Request, credentials: HTTPAuthorizationCredentials | None) -> str | None:
    token = request.cookies.get('access_token')
    if token:
        return token
    if credentials and credentials.scheme.lower() == 'bearer':
        return credentials.credentials
    return None


async def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    token = _extract_token(request, credentials)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Not authenticated')

    try:
        payload = decode_access_token(token)
        user_id = payload.get('sub')
        if not user_id:
            raise ValueError('missing sub')
        parsed_user_id = UUID(str(user_id))
    except (JWTError, ValueError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Invalid or expired token')

    result = await db.execute(select(User).where(User.id == parsed_user_id))
    user = result.scalar_one_or_none()
    if not user or user.status != UserStatus.ACTIVE:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='User not found or deactivated')
    return user


def _enforce_module_dependencies(
    permissions: dict, module: str, effective_level: str,
) -> None:
    """Check cross-module dependencies at runtime (defense-in-depth).

    For example backup:edit requires apps:view.  The dependency is also
    enforced when permissions are assigned, but we double-check here so a
    stale or manually-edited permission set cannot bypass the constraint.
    """
    module_def = get_module_definition(module)
    if module_def is None:
        return
    for dep in module_def.dependencies:
        if LEVEL_ORDER.get(effective_level, 0) < LEVEL_ORDER.get(dep.when_min_level, 0):
            continue
        dep_level = permissions.get(dep.module, 'none')
        if LEVEL_ORDER.get(dep_level, 0) >= LEVEL_ORDER.get(dep.min_level, 0):
            continue
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                dep.message
                or f"{module} {dep.when_min_level}+ requires {dep.module} {dep.min_level} or higher."
            ),
        )


def require_permission(module: str, min_level: str = 'view'):
    async def _check(user: User = Depends(get_current_user)) -> User:
        permissions = get_user_permissions(user)
        level = permissions.get(module, 'none')
        if LEVEL_ORDER.get(level, 0) < LEVEL_ORDER.get(min_level, 0):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Requires '{min_level}' permission on module '{module}'",
            )
        _enforce_module_dependencies(permissions, module, level)
        return user

    return _check


def require_any_permission(requirements: list[tuple[str, str]]):
    async def _check(user: User = Depends(get_current_user)) -> User:
        permissions = get_user_permissions(user)
        for module, min_level in requirements:
            level = permissions.get(module, 'none')
            if LEVEL_ORDER.get(level, 0) >= LEVEL_ORDER.get(min_level, 0):
                return user

        readable = ', '.join(f'{module}:{level}' for module, level in requirements)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f'Requires one of: {readable}',
        )

    return _check