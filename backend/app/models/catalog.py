"""Node registry and engine instances (SRS 22.9, 22.10).

`node_definitions` is the product's catalogue. It is seeded from
`app/resources/node_registry.json` at boot so the Node Library and the editor
palette render from the product database — an engine outage must not empty the
palette (SRS 11.4).
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean, DateTime, Enum as SAEnum, Index, Integer, String, Text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, TimestampMixin
from app.models.enums import Certification, EngineStatus, EngineType, NodeCategory, NodeStatus


class NodeDefinition(Base, TimestampMixin):
    __tablename__ = "node_definitions"
    __table_args__ = (
        Index("ix_nodes_status_certification_category", "status", "certification", "category"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    #: The stable product key. `http_request`, never
    #: `n8n-nodes-base.httpRequest` (guardrail 9).
    node_key: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    display_name: Mapped[str] = mapped_column(String(120), nullable=False)
    category: Mapped[NodeCategory] = mapped_column(
        SAEnum(NodeCategory, name="node_category"), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    icon: Mapped[str | None] = mapped_column(String(64), nullable=True)
    product_schema_version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    #: Normalized form schema the FE renders (SRS 54). Not an n8n node
    #: description -- those carry display logic we do not implement.
    config_schema: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    #: Ports, expression support, credential types, side-effect profile.
    capability_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    certification: Mapped[Certification] = mapped_column(
        SAEnum(Certification, name="certification"),
        default=Certification.BETA, nullable=False)
    status: Mapped[NodeStatus] = mapped_column(
        SAEnum(NodeStatus, name="node_status"), default=NodeStatus.ACTIVE, nullable=False)
    #: Backend-only: {"engine": "N8N", "engine_node_type": ..., "engine_type_version": ...}.
    #: Serialised on admin endpoints alone (SRS 11.3).
    engine_binding: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    security_profile: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    docs_ref: Mapped[str | None] = mapped_column(String(255), nullable=True)
    last_certified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True)
    #: Hash of the config schema. A change here is a schema change, and must not
    #: silently mutate a stored workflow (SRS 11.4).
    spec_hash: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    known_issues: Mapped[str | None] = mapped_column(Text, nullable=True)


class EngineInstance(Base, TimestampMixin):
    """Architecture-ready from day one (SRS 66).

    One row in V1. It exists so canary versions, per-tenant engines and
    blue/green rollout are a routing decision later, rather than a schema
    migration during an incident.
    """

    __tablename__ = "engine_instances"

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    engine_type: Mapped[EngineType] = mapped_column(
        SAEnum(EngineType, name="engine_type"), default=EngineType.N8N_CORE, nullable=False)
    #: Unique: this is how provisioning names the cluster a tenant is bound to
    #: (`--engine eu-west-1`), so two rows answering to one name would make
    #: that binding ambiguous.
    name: Mapped[str] = mapped_column(String(80), nullable=False, unique=True)
    #: A config key or secret ref, not a URL. The URL itself is deployment
    #: configuration and never reaches a response body.
    endpoint_ref: Mapped[str] = mapped_column(String(160), nullable=False, default="default")
    engine_version: Mapped[str | None] = mapped_column(String(32), nullable=True)
    adapter_contract_version: Mapped[str] = mapped_column(String(16), nullable=False, default="1")
    compiler_version: Mapped[str] = mapped_column(String(16), nullable=False, default="1")
    status: Mapped[EngineStatus] = mapped_column(
        SAEnum(EngineStatus, name="engine_instance_status"),
        default=EngineStatus.OFFLINE, nullable=False)
    #: When the *worker* last completed a housekeeping pass.
    #:
    #: Separate from `last_probe_at`, which any caller of the engine-status
    #: endpoint refreshes — so a dead worker looked alive for as long as
    #: somebody had a browser tab open, and the alert built on it could not
    #: fire. Only `app.worker` writes this one.
    last_worker_beat_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True)
    last_probe_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True)
    last_probe_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    region: Mapped[str | None] = mapped_column(String(32), nullable=True)
    capacity_class: Mapped[str | None] = mapped_column(String(32), nullable=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
