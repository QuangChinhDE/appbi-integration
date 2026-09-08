"""Take a backup, and prove it can be restored.

    python scripts/backup.py --out ./backups
    python scripts/backup.py --out ./backups --upload s3://bucket/prefix
    python scripts/backup.py --verify ./backups/appbi-20260905T0900Z.dump

    # when the postgres client tools are not on this host, only in a container
    python scripts/backup.py --via-docker postgres --out ./backups

A wrapper around `pg_dump`, which is the right tool. What it adds is the part
that gets skipped:

* a **manifest** beside the dump, recording the schema revision, the product
  version and row counts. A dump whose schema revision nobody wrote down is a
  dump you find out is unrestorable during an incident.
* `--verify`, which restores into a scratch database and checks the counts
  match. An unverified backup is a belief, not a backup.

The encryption key is deliberately **not** in here. A dump contains every
credential's ciphertext and its wrapped data key; without `SECRET_ENCRYPTION_KEY`
the credentials in a restored copy are unreadable, which is the property that
makes an accidentally-published dump survivable. The manifest records the key's
fingerprint so a restore can tell whether the key it has is the right one --
without recording anything that helps derive it.
"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import os
import pathlib
import re
import subprocess
import sys
from urllib.parse import unquote, urlparse

ROOT = pathlib.Path(__file__).resolve().parent.parent

#: Tables whose row counts go in the manifest. Not every table: these are the
#: ones whose absence after a restore means data was lost, as opposed to a
#: cache that rebuilds itself.
COUNTED_TABLES = (
    "workspaces", "users", "memberships", "workflows", "workflow_drafts",
    "workflow_versions", "credentials", "secrets", "trigger_bindings",
    "executions", "audit_events",
)


#: When set, `pg_dump`/`psql`/`pg_restore` are run inside this compose
#: service instead of on this host. Set by `--via-docker`.
#:
#: A convenience with a real justification: the tools have to be the same major
#: version as the server, and the container the server runs in is the one place
#: that is guaranteed. On a laptop there is often no `pg_dump` at all, and a
#: backup script that cannot be exercised outside production is a backup script
#: nobody has ever run.
_DOCKER_SERVICE: str | None = None


def _wrap(command: list[str]) -> list[str]:
    if _DOCKER_SERVICE is None:
        return command
    return ["docker", "compose", "exec", "-T", _DOCKER_SERVICE, *command]


def _pg_env_from_url(url: str) -> tuple[list[str], dict[str, str]]:
    """`pg_dump` arguments and environment from a SQLAlchemy URL.

    The password goes in `PGPASSWORD`, never on the command line: `ps` is
    readable by other processes on most hosts.
    """
    # `postgresql+asyncpg://` is a SQLAlchemy dialect, not something libpq
    # understands.
    cleaned = re.sub(r"^postgresql\+\w+://", "postgresql://", url)
    parsed = urlparse(cleaned)

    args = []
    if parsed.hostname:
        args += ["--host", parsed.hostname]
    if parsed.port:
        args += ["--port", str(parsed.port)]
    if parsed.username:
        args += ["--username", unquote(parsed.username)]
    database = (parsed.path or "/").lstrip("/")
    if not database:
        raise SystemExit("DATABASE_URL names no database.")
    args += ["--dbname", database]

    env = dict(os.environ)
    if parsed.password:
        env["PGPASSWORD"] = unquote(parsed.password)
    return args, env


def _psql_scalar(url: str, sql: str) -> str:
    args, env = _pg_env_from_url(url)
    command = _wrap(
        ["psql", *args, "--no-align", "--tuples-only", "--command", sql])
    if _DOCKER_SERVICE is not None:
        # `docker compose exec` does not inherit the caller's environment, so
        # the password has to be handed over explicitly.
        password = env.get("PGPASSWORD")
        if password:
            command = command[:4] + ["--env", f"PGPASSWORD={password}"] + command[4:]
    result = subprocess.run(command, capture_output=True, text=True, env=env)
    if result.returncode != 0:
        raise SystemExit(f"psql failed: {result.stderr.strip()[:400]}")
    return result.stdout.strip()


def _row_counts(url: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for table in COUNTED_TABLES:
        try:
            counts[table] = int(_psql_scalar(url, f"SELECT count(*) FROM {table}"))
        except (SystemExit, ValueError):
            # A table that does not exist yet is recorded as absent rather
            # than failing the backup: an older schema is still worth dumping.
            counts[table] = -1
    return counts


def _key_fingerprint() -> str | None:
    """A fingerprint of the encryption key, not the key.

    Enough for a restore to say "this is the wrong key" before it hands
    somebody a workspace full of undecryptable credentials. SHA-256 of the key
    with a fixed domain-separation prefix, truncated: it identifies the key
    and does not help derive it.
    """
    key = os.environ.get("SECRET_ENCRYPTION_KEY", "").strip()
    if not key:
        return None
    digest = hashlib.sha256(b"appbi-workflow-kek-fingerprint:" + key.encode())
    return digest.hexdigest()[:16]


def _manifest(url: str, dump: pathlib.Path) -> dict:
    return {
        "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "product_version": os.environ.get("PRODUCT_VERSION", "unknown"),
        # The single most important field. A dump restored onto a different
        # schema revision is the failure mode this whole file exists to
        # prevent.
        "schema_revision": _psql_scalar(
            url, "SELECT version_num FROM alembic_version") or "unknown",
        "row_counts": _row_counts(url),
        "dump_file": dump.name,
        "dump_bytes": dump.stat().st_size,
        "dump_sha256": hashlib.sha256(dump.read_bytes()).hexdigest(),
        # Present means "credentials in this dump need this key". Absent means
        # the backup was taken without one in the environment, and the
        # credentials will be unreadable -- which the restore says out loud.
        "encryption_key_fingerprint": _key_fingerprint(),
        "note": (
            "Credentials in this dump are ciphertext. Restoring them usably "
            "requires the SECRET_ENCRYPTION_KEY whose fingerprint is recorded "
            "above; the key is deliberately not in this file."
        ),
    }


def _pg_restore(dump: pathlib.Path, target_url: str, *, strict: bool):
    """Load a custom-format dump into `target_url`.

    Not `--clean`: the target is always a database this tool just created, and
    a restore that drops objects it did not create is a restore that can eat a
    database somebody pointed it at by mistake.
    """
    pg_args, env = _pg_env_from_url(target_url)
    command = [
        "pg_restore", *pg_args, "--no-owner", "--no-privileges",
        # Keep going by default: a dump taken while the schema was mid-change
        # can have one unrestorable object, and stopping would hide the other
        # two hundred that restored fine. The row-count comparison is the real
        # verdict. `--strict` is for a release gate, which wants the opposite.
        "--exit-on-error" if strict else "--verbose",
    ]
    if _DOCKER_SERVICE is None:
        return subprocess.run(
            [*command, str(dump)], env=env, capture_output=True, text=True)

    wrapped = _wrap(command)
    password = env.get("PGPASSWORD")
    if password:
        wrapped = wrapped[:4] + ["--env", f"PGPASSWORD={password}"] + wrapped[4:]
    with dump.open("rb") as handle:
        return subprocess.run(
            wrapped, stdin=handle, env=env, capture_output=True, text=True)


def do_backup(args) -> int:
    url = os.environ.get("DATABASE_URL", "")
    if not url:
        raise SystemExit("DATABASE_URL is not set.")

    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    dump = out / f"appbi-{stamp}.dump"

    print(f"pg_dump -> {dump}")
    pg_args, env = _pg_env_from_url(url)
    command = [
        "pg_dump", *pg_args,
        # Custom format: compressed, and restorable table-by-table, which is
        # what makes a partial recovery possible.
        "--format", "custom",
        "--no-owner", "--no-privileges",
    ]
    if _DOCKER_SERVICE is None:
        command += ["--file", str(dump)]
        result = subprocess.run(command, env=env)
        if result.returncode != 0:
            raise SystemExit(f"pg_dump exited {result.returncode}")
    else:
        # Streamed to stdout and written here. `--file` would put the dump
        # inside the container, where the next `docker compose down` removes
        # it -- a backup stored in the thing it backs up.
        wrapped = _wrap(command)
        password = env.get("PGPASSWORD")
        if password:
            wrapped = wrapped[:4] + ["--env", f"PGPASSWORD={password}"] + wrapped[4:]
        with dump.open("wb") as handle:
            result = subprocess.run(wrapped, stdout=handle, env=env)
        if result.returncode != 0:
            dump.unlink(missing_ok=True)
            raise SystemExit(f"pg_dump exited {result.returncode}")

    manifest_path = dump.with_suffix(".manifest.json")
    manifest = _manifest(url, dump)
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    print(f"manifest -> {manifest_path}")
    print(f"  schema revision : {manifest['schema_revision']}")
    print(f"  product version : {manifest['product_version']}")
    print(f"  size            : {manifest['dump_bytes'] / 1e6:.1f} MB")
    if manifest["encryption_key_fingerprint"] is None:
        print("  WARNING: no SECRET_ENCRYPTION_KEY in the environment, so the")
        print("           manifest cannot record which key this dump needs.")

    if args.upload:
        target = args.upload.rstrip("/")
        print(f"upload -> {target}")
        for path in (dump, manifest_path):
            uploaded = subprocess.run(
                ["aws", "s3", "cp", str(path), f"{target}/{path.name}"])
            if uploaded.returncode != 0:
                # Loud, and a failure: a backup that only exists on the host it
                # was taken from does not survive losing that host.
                raise SystemExit(
                    f"upload of {path.name} failed with {uploaded.returncode}. "
                    "The local copy is intact, but this backup is not offsite.")

    print("\nBackup complete. It is not verified until you run:")
    print(f"  python scripts/backup.py --verify {dump}\n")
    return 0


def do_verify(args) -> int:
    """Restore into a scratch database and compare against the manifest.

    This is the only step that distinguishes a backup from a file.
    """
    dump = pathlib.Path(args.verify)
    if not dump.exists():
        raise SystemExit(f"No such dump: {dump}")
    manifest_path = dump.with_suffix(".manifest.json")
    if not manifest_path.exists():
        raise SystemExit(
            f"No manifest beside {dump.name}. Without one there is nothing to "
            "verify the restore against.")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    digest = hashlib.sha256(dump.read_bytes()).hexdigest()
    if digest != manifest.get("dump_sha256"):
        raise SystemExit(
            "The dump does not match its manifest checksum. It is corrupt or "
            "was replaced.")
    print("checksum OK")

    url = os.environ.get("DATABASE_URL", "")
    if not url:
        raise SystemExit("DATABASE_URL is not set (used to reach the server).")

    scratch = args.scratch_db
    admin_url = re.sub(r"/[^/?]+(\?|$)", r"/postgres\1", url)
    print(f"restoring into scratch database '{scratch}'")

    for sql in (f'DROP DATABASE IF EXISTS "{scratch}"',
                f'CREATE DATABASE "{scratch}"'):
        _psql_scalar(admin_url, sql)

    scratch_url = re.sub(r"/[^/?]+(\?|$)", f"/{scratch}" + r"\1", url)
    restored = _pg_restore(dump, scratch_url, strict=args.strict)
    if args.strict and restored.returncode != 0:
        raise SystemExit(
            f"pg_restore exited {restored.returncode}:\n"
            f"{restored.stderr[-2000:]}")

    print("comparing row counts against the manifest")
    expected = manifest.get("row_counts", {})
    actual = _row_counts(scratch_url)
    problems = []
    for table, count in expected.items():
        if count < 0:
            continue
        if actual.get(table) != count:
            problems.append(f"  {table}: manifest {count}, restored {actual.get(table)}")

    revision = _psql_scalar(scratch_url, "SELECT version_num FROM alembic_version")
    if revision != manifest.get("schema_revision"):
        problems.append(
            f"  schema revision: manifest {manifest.get('schema_revision')}, "
            f"restored {revision}")

    if not args.keep:
        _psql_scalar(admin_url, f'DROP DATABASE IF EXISTS "{scratch}"')

    if problems:
        print("\nVERIFY FAILED")
        print("\n".join(problems))
        return 1

    print("\nVERIFY PASSED")
    print(f"  schema revision {revision}")
    print(f"  {sum(v for v in actual.values() if v > 0)} rows across "
          f"{len([v for v in actual.values() if v >= 0])} tables")
    if manifest.get("encryption_key_fingerprint"):
        current = _key_fingerprint()
        if current is None:
            print("  note: no SECRET_ENCRYPTION_KEY here, so credential "
                  "readability was not checked.")
        elif current != manifest["encryption_key_fingerprint"]:
            print("  WARNING: the SECRET_ENCRYPTION_KEY in this environment is "
                  "NOT the one this dump was taken with. Credentials would "
                  "restore as unreadable ciphertext.")
            return 1
        else:
            print("  encryption key matches the one this dump was taken with.")
    print()
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Take and verify database backups.")
    parser.add_argument("--out", default="./backups",
                        help="directory for the dump and its manifest")
    parser.add_argument("--upload", default=None, metavar="S3_URI",
                        help="also copy the dump and manifest here")
    parser.add_argument("--verify", default=None, metavar="DUMP",
                        help="restore this dump into a scratch database and "
                             "compare it against its manifest")
    parser.add_argument("--scratch-db", default="appbi_restore_verify")
    parser.add_argument("--keep", action="store_true",
                        help="keep the scratch database after verifying")
    parser.add_argument("--strict", action="store_true",
                        help="fail verification on any pg_restore error")
    parser.add_argument(
        "--via-docker", default=None, metavar="SERVICE",
        help="run the postgres client tools inside this compose service, for "
             "hosts that do not have them installed")
    args = parser.parse_args()

    global _DOCKER_SERVICE
    _DOCKER_SERVICE = args.via_docker

    if args.verify:
        return do_verify(args)
    return do_backup(args)


if __name__ == "__main__":
    raise SystemExit(main())
