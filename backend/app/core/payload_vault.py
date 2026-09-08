"""The run payload, kept intact for the engine and redacted for the screen.

The bug this exists to fix: `executions.start_payload` held one value that was
used for both jobs, and it was the redacted one. A webhook body arriving with
`{"password": "hunter2"}` and sixty line items was stored — and then *executed*
— as `{"password": "********"}` with fifty. The workflow did not receive what
the caller sent, a retry re-ran the mangled version, and nothing anywhere said
so. Redaction is a display concern that had been applied to the data itself.

So there are two values now, with different jobs and different lifetimes:

* **the sealed payload**, Fernet-encrypted with the same key that protects
  credentials, read only when the worker dispatches a run;
* **the preview**, redacted and truncated, which is what the API returns and
  what every execution screen shows.

Encrypted rather than plain: a run payload is the most likely place in the
product for a live token to arrive, and the whole reason the redaction was
there was that this row is widely read. Removing the redaction without sealing
the real value would trade a correctness bug for a disclosure one.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from cryptography.fernet import InvalidToken

from app.core.secrets import _kek
from app.core.logging import log_event

logger = logging.getLogger(__name__)


def seal(payload: Any) -> str | None:
    """Encrypt a payload for storage. `None` stays `None`."""
    if payload is None:
        return None
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    return _kek().encrypt(raw.encode()).decode()


def unseal(sealed: str | None) -> Any:
    """The original payload, or `None` if there is nothing to open.

    A payload that will not decrypt is returned as `None` rather than raised:
    the key has been rotated, or the row predates sealing, and refusing to
    dispatch the run would turn a historical data problem into an outage. The
    caller falls back to the preview and the event is logged, because a run
    that silently receives less than it should is exactly the failure this
    module exists to end.
    """
    if not sealed:
        return None
    try:
        return json.loads(_kek().decrypt(sealed.encode()).decode())
    except InvalidToken:
        log_event(
            logger, logging.ERROR, "execution.payload_unseal_failed",
            reason="invalid_token",
        )
        return None
    except (ValueError, TypeError):
        log_event(
            logger, logging.ERROR, "execution.payload_unseal_failed",
            reason="not_json",
        )
        return None
