"""a heartbeat written only by the worker

`AppbiWorkerStopped` alerted on `engine_instances.last_probe_at` being stale.
That field is written by the worker's housekeeping loop — and also by the API's
engine-status endpoint, which every open browser tab polls. So the field stayed
fresh while the worker was dead, and the one alert that would have revealed a
stopped worker could not fire as long as somebody had the product open.

`last_worker_beat_at` is written by `app.worker` and by nothing else.

Revision ID: d7f21ac6e885
Revises: c93a5d17be44
Created: 2026-09-08 11:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = 'd7f21ac6e885'
down_revision: str | None = 'c93a5d17be44'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "engine_instances",
        sa.Column("last_worker_beat_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("engine_instances", "last_worker_beat_at")
