"""Execution payload redaction and truncation (SRS 21.3, 58).

Applied on the way *in*, before anything is written to `execution_node_results`.
Sanitising on read instead would mean the raw payload sits in the database
waiting for the next endpoint that forgets to call the sanitiser.

Two separate jobs, deliberately in one place:

* redaction removes values that should never be stored (auth headers, tokens);
* truncation keeps a debugging aid from becoming a data warehouse — a node that
  returns 50,000 rows should not put 50,000 rows in the product database.
"""

from __future__ import annotations

import json
from typing import Any

MASK = "********"

#: Substring match on keys, case-insensitive. Broad on purpose: a false
#: positive costs a developer one confusing `********` in a preview, a false
#: negative puts a customer's bearer token in a JSONB column.
SENSITIVE_KEY_HINTS = (
    "password", "passwd", "secret", "token", "credential", "api_key", "apikey",
    "api-key", "authorization", "auth", "private_key", "client_secret",
    "access_key", "passphrase", "cookie", "set-cookie", "session",
    "x-api-key", "signature", "bearer",
)

#: Headers dropped outright rather than masked. Their *presence* is not
#: interesting and a masked "authorization" invites someone to log the real one
#: "just for debugging".
DROP_HEADERS = ("authorization", "proxy-authorization", "cookie", "set-cookie")

MAX_DEPTH = 8
MAX_ITEMS = 50
MAX_STRING = 4096


def is_sensitive_key(key: str) -> bool:
    lowered = str(key).lower()
    return any(hint in lowered for hint in SENSITIVE_KEY_HINTS)


def redact(value: Any, *, depth: int = 0) -> Any:
    """Recursively mask anything that looks like a credential."""
    if depth > MAX_DEPTH:
        return "<depth limit>"
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for key, item in value.items():
            lowered = str(key).lower()
            if lowered in DROP_HEADERS:
                continue
            out[key] = MASK if is_sensitive_key(key) else redact(item, depth=depth + 1)
        return out
    if isinstance(value, (list, tuple)):
        return [redact(item, depth=depth + 1) for item in value[:MAX_ITEMS]]
    if isinstance(value, str) and len(value) > MAX_STRING:
        return value[:MAX_STRING] + "…<truncated>"
    return value


def preview(
    items: Any, *, max_items: int = MAX_ITEMS, max_bytes: int = 64 * 1024
) -> tuple[dict[str, Any], bool]:
    """Turn node output into a stored preview.

    Returns `(preview, truncated)`. The preview is always a dict so the FE has
    one shape to render: `{"items": [...], "item_count": n}`.

    `max_bytes` is checked after redaction and after the item cap, because the
    thing being protected is the size of the database row — not the size of
    what the node returned.
    """
    if items is None:
        return {"items": [], "item_count": 0}, False

    sequence = items if isinstance(items, list) else [items]
    total = len(sequence)
    kept = [redact(item) for item in sequence[:max_items]]
    truncated = total > max_items

    body = {"items": kept, "item_count": total}
    encoded = json.dumps(body, default=str, ensure_ascii=False)
    if len(encoded.encode("utf-8")) <= max_bytes:
        return body, truncated

    # Still too big: shed items until it fits, then say so. Shedding is better
    # than storing nothing -- one item is usually enough to see the shape.
    while kept and len(json.dumps(
        {"items": kept, "item_count": total}, default=str, ensure_ascii=False
    ).encode("utf-8")) > max_bytes:
        kept.pop()
    return (
        {"items": kept, "item_count": total, "note": "PREVIEW_TRUNCATED_BY_SIZE"},
        True,
    )


def sanitize_headers(headers: dict[str, Any] | None) -> dict[str, str]:
    """Request headers safe to keep on an execution record."""
    if not headers:
        return {}
    out: dict[str, str] = {}
    for key, value in headers.items():
        lowered = str(key).lower()
        if lowered in DROP_HEADERS or is_sensitive_key(lowered):
            continue
        out[str(key)] = str(value)[:512]
    return out


def body_metadata(raw: bytes | None, content_type: str | None) -> dict[str, Any]:
    """What arrived, without keeping it (SRS 57: no raw webhook bodies by default)."""
    return {
        "content_type": content_type,
        "size_bytes": len(raw) if raw else 0,
    }
