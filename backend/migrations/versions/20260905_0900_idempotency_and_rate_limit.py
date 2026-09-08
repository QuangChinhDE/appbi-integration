"""idempotency uniqueness and the shared rate-limit store

Two changes that both move a guarantee out of application code and into the
database, because in both cases the application could not actually make it.

1. `uq_executions_idempotency` — a partial unique index on
   `(workspace_id, workflow_id, idempotency_key)`. The service already looked
   for an existing run before inserting, but a read followed by a write is not
   a claim: two clicks of Run arriving in the same instant both read nothing
   and both insert. Partial, because `idempotency_key` is null for most runs
   and a plain unique constraint would then permit exactly one keyless
   execution per workflow.

   The migration removes the non-unique index it replaces. Existing duplicates
   would make the index creation fail, so they are collapsed first -- keeping
   the earliest run for each key, which is the one whose id any caller was
   already told about.

2. `rate_limit_buckets` — one row per fixed window of one limited thing, so a
   limit means the same number however many API replicas are running.

Revision ID: b1c4e7a92f10
Revises: df842f034dc0
Created: 2026-09-05 09:00:00.000000
"""
from __future__ import annotations

from typing import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = 'b1c4e7a92f10'
down_revision: str | None = 'df842f034dc0'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ── 1. executions: real idempotency ────────────────────────────────────
    #
    # Collapse any pre-existing duplicates before the unique index is created,
    # or the migration fails on data that the old schema permitted. The
    # earliest row per key is kept: it is the one whose id was returned to
    # whoever submitted the request, so it is the one anything downstream may
    # already be holding.
    op.execute(
        """
        DELETE FROM executions e
        USING executions keep
        WHERE e.idempotency_key IS NOT NULL
          AND keep.idempotency_key = e.idempotency_key
          AND keep.workspace_id = e.workspace_id
          AND keep.workflow_id = e.workflow_id
          AND (keep.queued_at, keep.id) < (e.queued_at, e.id)
        """
    )

    op.drop_index('ix_executions_idempotency', table_name='executions')
    op.create_index(
        'uq_executions_idempotency',
        'executions',
        ['workspace_id', 'workflow_id', 'idempotency_key'],
        unique=True,
        postgresql_where=sa.text('idempotency_key IS NOT NULL'),
    )

    # ── 2. the shared rate-limit store ─────────────────────────────────────
    op.create_table(
        'rate_limit_buckets',
        sa.Column('bucket_key', sa.String(length=200), nullable=False),
        sa.Column('window_start', sa.BigInteger(), nullable=False),
        sa.Column('hits', sa.Integer(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('bucket_key'),
    )
    # The pruning query's predicate. Small table, but the prune runs every
    # minute in every deployment.
    op.create_index(
        'ix_rate_limit_buckets_updated_at',
        'rate_limit_buckets',
        ['updated_at'],
    )

    # ── 3. engine instance names are addressable ───────────────────────────
    #
    # Provisioning binds a tenant to a cluster by name (`--engine eu-west-1`),
    # so two rows answering to one name would make that binding ambiguous.
    op.create_unique_constraint(
        'uq_engine_instances_name', 'engine_instances', ['name'])


def downgrade() -> None:
    op.drop_constraint(
        'uq_engine_instances_name', 'engine_instances', type_='unique')

    op.drop_index('ix_rate_limit_buckets_updated_at', table_name='rate_limit_buckets')
    op.drop_table('rate_limit_buckets')

    op.drop_index('uq_executions_idempotency', table_name='executions')
    op.create_index(
        'ix_executions_idempotency',
        'executions',
        ['workspace_id', 'idempotency_key'],
    )
