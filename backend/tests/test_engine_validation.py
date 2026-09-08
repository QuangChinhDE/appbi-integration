"""What the product sends the engine for a publish-time dry run.

The dry run has two requirements that pull against each other: the compiler has
to be able to resolve every credential a graph names -- otherwise it reports
`CREDENTIAL_REQUIRED` and no workflow that authenticates to anything can ever be
published -- and a validation call must not carry a secret. Both are satisfied
by sending identity and type with an empty payload, and this is the test that
keeps them satisfied.
"""

from __future__ import annotations

import uuid

import pytest

from app.core.context import RequestContext
from app.core.permissions import Role
from app.engine.dto import EngineValidationResult
from app.models.enums import CredentialType
from app.services import workflows


class _Capture:
    """An adapter that records the request instead of compiling it."""

    def __init__(self) -> None:
        self.request = None

    async def validate(self, request):
        self.request = request
        return EngineValidationResult(ok=True, diagnostics=[], compiled_hash="0" * 64)


class _Row:
    """Just enough of a Credential row for the descriptor to be built."""

    def __init__(self, credential_type: CredentialType) -> None:
        self.id = uuid.uuid4()
        self.credential_type = credential_type


class _Workflow:
    def __init__(self) -> None:
        self.id = uuid.uuid4()


def _ctx() -> RequestContext:
    return RequestContext(
        user_id=uuid.uuid4(),
        workspace_id=uuid.uuid4(),
        role=Role.OWNER,
        trace_id="trc_test",
    )


@pytest.mark.asyncio
async def test_validation_describes_credentials_without_their_values(monkeypatch):
    capture = _Capture()
    monkeypatch.setattr(workflows, "get_adapter", lambda: capture)

    row = _Row(CredentialType.BEARER)
    state, issues = await workflows._engine_validate(
        session=None,  # unused on this path
        ctx=_ctx(),
        workflow=_Workflow(),
        graph={"nodes": [], "connections": []},
        definitions={},
        credentials=[row],
    )

    assert state == "OK"
    assert issues == []

    sent = capture.request.credentials
    assert len(sent) == 1
    # Identity and type, so the reference resolves and the type can be checked
    # against the authentications the compiler supports.
    assert sent[0].credential_id == str(row.id)
    assert sent[0].credential_type == "BEARER"
    # And nothing else. A dry run executes no request, so there is nothing for a
    # value to be used by -- which makes sending one pure exposure (SRS 12.2).
    assert sent[0].data == {}


@pytest.mark.asyncio
async def test_validation_sends_no_credentials_when_the_graph_names_none(monkeypatch):
    capture = _Capture()
    monkeypatch.setattr(workflows, "get_adapter", lambda: capture)

    await workflows._engine_validate(
        session=None,
        ctx=_ctx(),
        workflow=_Workflow(),
        graph={"nodes": [], "connections": []},
        definitions={},
    )

    assert capture.request.credentials == []
