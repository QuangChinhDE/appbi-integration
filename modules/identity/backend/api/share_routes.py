from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from packages.auth.src import (
    get_current_user,
    get_resource_or_404,
    require_full_access,
    validate_resource_type,
    validate_share_permission,
)
from packages.database.src import get_db
from packages.database.src.models import ResourceShare, User, UserStatus


router = APIRouter(tags=['shares'])


class ShareableUserInfo(BaseModel):
    id: str
    email: str
    full_name: str


class ShareCreateRequest(BaseModel):
    user_id: UUID
    permission: Literal['view', 'edit']


class ShareUpdateRequest(BaseModel):
    permission: Literal['view', 'edit']


class ShareAllTeamRequest(BaseModel):
    permission: Literal['view', 'edit']


class ShareResponse(BaseModel):
    user_id: str
    permission: str
    created_at: datetime
    user: Optional[ShareableUserInfo] = None


def _serialize_share(share: ResourceShare, user_lookup: dict[UUID, User]) -> ShareResponse:
    user = user_lookup.get(share.user_id)
    return ShareResponse(
        user_id=str(share.user_id),
        permission=share.permission,
        created_at=share.created_at,
        user=(
            ShareableUserInfo(
                id=str(user.id),
                email=user.email,
                full_name=user.full_name,
            ) if user else None
        ),
    )


async def _list_share_users(db: AsyncSession, shares: list[ResourceShare]) -> dict[UUID, User]:
    if not shares:
        return {}
    user_ids = {share.user_id for share in shares}
    result = await db.execute(select(User).where(User.id.in_(tuple(user_ids))))
    return {user.id: user for user in result.scalars().all()}


async def _assert_shareable_target(db: AsyncSession, user_id: UUID) -> User:
    result = await db.execute(select(User).where(User.id == user_id))
    target = result.scalar_one_or_none()
    if not target or target.status != UserStatus.ACTIVE:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Target user not found')
    return target


async def _upsert_share(
    db: AsyncSession,
    *,
    resource_type: str,
    resource_id: str,
    user_id: UUID,
    permission: str,
    shared_by: UUID,
) -> None:
    stmt = (
        pg_insert(ResourceShare)
        .values(
            resource_type=resource_type,
            resource_id=resource_id,
            user_id=user_id,
            permission=permission,
            shared_by=shared_by,
        )
        .on_conflict_do_update(
            constraint='uq_resource_shares',
            set_={'permission': permission, 'shared_by': shared_by},
        )
    )
    await db.execute(stmt)


@router.get('/api/shares/{resource_type}/{resource_id}', response_model=list[ShareResponse])
async def list_shares(
    resource_type: str,
    resource_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    normalized_resource_type = validate_resource_type(resource_type)
    resource = await get_resource_or_404(db, normalized_resource_type, resource_id)
    await require_full_access(db, current_user, resource, resource_type=normalized_resource_type)

    result = await db.execute(
        select(ResourceShare)
        .where(
            ResourceShare.resource_type == normalized_resource_type,
            ResourceShare.resource_id == str(resource.id),
        )
        .order_by(ResourceShare.created_at.asc())
    )
    shares = result.scalars().all()
    user_lookup = await _list_share_users(db, shares)
    return [_serialize_share(share, user_lookup) for share in shares]


@router.post('/api/shares/{resource_type}/{resource_id}', response_model=ShareResponse, status_code=status.HTTP_201_CREATED)
async def add_share(
    resource_type: str,
    resource_id: str,
    body: ShareCreateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    normalized_resource_type = validate_resource_type(resource_type)
    permission = validate_share_permission(body.permission)
    resource = await get_resource_or_404(db, normalized_resource_type, resource_id)
    await require_full_access(db, current_user, resource, resource_type=normalized_resource_type)

    if str(body.user_id) == str(current_user.id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='You already own this resource')
    if getattr(resource, 'owner_id', None) is not None and str(resource.owner_id) == str(body.user_id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='The owner already has full access')

    target_user = await _assert_shareable_target(db, body.user_id)
    await _upsert_share(
        db,
        resource_type=normalized_resource_type,
        resource_id=str(resource.id),
        user_id=body.user_id,
        permission=permission,
        shared_by=current_user.id,
    )
    await db.commit()

    result = await db.execute(
        select(ResourceShare).where(
            ResourceShare.resource_type == normalized_resource_type,
            ResourceShare.resource_id == str(resource.id),
            ResourceShare.user_id == body.user_id,
        )
    )
    share = result.scalar_one()
    return _serialize_share(share, {target_user.id: target_user})


@router.put('/api/shares/{resource_type}/{resource_id}/{user_id}', response_model=ShareResponse)
async def update_share(
    resource_type: str,
    resource_id: str,
    user_id: UUID,
    body: ShareUpdateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    normalized_resource_type = validate_resource_type(resource_type)
    permission = validate_share_permission(body.permission)
    resource = await get_resource_or_404(db, normalized_resource_type, resource_id)
    await require_full_access(db, current_user, resource, resource_type=normalized_resource_type)

    target_user = await _assert_shareable_target(db, user_id)
    await _upsert_share(
        db,
        resource_type=normalized_resource_type,
        resource_id=str(resource.id),
        user_id=user_id,
        permission=permission,
        shared_by=current_user.id,
    )
    await db.commit()

    result = await db.execute(
        select(ResourceShare).where(
            ResourceShare.resource_type == normalized_resource_type,
            ResourceShare.resource_id == str(resource.id),
            ResourceShare.user_id == user_id,
        )
    )
    share = result.scalar_one()
    return _serialize_share(share, {target_user.id: target_user})


@router.delete('/api/shares/{resource_type}/{resource_id}/{user_id}', status_code=status.HTTP_204_NO_CONTENT)
async def revoke_share(
    resource_type: str,
    resource_id: str,
    user_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    normalized_resource_type = validate_resource_type(resource_type)
    resource = await get_resource_or_404(db, normalized_resource_type, resource_id)
    await require_full_access(db, current_user, resource, resource_type=normalized_resource_type)

    result = await db.execute(
        select(ResourceShare).where(
            ResourceShare.resource_type == normalized_resource_type,
            ResourceShare.resource_id == str(resource.id),
            ResourceShare.user_id == user_id,
        )
    )
    share = result.scalar_one_or_none()
    if share is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Share not found')

    await db.delete(share)
    await db.commit()
    return None


@router.post('/api/shares/{resource_type}/{resource_id}/all-team', status_code=status.HTTP_204_NO_CONTENT)
async def share_all_team(
    resource_type: str,
    resource_id: str,
    body: ShareAllTeamRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    normalized_resource_type = validate_resource_type(resource_type)
    permission = validate_share_permission(body.permission)
    resource = await get_resource_or_404(db, normalized_resource_type, resource_id)
    await require_full_access(db, current_user, resource, resource_type=normalized_resource_type)

    result = await db.execute(
        select(User).where(User.status == UserStatus.ACTIVE, User.id != current_user.id)
    )
    target_users = [
        user for user in result.scalars().all()
        if getattr(resource, 'owner_id', None) is None or str(resource.owner_id) != str(user.id)
    ]
    for user in target_users:
        await _upsert_share(
            db,
            resource_type=normalized_resource_type,
            resource_id=str(resource.id),
            user_id=user.id,
            permission=permission,
            shared_by=current_user.id,
        )
    await db.commit()
    return None
