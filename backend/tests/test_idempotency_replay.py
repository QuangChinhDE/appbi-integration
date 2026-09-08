"""A replay is never refused for concurrency.

The bug: `create()` looked for an existing run with the caller's
`Idempotency-Key`, then checked the concurrency ceiling. Between those two
steps the first request can commit -- so the lookup finds nothing and the
ceiling then counts the very run the lookup was looking for. Ten concurrent
requests with one key returned nine copies of the same execution and one
`WORKFLOW_ALREADY_RUNNING`.

That is the worst possible answer, because the caller who receives it cannot
tell "your request was ignored because it already ran" from "your request was
rejected and nothing happened" -- which is the entire reason to send a key.

The window is narrow and timing-dependent, so a burst test hits it sometimes
and proves nothing when it does not. These tests drive the branch directly:
the lookup misses, the ceiling refuses, and the second lookup -- which by then
can see the committed winner -- must decide the outcome.
"""

from __future__ import annotations

import uuid

import pytest

from app.core.context import RequestContext
from app.core.errors import AppError, QuotaExceededError, error_from_matrix
from app.core.permissions import Role
from app.models.enums import TriggerType, VersionKind
from app.services import executions


class _Workflow:
    def __init__(self, workspace_id: uuid.UUID) -> None:
        self.id = uuid.uuid4()
        self.workspace_id = workspace_id
        self.draft = None
        self.active_version_id = None
        self.published_version_id = None


class _Session:
    """Just enough session for `create` to reach the branch under test.

    These tests drive one narrow path — lookup, ceiling, second lookup — with
    every collaborator stubbed, and used to pass `None` for the session because
    nothing touched it. `create` now takes a transaction-scoped advisory lock
    before counting active runs, so there is one statement to answer. Recorded
    rather than ignored: the lock is the fix for the quota race and a test that
    silently stopped exercising it would be worse than one that fails.
    """

    def __init__(self) -> None:
        self.statements: list[str] = []

    async def execute(self, statement, params=None):  # noqa: ANN001
        self.statements.append(str(statement))
        return None


class _Execution:
    """Stands in for the row the first request committed."""

    def __init__(self) -> None:
        self.id = uuid.uuid4()


def _ctx() -> RequestContext:
    return RequestContext(
        user_id=uuid.uuid4(),
        workspace_id=uuid.uuid4(),
        role=Role.OWNER,
        trace_id="trc_test",
    )


@pytest.fixture
def scenario(monkeypatch):
    """`create()` with its database calls replaced.

    Everything up to the point under test is stubbed, so the test is about the
    ordering decision and nothing else.
    """
    ctx = _ctx()
    workflow = _Workflow(ctx.workspace_id)
    winner = _Execution()
    calls = {"lookup": 0}

    async def fake_get_workflow(session, context, workflow_id):
        return workflow

    monkeypatch.setattr(
        "app.services.workflows.get_workflow", fake_get_workflow)

    return {"ctx": ctx, "workflow": workflow, "winner": winner, "calls": calls,
            "session": _Session(),
            "monkeypatch": monkeypatch}


def _lookup(scenario, results):
    """Install a lookup that returns `results[n]` on the n-th call."""
    calls = scenario["calls"]

    async def fake_lookup(session, workspace_id, workflow_id, key):
        index = calls["lookup"]
        calls["lookup"] += 1
        return results[min(index, len(results) - 1)]

    scenario["monkeypatch"].setattr(
        executions, "_by_idempotency_key", fake_lookup)


def _concurrency(scenario, error):
    async def fake_check(session, context, workflow):
        if error is not None:
            raise error

    scenario["monkeypatch"].setattr(
        executions, "_check_concurrency", fake_check)


class TestAReplayWinsOverTheCeiling:
    @pytest.mark.asyncio
    async def test_the_race_returns_the_winner_rather_than_refusing(
            self, scenario):
        """The exact sequence the storm produces.

        First lookup: nothing (the winner had not committed yet).
        Ceiling: refuses (the winner has committed by now).
        Second lookup: the winner.
        """
        _lookup(scenario, [None, scenario["winner"]])
        _concurrency(scenario, error_from_matrix("WORKFLOW_ALREADY_RUNNING"))

        result = await executions.create(
            scenario["session"], scenario["ctx"], scenario["workflow"].id,
            kind=VersionKind.DRAFT, trigger_type=TriggerType.MANUAL,
            idempotency_key="storm-key")

        assert result is scenario["winner"]
        assert scenario["calls"]["lookup"] == 2, (
            "the refusal path must look again; the first lookup ran before the "
            "winner was visible")

    @pytest.mark.asyncio
    async def test_a_workspace_quota_refusal_is_also_replayed(self, scenario):
        # The same window exists for the tenant ceiling, and a customer at
        # their quota retrying a submitted request must still get their run's
        # id back rather than a quota error about a run they already have.
        _lookup(scenario, [None, scenario["winner"]])
        _concurrency(scenario, QuotaExceededError("at the ceiling"))

        result = await executions.create(
            scenario["session"], scenario["ctx"], scenario["workflow"].id,
            kind=VersionKind.DRAFT, trigger_type=TriggerType.MANUAL,
            idempotency_key="storm-key")
        assert result is scenario["winner"]


class TestTheRefusalStillStands:
    @pytest.mark.asyncio
    async def test_a_genuinely_busy_workflow_is_refused(self, scenario):
        """A different key must not be let through by the replay path.

        The workflow is busy with somebody else's run: there is nothing to
        replay, and the ceiling means what it says.
        """
        _lookup(scenario, [None, None])
        _concurrency(scenario, error_from_matrix("WORKFLOW_ALREADY_RUNNING"))

        with pytest.raises(AppError) as raised:
            await executions.create(
                scenario["session"], scenario["ctx"], scenario["workflow"].id,
                kind=VersionKind.DRAFT, trigger_type=TriggerType.MANUAL,
                idempotency_key="a-key-with-no-run")
        assert raised.value.code == "WORKFLOW_ALREADY_RUNNING"

    @pytest.mark.asyncio
    async def test_a_request_with_no_key_is_refused(self, scenario):
        # Without a key there is no claim to replay, so the ceiling is the
        # whole answer. This is the ordinary "already running" case and must
        # not be softened by the fix above.
        _lookup(scenario, [None, scenario["winner"]])
        _concurrency(scenario, error_from_matrix("WORKFLOW_ALREADY_RUNNING"))

        with pytest.raises(AppError) as raised:
            await executions.create(
                scenario["session"], scenario["ctx"], scenario["workflow"].id,
                kind=VersionKind.DRAFT, trigger_type=TriggerType.MANUAL,
                idempotency_key=None)
        assert raised.value.code == "WORKFLOW_ALREADY_RUNNING"
        assert scenario["calls"]["lookup"] == 0, (
            "a request with no key must not consult the idempotency index at "
            "all")


class TestTheCommonCaseIsUnchanged:
    @pytest.mark.asyncio
    async def test_a_later_retry_is_answered_by_the_first_lookup(
            self, scenario):
        # The overwhelmingly common path: the retry arrives after the first
        # request committed. It must not reach the ceiling at all.
        _lookup(scenario, [scenario["winner"]])
        _concurrency(
            scenario, error_from_matrix("WORKFLOW_ALREADY_RUNNING"))

        result = await executions.create(
            scenario["session"], scenario["ctx"], scenario["workflow"].id,
            kind=VersionKind.DRAFT, trigger_type=TriggerType.MANUAL,
            idempotency_key="already-ran")

        assert result is scenario["winner"]
        assert scenario["calls"]["lookup"] == 1
