"""Does the live schema match the models this code expects?

    python scripts/schema_drift.py                    # against DATABASE_URL
    python scripts/schema_drift.py --json
    python scripts/schema_drift.py --strict           # also fail on extra objects

Two questions, both asked:

1. **Is the migration history applied?** The `alembic_version` row against this
   checkout's head. A deployment running code from a newer revision than its
   database is the one that produces `column does not exist` for one endpoint
   and works everywhere else.

2. **Does the schema match the models?** `alembic check`. A migration that was
   hand-edited after being applied, or a column added directly in a psql
   session during an incident, leaves the two disagreeing in a way no test
   catches -- every test builds its schema from the same models.

Run it after every deploy and on a schedule. Drift does not announce itself:
it waits for the query that happens to touch the column nobody migrated.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"


def head_revision() -> str | None:
    """This checkout's head, read from the migration files.

    Textual rather than via Alembic's API so this works with no database
    configured -- which is the state you are in when you are trying to work
    out whether the database is the problem.
    """
    versions = BACKEND / "migrations" / "versions"
    revisions: dict[str, str | None] = {}
    for path in versions.glob("*.py"):
        text = path.read_text(encoding="utf-8")
        rev = re.search(r"^revision: str = ['\"]([^'\"]+)['\"]", text, re.M)
        down = re.search(
            r"^down_revision: str \| None = (?:['\"]([^'\"]+)['\"]|None)",
            text, re.M)
        if rev:
            revisions[rev.group(1)] = down.group(1) if down else None
    if not revisions:
        return None
    parents = {d for d in revisions.values() if d}
    heads = [r for r in revisions if r not in parents]
    if len(heads) != 1:
        # Two heads means a merge is missing, which is its own problem and
        # worth reporting rather than guessing past.
        return None
    return heads[0]


async def applied_revision(url: str) -> str | None:
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import create_async_engine

    engine = create_async_engine(url)
    try:
        async with engine.connect() as connection:
            result = await connection.execute(
                text("SELECT version_num FROM alembic_version"))
            row = result.first()
            return row[0] if row else None
    except Exception as exc:  # noqa: BLE001
        message = str(exc)
        if "alembic_version" in message and "does not exist" in message:
            # A database built with `create_all` and never stamped. This is a
            # real state, and a confusing one: every table is there and the
            # next `alembic upgrade head` fails on "type already exists".
            return "__unstamped__"
        raise
    finally:
        await engine.dispose()


def alembic_check(url: str) -> tuple[bool, str]:
    env = dict(os.environ)
    env["DATABASE_URL"] = url
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "check"],
        cwd=BACKEND, env=env, capture_output=True, text=True)
    output = (result.stdout + result.stderr).strip()
    return result.returncode == 0, output


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Compare the live schema with this checkout's models.")
    parser.add_argument("--database-url", default=None)
    parser.add_argument("--json", action="store_true", dest="as_json")
    parser.add_argument(
        "--strict", action="store_true",
        help="treat an unreadable version row as a failure too")
    args = parser.parse_args()

    url = args.database_url or os.environ.get("DATABASE_URL", "")
    if not url:
        print("DATABASE_URL is not set.", file=sys.stderr)
        return 2

    head = head_revision()
    try:
        applied = asyncio.run(applied_revision(url))
    except Exception as exc:  # noqa: BLE001
        report = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
        print(json.dumps(report, indent=2) if args.as_json
              else f"FAIL: could not read the schema version: {exc}")
        return 1

    problems: list[str] = []

    if head is None:
        problems.append(
            "This checkout has no single migration head -- either there are no "
            "migrations, or two branches were merged without a merge revision.")
    elif applied == "__unstamped__":
        problems.append(
            "The database has no alembic_version row. It was probably built "
            "with create_all and never stamped, so the next `alembic upgrade "
            "head` will fail on an already-existing type. Fix with: "
            f"`alembic stamp {head}` if the schema is genuinely current.")
    elif applied != head:
        problems.append(
            f"The database is at revision {applied}, this code expects {head}. "
            "Run `python scripts/install.py` (or `alembic upgrade head`).")

    models_match, output = alembic_check(url)
    if not models_match:
        detail = next(
            (line for line in output.splitlines()
             if "New upgrade operations detected" in line),
            output.splitlines()[-1] if output else "unknown")
        problems.append(
            "The schema does not match the models: " + detail.strip() +
            "  -- something changed the database outside a migration, or a "
            "model changed without one.")

    report = {
        "ok": not problems,
        "head_revision": head,
        "applied_revision": None if applied == "__unstamped__" else applied,
        "models_match_schema": models_match,
        "problems": problems,
    }

    if args.as_json:
        print(json.dumps(report, indent=2))
    else:
        print("\nSchema drift")
        print("=" * 72)
        print(f"  code expects : {head}")
        print(f"  database has : "
              f"{'(unstamped)' if applied == '__unstamped__' else applied}")
        print(f"  models match : {'yes' if models_match else 'no'}")
        if problems:
            print("-" * 72)
            for problem in problems:
                print(f"  FAIL {problem}")
        print("=" * 72)
        print("  PASS -- no drift.\n" if not problems
              else f"  FAIL -- {len(problems)} problem(s).\n")

    return 0 if not problems else 1


if __name__ == "__main__":
    raise SystemExit(main())
