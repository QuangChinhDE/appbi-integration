"""The wire form of an engine request.

The validation path has to satisfy two rules at once: the compiler must be able
to resolve every credential a graph names, and a dry run must not carry a
secret. Three layers of this system each tried to satisfy the second by
dropping credentials entirely, and each time that made publishing any
authenticated workflow impossible. This is the test that pins the shape which
satisfies both.
"""

from __future__ import annotations

from app.engine.dto import EngineExecutionRequest, RuntimeCredential
from app.engine.n8n_service_adapter import _serialise_request


def _request() -> EngineExecutionRequest:
    return EngineExecutionRequest(
        execution_id="exec_1",
        workspace_ref="ws_1",
        graph={"nodes": [], "connections": []},
        registry={},
        start_payload={},
        credentials=[
            RuntimeCredential(
                credential_id="cred_1",
                credential_type="BEARER",
                data={"token": "super-secret-value"},
            )
        ],
        trace_id="trc_1",
    )


def test_validation_keeps_the_reference_and_drops_the_value():
    body = _serialise_request(_request(), include_credentials=False)

    # Present, so the compiler can resolve the reference and check the type.
    assert [item["credential_id"] for item in body["credentials"]] == ["cred_1"]
    assert body["credentials"][0]["credential_type"] == "BEARER"
    # Empty, because a dry run executes no request.
    assert body["credentials"][0]["data"] == {}
    # And the value is nowhere in what goes over the wire.
    assert "super-secret-value" not in repr(body)


def test_execution_carries_the_value_because_it_has_to():
    body = _serialise_request(_request(), include_credentials=True)
    assert body["credentials"][0]["data"] == {"token": "super-secret-value"}


def test_a_graph_with_no_credentials_sends_an_empty_list():
    request = _request()
    request.credentials = []
    assert _serialise_request(request, include_credentials=False)["credentials"] == []
