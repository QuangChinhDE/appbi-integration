"""tenant membership enforced by the database, not only by the query

Every tenant-scoped query in the service layer carries `workspace_id`, and
`test_tenant_isolation.py` walks the AST to prove it. That is a good guard and
it has a shape of hole: it checks `select()`, so a `get`, an `update`, a
`delete` or anything reaching for raw SQL is outside it, and a future writer
only has to forget once.

This closes the most consequential edge at the schema level. `executions`
carries both `workspace_id` and `workflow_id`; nothing stopped those two
disagreeing, so a bug anywhere in the write path could file tenant A's run
against tenant B's workflow — and every later read, being correctly filtered by
`workspace_id`, would then hide the row from the tenant it actually belonged
to. A composite foreign key makes the pair unrepresentable.

`execution_node_results` needs nothing: it has no `workspace_id` of its own and
inherits its tenant entirely through `execution_id`, so there is no pair that
can disagree. The tables at risk are exactly the ones carrying both a tenant
column and a parent.

Not row-level security. RLS on all nineteen tables needs the session to carry
the tenant (`SET LOCAL app.workspace_id`) on every connection including the
worker's and the migration runner's, and getting that half-right is worse than
not starting: a policy that silently matches nothing turns a leak into an
outage. This is the part that can be trusted today; RLS stays open.

Revision ID: e5b0c8d34a71
Revises: d7f21ac6e885
Created: 2026-09-08 12:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = 'e5b0c8d34a71'
down_revision: str | None = 'd7f21ac6e885'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # A composite foreign key needs a unique key to point at. `id` is already
    # unique, so `(workspace_id, id)` is too -- this index exists to be
    # referenced, and it earns its keep on the tenant-scoped lookups anyway.
    op.create_unique_constraint(
        "uq_workflows_workspace_id", "workflows", ["workspace_id", "id"])

    # An execution's workflow must live in the execution's workspace.
    op.create_foreign_key(
        "fk_executions_workflow_same_workspace",
        "executions", "workflows",
        ["workspace_id", "workflow_id"], ["workspace_id", "id"],
        ondelete="CASCADE",
    )



def downgrade() -> None:
    op.drop_constraint(
        "fk_executions_workflow_same_workspace", "executions", type_="foreignkey")
    op.drop_constraint(
        "uq_workflows_workspace_id", "workflows", type_="unique")
