from __future__ import annotations

from typing import Dict, Iterable, Optional, Sequence
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import String, cast, false, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from packages.auth.src.permissions import LEVEL_ORDER, get_user_permissions
from packages.database.src.models import (
    AppCredential,
    BackupFlow,
    DataPipeline,
    ResourceShare,
    ResourceType,
    SharePermission,
    User,
)


RESOURCE_TO_MODULE: Dict[str, str] = {
    ResourceType.APP_CREDENTIAL: 'apps',
    ResourceType.BACKUP_FLOW: 'backup',
    ResourceType.DATA_PIPELINE: 'pipeline',
}

RESOURCE_TO_MODEL = {
    ResourceType.APP_CREDENTIAL: AppCredential,
    ResourceType.BACKUP_FLOW: BackupFlow,
    ResourceType.DATA_PIPELINE: DataPipeline,
}

MODEL_TO_RESOURCE: Dict[str, str] = {
    'AppCredential': ResourceType.APP_CREDENTIAL,
    'BackupFlow': ResourceType.BACKUP_FLOW,
    'DataPipeline': ResourceType.DATA_PIPELINE,
}


def get_user_module_permission(user: User, module: str) -> str:
    return get_user_permissions(user).get(module, 'none')


def apply_resource_scope(stmt, model, resource_type: str, user: User, module: Optional[str] = None):
    module_name = module or RESOURCE_TO_MODULE.get(resource_type)
    if not module_name:
        return stmt.where(false())

    module_level = get_user_module_permission(user, module_name)
    if module_level == 'none':
        return stmt.where(false())
    if module_level == 'full':
        return stmt

    owner_col = getattr(model, 'owner_id', None)
    if owner_col is None:
        return stmt.where(false())

    shared_ids = select(ResourceShare.resource_id).where(
        ResourceShare.resource_type == resource_type,
        ResourceShare.user_id == user.id,
    )
    return stmt.where(
        or_(
            owner_col == user.id,
            cast(model.id, String).in_(shared_ids),
        )
    )


async def get_resource_or_404(
    db: AsyncSession,
    resource_type: str,
    resource_id: str,
):
    model = RESOURCE_TO_MODEL.get(resource_type)
    if model is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Unsupported resource type')

    try:
        parsed_id = UUID(str(resource_id))
    except (TypeError, ValueError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Resource not found')

    resource = await db.get(model, parsed_id)
    if resource is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Resource not found')
    return resource


async def fetch_owner_email_lookup(db: AsyncSession, owner_ids: Iterable[UUID | None]) -> Dict[UUID, str]:
    resolved_owner_ids = {owner_id for owner_id in owner_ids if owner_id is not None}
    if not resolved_owner_ids:
        return {}

    result = await db.execute(
        select(User.id, User.email).where(User.id.in_(tuple(resolved_owner_ids)))
    )
    return {row[0]: row[1] for row in result.all()}


async def stamp_owner_emails(db: AsyncSession, items: Sequence[object]) -> Dict[UUID, str]:
    lookup = await fetch_owner_email_lookup(
        db,
        (getattr(item, 'owner_id', None) for item in items),
    )
    for item in items:
        owner_id = getattr(item, 'owner_id', None)
        if owner_id is not None:
            setattr(item, 'owner_email', lookup.get(owner_id))
    return lookup


async def batch_effective_permissions(
    db: AsyncSession,
    user: User,
    resources: Sequence[object],
    *,
    module: Optional[str] = None,
    resource_type: Optional[str] = None,
) -> Dict[str, str]:
    if not resources:
        return {}

    resolved_resource_type = resource_type or MODEL_TO_RESOURCE.get(type(resources[0]).__name__)
    if resolved_resource_type is None:
        return {str(getattr(resource, 'id', '')): 'none' for resource in resources}

    module_name = module or RESOURCE_TO_MODULE.get(resolved_resource_type)
    module_level = get_user_module_permission(user, module_name or '')
    if module_level == 'none':
        return {str(resource.id): 'none' for resource in resources}
    if module_level == 'full':
        return {str(resource.id): 'full' for resource in resources}

    resource_ids = [str(resource.id) for resource in resources]
    result = await db.execute(
        select(ResourceShare.resource_id, ResourceShare.permission).where(
            ResourceShare.resource_type == resolved_resource_type,
            ResourceShare.resource_id.in_(resource_ids),
            ResourceShare.user_id == user.id,
        )
    )
    share_lookup = {row[0]: row[1] for row in result.all()}

    permissions: Dict[str, str] = {}
    for resource in resources:
        resource_key = str(resource.id)
        owner_id = getattr(resource, 'owner_id', None)
        if owner_id is not None and str(owner_id) == str(user.id):
            permissions[resource_key] = 'full'
            continue

        share_level = share_lookup.get(resource_key)
        if share_level:
            if LEVEL_ORDER.get(share_level, 0) <= LEVEL_ORDER.get(module_level, 0):
                permissions[resource_key] = share_level
            else:
                permissions[resource_key] = module_level
            continue

        permissions[resource_key] = 'none'

    return permissions


async def get_effective_permission(
    db: AsyncSession,
    user: User,
    resource: object,
    *,
    module: Optional[str] = None,
    resource_type: Optional[str] = None,
) -> str:
    resolved_resource_type = resource_type or MODEL_TO_RESOURCE.get(type(resource).__name__)
    module_name = module or RESOURCE_TO_MODULE.get(resolved_resource_type or '')
    if not resolved_resource_type or not module_name:
        return 'none'

    module_level = get_user_module_permission(user, module_name)
    if module_level == 'none':
        return 'none'
    if module_level == 'full':
        return 'full'

    owner_id = getattr(resource, 'owner_id', None)
    if owner_id is not None and str(owner_id) == str(user.id):
        return 'full'

    result = await db.execute(
        select(ResourceShare.permission).where(
            ResourceShare.resource_type == resolved_resource_type,
            ResourceShare.resource_id == str(resource.id),
            ResourceShare.user_id == user.id,
        )
    )
    share_level = result.scalar_one_or_none()
    if share_level is None:
        return 'none'
    if LEVEL_ORDER.get(share_level, 0) <= LEVEL_ORDER.get(module_level, 0):
        return share_level
    return module_level


async def require_view_access(
    db: AsyncSession,
    user: User,
    resource: object,
    *,
    module: Optional[str] = None,
    resource_type: Optional[str] = None,
) -> str:
    effective = await get_effective_permission(
        db,
        user,
        resource,
        module=module,
        resource_type=resource_type,
    )
    if effective == 'none':
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail='Permission denied: view access required',
        )
    return effective


async def require_edit_access(
    db: AsyncSession,
    user: User,
    resource: object,
    *,
    module: Optional[str] = None,
    resource_type: Optional[str] = None,
) -> str:
    effective = await get_effective_permission(
        db,
        user,
        resource,
        module=module,
        resource_type=resource_type,
    )
    if LEVEL_ORDER.get(effective, 0) < LEVEL_ORDER['edit']:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail='Permission denied: edit access required',
        )
    return effective


async def require_full_access(
    db: AsyncSession,
    user: User,
    resource: object,
    *,
    module: Optional[str] = None,
    resource_type: Optional[str] = None,
) -> str:
    effective = await get_effective_permission(
        db,
        user,
        resource,
        module=module,
        resource_type=resource_type,
    )
    if effective != 'full':
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail='Permission denied: owner or full access required',
        )
    return effective


def validate_share_permission(permission: str) -> str:
    normalized = str(permission or '').strip().lower()
    if normalized not in SharePermission.CHOICES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail='Invalid share permission',
        )
    return normalized


def validate_resource_type(resource_type: str) -> str:
    normalized = str(resource_type or '').strip().lower()
    if normalized not in ResourceType.CHOICES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail='Unsupported resource type',
        )
    return normalized
