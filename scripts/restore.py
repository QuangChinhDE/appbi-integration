"""Restore a backup into a database, deliberately awkwardly.

    python scripts/restore.py --dump ./backups/appbi-...dump --into appbi_recovered
    python scripts/restore.py --dump ... --into appbi_workflow --i-understand-this-overwrites
    python scripts/restore.py --dump ... --into ... --via-docker postgres

Restoring is the most destructive operation in the product, and it is performed
by somebody under pressure. So:

* the target database is **named explicitly**. There is no default and no "the
  one in DATABASE_URL", because the one in DATABASE_URL is production.
* restoring over an existing database requires
  `--i-understand-this-overwrites`. The flag is long on purpose.
* the manifest is checked first, and a schema-revision mismatch stops the
  restore rather than warning about it. Loading last month's dump onto this
  month's schema produces a database that mostly works, which is worse than
  one that plainly does not.
* the encryption key is compared by fingerprint before anything is written. A
  restore with the wrong key succeeds and leaves every credential unreadable,
  and that is discovered when the first workflow fails at 3am.

What it does not do is decide anything. It restores what the dump contains and
tells you what state you are in.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent


def _load_backup_module():
    """Reuse `backup.py`'s plumbing rather than reimplementing it.

    Two scripts with their own idea of how to build a `pg_restore` command line
    is how a restore ends up unable to read a dump the backup wrote.
    """
    spec = importlib.util.spec_from_file_location(
        "appbi_backup", ROOT / "scripts" / "backup.py")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Restore a backup into a named database.")
    parser.add_argument("--dump", required=True)
    parser.add_argument(
        "--into", required=True, metavar="DBNAME",
        help="the database to restore into. Named explicitly on purpose.")
    parser.add_argument(
        "--i-understand-this-overwrites", action="store_true",
        dest="overwrite",
        help="required to restore into a database that already exists")
    parser.add_argument(
        "--ignore-revision-mismatch", action="store_true",
        help="restore even though the dump's schema revision differs from "
             "this checkout's head. Almost always the wrong choice.")
    parser.add_argument("--via-docker", default=None, metavar="SERVICE")
    parser.add_argument("--strict", action="store_true", default=True)
    args = parser.parse_args()

    backup = _load_backup_module()
    backup._DOCKER_SERVICE = args.via_docker

    import os

    url = os.environ.get("DATABASE_URL", "")
    if not url:
        raise SystemExit("DATABASE_URL is not set (used to reach the server).")

    dump = pathlib.Path(args.dump)
    if not dump.exists():
        raise SystemExit(f"No such dump: {dump}")

    # ── the manifest, before anything is written ───────────────────────────
    manifest_path = dump.with_suffix(".manifest.json")
    if not manifest_path.exists():
        raise SystemExit(
            f"No manifest beside {dump.name}. Refusing to restore a dump whose "
            "schema revision and contents are unknown.")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    import hashlib

    if hashlib.sha256(dump.read_bytes()).hexdigest() != manifest.get("dump_sha256"):
        raise SystemExit(
            "The dump does not match its manifest checksum: it is corrupt or "
            "was replaced. Nothing has been changed.")
    print(f"dump           : {dump.name}")
    print(f"taken at       : {manifest.get('created_at')}")
    print(f"schema revision: {manifest.get('schema_revision')}")
    print(f"product version: {manifest.get('product_version')}")

    # ── revision match ─────────────────────────────────────────────────────
    head = _head_revision()
    if head and manifest.get("schema_revision") != head:
        message = (
            f"\nThe dump is at schema revision {manifest.get('schema_revision')} "
            f"but this checkout's head is {head}.\n"
            "Restoring it here would produce a database that mostly works.\n"
            "Either check out the release that matches the dump, or restore\n"
            "and then run `alembic upgrade head` deliberately."
        )
        if not args.ignore_revision_mismatch:
            raise SystemExit(message + "\n\nNothing has been changed.")
        print(message + "\n  continuing because --ignore-revision-mismatch was given")

    # ── the encryption key ─────────────────────────────────────────────────
    expected = manifest.get("encryption_key_fingerprint")
    actual = backup._key_fingerprint()
    if expected and actual is None:
        print("\nWARNING: this dump's credentials were encrypted with a key "
              "whose fingerprint is recorded in the manifest, and there is no "
              "SECRET_ENCRYPTION_KEY in this environment. Credentials will "
              "restore as unreadable ciphertext.")
    elif expected and actual != expected:
        raise SystemExit(
            "\nThe SECRET_ENCRYPTION_KEY in this environment is not the one "
            "this dump was taken with.\nEvery credential would restore as "
            "unreadable ciphertext, and the workflows that use them would "
            "fail\nat their next run rather than now.\n\n"
            "Nothing has been changed. Supply the right key, or pass the "
            "restore through\n`app.core.secrets.rewrap_all` afterwards with "
            "both keys available.")
    elif expected:
        print("encryption key : matches the dump")

    # ── the target ─────────────────────────────────────────────────────────
    admin_url = re.sub(r"/[^/?]+(\?|$)", r"/postgres\1", url)
    exists = backup._psql_scalar(
        admin_url,
        f"SELECT 1 FROM pg_database WHERE datname = '{args.into}'") == "1"

    if exists and not args.overwrite:
        raise SystemExit(
            f"\nDatabase '{args.into}' already exists.\n"
            "Restoring into it would replace its contents. If that is what you "
            "mean, pass\n  --i-understand-this-overwrites\n\n"
            "Nothing has been changed.")

    if exists:
        print(f"\ndropping and recreating '{args.into}'")
        backup._psql_scalar(admin_url, f'DROP DATABASE "{args.into}"')
    else:
        print(f"\ncreating '{args.into}'")
    backup._psql_scalar(admin_url, f'CREATE DATABASE "{args.into}"')

    target_url = re.sub(r"/[^/?]+(\?|$)", f"/{args.into}" + r"\1", url)
    print("pg_restore ...")
    result = backup._pg_restore(dump, target_url, strict=args.strict)
    if result.returncode != 0:
        raise SystemExit(
            f"pg_restore exited {result.returncode}. The target database is in "
            f"a partial state and must not be used.\n\n{result.stderr[-2000:]}")

    # ── what state are we in ───────────────────────────────────────────────
    counts = backup._row_counts(target_url)
    revision = backup._psql_scalar(
        target_url, "SELECT version_num FROM alembic_version")

    print("\n" + "=" * 72)
    print(f"  Restored into '{args.into}'")
    print(f"  schema revision : {revision}")
    for table, count in counts.items():
        if count >= 0:
            print(f"    {table:<20} {count}")
    print("=" * 72)
    print("\n  Next:")
    print(f"    1. point DATABASE_URL at '{args.into}'")
    print("    2. `python scripts/install.py --skip-doctor --skip-bootstrap` to")
    print("       confirm the schema matches this checkout")
    print("    3. sign in and open one workflow before sending traffic\n")
    return 0


def _head_revision() -> str | None:
    """This checkout's head revision, read from the migration files.

    Read textually rather than through Alembic's API: this script must work
    without a configured database connection, and `ScriptDirectory` wants one.
    """
    versions = ROOT / "backend" / "migrations" / "versions"
    if not versions.exists():
        return None
    revisions: dict[str, str | None] = {}
    for path in versions.glob("*.py"):
        text = path.read_text(encoding="utf-8")
        rev = re.search(r"^revision: str = ['\"]([^'\"]+)['\"]", text, re.M)
        down = re.search(
            r"^down_revision: str \| None = (?:['\"]([^'\"]+)['\"]|None)", text, re.M)
        if rev:
            revisions[rev.group(1)] = down.group(1) if down else None
    if not revisions:
        return None
    # The head is the revision nothing else points back to.
    parents = {d for d in revisions.values() if d}
    heads = [r for r in revisions if r not in parents]
    return heads[0] if len(heads) == 1 else None


if __name__ == "__main__":
    raise SystemExit(main())
