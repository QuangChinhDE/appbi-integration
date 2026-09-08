"""Collect the third-party packages this build cannot get from a mirror.

    python scripts/mirror_bundle.py --out dist/mirror
    python scripts/mirror_bundle.py --verify dist/mirror

A deployment that only pulls from Git plus an internal registry needs those
artefacts to be *in* the internal registry first. Most of them arrive there on
their own: an npm proxy in front of registry.npmjs.org caches whatever a build
asks for. Two things do not:

* the three pinned n8n packages, which the product's compatibility contract
  names explicitly (ADR-013) and which must survive upstream unpublishing,
  a licence change, or the registry being unreachable;
* anything the lockfile resolves from a host that is not an npm registry --
  today exactly one entry, SheetJS from `cdn.sheetjs.com`, which an npm proxy
  configured for the public registry will not fetch.

This script downloads them, records the integrity hash the lockfile already
demands, and writes a manifest. It does not push: publishing into an internal
registry is a credentialled operation for whoever owns that registry, and the
command to do it differs per registry. The manifest is what they need.

`--verify` re-hashes a bundle without the network, which is what a restore or
an audit actually needs.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import pathlib
import sys
import urllib.error
import urllib.parse
import urllib.request

for stream in (sys.stdout, sys.stderr):
    if hasattr(stream, "reconfigure"):
        stream.reconfigure(encoding="utf-8", errors="replace")

ROOT = pathlib.Path(__file__).resolve().parent.parent
LOCKFILE = ROOT / "workflow-engine" / "package-lock.json"

# The packages whose availability the product will not delegate to the public
# registry. Kept in step with `compatibility.yaml`'s pinned runtime.
PINNED_PREFIXES = ("node_modules/n8n-core", "node_modules/n8n-nodes-base",
                   "node_modules/n8n-workflow")

NPM_REGISTRY_HOSTS = {"registry.npmjs.org"}


def entries(lock: dict) -> list[dict]:
    """The lockfile entries this bundle is responsible for.

    Two reasons an entry qualifies, and the manifest records which:

    * `pinned` -- one of the three n8n packages;
    * `off-registry` -- resolved from a host an npm proxy does not mirror.
    """
    out = []
    for name, meta in (lock.get("packages") or {}).items():
        resolved = meta.get("resolved")
        if not resolved:
            continue
        host = urllib.parse.urlparse(resolved).netloc
        reasons = []
        if name in PINNED_PREFIXES:
            reasons.append("pinned")
        if host not in NPM_REGISTRY_HOSTS:
            reasons.append("off-registry")
        if reasons:
            out.append({
                "name": name.removeprefix("node_modules/"),
                "version": meta.get("version"),
                "resolved": resolved,
                "integrity": meta.get("integrity"),
                "host": host,
                "reasons": reasons,
            })
    return out


def expected_digest(integrity: str | None) -> tuple[str, bytes] | None:
    """`sha512-<base64>` from the lockfile, as (algorithm, raw digest)."""
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


# Some CDNs refuse Python's default `Python-urllib/3.x`. cdn.sheetjs.com is one
# of them, with a 403 and no explanation -- which looked exactly like the
# package having been withdrawn.
USER_AGENT = "appbi-mirror-bundle/1.0 (+internal artefact mirror)"


def download(item: dict, out_dir: pathlib.Path) -> tuple[pathlib.Path | None, str]:
    """The tarball, and whether it matches the lockfile.

    Returns `(None, reason)` rather than raising: one unreachable host must not
    lose the packages that were fetched before it. The caller reports the
    failure and exits non-zero, so a partial bundle is never mistaken for a
    complete one.
    """
    filename = item["resolved"].rsplit("/", 1)[-1]
    target = out_dir / filename
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


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Bundle the packages an internal registry must hold.")
    parser.add_argument("--out", default="dist/mirror",
                        help="where to write the tarballs and manifest")
    parser.add_argument(
        "--verify", metavar="DIR", default=None,
        help="re-hash an existing bundle instead of downloading; no network")
    args = parser.parse_args()

    if not LOCKFILE.exists():
        print(f"no lockfile at {LOCKFILE}", file=sys.stderr)
        return 2

    lock = json.loads(LOCKFILE.read_text(encoding="utf-8"))
    items = entries(lock)
    if not items:
        print("nothing to mirror, which is itself suspicious: expected the "
              "three pinned n8n packages", file=sys.stderr)
        return 1

    if args.verify:
        directory = pathlib.Path(args.verify)
        if not directory.is_absolute():
            directory = ROOT / directory
        manifest_path = directory / "manifest.json"
        if not manifest_path.exists():
            print(f"no manifest at {manifest_path}", file=sys.stderr)
            return 2
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        print(f"Verifying {len(manifest['packages'])} package(s) in "
              f"{directory}\n" + "-" * 62)
        bad = 0
        for item in manifest["packages"]:
            if not item.get("file"):
                # Recorded by a run where the download failed, so the bundle
                # was never complete. Say that, rather than crashing on a null
                # filename and looking like a bug in the verifier.
                print(f"  MISSING   {item['name']}@{item['version']} "
                      f"(never fetched: {item.get('verified')})")
                bad += 1
                continue
            path = directory / item["file"]
            if not path.exists():
                print(f"  MISSING   {item['file']}")
                bad += 1
                continue
            state = check(path, item.get("integrity"))
            print(f"  {state:9} {item['file']}")
            if state == "MISMATCH":
                bad += 1
        print("-" * 62)
        if bad:
            print(f"{bad} problem(s). This bundle must not be published.")
            return 1
        print("Bundle matches the lockfile.")
        return 0

    out_dir = pathlib.Path(args.out)
    if not out_dir.is_absolute():
        out_dir = ROOT / out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"Mirroring {len(items)} package(s) into {out_dir}\n" + "-" * 62)
    manifest: list[dict] = []
    bad = 0
    for item in items:
        path, state = download(item, out_dir)
        reasons = ",".join(item["reasons"])
        print(f"  {state:9} {item['name']}@{item['version']}  ({reasons})")
        if path is None or state == "MISMATCH":
            bad += 1
            manifest.append({**item, "file": None, "verified": state})
            continue
        manifest.append({**item, "file": path.name, "verified": state})

    (out_dir / "manifest.json").write_text(
        json.dumps({"lockfile": str(LOCKFILE.relative_to(ROOT)).replace("\\", "/"),
                    "packages": manifest}, indent=2) + "\n",
        encoding="utf-8")

    print("-" * 62)
    if bad:
        print(f"{bad} package(s) could not be fetched or did not match the "
              "lockfile's integrity hash.\n  This bundle is incomplete and "
              "must not be published.", file=sys.stderr)
        return 1

    off = [i for i in manifest if "off-registry" in i["reasons"]]
    print(f"  manifest: {out_dir / 'manifest.json'}")
    if off:
        print("\n  Note: these did not come from an npm registry, so an npm "
              "proxy will not\n  fetch them on demand -- they have to be "
              "published into the internal\n  registry explicitly:")
        for item in off:
            print(f"    {item['name']}@{item['version']}  from {item['host']}")
    print("\n  Publishing is left to whoever owns the internal registry: it "
          "needs their\n  credentials, and the command differs per registry. "
          "The manifest above is\n  what they need, and `--verify` re-checks a "
          "bundle without the network.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
