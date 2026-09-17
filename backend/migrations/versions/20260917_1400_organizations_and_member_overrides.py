"""organisations own workspaces, and a membership can depart from its preset

Until now a workspace was the top of the tree and a person reached one only
through a row in `memberships`. That works for one department and falls over
the moment one company has several: every administrator needs a membership
row per workspace, a workspace created today is invisible to them until
somebody remembers to add them, and there is nothing that answers "which
workspaces does this company have".

The backfill is written so an existing deployment keeps exactly what it had:
every current membership survives untouched, and the organisation layer is
added above it. Whoever already owned a workspace, or carries the platform
admin flag, becomes an organisation owner -- they were already administering
this deployment, and demoting them here would take away access they have
today. Everyone else who can already reach some workspace joins as a plain
member, gaining nothing they did not have.

`memberships.permissions` is nullable and that is the design, not an
oversight. NULL means "exactly the preset named by `role`", which is what
every existing row means today, so nothing is back-filled or rewritten.

Constraint and index names follow `app.core.db.NAMING_CONVENTION` by hand
(`ix_<table>_<column>`, `fk_<table>_<column>_<referred_table>`,
`pk_<table>`) rather than `unique=True` on a column, which produces an
unnamed table constraint the convention does not cover -- `alembic check`
against a schema built from nothing (not backfilled from an existing
deployment) is what caught the first draft of this file getting that wrong.

Revision ID: b4f7e91c3a52
Revises: e5b0c8d34a71
Created: 2026-09-17 14:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = 'b4f7e91c3a52'
down_revision: str | None = 'e5b0c8d34a71'
branch_labels = None
depends_on = None

#: The organisation an existing deployment's workspaces are moved into.
DEFAULT_SLUG = "default"
DEFAULT_NAME = "Tổ chức mặc định"


def upgrade() -> None:
    conn = op.get_bind()

    op.execute("CREATE TYPE org_role AS ENUM ('ORG_OWNER', 'ORG_ADMIN', 'ORG_MEMBER')")

    # `workspace_status` already exists; reuse it rather than minting a second
    # enum that means the same thing.
    status = postgresql.ENUM(name="workspace_status", create_type=False)

    op.create_table(
        "organizations",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("slug", sa.String(120), nullable=False),
        sa.Column("status", status, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_organizations")),
    )
    op.create_index(op.f("ix_organizations_slug"), "organizations", ["slug"], unique=True)

    op.create_table(
        "organization_memberships",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("role", postgresql.ENUM(name="org_role", create_type=False), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(
            ["organization_id"], ["organizations.id"],
            name=op.f("fk_organization_memberships_organization_id_organizations"),
            ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"],
            name=op.f("fk_organization_memberships_user_id_users"),
            ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_organization_memberships")),
        sa.UniqueConstraint("organization_id", "user_id",
                            name="uq_org_membership_org_user"),
    )
    op.create_index(op.f("ix_organization_memberships_organization_id"),
                    "organization_memberships", ["organization_id"])
    op.create_index(op.f("ix_organization_memberships_user_id"),
                    "organization_memberships", ["user_id"])

    # Nullable first: the column has to exist before there is an organisation
    # to point it at.
    op.add_column(
        "workspaces",
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=True),
    )

    has_workspaces = conn.execute(sa.text("SELECT EXISTS (SELECT 1 FROM workspaces)")).scalar()
    if has_workspaces:
        org_id = conn.execute(
            sa.text(
                """
                INSERT INTO organizations (id, name, slug, status, created_at, updated_at)
                VALUES (gen_random_uuid(), :name, :slug, 'ACTIVE', now(), now())
                RETURNING id
                """
            ),
            {"name": DEFAULT_NAME, "slug": DEFAULT_SLUG},
        ).scalar_one()

        conn.execute(
            sa.text("UPDATE workspaces SET organization_id = :org WHERE organization_id IS NULL"),
            {"org": org_id},
        )

        # Anyone who already owned a workspace, or who is a platform admin, was
        # already administering this deployment. Demoting them to ORG_MEMBER
        # here would take away access they have today.
        conn.execute(
            sa.text(
                """
                INSERT INTO organization_memberships
                    (id, organization_id, user_id, role, created_at, updated_at)
                SELECT gen_random_uuid(), :org, u.id, 'ORG_OWNER'::org_role, now(), now()
                FROM users u
                WHERE u.is_platform_admin
                   OR EXISTS (SELECT 1 FROM memberships m
                              WHERE m.user_id = u.id AND m.role = 'OWNER')
                """
            ),
            {"org": org_id},
        )
        # Everyone else who can reach any workspace joins as a plain member:
        # their existing workspace memberships keep working and they gain
        # nothing they did not have.
        conn.execute(
            sa.text(
                """
                INSERT INTO organization_memberships
                    (id, organization_id, user_id, role, created_at, updated_at)
                SELECT gen_random_uuid(), :org, u.id, 'ORG_MEMBER'::org_role, now(), now()
                FROM users u
                WHERE EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = u.id)
                  AND NOT EXISTS (SELECT 1 FROM organization_memberships om
                                  WHERE om.organization_id = :org AND om.user_id = u.id)
                """
            ),
            {"org": org_id},
        )

    # Now that every row has one, the column becomes the invariant it is meant
    # to be: a workspace without an organisation is unreachable.
    op.alter_column("workspaces", "organization_id", nullable=False)
    op.create_foreign_key(
        op.f("fk_workspaces_organization_id_organizations"), "workspaces", "organizations",
        ["organization_id"], ["id"], ondelete="RESTRICT",
    )
    op.create_index(op.f("ix_workspaces_organization_id"), "workspaces", ["organization_id"])

    op.add_column(
        "memberships",
        sa.Column("permissions", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("memberships", "permissions")

    op.drop_index(op.f("ix_workspaces_organization_id"), table_name="workspaces")
    op.drop_constraint(op.f("fk_workspaces_organization_id_organizations"), "workspaces",
                       type_="foreignkey")
    op.drop_column("workspaces", "organization_id")

    op.drop_index(op.f("ix_organization_memberships_user_id"),
                  table_name="organization_memberships")
    op.drop_index(op.f("ix_organization_memberships_organization_id"),
                  table_name="organization_memberships")
    op.drop_table("organization_memberships")

    op.drop_index(op.f("ix_organizations_slug"), table_name="organizations")
    op.drop_table("organizations")

    op.execute("DROP TYPE org_role")
