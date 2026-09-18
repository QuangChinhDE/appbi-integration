"""A deterministic fingerprint of the repository's source state.

Evidence is only valid for the exact state that produced it. That claim is
worthless without a cheap, reliable way to name "the exact state" — this is
that name.

    python scripts/repo_fingerprint.py                # print the fingerprint
    python scripts/repo_fingerprint.py --explain       # + what went into it
    python scripts/repo_fingerprint.py --check ABC123  # exit 0 if current == ABC123, else 1

## What goes in

Every file git considers part of the working tree and does not ignore:
tracked files (as they currently read on disk, not as last committed --
unstaged edits count), plus untracked files that are not covered by
`.gitignore`. That is exactly `git status --porcelain` plus file content, which
is also exactly what "the diff a reviewer would look at" means.

`.gitignore` already excludes node_modules, .venv, dist, .next, build output,
caches, logs, test-results, playwright-report and backups (see the repository
root `.gitignore`) -- so those never reach this script and never need a second
exclude list here. The one thing excluded on top of `.gitignore` is this
harness's own evidence store (`.claude/evidence/`), because a fingerprint must
not depend on the record of previous fingerprints -- that would make the
fingerprint of "record evidence, then fingerprint again" different from
"fingerprint, then record evidence", which breaks the one property this file
exists to provide.

## What goes in from git metadata

The current HEAD commit SHA is folded in too, even though HEAD is itself a
function of committed file contents, because two checkouts with an identical
working tree but different history (e.g. a rebase in progress, a detached
HEAD) are not the same reviewed state and should not collide.

## One more exclusion, and why it is not the same mistake as a naive one

`workflow-engine/reachability.json` carries a `measuredAt` timestamp that
`tests/contract/reachability.test.ts` rewrites on every run of the engine
suite -- so running the exact verification this fingerprint is meant to attest
to *changes the fingerprint out from under itself*, which would make
`scripts/verify.py` unable to ever record engine evidence. It is excluded by
exact path, not by a general "ignore JSON with timestamps" rule: only this one
file, only because its sole non-reachability field is a self-reported
measurement time and its content (the reachable-package set) still matters and
is not exempted from anything else -- `scripts/sbom.py` still reads the real
file, `npm test` still fails if the reachable set is wrong. Excluding it here
changes what counts as "the state under review"; it does not change what the
contract test asserts.

## Determinism

Same source state -> same fingerprint, on any machine, because content is
hashed (not size/mtime) and paths are sorted before hashing. A single-byte
change anywhere in an included file changes the fingerprint. Renaming a file,
even with unchanged content, changes it too -- the path is part of what is
hashed, and "which file this content is in" is part of the state a reviewer
sees.
"""

from __future__ import annotations

import argparse
import hashlib
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Excluded on top of .gitignore: the harness's own record of past fingerprints
# must not feed back into the fingerprint it is recording.
EXCLUDE_PREFIXES = (
    ".claude/evidence/",
)

# Exact paths, not prefixes: files that are themselves a byproduct of running
# the verification this fingerprint attests to, so including them would make
# a fingerprint change out from under the very run that is supposed to match
# it. See the module docstring for why this is one specific, justified file
# rather than a general exemption.
EXCLUDE_EXACT = (
    "workflow-engine/reachability.json",
)


def _run(args: list[str]) -> str:
    result = subprocess.run(
        ["git", *args], cwd=ROOT, capture_output=True, text=True, check=True,
    )
    return result.stdout


def head_sha() -> str:
    try:
        return _run(["rev-parse", "HEAD"]).strip()
    except subprocess.CalledProcessError:
        return "0" * 40  # a repository with no commits yet


def tracked_and_untracked_paths() -> list[str]:
    """Every path git would show in a full diff against a clean checkout.

    `-z` for NUL-separated, rename-safe parsing. `--porcelain=v1` with
    `-uall` reports untracked files individually rather than collapsing a
    directory to one line, which matters here because we hash file content per
    path.
    """
    tracked = _run(["ls-files", "-z"]).split("\0")
    status_lines = _run(["status", "--porcelain=v1", "-uall", "-z"]).split("\0")

    paths: set[str] = {p for p in tracked if p}

    i = 0
    while i < len(status_lines):
        entry = status_lines[i]
        if not entry:
            i += 1
            continue
        code, _, rest = entry[:2], entry[2:3], entry[3:]
        # A rename/copy entry ("R  old -> " form under -z) carries the new
        # path as `rest` and the old path as the *next* NUL-separated token;
        # git's -z porcelain puts them as two consecutive fields.
        if code[0] in ("R", "C"):
            paths.add(rest)
            i += 2
            continue
        if rest:
            paths.add(rest)
        i += 1

    return sorted(
        p for p in paths
        if p
        and p not in EXCLUDE_EXACT
        and not any(p.startswith(prefix) for prefix in EXCLUDE_PREFIXES)
    )


def compute(*, explain: bool = False) -> tuple[str, list[str]]:
    sha = head_sha()
    paths = tracked_and_untracked_paths()

    digest = hashlib.sha256()
    digest.update(f"head:{sha}\n".encode())

    lines: list[str] = [f"HEAD {sha}"]
    for path in paths:
        full = ROOT / path
        try:
            content = full.read_bytes()
        except (FileNotFoundError, IsADirectoryError, PermissionError):
            # Deleted-but-staged, a submodule boundary, or a permission quirk.
            # Record the absence itself so it still affects the fingerprint.
            content = b"<unreadable>"
        file_hash = hashlib.sha256(content).hexdigest()
        digest.update(f"{path}:{file_hash}\n".encode())
        if explain:
            lines.append(f"{file_hash[:12]}  {path}")

    return digest.hexdigest(), lines


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--explain", action="store_true",
                        help="also print every path and file hash that went in")
    parser.add_argument("--check", metavar="FINGERPRINT",
                        help="exit 0 if the current fingerprint matches, else 1 and print both")
    args = parser.parse_args()

    fingerprint, lines = compute(explain=args.explain)

    if args.check:
        if fingerprint == args.check:
            print(f"MATCH  {fingerprint}")
            return 0
        print(f"STALE  expected {args.check}", file=sys.stderr)
        print(f"       current  {fingerprint}", file=sys.stderr)
        return 1

    if args.explain:
        for line in lines:
            print(line)
        print()
    print(fingerprint)
    return 0


if __name__ == "__main__":
    sys.exit(main())
