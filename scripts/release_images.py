"""Export the built images as verifiable tarballs.

For a pilot with no internal registry yet. A registry is the better answer —
it gives you digests, garbage collection and access control — and this is the
stopgap that does not pretend to be one.

    python scripts/release_images.py --version v1.0.0-rc1 --out dist/images

Writes one tarball per image, a `SHA256SUMS` file, and a manifest naming the
image id each tarball holds. On the far side:

    sha256sum -c SHA256SUMS
    docker load -i appbi-workflow-api-v1.0.0-rc1.tar

The checksum step is the point. A tarball copied to a laptop, onto a USB stick
and into a server is a tarball nobody verified, and "docker load succeeded" is
not verification — it succeeds on a truncated layer set too, and the failure
surfaces later as a container that will not start.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import subprocess
import sys

for stream in (sys.stdout, sys.stderr):
    if hasattr(stream, "reconfigure"):
        stream.reconfigure(encoding="utf-8", errors="replace")

ROOT = pathlib.Path(__file__).resolve().parent.parent

#: The three images a deployment needs. `postgres` is upstream and pulled by
#: tag; exporting somebody else's image would put this release's name on it.
IMAGES = {
    "appbi-workflow-api": "api",
    "appbi-workflow-engine": "engine",
    "appbi-workflow-frontend": "frontend",
}


def docker(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["docker", *args], capture_output=True, text=True)


def image_id(reference: str) -> str | None:
    result = docker("image", "inspect", "--format", "{{.Id}}", reference)
    return result.stdout.strip() if result.returncode == 0 else None


def sha256(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description="Export images for a pilot.")
    parser.add_argument("--version", required=True)
    parser.add_argument("--out", default="dist/images")
    parser.add_argument("--tag", default="latest",
                        help="the local tag to export from")
    args = parser.parse_args()

    out_dir = pathlib.Path(args.out)
    if not out_dir.is_absolute():
        out_dir = ROOT / out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    manifest: list[dict] = []
    missing: list[str] = []

    for repository, role in IMAGES.items():
        reference = f"{repository}:{args.tag}"
        identifier = image_id(reference)
        if identifier is None:
            missing.append(reference)
            continue

        # Tagged with the release version before export, so what comes out of
        # `docker load` on the far side is named after the release rather than
        # after whatever `latest` happened to be.
        versioned = f"{repository}:{args.version}"
        docker("tag", reference, versioned)

        target = out_dir / f"{repository}-{args.version}.tar"
        print(f"  exporting {versioned} ...", flush=True)
        result = docker("save", "-o", str(target), versioned)
        if result.returncode != 0:
            print(f"    failed: {result.stderr.strip()[:200]}", file=sys.stderr)
            missing.append(versioned)
            continue

        digest = sha256(target)
        manifest.append({
            "role": role,
            "repository": repository,
            "tag": args.version,
            "image_id": identifier,
            "file": target.name,
            "bytes": target.stat().st_size,
            "sha256": digest,
        })
        print(f"    {target.name}  {target.stat().st_size / 1048576:.0f} MB")

    if missing:
        print("\n  Not built locally: " + ", ".join(missing)
              + "\n  Run `docker compose build` first -- this exports what is "
                "there and does not build.", file=sys.stderr)
        return 1

    sums = out_dir / "SHA256SUMS"
    sums.write_text(
        "".join(f"{row['sha256']}  {row['file']}\n" for row in manifest),
        encoding="utf-8")

    manifest_path = out_dir / f"images-{args.version}.json"
    manifest_path.write_text(
        json.dumps({"version": args.version, "images": manifest}, indent=2) + "\n",
        encoding="utf-8")

    print("-" * 62)
    print(f"  {len(manifest)} image(s) -> {out_dir}")
    print(f"  checksums: {sums.name}    manifest: {manifest_path.name}")
    print("\n  On the target host, verify before loading:")
    print("    sha256sum -c SHA256SUMS")
    for row in manifest:
        print(f"    docker load -i {row['file']}")
    print("\n  The image ids in the manifest belong in the release artefact: "
          "an image\n  a release cannot name is an image nobody can roll back "
          "to.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
