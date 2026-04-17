from __future__ import annotations

import os
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from packages.auth.src import (
    MODULE_ALLOWED_LEVELS,
    PRESETS,
    create_access_token,
    get_current_user,
    get_user_permissions,
    hash_password,
    require_permission,
    validate_permissions,
    verify_password,
)
from packages.database.src import get_db
from packages.database.src.models import AuthProvider, User, UserStatus


router = APIRouter(tags=['identity'])


def _env_flag(name: str, default: bool = False) -> bool:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default
    return raw_value.strip().lower() in {'1', 'true', 'yes', 'on'}


class LoginRequest(BaseModel):
    email: str
    password: str


class UserResponse(BaseModel):
    id: str
    email: str
    full_name: str
    auth_provider: str
    status: str
    last_login_at: datetime | None


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = 'bearer'
    user: UserResponse
    permissions: dict[str, str]
    module_levels: dict[str, list[str]]


class MyPermissionsResponse(BaseModel):
    permissions: dict[str, str]
    module_levels: dict[str, list[str]]


class UserPermissionRow(BaseModel):
    user_id: str
    email: str
    full_name: str
    auth_provider: str
    status: str
    last_login_at: datetime | None
    permissions: dict[str, str]


class PermissionMatrixResponse(BaseModel):
    modules: list[str]
    module_levels: dict[str, list[str]]
    users: list[UserPermissionRow]


class UpdatePermissionsRequest(BaseModel):
    permissions: dict[str, str]


class ApplyPresetRequest(BaseModel):
    preset: str


class PresetsResponse(BaseModel):
    presets: dict[str, dict[str, str]]


class CreateUserRequest(BaseModel):
    email: str
    full_name: str
    password: str | None = None
    preset: str = Field(default='viewer')


class AdminUserRecord(BaseModel):
    id: str
    email: str
    full_name: str
    auth_provider: str
    google_connected: bool
    has_password: bool
    status: str
    last_login_at: datetime | None
    created_at: datetime


class AdminUserCreateRequest(BaseModel):
    email: str
    full_name: str
    auth_provider: str = Field(default=AuthProvider.PASSWORD)
    password: str | None = None


class AdminUserUpdateRequest(BaseModel):
    status: str | None = None


def _serialize_user(user: User) -> UserResponse:
    return UserResponse(
        id=str(user.id),
        email=user.email,
        full_name=user.full_name,
        auth_provider=user.auth_provider,
        status=user.status,
        last_login_at=user.last_login_at,
    )


def _serialize_user_row(user: User) -> UserPermissionRow:
    return UserPermissionRow(
        user_id=str(user.id),
        email=user.email,
        full_name=user.full_name,
        auth_provider=user.auth_provider,
        status=user.status,
        last_login_at=user.last_login_at,
        permissions=get_user_permissions(user),
    )


def _serialize_admin_user(user: User) -> AdminUserRecord:
    return AdminUserRecord(
        id=str(user.id),
        email=user.email,
        full_name=user.full_name,
        auth_provider=user.auth_provider,
        google_connected=bool(user.google_sub) or user.auth_provider == AuthProvider.GOOGLE,
        has_password=bool(user.password_hash),
        status=user.status,
        last_login_at=user.last_login_at,
        created_at=user.created_at,
    )


async def _create_user(
    db: AsyncSession,
    *,
    email: str,
    full_name: str,
    password: str | None,
    preset: str,
    auth_provider: str | None = None,
) -> User:
    if preset not in PRESETS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f'Unknown preset: {preset}')

    normalized_email = email.strip().lower()
    if not normalized_email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Email is required')
    if not full_name.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Full name is required')

    existing = await db.execute(select(User).where(func.lower(User.email) == normalized_email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail='A user with this email already exists')

    normalized_password = password.strip() if password and password.strip() else None
    if auth_provider and auth_provider not in {AuthProvider.PASSWORD, AuthProvider.GOOGLE}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Unsupported auth provider')
    if auth_provider == AuthProvider.PASSWORD and not normalized_password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Password is required for password sign-in')

    password_hash = hash_password(normalized_password) if normalized_password else None
    effective_auth_provider = auth_provider or (AuthProvider.PASSWORD if password_hash else AuthProvider.GOOGLE)

    user = User(
        email=normalized_email,
        full_name=full_name.strip(),
        password_hash=password_hash,
        auth_provider=effective_auth_provider,
        permissions=PRESETS[preset].copy(),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@router.post('/api/auth/login', response_model=LoginResponse)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)):
    if not _env_flag('AUTH_PASSWORD_LOGIN_ENABLED', True):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Password login is disabled.')

    email = body.email.strip().lower()
    result = await db.execute(select(User).where(func.lower(User.email) == email))
    user = result.scalar_one_or_none()

    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Invalid email or password')
    if user.status != UserStatus.ACTIVE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='This account is deactivated')

    user.last_login_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(user)

    return LoginResponse(
        access_token=create_access_token(str(user.id), user.email),
        user=_serialize_user(user),
        permissions=get_user_permissions(user),
        module_levels=MODULE_ALLOWED_LEVELS,
    )


@router.get('/api/auth/me', response_model=LoginResponse)
async def me(current_user: User = Depends(get_current_user)):
    return LoginResponse(
        access_token='',
        user=_serialize_user(current_user),
        permissions=get_user_permissions(current_user),
        module_levels=MODULE_ALLOWED_LEVELS,
    )


@router.post('/api/auth/logout', status_code=status.HTTP_200_OK)
async def logout(_: User = Depends(get_current_user)):
    return {'status': 'ok'}


@router.get('/api/permissions/me', response_model=MyPermissionsResponse)
async def get_my_permissions(current_user: User = Depends(get_current_user)):
    return MyPermissionsResponse(
        permissions=get_user_permissions(current_user),
        module_levels=MODULE_ALLOWED_LEVELS,
    )


@router.get('/api/permissions/presets', response_model=PresetsResponse)
async def get_presets(_: User = Depends(require_permission('settings', 'full'))):
    return PresetsResponse(presets=PRESETS)


@router.get('/api/permissions/matrix', response_model=PermissionMatrixResponse)
async def get_permission_matrix(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_permission('settings', 'full')),
):
    result = await db.execute(select(User).order_by(User.full_name.asc(), User.email.asc()))
    users = result.scalars().all()
    return PermissionMatrixResponse(
        modules=list(MODULE_ALLOWED_LEVELS.keys()),
        module_levels=MODULE_ALLOWED_LEVELS,
        users=[_serialize_user_row(user) for user in users],
    )


@router.post('/api/permissions/users', response_model=UserPermissionRow, status_code=status.HTTP_201_CREATED)
async def create_workspace_user(
    body: CreateUserRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_permission('settings', 'full')),
):
    user = await _create_user(
        db,
        email=body.email,
        full_name=body.full_name,
        password=body.password,
        preset=body.preset,
    )
    return _serialize_user_row(user)


@router.get('/api/users/', response_model=list[AdminUserRecord])
async def list_users(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_permission('settings', 'full')),
):
    result = await db.execute(select(User).order_by(User.full_name.asc(), User.email.asc()))
    users = result.scalars().all()
    return [_serialize_admin_user(user) for user in users]


@router.post('/api/users/', response_model=AdminUserRecord, status_code=status.HTTP_201_CREATED)
async def create_user(
    body: AdminUserCreateRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_permission('settings', 'full')),
):
    user = await _create_user(
        db,
        email=body.email,
        full_name=body.full_name,
        password=body.password,
        preset='viewer',
        auth_provider=body.auth_provider,
    )
    return _serialize_admin_user(user)


@router.put('/api/users/{user_id}', response_model=AdminUserRecord)
async def update_user(
    user_id: UUID,
    body: AdminUserUpdateRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_permission('settings', 'full')),
):
    if body.status is not None and body.status not in {UserStatus.ACTIVE, UserStatus.DEACTIVATED}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Unsupported status')

    result = await db.execute(select(User).where(User.id == user_id))
    target = result.scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='User not found')

    if body.status is not None:
        target.status = body.status

    await db.commit()
    await db.refresh(target)
    return _serialize_admin_user(target)


@router.delete('/api/users/{user_id}', status_code=status.HTTP_200_OK)
async def deactivate_user(
    user_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission('settings', 'full')),
):
    if str(current_user.id) == str(user_id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='You cannot deactivate your own account')

    result = await db.execute(select(User).where(User.id == user_id))
    target = result.scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='User not found')

    target.status = UserStatus.DEACTIVATED
    await db.commit()
    return {'status': 'ok'}


@router.put('/api/permissions/{user_id}', status_code=status.HTTP_200_OK)
async def update_user_permissions(
    user_id: UUID,
    body: UpdatePermissionsRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_permission('settings', 'full')),
):
    try:
        validate_permissions(body.permissions)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    result = await db.execute(select(User).where(User.id == user_id))
    target = result.scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='User not found')

    next_permissions = get_user_permissions(target)
    next_permissions.update(body.permissions)
    target.permissions = next_permissions
    await db.commit()

    return {'status': 'ok', 'permissions': target.permissions}


@router.put('/api/permissions/{user_id}/preset', status_code=status.HTTP_200_OK)
async def apply_preset(
    user_id: UUID,
    body: ApplyPresetRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_permission('settings', 'full')),
):
    if body.preset not in PRESETS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f'Unknown preset: {body.preset}')

    result = await db.execute(select(User).where(User.id == user_id))
    target = result.scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='User not found')

    target.permissions = PRESETS[body.preset].copy()
    await db.commit()
    return {'status': 'ok', 'preset': body.preset, 'permissions': target.permissions}