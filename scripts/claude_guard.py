"""PreToolUse guard for sensitive files (see docs/ai-sdlc/DEVELOPMENT_WORKFLOW.md).

Wired into `.claude/settings.json` as a `PreToolUse` hook on `Write|Edit` and
on `Bash`. It reads the hook payload on stdin and answers with a
`permissionDecision`.

The point is not to make ordinary development annoying. Every check here
corresponds to a change that is high-impact, low-visibility, and easy to make
as an unnoticed side effect of unrelated work -- the class of mistake that is
cheap now and expensive in three weeks.

Two decisions are used:

  deny  -- the engine pins. Moving the n8n line as a side effect of feature
           work is refused outright. The documented escape hatch is to declare
           the migration explicitly (see below), because an engine upgrade is
           a project, not an edit.
  ask   -- migrations, CI, deployment, security-sensitive code, anything that
           looks like a test being removed or disabled, and -- since the
           preflight gate below -- product code edited with no declared scope.
           These are legitimate often enough that blocking would be wrong, and
           consequential enough that they should never happen unnoticed.

Declaring an engine migration:

    APPBI_ENGINE_MIGRATION=<change-slug> ...

where `docs/changes/<change-slug>/` exists and contains a `plan.md`. That is
the acknowledgement: a named change artefact with a plan, which is exactly what
ADR-013 requires before a pin moves.

## The preflight gate

Before this existed, an agent could start editing `backend/app/services/`
without ever having read the existing implementation, named the affected
layers, or checked which invariants apply -- `/feature` and `/preflight`
described the right process, but nothing enforced starting it. Now: an edit
to product code (`backend/app/**` excluding tests, `frontend/src/**`,
`workflow-engine/src/**`, `e2e/tests/**`) is asked-about unless one of two
markers exists:

  `.claude/active-change`       one line, the slug of a `docs/changes/<slug>/`
                                 directory that has a `plan.md`. Written by
                                 `/preflight`.
  `.claude/light-change.json`   `{"reason": "...", "declared_at": "..."}`, for
                                 a genuinely small fix that does not warrant
                                 the full artefact set (see .claude/skills/
                                 feature/SKILL.md's light path). Capped: past
                                 a handful of touched product files under one
                                 declaration, the guard insists on a real
                                 preflight instead -- a light path that keeps
                                 growing is not a light fix.

Editing the markers themselves, or anything under `docs/changes/`, `.claude/`,
or the repository's top-level documentation, is never gated -- that is how the
gate gets satisfied in the first place.

Exit code is always 0 -- the decision travels in the JSON, and a crashing hook
must not block the session. Anything unexpected falls through to `allow`,
because a guard that fails closed on its own bugs gets switched off.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LIGHT_CHANGE_MARKER = ROOT / ".claude" / "light-change.json"
ACTIVE_CHANGE_MARKER = ROOT / ".claude" / "active-change"
LIGHT_PATH_FILE_CAP = 5


def allow() -> dict:
    return {}


def decide(decision: str, reason: str) -> dict:
    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": decision,
            "permissionDecisionReason": reason,
        }
    }


# --- what counts as sensitive -------------------------------------------------

ENGINE_PINS = (
    "workflow-engine/package.json",
    "workflow-engine/package-lock.json",
    "compatibility.yaml",
    "node-lock.json",
)

SECURITY_PATHS = (
    "backend/app/core/secrets.py",
    "backend/app/core/security.py",
    "backend/app/core/redaction.py",
    "backend/app/core/rate_limit.py",
    "backend/app/core/permissions.py",
    "backend/app/core/payload_vault.py",
    "backend/app/services/credentials.py",
    "backend/app/services/access.py",
    "backend/app/api/v1/auth.py",
    "workflow-engine/src/credentials/",
    "workflow-engine/src/runtime/egress-guard.ts",
    "workflow-engine/src/runtime/redaction.ts",
    "scripts/release_gate.py",
    "scripts/doctor.py",
)

GUARD_SCRIPTS = (
    "scripts/guardrails.py",
    "scripts/certify.py",
    "backend/tests/test_tenant_isolation.py",
)

# Markers that mean a test has stopped asserting.
DISABLING = re.compile(
    r"""(
        @pytest\.mark\.(skip|xfail)
      | pytest\.skip\(
      | \b(it|test|describe)\.skip\(
      | \btest\.fixme\(
      | \.todo\(
      | \bxit\(
      | \bxdescribe\(
    )""",
    re.VERBOSE,
)

TEST_PATH = re.compile(r"(^|/)(tests?|e2e)/|\.(test|spec)\.[tj]sx?$|(^|/)test_[^/]+\.py$")

# Product code the preflight gate cares about. Deliberately excludes tests
# (writing a regression test is how a bugfix *starts*, per .claude/skills/
# bugfix/SKILL.md) and excludes everything the gate itself needs edited to be
# satisfied (docs/changes/, .claude/, top-level docs).
PRODUCT_CODE_PREFIXES = (
    "backend/app/",
    "frontend/src/",
    "workflow-engine/src/",
)

NEVER_GATED_PREFIXES = (
    "docs/", ".claude/", "README.md", "CLAUDE.md", "REVIEW.md",
)


def is_product_code(rel: str) -> bool:
    if any(rel.startswith(p) for p in NEVER_GATED_PREFIXES):
        return False
    if TEST_PATH.search(rel):
        return False
    return any(rel.startswith(p) for p in PRODUCT_CODE_PREFIXES)


def active_change_slug() -> str | None:
    if not ACTIVE_CHANGE_MARKER.exists():
        return None
    slug = ACTIVE_CHANGE_MARKER.read_text(encoding="utf-8").strip()
    if slug and (ROOT / "docs" / "changes" / slug / "plan.md").exists():
        return slug
    return None


def light_change_state() -> dict | None:
    if not LIGHT_CHANGE_MARKER.exists():
        return None
    try:
        return json.loads(LIGHT_CHANGE_MARKER.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def light_path_files_touched() -> int:
    """How many distinct product files already differ from HEAD.

    Cheap proxy for "how big has this 'light' fix actually gotten" -- a real
    diff count against HEAD, not a count this script maintains itself (which
    a fresh session would have no way to recover).
    """
    try:
        out = subprocess.run(
            ["git", "status", "--porcelain", "-uall"],
            cwd=ROOT, capture_output=True, text=True, timeout=10,
        ).stdout
    except (subprocess.SubprocessError, OSError):
        return 0
    count = 0
    for line in out.splitlines():
        path = line[3:].strip()
        if is_product_code(path):
            count += 1
    return count


def relative(file_path: str) -> str | None:
    """The path relative to the repository root, in posix form."""
    if not file_path:
        return None
    try:
        return Path(file_path).resolve().relative_to(ROOT).as_posix()
    except (ValueError, OSError):
        return None


def engine_migration_declared() -> str | None:
    """The approved-migration acknowledgement, if it is present and real."""
    slug = os.environ.get("APPBI_ENGINE_MIGRATION", "").strip()
    if not slug:
        return None
    if (ROOT / "docs" / "changes" / slug / "plan.md").exists():
        return slug
    return None


def check_write(rel: str, payload: dict) -> dict:
    """A file is being written or edited."""

    if is_product_code(rel):
        slug = active_change_slug()
        light = light_change_state()

        if not slug and not light:
            return decide(
                "ask",
                f"{rel} is product code, and no change is declared for this session.\n\n"
                "Substantial work should not begin implementation before intent, spec "
                "and plan exist (`/feature`, or `/preflight`) -- so that review has "
                "something to check the diff against, and so this session and any "
                "session that resumes it can tell what is in flight.\n\n"
                "If this is a real feature or bugfix: run `/preflight`, or create "
                "docs/changes/<slug>/ with a plan.md and write the slug to "
                ".claude/active-change.\n\n"
                "If this is genuinely a small, self-contained fix: write "
                ".claude/light-change.json as "
                '{"reason": "<why this is small>", "declared_at": "<ISO time>"} '
                "and proceed -- the light path still requires the targeted test and "
                "final verification (.claude/skills/bugfix/SKILL.md).",
            )

        if light and not slug:
            touched = light_path_files_touched()
            if touched >= LIGHT_PATH_FILE_CAP:
                return decide(
                    "ask",
                    f"{rel}: the light-path fix declared \"{light.get('reason', '?')}\" "
                    f"has now touched {touched} product files, at or past the cap of "
                    f"{LIGHT_PATH_FILE_CAP}.\n\n"
                    "A light path that keeps growing is not a light fix. Run "
                    "`/preflight` and continue as a proper change with intent, spec "
                    "and plan -- that is what review and the completion gate will "
                    "expect for something this size.",
                )

    if rel in ENGINE_PINS:
        slug = engine_migration_declared()
        if slug:
            return decide(
                "ask",
                f"{rel} is an engine pin, and the migration '{slug}' is declared. "
                f"Confirm this edit belongs to that migration. The contract suite "
                f"must be green against the new runtime before this can be Done "
                f"(ADR-013).",
            )
        return decide(
            "deny",
            f"{rel} pins the certified n8n runtime (currently 1.14.1).\n\n"
            "Moving this line is an engine migration, not an edit. It requires a "
            "compatibility analysis, an exact dependency inventory, compiler "
            "verification, certified-node verification, the fifteen golden "
            "contract tests green against the new runtime, and a licence review "
            "(ADR-013, ADR-015).\n\n"
            "If this edit is genuinely part of an approved migration, open "
            "docs/changes/<slug>/ with a plan.md and re-run with "
            "APPBI_ENGINE_MIGRATION=<slug>. If it is not, the change you are "
            "making does not need this file -- fix the vulnerability with an "
            "`overrides` entry instead (ADR-024).",
        )

    if rel.startswith("backend/migrations/"):
        return decide(
            "ask",
            f"{rel} is a database migration.\n\n"
            "Before this is Done: the migration must apply, `downgrade base`, and "
            "re-apply; `alembic check` must be clean; and "
            "`python scripts/schema_drift.py` must be run against a real migrated "
            "database -- one head is a claim, the drift report is the evidence. "
            "No engine identifier may reach the schema (guardrail 5). Never edit "
            "an applied migration; add a new one.",
        )

    if rel.startswith(".github/workflows/"):
        return decide(
            "ask",
            f"{rel} is a CI gate. Weakening or removing a job removes the only "
            "thing that enforces a rule nobody can remember. Confirm this change "
            "adds or preserves coverage rather than routing around a failure, and "
            "check the push trigger still names the default branch (master).",
        )

    if rel.startswith("deploy/") or rel in ("docker-compose.yml", ".env.production.example"):
        return decide(
            "ask",
            f"{rel} is deployment configuration.\n\n"
            "The engine must stay unreachable from outside: no published port, no "
            "Ingress path, the NetworkPolicy accepting only api and worker "
            "(guardrail 15). Every image pinned, resource limits present, no "
            "database inside the compose file for production. "
            "`backend/tests/test_deployment_manifests.py` asserts these -- run it.",
        )

    if any(rel == p or rel.startswith(p) for p in SECURITY_PATHS):
        return decide(
            "ask",
            f"{rel} is security-sensitive.\n\n"
            "Security review is mandatory before Done (REVIEW.md dimension 6). "
            "No plaintext secret through a product-facing response; redaction "
            "stays in both layers; constant-time comparison for signatures and "
            "tokens; the egress guard stays in the path; tenant filters stay. "
            "Read .claude/rules/security.md.",
        )

    if rel in GUARD_SCRIPTS:
        return decide(
            "ask",
            f"{rel} is one of the checks that enforces an architectural rule.\n\n"
            "Editing the guard rather than the code it objects to is the failure "
            "mode this repository is built against. If the rule itself is wrong, "
            "that is a change artefact under docs/changes/ arguing the case -- not "
            "a narrowed pattern here. Adding a tenant-isolation allow-list entry "
            "requires a written reason in the same commit (ADR-018).",
        )

    # A test being disabled in place, rather than deleted.
    if TEST_PATH.search(rel):
        new_text = payload.get("new_string") or payload.get("content") or ""
        old_text = payload.get("old_string") or ""
        added = DISABLING.search(new_text) and not DISABLING.search(old_text)
        if added:
            return decide(
                "ask",
                f"This edit disables a test in {rel}.\n\n"
                "A test is evidence about behaviour, not an obstacle. There are "
                "exactly two reasons a test fails: the implementation is wrong "
                "(fix it), or an approved spec changed (and that spec change must "
                "already exist in a docs/changes/<change>/spec.md). If you are "
                "proceeding, the justification goes in review.md under residual "
                "risks, with what now covers the behaviour. "
                "Read .claude/rules/testing.md.",
            )

    return allow()


DELETES_TESTS = re.compile(
    r"""\b(rm|del|Remove-Item|git\s+rm)\b[^|;&]*?
        ((^|[\s/'"])(tests?|e2e)[/\\]|test_[^\s/'"]*\.py|\.(test|spec)\.[tj]sx?)""",
    re.VERBOSE | re.IGNORECASE,
)


def check_bash(command: str) -> dict:
    """A shell command is about to run."""

    if DELETES_TESTS.search(command):
        return decide(
            "ask",
            "This command looks like it removes test files.\n\n"
            "Deleting a test to obtain a green build is prohibited. If the "
            "behaviour a test covered was genuinely removed by an approved spec "
            "change, say which spec, in the same commit. Otherwise fix the "
            "implementation. Read .claude/rules/testing.md.",
        )

    # `npm install` in the engine resolves fresh and can move the pinned tree.
    if re.search(r"npm\s+(install|i|update|up)\b", command) and "workflow-engine" in command:
        return decide(
            "ask",
            "`npm install` in workflow-engine/ re-resolves the dependency tree, "
            "and the lockfile is the pin ADR-013 depends on. Use `npm ci`. If a "
            "dependency genuinely has to change, that is an engine migration with "
            "its own change artefact.",
        )

    return allow()


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        print(json.dumps(allow()))
        return 0

    try:
        tool = payload.get("tool_name", "")
        tool_input = payload.get("tool_input", {}) or {}

        if tool in ("Write", "Edit", "NotebookEdit"):
            rel = relative(tool_input.get("file_path", ""))
            result = check_write(rel, tool_input) if rel else allow()
        elif tool in ("Bash", "PowerShell"):
            result = check_bash(tool_input.get("command", "") or "")
        else:
            result = allow()
    except Exception as exc:  # noqa: BLE001
        # A guard that fails closed on its own bugs is a guard that gets
        # switched off. Fail open, and say why on stderr.
        print(f"claude_guard: internal error, allowing: {exc}", file=sys.stderr)
        result = allow()

    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
