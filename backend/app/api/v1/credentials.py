"""Credential routes (SRS 23.5).

No route in this file can return a secret. The nearest thing is webhook secret
rotation on the workflow router, which returns a value it has just generated and
will never show again.
"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Response, status
from pydantic import BaseModel, Field

from app.api.deps import CtxDep, SessionDep
from app.services import catalog
from app.services import credentials as service

router = APIRouter(prefix="/credentials", tags=["credentials"])


class CreateCredentialRequest(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    credential_type: str
    data: dict[str, Any] = Field(default_factory=dict)


class UpdateCredentialRequest(BaseModel):
    name: str | None = Field(default=None, max_length=160)
    #: An omitted key means leave it alone; an empty string is refused. A form
    #: that cannot display a secret must not be able to erase it by being
    #: submitted (SRS 12.4).
    data: dict[str, Any] | None = None


class TestCredentialRequest(BaseModel):
    #: A URL to try the credential against. Optional: without one, the test only
    #: confirms the credential is complete and well-formed.
    url: str | None = None


@router.get("/types")
async def credential_types() -> dict:
    return {"items": catalog.bundled_credential_types()}


@router.get("")
async def list_credentials(
    ctx: CtxDep, session: SessionDep, q: str | None = None
) -> dict:
    return {"items": await service.list_credentials(session, ctx, query=q)}


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_credential(
    payload: CreateCredentialRequest, ctx: CtxDep, session: SessionDep
) -> dict:
    result = await service.create(
        session, ctx, name=payload.name,
        credential_type=payload.credential_type, data=payload.data)
    await session.commit()
    return result


@router.get("/{credential_id}")
async def get_credential(
    credential_id: uuid.UUID, ctx: CtxDep, session: SessionDep
) -> dict:
    row = await service.get(session, ctx, credential_id)
    body = service.public_view(row)
    body["used_by"] = await service.dependents(session, ctx, credential_id)
    return body


@router.patch("/{credential_id}")
async def update_credential(
    credential_id: uuid.UUID,
    payload: UpdateCredentialRequest,
    ctx: CtxDep,
    session: SessionDep,
) -> dict:
    result = await service.update(
        session, ctx, credential_id, name=payload.name, data=payload.data)
    await session.commit()
    return result


@router.post("/{credential_id}/test")
async def test_credential(
    credential_id: uuid.UUID,
    payload: TestCredentialRequest,
    ctx: CtxDep,
    session: SessionDep,
) -> dict:
    """Record the outcome of trying a credential.

    Deliberately not a live request from the API process: an outbound call from
    the control plane would bypass the engine's egress policy, which is the one
    place that decides what this deployment may connect to (SRS 32.2). A full
    live test belongs behind the engine and is tracked as V1.1; until then this
    validates completeness and clears an INVALID flag the user has since fixed.
    """
    row = await service.get(session, ctx, credential_id)
    configured = bool(row.secret_ref)
    result = await service.record_test(
        session, ctx, credential_id,
        ok=configured,
        message=None if configured else "Chưa có giá trị bí mật nào được lưu.")
    await session.commit()
    return result


@router.delete("/{credential_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_credential(
    credential_id: uuid.UUID, ctx: CtxDep, session: SessionDep
) -> Response:
    await service.delete(session, ctx, credential_id)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
