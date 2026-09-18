"""Stop hook: refuse to let a completion claim through on stale or missing
evidence.

This is a backstop, not the primary mechanism -- the primary mechanism is that
`scripts/verify.py` and the reviewer contract only ever produce evidence tied
to a fingerprint, and stale evidence is visibly stale in `evidence.py status`.
This hook exists because a session can still *say* "Done" without having
looked, and nothing before this point in the pipeline stops that sentence from
being typed.

## What it does NOT do

It does not block every Stop event. Claude Code fires `Stop` at the end of
every turn, including "here's my plan, should I proceed?" and ordinary
mid-task check-ins, and blocking all of those on missing evidence would make
the harness unusable and would not match what this gate is actually for.

Instead it looks for a completion claim in the assistant's own last message
(read from the session transcript) using a set of phrase patterns, not single
words -- "ready to merge", "implementation complete", "no defects found", not
"ready" or "done" in isolation, which appear constantly in ordinary prose. A
message that says "STATUS: NOT DONE" or similar is explicitly recognised and
let through: an honest non-completion is exactly the outcome this gate exists
to make possible, per CLAUDE.md's self-certification principle.

**This heuristic is not infallible.** Wording the detector does not recognise
will not be blocked. It is a backstop layered on top of the evidence system,
not a replacement for it -- see docs/ai-sdlc/DEVELOPMENT_WORKFLOW.md.

## Loop safety

If `stop_hook_active` is true (Claude Code re-invoked the model after this
hook already blocked once this turn), this hook always allows the stop. A
gate that can block the same turn twice is a gate that can hang a session.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import evidence  # noqa: E402
import repo_fingerprint  # noqa: E402

# Paths outside these are prose/process, not product code: editing them alone
# never triggers the gate. Anything else touched pulls in its area's checks.
AREA_PREFIXES: dict[str, tuple[str, ...]] = {
    "backend": ("backend/",),
    "frontend": ("frontend/",),
    "engine": ("workflow-engine/",),
    "e2e": ("e2e/",),
    "deployment": ("deploy/", "docker-compose.yml", ".github/workflows/"),
}

# Paths that never count as "product code" for this gate, even though they
# live in a tracked location -- editing only these should never require a
# fresh full verification.
NON_PRODUCT_PREFIXES = (
    "docs/", ".claude/rules/", ".claude/skills/", ".claude/agents/",
    ".claude/evidence/", "README.md", "CLAUDE.md", "REVIEW.md",
    "BA_SRS_", ".gitignore",
)

# Completion-claim phrases: multi-word patterns, not bare adjectives, because
# "ready", "done" and "complete" are ordinary English words that show up in
# unrelated sentences constantly. A false negative here just means the
# evidence system (and CLAUDE.md's rule against self-certification) is the
# only thing standing guard, same as before this hook existed.
COMPLETION_PATTERNS = [
    r"\bimplementation (is )?complete\b",
    r"\btask (is )?(complete|done|finished)\b",
    r"\bthis is (now )?(done|complete|finished|ready)\b",
    r"\bready (to|for) (merge|ship|release|deploy)\b",
    r"\bproduction[- ]ready\b",
    r"\bno defects? found\b",
    r"\ball (good|set|clear)\b",
    r"^\s*status:\s*done\b",
    r"^\s*\*\*done\*\*",
    r"^\s*## +done\b",
    r"\beverything (is )?(passing|passes|green|working)\b",
]

# If any of these appear near a completion phrase, the message is an honest
# non-completion report and must be let through, not blocked.
HONEST_NOT_DONE = [
    r"\bnot done\b", r"\bnot complete\b", r"\bnot ready\b",
    r"\bcannot complete\b", r"\bblocked\b", r"\bnot run\b", r"\bskip",
]


def _git(*args: str) -> str:
    result = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True)
    return result.stdout if result.returncode == 0 else ""


def changed_paths() -> list[str]:
    """Paths git considers modified or new, filtered to the *exact* universe
    `repo_fingerprint.py` hashes -- reused, not re-implemented, so this gate's
    idea of "the diff" can never silently drift from the fingerprint's.
    """
    fingerprinted = set(repo_fingerprint.tracked_and_untracked_paths())
    status_lines = _git("status", "--porcelain", "-uall", "-z").split("\0")

    dirty: set[str] = set()
    i = 0
    while i < len(status_lines):
        entry = status_lines[i]
        if not entry:
            i += 1
            continue
        code, rest = entry[:2], entry[3:]
        if code[0] in ("R", "C"):
            dirty.add(rest)
            i += 2
            continue
        if rest:
            dirty.add(rest)
        i += 1

    return sorted(dirty & fingerprinted)


def is_product_change(paths: list[str]) -> bool:
    return any(
        not any(p.startswith(prefix) for prefix in NON_PRODUCT_PREFIXES)
        for p in paths
    )


def required_areas(paths: list[str]) -> set[str]:
    areas: set[str] = set()
    for path in paths:
        if any(path.startswith(prefix) for prefix in NON_PRODUCT_PREFIXES):
            continue
        matched = False
        for area, prefixes in AREA_PREFIXES.items():
            if any(path.startswith(prefix) for prefix in prefixes):
                areas.add(area)
                matched = True
        if not matched:
            areas.add("guardrails")  # anything else (scripts/, root configs, ...)
    return areas


def find_last_assistant_text(transcript_path: str | None) -> str | None:
    if not transcript_path:
        return None
    path = Path(transcript_path)
    if not path.exists():
        return None
    last_text = None
    try:
        with path.open(encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue
                message = obj.get("message")
                if isinstance(message, dict) and message.get("role") == "assistant":
                    for block in message.get("content") or []:
                        if isinstance(block, dict) and block.get("type") == "text":
                            last_text = block.get("text")
    except OSError:
        return None
    return last_text


def looks_like_completion_claim(text: str) -> bool:
    lowered = text.lower()
    if any(re.search(p, lowered) for p in HONEST_NOT_DONE):
        return False
    return any(re.search(p, lowered, re.MULTILINE) for p in COMPLETION_PATTERNS)


def _any_current_record_covers(kind: str, stage_substring: str, fp: str) -> bool:
    """True if some current record's stage list already exercised this check.

    `guardrails` runs as a bonus stage inside every `quick`, every `targeted
    <area>` and every `full` invocation (see verify.py) -- requiring a
    *separate* dedicated `targeted guardrails` run on top of that would be
    asking for proof the repository already has, under a different label.
    """
    for area in evidence.all_areas(kind):
        rec = evidence.read_latest(kind, area)
        if rec is None or not evidence.is_current(rec, fingerprint=fp):
            continue
        for stage in rec.get("detail", {}).get("stages", []):
            if stage_substring in stage.get("name", "") and stage.get("status") == "PASS":
                return True
    return False


def missing_evidence(areas: set[str]) -> list[str]:
    fp = evidence.current_fingerprint()
    missing: list[str] = []

    # At least one current, non-failing verification of appropriate breadth.
    quick = evidence.read_latest("verification", "quick")
    full = evidence.read_latest("verification", "full")
    have_baseline = (
        (quick and evidence.is_current(quick, fingerprint=fp) and quick["status"] != "FAIL")
        or (full and evidence.is_current(full, fingerprint=fp) and full["status"] != "FAIL")
    )
    if not have_baseline:
        missing.append("verification/quick (or full) — no current, non-failing run for this exact state")

    for area in sorted(areas):
        if area == "guardrails" and _any_current_record_covers("verification", "guardrails", fp):
            continue
        rec = evidence.read_latest("verification", area)
        if rec is None:
            missing.append(f"verification/{area} — never run")
        elif not evidence.is_current(rec, fingerprint=fp):
            missing.append(f"verification/{area} — stale (recorded for a different state)")
        elif rec["status"] == "FAIL":
            missing.append(f"verification/{area} — last run FAILED")

    # Review evidence only matters once a change artefact exists — ad hoc
    # small edits are not routed through the reviewer contract (see
    # .claude/skills/feature/SKILL.md's light path).
    active_marker = ROOT / ".claude" / "active-change"
    if active_marker.exists():
        required_reviewers = ["architecture-reviewer", "qa-reviewer"]
        if "frontend" in areas:
            required_reviewers.append("ui-reviewer")
        for reviewer in required_reviewers:
            rec = evidence.read_latest("review", reviewer)
            if rec is None:
                missing.append(f"review/{reviewer} — never run")
            elif not evidence.is_current(rec, fingerprint=fp):
                missing.append(f"review/{reviewer} — stale (code changed since this review ran)")
            elif rec.get("blocker", 0):
                missing.append(f"review/{reviewer} — {rec['blocker']} BLOCKER finding(s) open")

    return missing


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        payload = {}

    # Never block the same turn twice -- this is what makes the gate
    # terminate rather than loop.
    if payload.get("stop_hook_active"):
        print(json.dumps({}))
        return 0

    text = find_last_assistant_text(payload.get("transcript_path"))
    if text is None or not looks_like_completion_claim(text):
        # No completion claim detected (or no transcript available to check).
        # Let the stop through -- this hook only ever intervenes on an
        # apparent "Done" claim, never on an ordinary pause.
        print(json.dumps({}))
        return 0

    paths = changed_paths()
    if not is_product_change(paths):
        print(json.dumps({}))
        return 0

    areas = required_areas(paths)
    missing = missing_evidence(areas)

    if not missing:
        print(json.dumps({}))
        return 0

    reason = (
        "Completion claim detected, but evidence for the current repository "
        "state is incomplete. Do not report Done. Missing:\n"
        + "\n".join(f"  - {m}" for m in missing)
        + "\n\nRun the corresponding `python scripts/verify.py targeted <area>` "
        "(and any required reviewer) against the CURRENT state, or state "
        "explicitly that this is NOT DONE and name what is missing and why "
        "(e.g. an unavailable environment) -- that is an accepted, truthful "
        "outcome. See docs/ai-sdlc/DEFINITION_OF_DONE.md."
    )
    print(json.dumps({"decision": "block", "reason": reason}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
