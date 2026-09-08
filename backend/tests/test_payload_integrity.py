"""The engine receives what the caller sent.

`executions.start_payload` was one column doing two jobs, and the value it held
was the redacted one: masked keys, arrays cut to fifty, strings cut to 4096.
That value was stored *and dispatched*, so a workflow ran against
`{"password": "********"}` with fifty of its sixty items, and a retry re-ran
the mangled version. Nothing said so — the run succeeded, against the wrong
input.

Written from the four shapes that lose information passing through `redact`: a
sensitive key, an array over the cap, a string over the cap, and nesting past
the depth limit. Each asserts both halves of the split — the engine gets the
original, the screen gets the redaction — because fixing one direction by
breaking the other is the obvious wrong turn here.
"""

from __future__ import annotations

import logging
import uuid

from app.core import payload_vault
from app.core.redaction import MAX_ITEMS, MAX_STRING
from app.services.executions import _payload_for_engine, _sanitize_payload


def _payload() -> dict:
    """One payload carrying all four lossy shapes at once."""
    deep: dict = {"leaf": "kept"}
    for _ in range(12):
        deep = {"down": deep}
    return {
        "password": "hunter2",
        "api_key": "sk-live-abcdef0123456789",
        "items": [{"n": i} for i in range(MAX_ITEMS + 10)],
        "body": "y" * (MAX_STRING + 500),
        "nested": deep,
        "unicode": "Đơn hàng · 8.500.000 ₫",
        "order_id": "DH-1",
    }


class _Execution:
    """Enough of the row for `_payload_for_engine`."""

    def __init__(self, sealed: str | None, preview: dict | None) -> None:
        self.id = uuid.uuid4()
        self.workspace_id = uuid.uuid4()
        self.start_payload_sealed = sealed
        self.start_payload = preview


# ── the vault ──────────────────────────────────────────────────────────────
class TestSealing:
    def test_a_payload_survives_a_round_trip_unchanged(self):
        payload = _payload()
        assert payload_vault.unseal(payload_vault.seal(payload)) == payload

    def test_none_stays_none(self):
        assert payload_vault.seal(None) is None
        assert payload_vault.unseal(None) is None

    def test_the_ciphertext_does_not_contain_the_secret(self):
        # Encrypted rather than stored plainly, because the redaction was not
        # paranoia: this column exists so a retry can re-send a webhook body,
        # and a webhook body is the likeliest place a live token arrives.
        sealed = payload_vault.seal({"api_key": "sk-live-abcdef0123456789"})
        assert "sk-live-abcdef0123456789" not in sealed
        assert "hunter2" not in payload_vault.seal({"password": "hunter2"})

    def test_a_payload_that_will_not_open_returns_none(self, caplog):
        # A rotated key, or a row written before sealing existed. `None` rather
        # than an exception: the caller falls back and logs, because refusing
        # to dispatch would turn a historical data problem into an outage.
        with caplog.at_level(logging.ERROR):
            assert payload_vault.unseal("not-a-fernet-token") is None
        assert "payload_unseal_failed" in caplog.text


# ── what runs, and what is shown ───────────────────────────────────────────
class TestTheSplit:
    def test_the_engine_gets_every_lossy_shape_intact(self):
        payload = _payload()
        execution = _Execution(payload_vault.seal(payload), _sanitize_payload(payload))

        sent = _payload_for_engine(execution)

        assert sent["password"] == "hunter2"
        assert sent["api_key"] == "sk-live-abcdef0123456789"
        assert len(sent["items"]) == MAX_ITEMS + 10
        assert sent["items"][-1] == {"n": MAX_ITEMS + 9}
        assert len(sent["body"]) == MAX_STRING + 500
        assert sent["unicode"] == "Đơn hàng · 8.500.000 ₫"

        probe = sent["nested"]
        for _ in range(12):
            probe = probe["down"]
        assert probe == {"leaf": "kept"}

    def test_the_screen_still_sees_a_redaction(self):
        # The other half. A fix that hands the token to the engine *and* to
        # every execution detail screen has traded a correctness bug for a
        # disclosure one.
        preview = _sanitize_payload(_payload())

        assert preview["password"] == "********"
        assert preview["api_key"] == "********"
        assert len(preview["items"]) == MAX_ITEMS
        assert len(preview["body"]) < MAX_STRING + 500

    def test_an_unsealable_row_falls_back_and_says_so(self, caplog):
        # Rows written before this column existed. They cannot be recovered --
        # the original was never stored -- so the run proceeds on the preview,
        # loudly, rather than not at all.
        execution = _Execution("not-a-fernet-token", {"password": "********"})

        with caplog.at_level(logging.ERROR):
            sent = _payload_for_engine(execution)

        assert sent == {"password": "********"}
        assert "payload_fell_back_to_preview" in caplog.text

    def test_a_row_with_no_sealed_payload_uses_the_preview(self):
        execution = _Execution(None, {"a": 1})
        assert _payload_for_engine(execution) == {"a": 1}

    def test_a_row_with_nothing_at_all_dispatches_an_empty_object(self):
        # Not `None`: the engine contract wants an object, and a manual run
        # with no payload is the most common case in the product.
        assert _payload_for_engine(_Execution(None, None)) == {}
