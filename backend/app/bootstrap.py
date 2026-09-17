"""First-run bootstrap: schema, node catalogue, engine instance, admin account.

Idempotent. Running it twice changes nothing, which is what lets it run on every
deploy as part of the start script.

    python -m app.bootstrap
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import pathlib
import secrets
import sys

from sqlalchemy import func, select

from app.core.config import settings
from app.core.db import Base, SessionLocal, get_engine
from app.core.logging import configure_logging, log_event
from app.core.permissions import OrgRole, Role
from app.core.security import hash_password
from app.models import (  # noqa: F401 - importing registers every table
    AlertRule, AuditEvent, Credential, EngineInstance, Execution, ExecutionLogLine,
    ExecutionNodeResult, Membership, NodeDefinition, Notification, Organization,
    OrganizationMembership, SecretRecord, TriggerBinding, User, Workflow,
    WorkflowDraft, WorkflowVersion, Workspace,
)
from app.models.enums import EngineType
from app.services import catalog

logger = logging.getLogger(__name__)

DEFAULT_WORKSPACE_NAME = "AppBI Automation"
DEFAULT_WORKSPACE_SLUG = "appbi-automation"


async def create_schema() -> None:
    """Create tables directly, then stamp Alembic at head.

    For a first run and for development. Production uses `alembic upgrade head`
    so that schema changes are reviewable and reversible; `create_all` cannot
    express a migration.

    The stamp is not decoration. Without it a database built this way has every
    table and no version row, so the next `alembic upgrade head` tries to
    create everything again and fails on "type actor_type already exists" --
    with no obvious way out for whoever hits it.
    """
    engine = get_engine()
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    log_event(logger, logging.INFO, "bootstrap.schema_ready")

    def _stamp(connection) -> None:
        from alembic import command
        from alembic.config import Config

        config = Config(str(pathlib.Path(__file__).resolve().parent.parent / "alembic.ini"))
        config.set_main_option("script_location", str(
            pathlib.Path(__file__).resolve().parent.parent / "migrations"))
        # Alembic needs the live connection rather than a URL of its own, or it
        # would open a second one against a database this transaction is still
        # writing.
        config.attributes["connection"] = connection
        command.stamp(config, "head")

    async with engine.begin() as connection:
        await connection.run_sync(_stamp)
    log_event(logger, logging.INFO, "bootstrap.schema_stamped")


async def seed_catalog() -> None:
    async with SessionLocal() as session:
        created, updated = await catalog.seed(session)
        await session.commit()
    log_event(logger, logging.INFO, "bootstrap.catalog_seeded",
              created=created, updated=updated)


async def seed_engine_instance() -> None:
    async with SessionLocal() as session:
        existing = await session.scalar(
            select(EngineInstance).where(EngineInstance.is_default.is_(True)))
        if existing is None:
            session.add(EngineInstance(
                engine_type=EngineType.N8N_CORE,
                name="default",
                # A config key, not a URL: the address is deployment
                # configuration and must not end up in a database somebody
                # dumps into a response (SRS 22.10).
                endpoint_ref="ENGINE_BASE_URL",
                adapter_contract_version=settings.adapter_contract_version,
                is_default=True,
            ))
            await session.commit()
            log_event(logger, logging.INFO, "bootstrap.engine_instance_created")


async def seed_admin(email: str | None, password: str | None) -> None:
    """Create the first workspace and its owner, once.

    The password comes from the environment and the account is flagged
    `password_change_required`: whoever deploys the system holds a one-time
    secret, not a standing credential.
    """
    async with SessionLocal() as session:
        workspace = await session.scalar(
            select(Workspace).where(Workspace.slug == DEFAULT_WORKSPACE_SLUG))
        if workspace is None:
            organization = await session.scalar(
                select(Organization).where(Organization.slug == DEFAULT_WORKSPACE_SLUG))
            if organization is None:
                organization = Organization(
                    name=DEFAULT_WORKSPACE_NAME, slug=DEFAULT_WORKSPACE_SLUG)
                session.add(organization)
                await session.flush()

            workspace = Workspace(
                name=DEFAULT_WORKSPACE_NAME,
                slug=DEFAULT_WORKSPACE_SLUG,
                organization_id=organization.id,
                timezone=os.getenv("BOOTSTRAP_TIMEZONE", "Asia/Bangkok"),
            )
            session.add(workspace)
            await session.flush()
            log_event(logger, logging.INFO, "bootstrap.workspace_created",
                      workspace_id=str(workspace.id))

        total_users = int(await session.scalar(select(func.count(User.id))) or 0)
        if total_users > 0:
            await session.commit()
            log_event(logger, logging.INFO, "bootstrap.admin_exists")
            return

        admin_email = (email or os.getenv("BOOTSTRAP_ADMIN_EMAIL") or "").strip().lower()
        admin_password = password or os.getenv("BOOTSTRAP_ADMIN_PASSWORD") or ""
        if not admin_email:
            admin_email = "admin@appbi.vn"
        generated = False
        if not admin_password:
            # Printed once, and only to the operator running bootstrap. Better
            # than a well-known default that ships to every deployment.
            admin_password = secrets.token_urlsafe(16)
            generated = True

        user = User(
            email=admin_email,
            full_name="Platform Admin",
            password_hash=hash_password(admin_password),
            is_platform_admin=True,
            password_change_required=True,
        )
        session.add(user)
        await session.flush()
        session.add(Membership(
            workspace_id=workspace.id, user_id=user.id, role=Role.OWNER))
        session.add(OrganizationMembership(
            organization_id=workspace.organization_id, user_id=user.id,
            role=OrgRole.ORG_OWNER))
        await session.commit()

        log_event(logger, logging.INFO, "bootstrap.admin_created", email=admin_email)
        if generated:
            print("\n" + "=" * 66)
            print("  Bootstrap admin account created")
            print(f"  email:    {admin_email}")
            print(f"  password: {admin_password}")
            print("  This password must be changed on first sign-in.")
            print("=" * 66 + "\n")


async def main() -> int:
    configure_logging()
    parser = argparse.ArgumentParser(description="Bootstrap the workflow platform.")
    parser.add_argument("--schema", action="store_true",
                        help="create tables with create_all (development only)")
    parser.add_argument("--admin-email", default=None)
    parser.add_argument("--admin-password", default=None)
    args = parser.parse_args()

    if args.schema:
        await create_schema()
    await seed_catalog()
    await seed_engine_instance()
    await seed_admin(args.admin_email, args.admin_password)
    log_event(logger, logging.INFO, "bootstrap.done")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
