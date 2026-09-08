"""Node registry service (SRS 11).

Seeds `node_definitions` from the bundled JSON at boot and answers catalogue
questions afterwards. Two properties matter:

* the palette renders from the product database, so an engine outage does not
  empty it (SRS 11.4);
* `engine_binding` is stripped from every public projection. It leaves this
  module only through the admin view (guardrail 9).
"""

from __future__ import annotations

import hashlib
import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import utcnow
from app.core.errors import NotFoundError
from app.models.catalog import NodeDefinition
from app.models.enums import Certification, NodeCategory, NodeStatus

REGISTRY_PATH = Path(__file__).resolve().parent.parent / "resources" / "node_registry.json"


@lru_cache(maxsize=1)
def _bundle() -> dict[str, Any]:
    return json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))


def bundled_nodes() -> list[dict[str, Any]]:
    return list(_bundle()["nodes"])


def bundled_credential_types() -> list[dict[str, Any]]:
    return list(_bundle().get("credential_types") or [])


def spec_hash(schema: dict[str, Any]) -> str:
    material = json.dumps(schema, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(material.encode()).hexdigest()[:32]


async def seed(session: AsyncSession) -> tuple[int, int]:
    """Upsert the bundled catalogue. Returns `(created, updated)`.

    A schema change updates the definition and its `spec_hash` but never
    touches a stored workflow: an existing node keeps the config it was saved
    with, and migration is the compiler's job (SRS 25.5). That is why this
    writes definitions only.
    """
    existing = {
        row.node_key: row
        for row in (await session.scalars(select(NodeDefinition))).all()
    }
    created = updated = 0

    for entry in bundled_nodes():
        key = entry["node_key"]
        schema = entry.get("config_schema") or {}
        digest = spec_hash({
            "config_schema": schema,
            "capability": entry.get("capability") or {},
            "engine_binding": entry.get("engine_binding") or {},
        })
        row = existing.get(key)
        if row is None:
            session.add(NodeDefinition(
                node_key=key,
                display_name=entry["display_name"],
                category=NodeCategory(entry["category"]),
                description=entry.get("description"),
                icon=entry.get("icon"),
                product_schema_version=int(entry.get("product_schema_version", 1)),
                config_schema=schema,
                capability_json=entry.get("capability") or {},
                certification=Certification(entry.get("certification", "BETA")),
                status=NodeStatus(entry.get("status", "ACTIVE")),
                engine_binding=entry.get("engine_binding") or {},
                security_profile=entry.get("security_profile") or {},
                docs_ref=entry.get("docs_ref"),
                spec_hash=digest,
                last_certified_at=utcnow()
                if entry.get("certification") == "SUPPORTED" else None,
            ))
            created += 1
            continue

        if row.spec_hash == digest and row.display_name == entry["display_name"]:
            continue
        row.display_name = entry["display_name"]
        row.category = NodeCategory(entry["category"])
        row.description = entry.get("description")
        row.icon = entry.get("icon")
        row.config_schema = schema
        row.capability_json = entry.get("capability") or {}
        row.engine_binding = entry.get("engine_binding") or {}
        row.security_profile = entry.get("security_profile") or {}
        row.docs_ref = entry.get("docs_ref")
        row.spec_hash = digest
        # Certification and status are deliberately not overwritten: an admin
        # who disabled a node in production must not have that undone by a
        # deploy that only changed a label.
        updated += 1

    await session.flush()
    return created, updated


async def definitions_map(session: AsyncSession) -> dict[str, dict[str, Any]]:
    """`node_key` -> registry entry, in the shape `services.graph` expects.

    Includes `engine_binding`, because the compiler snapshot needs it. Never
    hand the result of this straight to a response model.
    """
    rows = (await session.scalars(select(NodeDefinition))).all()
    return {
        row.node_key: {
            "node_key": row.node_key,
            "display_name": row.display_name,
            "category": row.category.value,
            "config_schema": row.config_schema or {},
            "capability": row.capability_json or {},
            "certification": row.certification.value,
            "status": row.status.value,
            "product_schema_version": row.product_schema_version,
            "engine_binding": row.engine_binding or {},
            "security_profile": row.security_profile or {},
        }
        for row in rows
    }


def registry_snapshot(definitions: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """What the engine receives with an execution request.

    Sent per request rather than configured in the engine so that a registry
    edit cannot retroactively change how an already-published version compiles
    (SRS 25.1).
    """
    return {
        key: {
            "node_key": key,
            "engine_binding": entry.get("engine_binding") or {},
            "capability": entry.get("capability") or {},
            "product_schema_version": entry.get("product_schema_version", 1),
            "certification": entry.get("certification"),
            "status": entry.get("status"),
        }
        for key, entry in definitions.items()
    }


def public_view(row: NodeDefinition, *, include_binding: bool = False) -> dict[str, Any]:
    body: dict[str, Any] = {
        "node_key": row.node_key,
        "display_name": row.display_name,
        "category": row.category.value,
        "description": row.description,
        "icon": row.icon,
        "certification": row.certification.value,
        "status": row.status.value,
        "product_schema_version": row.product_schema_version,
        "config_schema": row.config_schema or {},
        "capability": row.capability_json or {},
        "credential_types": (row.capability_json or {}).get("credential_types") or [],
        "security_profile": row.security_profile or {},
        "docs_ref": row.docs_ref,
        "spec_hash": row.spec_hash,
        "last_certified_at": row.last_certified_at,
        "known_issues": row.known_issues,
    }
    if include_binding:
        # Admin/debug only, and audited by the endpoint that sets this flag.
        body["engine_binding"] = row.engine_binding or {}
    return body


async def list_nodes(
    session: AsyncSession,
    *,
    query: str | None = None,
    category: str | None = None,
    include_hidden: bool = False,
    include_binding: bool = False,
) -> list[dict[str, Any]]:
    statement = select(NodeDefinition).order_by(
        NodeDefinition.category, NodeDefinition.display_name)
    rows = list((await session.scalars(statement)).all())

    def visible(row: NodeDefinition) -> bool:
        if include_hidden:
            return True
        # HIDDEN and BLOCKED are not "listed with a badge": one is not ready to
        # be seen and the other is refused by the compiler. Showing either in
        # the palette would offer a node that cannot be used.
        return row.certification not in (Certification.HIDDEN, Certification.BLOCKED)

    out = [row for row in rows if visible(row)]
    if category:
        out = [row for row in out if row.category.value == category.upper()]
    if query:
        needle = query.strip().lower()
        out = [
            row for row in out
            if needle in row.display_name.lower()
            or needle in (row.description or "").lower()
            or needle in row.node_key
        ]
    return [public_view(row, include_binding=include_binding) for row in out]


async def get_node(
    session: AsyncSession, node_key: str, *, include_binding: bool = False
) -> dict[str, Any]:
    row = await session.scalar(
        select(NodeDefinition).where(NodeDefinition.node_key == node_key))
    if row is None:
        raise NotFoundError(f"Không tìm thấy loại bước '{node_key}'.")
    return public_view(row, include_binding=include_binding)


async def set_certification(
    session: AsyncSession, node_key: str, certification: str
) -> dict[str, Any]:
    row = await session.scalar(
        select(NodeDefinition).where(NodeDefinition.node_key == node_key))
    if row is None:
        raise NotFoundError(f"Không tìm thấy loại bước '{node_key}'.")
    row.certification = Certification(certification)
    if row.certification is Certification.SUPPORTED:
        row.last_certified_at = utcnow()
    await session.flush()
    return public_view(row, include_binding=True)


async def set_status(session: AsyncSession, node_key: str, status: str) -> dict[str, Any]:
    row = await session.scalar(
        select(NodeDefinition).where(NodeDefinition.node_key == node_key))
    if row is None:
        raise NotFoundError(f"Không tìm thấy loại bước '{node_key}'.")
    row.status = NodeStatus(status)
    await session.flush()
    return public_view(row, include_binding=True)
