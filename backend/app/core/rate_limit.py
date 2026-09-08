"""Rate limiting that means the same thing on every replica (SRS 68.2).

The counter lives in Postgres. That is one round trip per limited request,
which is the price of a limit whose value does not depend on how many API pods
happen to be running -- an in-process counter silently multiplies the
configured limit by the replica count, and changes what it enforces every time
somebody scales the deployment.

Postgres rather than Redis because the deployment already requires Postgres and
ADR-011 defers adding a second datastore until there is a measured reason. The
whole limiter is one `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`, which is
atomic without a transaction of its own; Redis would be faster per call and no
more correct.
"""

from __future__ import annotations

import logging
import time

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import log_event

logger = logging.getLogger(__name__)

#: One statement, evaluated in the database.
#:
#: `window_start` is compared, not just written: if the stored row belongs to
#: an older window the count restarts at 1 instead of continuing, which is what
#: makes the window fixed rather than cumulative. Doing that as a read, a
#: decision and a write in Python would reintroduce exactly the race this
#: exists to remove.
_HIT = text(
    """
    INSERT INTO rate_limit_buckets (bucket_key, window_start, hits, updated_at)
    VALUES (:bucket_key, :window_start, 1, now())
    ON CONFLICT (bucket_key) DO UPDATE SET
        hits = CASE
            WHEN rate_limit_buckets.window_start = :window_start
            THEN rate_limit_buckets.hits + 1
            ELSE 1
        END,
        window_start = :window_start,
        updated_at = now()
    RETURNING hits
    """
)


def window_start(window_seconds: int, now: float | None = None) -> int:
    """The start of the window the given moment falls in, in whole seconds."""
    moment = time.time() if now is None else now
    return int(moment // window_seconds) * window_seconds


async def hit(
    session: AsyncSession,
    bucket_key: str,
    *,
    limit: int,
    window_seconds: int = 60,
) -> tuple[bool, int]:
    """Count one request against a bucket.

    Returns `(allowed, hits_in_window)`. The count is recorded whether or not
    the request is allowed: a caller that keeps hammering a limit they are over
    should stay over it, not reset it by trying again.

    Commits its own statement, deliberately. The limiter's count must survive
    whatever happens to the request afterwards -- a rejected webhook rolls its
    session back, and a count that rolls back with it is not a limit.
    """
    row = await session.execute(
        _HIT,
        {"bucket_key": bucket_key[:200],
         "window_start": window_start(window_seconds)},
    )
    hits = int(row.scalar_one())
    await session.commit()
    return hits <= limit, hits


async def check(
    bucket_key: str, *, limit: int, window_seconds: int = 60
) -> tuple[bool, int]:
    """`hit`, on a session of its own.

    For call sites outside the request's own transaction -- the webhook gateway
    runs this before it opens the session that will process the request.

    Fails *open* on a database error, and says so in the log. The alternative
    is refusing traffic because the counter is unavailable, and every request
    this guards needs the same database one step later: a limiter that turns a
    database blip into a second, separate outage is worse than one that stops
    counting for a moment.
    """
    from app.core.db import SessionLocal

    try:
        async with SessionLocal() as session:
            return await hit(
                session, bucket_key, limit=limit, window_seconds=window_seconds)
    except Exception as exc:  # noqa: BLE001
        log_event(logger, logging.ERROR, "rate_limit.unavailable",
                  bucket=bucket_key[:64], detail=str(exc)[:200])
        return True, 0


async def prune(session: AsyncSession, older_than_seconds: int = 3600) -> int:
    """Drop buckets nobody has touched for an hour.

    Without this the table grows one row per distinct webhook key, forever. The
    worker calls it on its reconcile tick; it is not on the request path.
    """
    result = await session.execute(
        text("DELETE FROM rate_limit_buckets WHERE updated_at < now() - "
             "make_interval(secs => :age)"),
        {"age": older_than_seconds},
    )
    return int(result.rowcount or 0)
