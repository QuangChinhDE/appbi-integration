"""the run payload the engine receives, kept intact

`executions.start_payload` served two purposes with one value, and the value it
held was the redacted one. `_sanitize_payload` masked anything key-like, cut
arrays to fifty items and strings to 4096 characters -- correct for a column
every execution screen reads, and catastrophic for the column the worker hands
to the engine. A webhook body arriving with a token and sixty line items was
*executed* as `********` with fifty. A retry re-ran the mangled version.

This adds `start_payload_sealed`: the caller's payload, Fernet-encrypted with
the same key that protects credentials. `start_payload` keeps its job as the
redacted preview.

Encrypted rather than plain, because the redaction was not paranoia -- a run
payload is the most likely place in the product for a live token to arrive, and
this row is read widely. Removing the masking without sealing the real value
would have traded a correctness bug for a disclosure one.

Existing rows get NULL. They cannot be recovered -- the original was never
stored -- and the dispatcher falls back to the preview for them, logging
`execution.payload_fell_back_to_preview` so a retry of an old run is visible
rather than silent.

Revision ID: c93a5d17be44
Revises: b1c4e7a92f10
Created: 2026-09-08 09:30:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = 'c93a5d17be44'
down_revision: str | None = 'b1c4e7a92f10'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "executions",
        sa.Column("start_payload_sealed", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("executions", "start_payload_sealed")
