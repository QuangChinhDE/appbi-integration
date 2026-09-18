"""Record that a reviewer actually ran, and what it found — the mechanism
behind REVIEW.md's "review execution must be provable" rule.

A reviewer agent's job is to look at a diff and report findings; this script
is the one way that report becomes evidence rather than a claim in the
transcript. Every reviewer agent (`.claude/agents/*.md`) is instructed to call
this as its **last** action, after finishing its analysis, with the fingerprint
of the state it just reviewed.

    python scripts/record_review.py --reviewer architecture-reviewer \\
        --status FINDINGS --blocker 0 --important 2 --minor 1 \\
        --summary "Two IMPORTANT findings on tenancy filters, no BLOCKER."

If the fingerprint has moved between when the reviewer started reading the
diff and when it calls this script, the record is written anyway (a review
that finishes after a few seconds is still a review of what it read), but
`completion_gate.py` and `evidence.py check` will correctly see it as stale
the moment the diff changes further — which is the intended lifecycle
(REVIEW.md's review-fix-review loop): a fix invalidates the review that found
it, and the fixed code needs its own pass.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import evidence  # noqa: E402

VALID_REVIEWERS = {
    "product-reviewer", "architecture-reviewer", "qa-reviewer", "ui-reviewer",
}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--reviewer", required=True, choices=sorted(VALID_REVIEWERS))
    parser.add_argument("--status", required=True, choices=["PASS", "FINDINGS", "PARTIAL"],
                        help="PASS: no findings. FINDINGS: at least one finding, of any "
                             "severity. PARTIAL: the review could not fully run (say why "
                             "in --summary) -- e.g. ui-reviewer with no running application.")
    parser.add_argument("--blocker", type=int, required=True)
    parser.add_argument("--important", type=int, required=True)
    parser.add_argument("--minor", type=int, required=True)
    parser.add_argument("--summary", required=True,
                        help="One or two sentences. Goes into the evidence record verbatim.")
    parser.add_argument("--agent-id", default=None,
                        help="This subagent's session/agent id, if known, for traceability.")
    args = parser.parse_args()

    fp = evidence.current_fingerprint()
    rec = evidence.record(
        kind="review",
        area=args.reviewer,
        status=args.status,
        reviewer=args.reviewer,
        blocker=args.blocker,
        important=args.important,
        minor=args.minor,
        fingerprint=fp,
        detail={"summary": args.summary, "agent_id": args.agent_id},
    )

    print("REVIEW_VERDICT")
    print(f"fingerprint: {rec['fingerprint']}")
    print(f"reviewer:    {rec['reviewer']}")
    print(f"status:      {rec['status']}")
    print(f"blocker:     {rec['blocker']}")
    print(f"important:   {rec['important']}")
    print(f"minor:       {rec['minor']}")
    print()
    print("Recorded. This review is valid ONLY for the fingerprint above. Any")
    print("further edit to the diff makes it stale, and the reviewer must run again")
    print("(REVIEW.md's review-fix-review loop) -- do not reuse this verdict after")
    print("applying a fix.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
