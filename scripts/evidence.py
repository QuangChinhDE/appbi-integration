"""The evidence store: verification and review results, tied to the exact
repository state that produced them.

Evidence is written under `.claude/evidence/` (gitignored — session-local, not
committed) as one JSON file per record, plus `latest.json` per (kind, area)
pair for cheap lookup. Every record carries the `repo_fingerprint.py`
fingerprint of the state it attests to. A record is **current** only if that
fingerprint matches the repository's fingerprint right now; otherwise it is
**stale**, and stale evidence proves nothing about the current diff.

    python scripts/evidence.py record --kind verification --area backend \\
        --status PASS --detail '{"stages": [...]}'
    python scripts/evidence.py record --kind review --area architecture \\
        --status FINDINGS --blocker 0 --important 2 --minor 1 --reviewer architecture-reviewer

    python scripts/evidence.py status                       # everything recorded, current or stale
    python scripts/evidence.py check --kind verification --area backend
    python scripts/evidence.py check --kind review --area architecture --max-age-sec 3600

`check` exits 0 only if a record exists, matches the current fingerprint, and
(for review) is not itself expired by `--max-age-sec` — a review from three
days ago against a fingerprint that happens to still match is not what
"the reviewer actually ran on this" is supposed to mean, so callers that care
about staleness *and* recency pass both.

This is a library as much as a CLI: `scripts/completion_gate.py` and
`scripts/claude_guard.py` import `read_latest` / `is_current` directly rather
than shelling out.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
import uuid
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
EVIDENCE_DIR = ROOT / ".claude" / "evidence"


def current_fingerprint() -> str:
    result = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "repo_fingerprint.py")],
        capture_output=True, text=True, check=True,
    )
    return result.stdout.strip()


def head_sha() -> str:
    result = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True,
    )
    return result.stdout.strip() if result.returncode == 0 else "0" * 40


def _latest_path(kind: str, area: str) -> Path:
    return EVIDENCE_DIR / kind / f"{area}.latest.json"


def _history_path(kind: str, area: str, record_id: str) -> Path:
    return EVIDENCE_DIR / kind / "history" / f"{area}-{record_id}.json"


def record(
    *,
    kind: str,
    area: str,
    status: str,
    fingerprint: str | None = None,
    **extra: Any,
) -> dict:
    """Write one evidence record. Returns the record written.

    `fingerprint` defaults to the repository's fingerprint *right now*, at the
    moment of recording -- which only makes sense immediately after whatever
    produced `status` finished running against an unchanged tree. Callers that
    verify-then-record in two steps with editing in between are recording a
    lie; `scripts/verify.py` and the reviewer contract both fingerprint
    immediately before and confirm immediately after.
    """
    fp = fingerprint or current_fingerprint()
    rec = {
        "id": uuid.uuid4().hex[:12],
        "kind": kind,
        "area": area,
        "status": status,
        "fingerprint": fp,
        "head_sha": head_sha(),
        "recorded_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "recorded_at_epoch": time.time(),
        **extra,
    }

    latest = _latest_path(kind, area)
    latest.parent.mkdir(parents=True, exist_ok=True)
    latest.write_text(json.dumps(rec, indent=2) + "\n", encoding="utf-8")

    history = _history_path(kind, area, rec["id"])
    history.parent.mkdir(parents=True, exist_ok=True)
    history.write_text(json.dumps(rec, indent=2) + "\n", encoding="utf-8")

    return rec


def read_latest(kind: str, area: str) -> dict | None:
    path = _latest_path(kind, area)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def is_current(rec: dict | None, *, fingerprint: str | None = None) -> bool:
    if rec is None:
        return False
    fp = fingerprint or current_fingerprint()
    return rec.get("fingerprint") == fp


def all_areas(kind: str) -> list[str]:
    kind_dir = EVIDENCE_DIR / kind
    if not kind_dir.exists():
        return []
    return sorted(p.stem.removesuffix(".latest") for p in kind_dir.glob("*.latest.json"))


def status_report() -> list[dict]:
    fp = current_fingerprint()
    rows: list[dict] = []
    if not EVIDENCE_DIR.exists():
        return rows
    for kind_dir in sorted(EVIDENCE_DIR.iterdir()):
        if not kind_dir.is_dir():
            continue
        for area in all_areas(kind_dir.name):
            rec = read_latest(kind_dir.name, area)
            if rec is None:
                continue
            rows.append({
                **rec,
                "current": is_current(rec, fingerprint=fp),
            })
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)

    p_record = sub.add_parser("record", help="write an evidence record for the current state")
    p_record.add_argument("--kind", required=True, choices=["verification", "review", "acceptance"])
    p_record.add_argument("--area", required=True)
    p_record.add_argument("--status", required=True)
    p_record.add_argument("--reviewer")
    p_record.add_argument("--blocker", type=int)
    p_record.add_argument("--important", type=int)
    p_record.add_argument("--minor", type=int)
    p_record.add_argument("--depth", help="quick|targeted|full, for verification records")
    p_record.add_argument("--detail", help="a JSON object merged into the record")

    p_check = sub.add_parser("check", help="exit 0 if current evidence exists for kind+area")
    p_check.add_argument("--kind", required=True)
    p_check.add_argument("--area", required=True)
    p_check.add_argument("--max-age-sec", type=int, default=None)

    sub.add_parser("status", help="list every recorded record and whether it is current")

    args = parser.parse_args()

    if args.command == "record":
        extra: dict[str, Any] = {}
        if args.reviewer is not None:
            extra["reviewer"] = args.reviewer
        if args.blocker is not None:
            extra["blocker"] = args.blocker
        if args.important is not None:
            extra["important"] = args.important
        if args.minor is not None:
            extra["minor"] = args.minor
        if args.depth is not None:
            extra["depth"] = args.depth
        if args.detail is not None:
            try:
                extra["detail"] = json.loads(args.detail)
            except json.JSONDecodeError as exc:
                print(f"--detail is not valid JSON: {exc}", file=sys.stderr)
                return 2
        rec = record(kind=args.kind, area=args.area, status=args.status, **extra)
        print(json.dumps(rec, indent=2))
        return 0

    if args.command == "check":
        rec = read_latest(args.kind, args.area)
        if rec is None:
            print(f"NO EVIDENCE  {args.kind}/{args.area}", file=sys.stderr)
            return 1
        fp = current_fingerprint()
        if not is_current(rec, fingerprint=fp):
            print(f"STALE  {args.kind}/{args.area}: recorded for {rec['fingerprint'][:12]}, "
                  f"current is {fp[:12]}", file=sys.stderr)
            return 1
        if args.max_age_sec is not None:
            age = time.time() - rec.get("recorded_at_epoch", 0)
            if age > args.max_age_sec:
                print(f"EXPIRED  {args.kind}/{args.area}: recorded {age:.0f}s ago, "
                      f"max age {args.max_age_sec}s", file=sys.stderr)
                return 1
        print(f"CURRENT  {args.kind}/{args.area}: {rec['status']} "
              f"(fingerprint {rec['fingerprint'][:12]})")
        return 0

    if args.command == "status":
        rows = status_report()
        if not rows:
            print("no evidence recorded yet")
            return 0
        fp = current_fingerprint()
        print(f"current fingerprint: {fp[:12]}\n")
        for row in sorted(rows, key=lambda r: (r["kind"], r["area"])):
            mark = "CURRENT" if row["current"] else "STALE  "
            print(f"[{mark}] {row['kind']:<12} {row['area']:<20} "
                  f"{row['status']:<10} fp={row['fingerprint'][:12]} "
                  f"at {row['recorded_at']}")
        return 0

    return 2


if __name__ == "__main__":
    sys.exit(main())
