"""The architectural guardrails, as an executable check.

These are the rules from SRS 2.1 that are cheap to check mechanically and
expensive to discover later. They already existed as `grep` steps in the
`guardrails` job of `.github/workflows/ci.yml`; this script is the same set,
runnable on a developer's machine and on Windows, so a boundary violation is
found in the edit that caused it rather than in CI twenty minutes later.

    python scripts/guardrails.py            # all of them
    python scripts/guardrails.py --list     # what is checked, and why

Each check names the guardrail or ADR it enforces. A check that fails prints
the offending file and line, because "guardrail 10 violated" is not
actionable and "guardrail 10 violated at backend/app/services/x.py:12" is.

The rules deliberately match *imports and declared dependencies*, never any
mention of the word "n8n": the ADRs, the adapter docstrings and this file all
name n8n on purpose, and a check that failed on prose would be switched off
within a week.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

SOURCE_SUFFIXES = {".py", ".ts", ".tsx", ".js", ".jsx", ".mjs"}
SKIP_DIRS = {
    "node_modules", ".git", ".venv", "__pycache__", ".next", "dist",
    ".ruff_cache", "playwright-report", "test-results", ".serena",
}


class Report:
    def __init__(self) -> None:
        self.failures: list[str] = []

    def check(self, guardrail: str, label: str, offences: list[str]) -> None:
        if offences:
            print(f"[ FAIL ] {guardrail}: {label}")
            for offence in offences[:20]:
                print(f"           {offence}")
            if len(offences) > 20:
                print(f"           ... and {len(offences) - 20} more")
            self.failures.append(f"{guardrail}: {label}")
        else:
            print(f"[  ok  ] {guardrail}: {label}")


def walk(*roots: Path):
    """Yield (relative path, text) for every source file under `roots`."""
    for root in roots:
        if not root.exists():
            continue
        for path in root.rglob("*"):
            if not path.is_file() or path.suffix not in SOURCE_SUFFIXES:
                continue
            if any(part in SKIP_DIRS for part in path.parts):
                continue
            try:
                yield path.relative_to(ROOT), path.read_text(encoding="utf-8")
            except (UnicodeDecodeError, OSError):
                continue


def hits(pattern: re.Pattern[str], *roots: Path) -> list[str]:
    found = []
    for rel, text in walk(*roots):
        for number, line in enumerate(text.splitlines(), start=1):
            if pattern.search(line):
                found.append(f"{rel.as_posix()}:{number}: {line.strip()[:120]}")
    return found


# --- the checks ---------------------------------------------------------------

def only_the_engine_imports_n8n(r: Report) -> None:
    """Guardrails 2 and 10. The engine is the only n8n-aware process."""
    imports = re.compile(r"""(?:^|\s)(?:from|import)\s+['"]n8n-|require\(\s*['"]n8n-""")
    r.check(
        "guardrail 10",
        "n8n is imported only inside workflow-engine",
        hits(imports, ROOT / "backend", ROOT / "frontend", ROOT / "e2e"),
    )

    declared: list[str] = []
    for manifest in (ROOT / "frontend" / "package.json", ROOT / "e2e" / "package.json"):
        if not manifest.exists():
            continue
        data = json.loads(manifest.read_text(encoding="utf-8"))
        for section in ("dependencies", "devDependencies", "peerDependencies", "optionalDependencies"):
            for name in data.get(section, {}):
                if name.startswith("n8n-") or name == "n8n" or name.startswith("@n8n/"):
                    declared.append(f"{manifest.relative_to(ROOT).as_posix()}: {section}.{name}")

    requirements = ROOT / "backend" / "requirements.txt"
    if requirements.exists():
        for number, line in enumerate(requirements.read_text(encoding="utf-8").splitlines(), 1):
            if re.match(r"\s*n8n[-_]", line):
                declared.append(f"backend/requirements.txt:{number}: {line.strip()}")

    r.check("guardrail 10", "n8n is declared as a dependency only by the engine", declared)


def no_engine_identity_in_the_schema(r: Report) -> None:
    """Guardrail 5, checked against the migrations: the database settles it.

    Matched case-sensitively on the lowercase package spelling, which is how a
    leaked engine handle would appear -- `n8n_workflow_id`, `n8n-nodes-base`.
    `engine_type` with the value `N8N_CORE` is deliberately not a violation:
    that column records *which kind* of engine a workspace is bound to, which
    is a product concept, and holds no engine-side identity.
    """
    versions = ROOT / "backend" / "migrations" / "versions"
    offences: list[str] = []
    if versions.exists():
        for path in sorted(versions.glob("*.py")):
            for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
                if "n8n" in line:
                    offences.append(f"{path.relative_to(ROOT).as_posix()}:{number}: {line.strip()[:120]}")
    r.check("guardrail 5", "no engine identifier reached the product schema", offences)


def no_enterprise_source(r: Report) -> None:
    """ADR-015. Importing an `.ee` module is a licence problem, not a code one.

    Matched on module specifiers only -- an `import`/`require`/`from` path whose
    module name ends in `.ee` or contains `.ee/`. Deliberately not on any
    occurrence of the text `.ee.`: `binary-data.ts` carries a comment
    explaining precisely why it deep-imports `BinaryData.service` rather than
    the package root, and naming the contract test that enforces it. A check
    that fails on the comment documenting the rule is a check that gets
    deleted, and the enforcement that actually matters is
    `tests/contract/no-enterprise-source.test.ts`, which runs a real execution
    and asserts nothing matching `.ee.` reached `require.cache`.
    """
    specifier = re.compile(
        r"""(?:from|import|require\(\s*)\s*['"][^'"]*\.ee(?:/[^'"]*)?['"]"""
    )
    r.check(
        "ADR-015",
        "no enterprise-only (.ee) module is imported",
        hits(specifier, ROOT / "backend", ROOT / "frontend", ROOT / "workflow-engine" / "src"),
    )


def the_frontend_talks_only_to_the_product(r: Report) -> None:
    """Guardrail 1. The browser reaches /api/v1 and /hooks, and nothing else.

    The deployment already enforces this by not publishing the engine's port.
    This catches the source-level version -- a component that has learned the
    engine's address -- which is the change that would make the deployment
    guarantee the only thing standing in the way.
    """
    engine_address = re.compile(r"ENGINE_BASE_URL|ENGINE_INTERNAL_TOKEN|:8099|/internal/v1")
    r.check(
        "guardrail 1",
        "the frontend carries no engine address or engine token",
        hits(engine_address, ROOT / "frontend" / "src"),
    )


def validation_describes_credentials_without_disclosing_them(r: Report) -> None:
    """ADR-016, and the bug three layers independently introduced.

    "No secrets on validate" was implemented three times by dropping the
    credential list entirely, and each time that made every workflow which
    authenticates to anything impossible to publish: the compiler cannot
    resolve a reference it was never sent. The rule is send the id and the
    type, send an empty payload -- and these are the two places that are easy
    to "simplify" back into the bug.
    """
    adapter = ROOT / "backend" / "app" / "engine" / "n8n_service_adapter.py"
    offences: list[str] = []
    if not adapter.exists():
        offences.append(f"{adapter.relative_to(ROOT).as_posix()} is missing")
    elif 'credential_type": item.credential_type' not in adapter.read_text(encoding="utf-8"):
        offences.append(
            "backend/app/engine/n8n_service_adapter.py no longer describes "
            "credentials on the validation path (ADR-016)"
        )

    server = ROOT / "workflow-engine" / "src" / "server.ts"
    if server.exists() and re.search(r"credentials:\s*\[\]", server.read_text(encoding="utf-8")):
        offences.append(
            "workflow-engine/src/server.ts drops the credential list on the "
            "validate route again (ADR-016)"
        )

    r.check("ADR-016", "validation sends credential descriptors, not values", offences)


def there_is_exactly_one_compiler(r: Report) -> None:
    """The product graph and the n8n graph are separate models (SRS §2.1),

    translated in exactly one place. Constructing n8n's `Workflow` object is
    the one irreversible step of that translation -- once a graph is a
    `Workflow`, it is in n8n's model, not the product's -- so this checks the
    one thing that actually matters: nowhere outside
    `workflow-engine/src/compiler/compiler.ts` may call `new Workflow(`.

    Deliberately not "only compiler.ts imports n8n-workflow": most of the
    engine legitimately imports types and error classes from that package
    (`INode`, `IRun`, ...), and a check that flagged every such import would
    either misfire constantly or get narrowed into uselessness. Constructing
    the Workflow instance is the specific, rare, meaningful act; grep for that
    act, not for the import.
    """
    pattern = re.compile(r"new\s+Workflow\s*\(")
    offences = [
        h for h in hits(pattern, ROOT / "workflow-engine" / "src")
        if not h.startswith("workflow-engine/src/compiler/compiler.ts:")
    ]
    r.check(
        "one compiler",
        "only compiler.ts constructs an n8n Workflow instance",
        offences,
    )


def publish_never_activates_and_activate_never_publishes(r: Report) -> None:
    """Publish and Activate are separate operations (SRS §2.1, ADR-009).

    Checked structurally rather than by behaviour here (the behaviour is
    covered by backend/tests/test_workflow_lifecycle.py): `publish()` must
    never write `workflow.status` or `workflow.active_version_id`, and
    `activate()` must never construct a new `WorkflowVersion`. A future edit
    that starts doing either is exactly the coupling this guards against, and
    it is cheap to catch as a source pattern because the two functions are
    each one contiguous block in one file.
    """
    path = ROOT / "backend" / "app" / "services" / "workflows.py"
    if not path.exists():
        r.check("Publish != Activate", "publish() and activate() stay separate",
                [f"{path.relative_to(ROOT).as_posix()} is missing"])
        return

    text = path.read_text(encoding="utf-8")
    offences: list[str] = []

    def _function_body(name: str) -> str | None:
        match = re.search(rf"^async def {name}\(.*?\n(?=^async def |\Z)", text, re.M | re.S)
        return match.group(0) if match else None

    publish_body = _function_body("publish")
    if publish_body is None:
        offences.append("could not locate publish() to check")
    elif re.search(r"\bworkflow\.status\s*=|\bworkflow\.active_version_id\s*=", publish_body):
        offences.append("publish() assigns workflow.status or workflow.active_version_id "
                         "-- that is activation, not publishing")

    activate_body = _function_body("activate")
    if activate_body is None:
        offences.append("could not locate activate() to check")
    elif re.search(r"\bWorkflowVersion\s*\(", activate_body):
        offences.append("activate() constructs a WorkflowVersion -- that is publishing, "
                         "not activation")

    r.check("Publish != Activate", "publish() and activate() stay separate", offences)


def the_licence_gate_is_recorded(r: Report) -> None:
    """SRS 33.1. Not a pass/fail on the value -- on the field existing.

    A release must not be able to claim the review happened while
    compatibility.yaml says otherwise. An unapproved review is a warning here
    and a refusal in `release_gate.py --delivery commercial`, which is the
    place that can actually stop a release.
    """
    compatibility = ROOT / "compatibility.yaml"
    offences: list[str] = []
    gate = None
    if not compatibility.exists():
        offences.append("compatibility.yaml is missing")
    else:
        match = re.search(r"^\s*commercial_gate:\s*['\"]?([A-Z_]+)", compatibility.read_text(encoding="utf-8"), re.M)
        if not match:
            offences.append("licensing.commercial_gate is missing from compatibility.yaml")
        else:
            gate = match.group(1)

    r.check("SRS 33.1", "the commercial licence gate is recorded", offences)
    if gate and gate != "APPROVED":
        print(f"[ warn ] SRS 33.1: commercial_gate is {gate} -- not releasable as a "
              f"commercial delivery (LIC-N8N-001)")


def ci_listens_to_the_default_branch(r: Report) -> None:
    """An SDLC check rather than an architectural one.

    A push workflow that names a branch the repository does not use means
    nothing gates the default branch, and the repository looks green because
    nothing ever ran. This is the class of defect that hides behind a CI badge.
    """
    workflow = ROOT / ".github" / "workflows" / "ci.yml"
    head = ROOT / ".git" / "HEAD"
    offences: list[str] = []
    if not workflow.exists() or not head.exists():
        r.check("SDLC", "CI listens to the default branch", ["ci.yml or .git/HEAD is missing"])
        return

    branch_match = re.search(r"ref:\s*refs/heads/(\S+)", head.read_text(encoding="utf-8"))
    branch = branch_match.group(1) if branch_match else None
    text = workflow.read_text(encoding="utf-8")
    push_match = re.search(r"push:\s*\n\s*branches:\s*\[([^\]]*)\]", text)
    if branch and push_match:
        listed = [b.strip().strip("'\"") for b in push_match.group(1).split(",")]
        if branch not in listed:
            offences.append(
                f"ci.yml pushes gate {listed}, but the checked-out branch is "
                f"'{branch}'. Nothing gates it."
            )
    r.check("SDLC", "CI's push trigger names the default branch", offences)


CHECKS = [
    only_the_engine_imports_n8n,
    no_engine_identity_in_the_schema,
    no_enterprise_source,
    the_frontend_talks_only_to_the_product,
    validation_describes_credentials_without_disclosing_them,
    there_is_exactly_one_compiler,
    publish_never_activates_and_activate_never_publishes,
    the_licence_gate_is_recorded,
    ci_listens_to_the_default_branch,
]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--list", action="store_true", help="print what is checked and why")
    args = parser.parse_args()

    if args.list:
        for check in CHECKS:
            doc = (check.__doc__ or "").strip().splitlines()
            print(f"{check.__name__}\n    {doc[0] if doc else ''}")
        return 0

    report = Report()
    for check in CHECKS:
        check(report)

    if report.failures:
        print(f"\n{len(report.failures)} guardrail(s) violated:")
        for failure in report.failures:
            print(f"  - {failure}")
        print("\nThese are load-bearing architectural boundaries (SRS 2.1).")
        print("Fix the code. If you believe the rule itself is wrong, that is a")
        print("change artefact under docs/changes/, not an edit to this file.")
        return 1

    print("\nall guardrails hold")
    return 0


if __name__ == "__main__":
    sys.exit(main())
