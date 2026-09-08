"""Every query that reads tenant data names the tenant.

The leak this exists to prevent was real: `derive_health` looked up a
credential by id alone. A graph is JSONB, so it can name any UUID -- the
reference is not a foreign key -- and a workflow in workspace A referring to
workspace B's credential got back B's row, and B's credential *name* in A's
health message.

Nothing else catches that. It is not a permission bug, so the RBAC tests pass;
it is not a route bug, so the API tests pass; and every service test builds its
fixtures in one workspace, so a missing filter is invisible.

So this walks the AST of every service module and requires that a query
touching a tenant-scoped table also constrains `workspace_id` -- or is listed
below with a reason. The list is the point: each entry is a deliberate
cross-tenant query, and adding to it should feel like a decision.
"""

from __future__ import annotations

import ast
import pathlib

import pytest

BACKEND = pathlib.Path(__file__).resolve().parent.parent
SERVICES = BACKEND / "app" / "services"

#: Models whose rows belong to exactly one workspace. A query selecting one of
#: these without constraining the tenant is a cross-tenant read.
TENANT_SCOPED = {
    "Workflow", "WorkflowDraft", "WorkflowVersion", "TriggerBinding",
    "Credential", "Execution", "ExecutionNodeResult", "ExecutionLogLine",
    "AuditEvent", "AlertRule", "Notification", "Membership",
}

#: Anything that makes a query tenant-safe. `workspace_id` is the direct form;
#: the others are the indirect ones -- a query keyed on a parent row that was
#: itself fetched with a tenant filter.
SAFE_MARKERS = (
    "workspace_id",
    # `execution.id` / `execution_id`: the execution was fetched through
    # `executions.get`, which filters, and `detail_view` re-checks the tenant
    # before reading any child row.
    "execution_id",
    "Execution.id",
    # A version or draft belongs to a workflow fetched through
    # `get_workflow`, which filters.
    "workflow_id",
    "Workflow.id",
    "membership_id",
    "Membership.id",
)

#: Deliberate cross-tenant queries, each with the reason it is correct.
#:
#: Keyed by `module:function`. A new entry here should be a considered
#: decision, which is why the reason is required rather than a comment.
ALLOWED_CROSS_TENANT = {
    # ── identity is global; tenancy is the membership ──────────────────────
    "access:authenticate":
        "Users are global. An account can belong to several workspaces, and "
        "sign-in happens before any tenant has been chosen.",
    "access:reachable":
        "Answers *which* workspaces this account can reach, so it cannot be "
        "scoped to one of them. This is the function every other tenant "
        "filter is ultimately derived from.",
    "access:invite_member":
        "Looks up a global user by email before adding a membership in the "
        "caller's own workspace. The membership insert is tenant-scoped.",
    "access:session_payload":
        "Builds the workspace switcher, which by definition lists every "
        "workspace the account can reach.",

    # ── the webhook gateway and the scheduler run before, or across, tenants
    "triggers:resolve_webhook":
        "The public key *is* the tenant identifier. This is the function that "
        "resolves an anonymous request to a workspace, so it cannot already "
        "know which one.",
    "triggers:due_schedules":
        "The scheduler ticks across every tenant on the deployment. "
        "`FOR UPDATE SKIP LOCKED` is the distributed lock that stops two "
        "workers firing one schedule (SRS 67).",
    "triggers:detect_missed":
        "Deployment-wide by design: it reports late schedules to the "
        "housekeeping loop, which then raises an alert in each affected "
        "workspace individually.",
    "executions:claim_queued":
        "The dispatcher's claim query. It works across tenants and orders by "
        "queue time, which is what makes one tenant unable to starve another "
        "by queueing first.",
    "executions:active_executions":
        "The reconciler polls every in-flight run on the deployment, because "
        "an engine that lost an execution did not lose it per tenant.",

    # ── the node catalogue is a product constant, identical for all tenants ─
    "catalog:seed":
        "The node registry is a product constant. It is the same eight nodes "
        "for every tenant, and it is seeded once at bootstrap.",
    "catalog:definitions_map":
        "Reads the product-wide node registry, which carries no tenant data "
        "at all -- only the certified node definitions.",
    "catalog:list_nodes":
        "Serves the node library, which is the same product constant for "
        "every tenant. Nothing in a NodeDefinition belongs to a workspace.",
    "catalog:get_node":
        "One entry from that same product-wide registry.",
    "monitoring:engine_status":
        "Describes the engine instance, which is deployment infrastructure "
        "rather than tenant data. Its address is never returned.",

    # ── provisioning exists to cross the boundary ──────────────────────────
    "provisioning:provision_workspace":
        "Creates a tenant, so it cannot be scoped to one. Gated on the "
        "platform-admin flag rather than on any workspace role.",
    "provisioning:list_workspaces":
        "Lists every tenant on the deployment for a platform admin, and "
        "deliberately returns no tenant *content* -- only names, slugs, "
        "quotas and owners.",
    "provisioning:_resolve_engine":
        "Engine instances are deployment infrastructure, shared by every "
        "tenant unless one is bound to a specific cluster.",
}


def _service_modules() -> list[pathlib.Path]:
    return sorted(p for p in SERVICES.glob("*.py") if p.name != "__init__.py")


def _enclosing_function(tree: ast.Module, node: ast.AST) -> str:
    """The name of the function `node` sits in, or `<module>`."""
    best = "<module>"
    for candidate in ast.walk(tree):
        if not isinstance(candidate, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        start = candidate.lineno
        end = getattr(candidate, "end_lineno", start)
        if start <= node.lineno <= end:
            # The innermost enclosing function wins.
            if best == "<module>" or start >= _line_of(tree, best):
                best = candidate.name
    return best


def _line_of(tree: ast.Module, name: str) -> int:
    for candidate in ast.walk(tree):
        if isinstance(candidate, (ast.FunctionDef, ast.AsyncFunctionDef)) \
                and candidate.name == name:
            return candidate.lineno
    return 0


def _selected_models(call: ast.Call) -> set[str]:
    """Tenant-scoped model names a `select(...)` call reads from."""
    models: set[str] = set()
    for argument in call.args:
        # select(Workflow)
        if isinstance(argument, ast.Name) and argument.id in TENANT_SCOPED:
            models.add(argument.id)
        # select(Workflow.id), select(func.count(Execution.id))
        for inner in ast.walk(argument):
            if isinstance(inner, ast.Attribute) and isinstance(inner.value, ast.Name):
                if inner.value.id in TENANT_SCOPED:
                    models.add(inner.value.id)
    return models


def _statement_source(source_lines: list[str], node: ast.AST) -> str:
    """The whole statement a call belongs to.

    A query is built across several chained lines -- `select(...)`, `.where(...)`,
    `.order_by(...)` -- so the filter is very often not on the `select` line.
    Reading the enclosing statement is what makes the check meaningful rather
    than noisy.
    """
    start = node.lineno - 1
    end = getattr(node, "end_lineno", node.lineno)
    return "\n".join(source_lines[start:end])


def _find_unscoped(path: pathlib.Path) -> list[tuple[str, int, set[str]]]:
    source = path.read_text(encoding="utf-8")
    lines = source.splitlines()
    tree = ast.parse(source)
    module = path.stem

    findings: list[tuple[str, int, set[str]]] = []
    for node in ast.walk(tree):
        if not (isinstance(node, ast.Call)
                and isinstance(node.func, ast.Name)
                and node.func.id == "select"):
            continue

        models = _selected_models(node)
        if not models:
            continue

        # The statement this select is part of: walk up to the outermost
        # expression on the same lines.
        enclosing = _widest_statement(tree, node)
        text = _statement_source(lines, enclosing)
        if any(marker in text for marker in SAFE_MARKERS):
            continue

        function = _enclosing_function(tree, node)
        if f"{module}:{function}" in ALLOWED_CROSS_TENANT:
            continue

        findings.append((function, node.lineno, models))
    return findings


def _widest_statement(tree: ast.Module, node: ast.AST) -> ast.AST:
    """The statement containing `node`, so chained `.where()` calls are seen."""
    best: ast.AST = node
    for candidate in ast.walk(tree):
        if not isinstance(candidate, ast.stmt):
            continue
        start = candidate.lineno
        end = getattr(candidate, "end_lineno", start)
        if start <= node.lineno and getattr(node, "end_lineno", node.lineno) <= end:
            best_start = best.lineno
            best_end = getattr(best, "end_lineno", best_start)
            if (end - start) >= (best_end - best_start):
                best = candidate
    return best


class TestEveryTenantQueryNamesItsTenant:
    @pytest.mark.parametrize(
        "module", _service_modules(), ids=lambda p: p.stem)
    def test_no_unscoped_query(self, module: pathlib.Path):
        findings = _find_unscoped(module)
        assert not findings, "\n".join(
            f"  {module.stem}.py:{line} in {function}() selects "
            f"{sorted(models)} without constraining the tenant.\n"
            f"    Either add a workspace_id filter, or add "
            f"'{module.stem}:{function}' to ALLOWED_CROSS_TENANT with the "
            f"reason it is correct."
            for function, line, models in findings)


class TestTheAllowListIsHonest:
    def test_every_entry_has_a_reason(self):
        for key, reason in ALLOWED_CROSS_TENANT.items():
            assert len(reason) > 40, (
                f"{key} is allow-listed with no real reason: {reason!r}")

    def test_every_entry_still_exists(self):
        """An allow-list entry for code that is gone hides the next mistake.

        If `triggers:resolve_webhook` is renamed and the entry stays, a future
        `resolve_webhook` -- or anything else that ends up with that name --
        inherits the exemption.
        """
        stale = []
        for key in ALLOWED_CROSS_TENANT:
            module_name, function = key.split(":", 1)
            path = SERVICES / f"{module_name}.py"
            if not path.exists():
                stale.append(f"{key} (no {module_name}.py)")
                continue
            tree = ast.parse(path.read_text(encoding="utf-8"))
            names = {n.name for n in ast.walk(tree)
                     if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))}
            if function not in names:
                stale.append(f"{key} (no such function)")
        assert not stale, f"stale allow-list entries: {stale}"


class TestTheCheckActuallyWorks:
    """A checker that finds nothing is indistinguishable from a safe codebase.

    So the detector is pointed at a query that is definitely unsafe.
    """

    def test_an_unscoped_query_is_detected(self, tmp_path):
        module = tmp_path / "leaky.py"
        module.write_text(
            "from sqlalchemy import select\n"
            "from app.models.workflow import Credential\n"
            "\n"
            "async def leak(session, ids):\n"
            "    return await session.scalars(\n"
            "        select(Credential).where(Credential.id.in_(ids)))\n",
            encoding="utf-8")
        findings = _find_unscoped(module)
        assert findings, "the detector missed a query with no tenant filter"
        assert findings[0][0] == "leak"
        assert findings[0][2] == {"Credential"}

    def test_a_scoped_query_is_not_flagged(self, tmp_path):
        module = tmp_path / "safe.py"
        module.write_text(
            "from sqlalchemy import select\n"
            "from app.models.workflow import Credential\n"
            "\n"
            "async def safe(session, ctx, ids):\n"
            "    return await session.scalars(\n"
            "        select(Credential).where(\n"
            "            Credential.workspace_id == ctx.workspace_id,\n"
            "            Credential.id.in_(ids)))\n",
            encoding="utf-8")
        assert not _find_unscoped(module)

    def test_the_original_leak_would_have_been_caught(self, tmp_path):
        """The exact shape of the bug that motivated this file."""
        module = tmp_path / "workflows.py"
        module.write_text(
            "from sqlalchemy import select\n"
            "from app.models.workflow import Credential\n"
            "\n"
            "async def _credential_problem(session, workflow):\n"
            "    rows = list((await session.scalars(\n"
            "        select(Credential).where(Credential.id.in_(parsed))\n"
            "    )).all())\n"
            "    return rows\n",
            encoding="utf-8")
        findings = _find_unscoped(module)
        assert findings and findings[0][0] == "_credential_problem"
