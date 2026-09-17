"""Vendor the engine's production dependencies into the repository.

    python scripts/vendor_npm.py --out vendor/npm
    python scripts/vendor_npm.py --verify vendor/npm     # no network

Sibling of `mirror_bundle.py`, and deliberately not the same thing.
`mirror_bundle.py` collects the handful of packages an *internal registry*
must hold; this takes the whole production tree and puts it in Git, so a clone
onto a new VM installs with no registry at all.

That is a decision with consequences, so this script states them rather than
hiding them:

* **Every tarball is verified against the lockfile's own integrity hash.**
  A vendored tree that nobody can check is worse than no vendored tree: it
  looks authoritative and is not. `--verify` re-checks without the network,
  which is what an audit or a restore actually needs.

* **The licence of every package is read out of its own `package.json` and
  recorded in the manifest.** Vendoring means this repository now carries
  third-party code, and "which licences did we just take on" is the first
  question anybody reviewing that will ask. Answering it from a measurement
  beats answering it from memory.

* **Files under an Enterprise licence are listed separately and loudly.**
  `n8n-core` ships `.ee.` files that the Sustainable Use License does not
  cover at all (ADR-015). They arrive inside the package tarball and cannot be
  removed without breaking the integrity hash that makes the rest of this
  trustworthy, so the honest handling is to carry them, prove they are never
  loaded -- `workflow-engine/tests/contract/no-enterprise-source.test.ts` does
  exactly that -- and never let their presence be a surprise.

Dev dependencies are skipped: the runtime image installs `--omit=dev`, so
vendoring the TypeScript toolchain would put ~47 MB in Git that no deployment
ever runs.
"""

from __future__ import annotations

import argparse
import base64
import datetime
import hashlib
import json
import pathlib
import sys
import tarfile
import urllib.error
import urllib.parse
import urllib.request

for stream in (sys.stdout, sys.stderr):
    if hasattr(stream, "reconfigure"):
        stream.reconfigure(encoding="utf-8", errors="replace")

ROOT = pathlib.Path(__file__).resolve().parent.parent
LOCKFILE = ROOT / "workflow-engine" / "package-lock.json"

#: The packages whose version the compatibility contract names (ADR-013).
PINNED = ("n8n-core", "n8n-nodes-base", "n8n-workflow")

USER_AGENT = "appbi-vendor-npm/1.0 (+repository-vendored dependency tree)"


# ── the lockfile ───────────────────────────────────────────────────────────

def production_entries(lock: dict) -> list[dict]:
    """Every entry a `npm ci --omit=dev` would install.

    Keyed on the lockfile's own `dev` flag rather than on walking the
    dependency graph: npm already did that work, and re-deriving it here would
    be a second opinion that can disagree with the installer.
    """
    out: list[dict] = []
    for path, meta in (lock.get("packages") or {}).items():
        if not path.startswith("node_modules/"):
            continue
        if meta.get("dev"):
            continue
        resolved = meta.get("resolved")
        if not resolved:
            # Workspace links and similar. Nothing to fetch.
            continue
        name = path.split("node_modules/")[-1]
        out.append({
            "name": name,
            "version": meta.get("version"),
            "resolved": resolved,
            "integrity": meta.get("integrity"),
            "host": urllib.parse.urlparse(resolved).netloc,
            "optional": bool(meta.get("optional")),
        })
    return out


def filename_for(item: dict) -> str:
    """A flat, readable filename: `@scope/name` cannot be one.

    `@n8n/client-oauth2@1.0.0` becomes `@n8n-client-oauth2-1.0.0.tgz`, which
    keeps the scope visible while staying a single path component -- a nested
    directory per scope would make the bundle harder to list, not easier.
    """
    name = item["name"].replace("/", "-")
    return f"{name}-{item['version']}.tgz"


# ── integrity ──────────────────────────────────────────────────────────────

def expected_digest(integrity: str | None) -> tuple[str, bytes] | None:
    if not integrity or "-" not in integrity:
        return None
    algorithm, encoded = integrity.split("-", 1)
    try:
        return algorithm, base64.b64decode(encoded)
    except Exception:
        return None


def digest_of(path: pathlib.Path, algorithm: str) -> bytes:
    hasher = hashlib.new(algorithm)
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            hasher.update(block)
    return hasher.digest()


def check(path: pathlib.Path, integrity: str | None) -> str:
    """`ok`, `MISMATCH`, or `unverified` when the lockfile carries no hash."""
    expected = expected_digest(integrity)
    if expected is None:
        return "unverified"
    algorithm, want = expected
    try:
        got = digest_of(path, algorithm)
    except ValueError:
        return "unverified"
    return "ok" if got == want else "MISMATCH"


# ── what is inside a tarball ───────────────────────────────────────────────

def inspect(path: pathlib.Path) -> dict:
    """The licence a package declares, and any Enterprise-licensed files.

    Read from the tarball rather than from an installed tree, so this answers
    for the artefact actually committed. A package that declares no licence is
    reported as `UNDECLARED` rather than guessed at.
    """
    licence = "UNDECLARED"
    enterprise: list[str] = []
    try:
        with tarfile.open(path, "r:gz") as archive:
            for member in archive.getmembers():
                if not member.isfile():
                    continue
                # npm tarballs put everything under `package/`.
                inner = member.name.split("package/", 1)[-1]
                if ".ee." in inner:
                    enterprise.append(inner)
                if inner == "package.json" and licence == "UNDECLARED":
                    handle = archive.extractfile(member)
                    if handle is None:
                        continue
                    try:
                        declared = json.loads(handle.read().decode("utf-8"))
                    except Exception:
                        continue
                    value = declared.get("license") or declared.get("licence")
                    if isinstance(value, dict):
                        value = value.get("type")
                    if isinstance(value, str) and value.strip():
                        licence = value.strip()
    except (tarfile.TarError, OSError):
        return {"license": "UNREADABLE", "enterprise_files": []}
    return {"license": licence, "enterprise_files": sorted(enterprise)}


# ── fetching ───────────────────────────────────────────────────────────────

def download(item: dict, out_dir: pathlib.Path) -> tuple[pathlib.Path | None, str]:
    """The tarball, and whether it matches the lockfile.

    Returns `(None, reason)` rather than raising: one unreachable host must not
    lose the 700-odd packages fetched before it.
    """
    target = out_dir / filename_for(item)
    if not target.exists():
        request = urllib.request.Request(
            item["resolved"], headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                target.write_bytes(response.read())
        except urllib.error.HTTPError as error:
            return None, f"HTTP {error.code}"
        except urllib.error.URLError as error:
            return None, f"unreachable ({error.reason})"
    return target, check(target, item["integrity"])


# ── reporting ──────────────────────────────────────────────────────────────

def summarise(packages: list[dict]) -> None:
    total = sum(p.get("bytes") or 0 for p in packages)
    licences: dict[str, int] = {}
    enterprise = [p for p in packages if p.get("enterprise_files")]
    for package in packages:
        licences[package.get("license", "UNDECLARED")] = \
            licences.get(package.get("license", "UNDECLARED"), 0) + 1

    print("-" * 66)
    print(f"  {len(packages)} package(s), {total / 1048576:.0f} MB of tarballs")
    print("\n  Licences declared:")
    for licence, count in sorted(licences.items(), key=lambda kv: -kv[1]):
        print(f"    {count:4}  {licence}")

    if enterprise:
        print("\n  ENTERPRISE-LICENSED FILES, carried but never loaded:")
        for package in enterprise:
            print(f"    {package['name']}@{package['version']}")
            for name in package["enterprise_files"]:
                print(f"        {name}")
        print("    These are outside the Sustainable Use License (ADR-015).")
        print("    `no-enterprise-source.test.ts` asserts the runtime never")
        print("    loads them; that test is what makes carrying them honest.")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Vendor the engine's production dependency tree into Git.")
    parser.add_argument("--out", default="vendor/npm",
                        help="where the tarballs and manifest are written")
    parser.add_argument(
        "--verify", metavar="DIR", default=None,
        help="re-hash an existing bundle instead of downloading; no network")
    args = parser.parse_args()

    if not LOCKFILE.exists():
        print(f"no lockfile at {LOCKFILE}", file=sys.stderr)
        return 2

    if args.verify:
        directory = pathlib.Path(args.verify)
        if not directory.is_absolute():
            directory = ROOT / directory
        manifest_path = directory / "manifest.json"
        if not manifest_path.exists():
            print(f"no manifest at {manifest_path}", file=sys.stderr)
            return 2
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        packages = manifest["packages"]
        print(f"Verifying {len(packages)} package(s) in {directory}")
        print("-" * 66)
        bad = 0
        for item in packages:
            path = directory / item["file"]
            if not path.exists():
                print(f"  MISSING   {item['file']}")
                bad += 1
                continue
            state = check(path, item.get("integrity"))
            if state != "ok":
                print(f"  {state:9} {item['file']}")
            if state == "MISMATCH":
                bad += 1
        print("-" * 66)
        if bad:
            print(f"  {bad} problem(s). This tree must not be installed from.")
            return 1
        print(f"  all {len(packages)} verified against the lockfile")
        return 0

    out_dir = pathlib.Path(args.out)
    if not out_dir.is_absolute():
        out_dir = ROOT / out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    lock = json.loads(LOCKFILE.read_text(encoding="utf-8"))
    items = production_entries(lock)
    if not items:
        print("no production entries, which is itself suspicious",
              file=sys.stderr)
        return 1

    print(f"Vendoring {len(items)} production package(s) into {out_dir}")
    print("-" * 66)

    packages: list[dict] = []
    failed: list[tuple[dict, str]] = []
    for index, item in enumerate(items, start=1):
        path, state = download(item, out_dir)
        if path is None:
            failed.append((item, state))
            print(f"  FAILED    {item['name']}@{item['version']}: {state}")
            continue
        if state == "MISMATCH":
            failed.append((item, state))
            print(f"  MISMATCH  {item['name']}@{item['version']}")
            continue
        detail = inspect(path)
        packages.append({
            "name": item["name"],
            "version": item["version"],
            "file": path.name,
            "resolved": item["resolved"],
            "integrity": item["integrity"],
            "verified": state,
            "bytes": path.stat().st_size,
            "optional": item["optional"],
            **detail,
        })
        if index % 100 == 0 or index == len(items):
            print(f"  {index}/{len(items)} ...")

    pinned = {p["name"]: p["version"] for p in packages if p["name"] in PINNED}
    manifest = {
        "generatedAt": datetime.datetime.now(datetime.timezone.utc)
                               .replace(microsecond=0).isoformat(),
        "lockfile": "workflow-engine/package-lock.json",
        "note": "Written by scripts/vendor_npm.py. Verify with --verify; "
                "do not edit by hand.",
        "pinned": pinned,
        "totals": {
            "count": len(packages),
            "bytes": sum(p["bytes"] for p in packages),
        },
        "packages": sorted(packages, key=lambda p: (p["name"], p["version"])),
    }
    (out_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8")

    summarise(packages)
    print(f"\n  manifest: {out_dir / 'manifest.json'}")

    if failed:
        print(f"\n  {len(failed)} package(s) failed. The tree is incomplete "
              f"and must not be committed as if it were not.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
