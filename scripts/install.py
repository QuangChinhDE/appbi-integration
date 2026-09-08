"""Bring a database up to the running release, from empty or from an old one.

    python scripts/install.py --env-file .env.production
    python scripts/install.py --env-file .env.production --skip-doctor  # dev only
    python scripts/install.py --dry-run

The order is not negotiable and is the reason this exists as a script rather
than three lines in a README:

  1. check the configuration           -- refuse a deployment that is unsafe
  2. wait for the database             -- a managed instance may still be
                                          starting, or failing over
  3. `alembic upgrade head`            -- never `create_all`: a schema change
                                          has to be reviewable and reversible
  4. `alembic check`                   -- prove the schema now matches the
                                          models, so drift is caught here
                                          rather than by a confusing query
                                          failure later
  5. bootstrap the catalogue           -- node definitions and the engine
                                          instance row, idempotent
  6. bootstrap the platform admin      -- only when no user exists at all

Idempotent throughout: running it on an up-to-date deployment changes nothing,
which is what lets it be the first step of every deploy rather than a thing
somebody remembers to do on the first one.
"""

from __future__ import annotations

import argparse
import asyncio
import importlib.util
import os
import pathlib
import subprocess
import sys
import time

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent


def _backend_dir() -> pathlib.Path:
    """Where `alembic.ini` and the `app` package live.

    Two layouts, because this script runs in both:

    * a checkout, where it is `<repo>/backend`;
    * the API image, where the application *is* the working directory (`/app`)
      and there is no `backend/` at all.

    Detected rather than configured. A migration step that needs an extra
    environment variable to find the migrations is a migration step that gets
    skipped in one of the two places.
    """
    candidates = (ROOT / "backend", pathlib.Path.cwd(), pathlib.Path("/app"))
    for candidate in candidates:
        if (candidate / "alembic.ini").exists():
            return candidate
    raise SystemExit(
        "Cannot find alembic.ini. Looked in: "
        + ", ".join(str(c) for c in candidates))


BACKEND = _backend_dir()


def _load_doctor():
    # Beside this file, not under `ROOT/scripts`: in the image the two are
    # mounted together into one directory and there is no `scripts/` above them.
    spec = importlib.util.spec_from_file_location(
        "appbi_doctor", HERE / "doctor.py")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _step(number: int, total: int, title: str) -> None:
    print(f"\n[{number}/{total}] {title}")
    print("-" * 72)


def _run(command: list[str], *, env: dict[str, str], dry_run: bool) -> None:
    printable = " ".join(command)
    if dry_run:
        print(f"  (dry run) {printable}")
        return
    print(f"  $ {printable}")
    result = subprocess.run(command, cwd=BACKEND, env=env)
    if result.returncode != 0:
        raise SystemExit(
            f"\n  FAILED: {printable} exited {result.returncode}\n"
            "  The deployment has been stopped. Nothing after this step ran.")


async def _wait_for_database(url: str, timeout: float) -> None:
    """Poll until the database answers, or give up loudly.

    A managed instance can be mid-failover when a deploy starts. Retrying for a
    bounded time turns that from a failed deploy into a slow one; retrying
    forever turns a genuinely wrong `DATABASE_URL` into a hang nobody can
    diagnose.
    """
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import create_async_engine

    deadline = time.monotonic() + timeout
    attempt = 0
    last: Exception | None = None
    while time.monotonic() < deadline:
        attempt += 1
        engine = create_async_engine(url, pool_pre_ping=True)
        try:
            async with engine.connect() as connection:
                await connection.execute(text("SELECT 1"))
            print(f"  database answered on attempt {attempt}")
            await engine.dispose()
            return
        except Exception as exc:  # noqa: BLE001
            last = exc
            await engine.dispose()
            print(f"  attempt {attempt}: not ready ({type(exc).__name__})")
            await asyncio.sleep(2.0)

    raise SystemExit(
        f"\n  FAILED: the database did not answer within {timeout:.0f}s.\n"
        f"  Last error: {type(last).__name__}: {last}\n"
        "  Check DATABASE_URL, the network policy, and the instance's status.")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Migrate and bootstrap a deployment, in the right order.")
    parser.add_argument("--env-file", default=None)
    parser.add_argument(
        "--skip-doctor", action="store_true",
        help="skip the configuration gate (development only)")
    parser.add_argument(
        "--skip-bootstrap", action="store_true",
        help="migrate only; do not seed the catalogue or the admin account")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--database-timeout", type=float, default=90.0,
        help="how long to wait for the database (default 90s)")
    args = parser.parse_args()

    env = dict(os.environ)
    if args.env_file:
        path = pathlib.Path(args.env_file)
        if not path.is_absolute():
            path = ROOT / path
        if not path.exists():
            print(f"No such file: {path}", file=sys.stderr)
            return 2
        doctor = _load_doctor()
        file_values = doctor.parse_env_file(path)
        # The file is the source of truth for this run. An operator who passed
        # `--env-file` means that file, not whatever the shell happens to hold.
        env.update(file_values)
        env["APPBI_ENV_FILE"] = str(path)
    else:
        doctor = _load_doctor()
        file_values = env

    # `DATABASE_URL_FILE` and friends resolved to their values, the same way
    # the application does at startup, for this script's own use and for the
    # subprocesses it starts. Without this the steps below look for
    # `DATABASE_URL` and do not find it, so a deployment configured entirely
    # through mounted secrets -- which is what `deploy/production.yaml.example`
    # describes -- could not be migrated at all.
    #
    # `file_values` is deliberately left raw: `doctor.run` does its own
    # resolution, and handing it an already-resolved copy would look like an
    # operator who set both the value and the file.
    env, secret_problems = doctor.resolve_file_backed(env)
    if secret_problems:
        for key, message in secret_problems:
            print(f"  [FAIL] {key}: {message}")
        raise SystemExit(
            "\n  FAILED: a secret file is named but unusable. Nothing was "
            "changed.")

    total = 4 if args.skip_bootstrap else 5
    step = 0

    # ── 1. configuration ───────────────────────────────────────────────────
    step += 1
    _step(step, total, "Configuration")
    if args.skip_doctor:
        print("  skipped (--skip-doctor)")
    else:
        report = doctor.run(file_values)
        for finding in report.findings:
            marker = "FAIL" if finding.severity == "ERROR" else "warn"
            print(f"  [{marker}] {finding.key}: {finding.message}")
        if not report.ok:
            raise SystemExit(
                f"\n  FAILED: {len(report.errors)} blocking configuration "
                "problems.\n  Nothing was changed. Fix them and run this "
                "again, or see `python scripts/doctor.py --help`.")
        print(f"  OK ({len(report.warnings)} advisory)")

    # ── 2. database reachable ──────────────────────────────────────────────
    step += 1
    _step(step, total, "Database")
    url = env.get("DATABASE_URL", "")
    if not url:
        raise SystemExit("  FAILED: DATABASE_URL is not set.")
    if args.dry_run:
        print("  (dry run) would wait for the database")
    else:
        asyncio.run(_wait_for_database(url, args.database_timeout))

    python = sys.executable

    # ── 3. migrations ──────────────────────────────────────────────────────
    step += 1
    _step(step, total, "Migrations")
    print("  `alembic upgrade head`, never create_all: a schema change has to")
    print("  be reviewable and reversible.")
    _run([python, "-m", "alembic", "upgrade", "head"],
         env=env, dry_run=args.dry_run)

    # ── 4. drift ───────────────────────────────────────────────────────────
    step += 1
    _step(step, total, "Schema drift")
    print("  The schema now has to match the models. Catching a mismatch here")
    print("  is the difference between a failed deploy and a query that fails")
    print("  for one tenant next week.")
    _run([python, "-m", "alembic", "check"], env=env, dry_run=args.dry_run)

    # ── 5. seed data ───────────────────────────────────────────────────────
    if not args.skip_bootstrap:
        step += 1
        _step(step, total, "Catalogue and platform admin")
        print("  Idempotent. The admin account is created only when no user")
        print("  exists at all, and must change its password on first use.")
        _run([python, "-m", "app.bootstrap"], env=env, dry_run=args.dry_run)

    print("\n" + "=" * 72)
    print("  Install complete." if not args.dry_run
          else "  Dry run complete -- nothing was changed.")
    print("=" * 72 + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
