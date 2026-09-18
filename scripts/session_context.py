"""SessionStart hook: tell the session what state the repository is actually
in, so it cannot assume "everything was already checked" just because a
previous turn in this conversation said so.

Cheap by design -- this reads git status and evidence files, it does not run
any suite. The point is to make session state rediscoverable from the
repository rather than from conversation memory, not to front-load a full
verification on every resume.

Wired as a `SessionStart` hook in `.claude/settings.json`; prints a short
report and returns it as `additionalContext` so it lands in the model's
context without cluttering the visible transcript.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import evidence  # noqa: E402


def _git(*args: str) -> str:
    result = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True)
    return result.stdout.strip() if result.returncode == 0 else ""


def active_change() -> str | None:
    marker = ROOT / ".claude" / "active-change"
    if marker.exists():
        slug = marker.read_text(encoding="utf-8").strip()
        if slug and (ROOT / "docs" / "changes" / slug).exists():
            return slug
    return None


def light_change() -> dict | None:
    marker = ROOT / ".claude" / "light-change.json"
    if marker.exists():
        try:
            return json.loads(marker.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return None
    return None


def build_report() -> str:
    branch = _git("branch", "--show-current") or "(detached HEAD)"
    head = _git("rev-parse", "--short", "HEAD") or "(no commits)"
    dirty = bool(_git("status", "--porcelain"))
    fp = evidence.current_fingerprint()

    lines = [
        "## Repository state (from scripts/session_context.py, not conversation memory)",
        f"- branch: {branch} @ {head}{' (dirty)' if dirty else ' (clean)'}",
        f"- current fingerprint: {fp[:16]}",
    ]

    change = active_change()
    light = light_change()
    if change:
        lines.append(f"- active change: docs/changes/{change}/ (preflight required for product code edits)")
    elif light:
        lines.append(f"- light-path change declared: \"{light.get('reason', '?')}\" "
                      f"(only small, self-contained fixes belong here)")
    else:
        lines.append("- no active change and no light-path declared: product code edits will be "
                      "blocked by the preflight gate until one exists (run /preflight, or declare "
                      "a light-path fix for something genuinely small)")

    rows = evidence.status_report()
    if not rows:
        lines.append("- no verification or review evidence recorded yet this checkout")
    else:
        current = [r for r in rows if r["current"]]
        stale = [r for r in rows if not r["current"]]
        if current:
            lines.append("- evidence CURRENT for this exact state:")
            for r in sorted(current, key=lambda x: (x["kind"], x["area"])):
                lines.append(f"    {r['kind']}/{r['area']}: {r['status']} (recorded {r['recorded_at']})")
        if stale:
            lines.append("- evidence STALE (recorded state != current state, do not reuse):")
            for r in sorted(stale, key=lambda x: (x["kind"], x["area"])):
                lines.append(f"    {r['kind']}/{r['area']}: was {r['status']}, now stale")

    lines.append(
        "- reminder: `python scripts/verify.py quick|targeted <area>|full` records evidence "
        "against this fingerprint; `python scripts/evidence.py status` shows what is current. "
        "Do not report a check as passing without a corresponding evidence record."
    )
    lines.append(
        "- reminder: licensing.commercial_gate in compatibility.yaml is NOT_REVIEWED -- "
        "internal delivery only (ADR-015)."
    )

    return "\n".join(lines)


def main() -> int:
    report = build_report()
    # Stdout must be exactly one JSON object for the harness to parse
    # `hookSpecificOutput.additionalContext` -- printing anything else
    # alongside it would make the whole stream invalid JSON and silently
    # drop the context injection.
    output = {
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "additionalContext": report,
        }
    }
    print(json.dumps(output))
    return 0


if __name__ == "__main__":
    sys.exit(main())
