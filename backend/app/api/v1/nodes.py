"""Node library routes (SRS 23.6).

`engine_binding` is served only to a platform admin, and only from the admin
router: `n8n-nodes-base.httpRequest` is an engine detail, not a product node key
(guardrail 9).
"""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from app.api.deps import AdminDep, CtxDep, SessionDep
from app.core.permissions import Action, Module
from app.services import audit, catalog

router = APIRouter(prefix="/nodes", tags=["nodes"])
admin_router = APIRouter(prefix="/admin/nodes", tags=["admin"])


class CertifyRequest(BaseModel):
    certification: str


class StatusRequest(BaseModel):
    status: str


@router.get("")
async def list_nodes(
    ctx: CtxDep,
    session: SessionDep,
    q: str | None = None,
    category: str | None = None,
) -> dict:
    ctx.require(Module.NODES, Action.VIEW)
    return {
        "items": await catalog.list_nodes(
            session, query=q, category=category,
            include_hidden=ctx.is_platform_admin,
            include_binding=False),
    }


@router.get("/{node_key}")
async def get_node(node_key: str, ctx: CtxDep, session: SessionDep) -> dict:
    ctx.require(Module.NODES, Action.VIEW)
    return await catalog.get_node(session, node_key, include_binding=False)


@router.get("/{node_key}/config-schema")
async def config_schema(node_key: str, ctx: CtxDep, session: SessionDep) -> dict:
    ctx.require(Module.NODES, Action.VIEW)
    node = await catalog.get_node(session, node_key, include_binding=False)
    return {
        "node_key": node["node_key"],
        "product_schema_version": node["product_schema_version"],
        "config_schema": node["config_schema"],
        "capability": node["capability"],
        "spec_hash": node["spec_hash"],
    }


@admin_router.get("")
async def admin_list_nodes(ctx: AdminDep, session: SessionDep) -> dict:
    return {
        "items": await catalog.list_nodes(
            session, include_hidden=True, include_binding=True),
    }


@admin_router.post("/{node_key}/certify")
async def certify(
    node_key: str, payload: CertifyRequest, ctx: AdminDep, session: SessionDep
) -> dict:
    result = await catalog.set_certification(session, node_key, payload.certification)
    await audit.record(
        session, ctx, action="node.certification_changed", resource_type="NODE",
        resource_label=node_key, after={"certification": payload.certification})
    await session.commit()
    return result


@admin_router.post("/{node_key}/status")
async def set_status(
    node_key: str, payload: StatusRequest, ctx: AdminDep, session: SessionDep
) -> dict:
    result = await catalog.set_status(session, node_key, payload.status)
    await audit.record(
        session, ctx, action="node.status_changed", resource_type="NODE",
        resource_label=node_key, after={"status": payload.status})
    await session.commit()
    return result
