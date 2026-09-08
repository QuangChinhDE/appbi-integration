"""Produce the SBOM and the VEX statement a release has to carry.

Two documents, and they answer different questions.

**SBOM** (CycloneDX 1.5) — everything in the image. Read from the lockfiles
rather than from a running container: the lockfile is what the build resolves,
so a bill of materials taken from it describes what *will* be there rather than
what happened to be there when somebody looked.

**VEX** (CycloneDX vulnerability analysis) — of the things `npm audit` flags,
which ones can actually be reached. This is the document that turns "29
findings, one critical" into something a reviewer can act on. Every `not
affected` claim here is backed by a measurement, not an opinion:

* the engine loads a hardcoded allowlist of node classes and never calls n8n's
  `DirectoryLoader`, so several hundred integrations and their SDKs are never
  required into the process;
* `tests/contract/` boots the runtime, runs a real HTTP workflow and reads
  `require.cache` — that is where the reachable/unreachable split comes from.

    python scripts/sbom.py --out release/
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import pathlib
import re
import subprocess
import sys
import urllib.parse

for stream in (sys.stdout, sys.stderr):
    if hasattr(stream, "reconfigure"):
        stream.reconfigure(encoding="utf-8", errors="replace")

ROOT = pathlib.Path(__file__).resolve().parent.parent


def git(*args: str) -> str:
    try:
        return subprocess.run(["git", *args], cwd=ROOT, capture_output=True,
                              text=True, check=True).stdout.strip()
    except Exception:  # noqa: BLE001
        return "unknown"


def npm_components(lockfile: pathlib.Path, scope: str) -> list[dict]:
    """Every resolved package in a lockfile, as CycloneDX components."""
    if not lockfile.exists():
        return []
    lock = json.loads(lockfile.read_text(encoding="utf-8"))
    out: list[dict] = []
    for path, meta in (lock.get("packages") or {}).items():
        if not path or not meta.get("version"):
            continue
        name = path.removeprefix("node_modules/").split("/node_modules/")[-1]
        resolved = meta.get("resolved") or ""
        host = urllib.parse.urlparse(resolved).netloc
        component = {
            "type": "library",
            "name": name,
            "version": meta["version"],
            "purl": f"pkg:npm/{name.replace('@', '%40')}@{meta['version']}",
            "scope": "required" if not meta.get("dev") else "optional",
            "properties": [
                {"name": "appbi:workspace", "value": scope},
                {"name": "appbi:resolvedFrom", "value": host or "unknown"},
            ],
        }
        if meta.get("integrity"):
            algorithm, _, digest = str(meta["integrity"]).partition("-")
            component["hashes"] = [
                {"alg": algorithm.upper().replace("SHA", "SHA-"), "content": digest}]
        out.append(component)
    return out


def pip_components(requirements: pathlib.Path) -> list[dict]:
    """Pinned Python requirements. Unpinned lines are reported, not guessed."""
    if not requirements.exists():
        return []
    out: list[dict] = []
    for line in requirements.read_text(encoding="utf-8").splitlines():
        line = line.split("#", 1)[0].strip()
        if not line or line.startswith("-"):
            continue
        match = re.match(r"^([A-Za-z0-9._\-\[\]]+)==([^\s;]+)", line)
        if not match:
            out.append({"type": "library", "name": line, "version": "UNPINNED",
                        "properties": [{"name": "appbi:workspace",
                                        "value": "backend"}]})
            continue
        name, version = match.group(1), match.group(2)
        out.append({
            "type": "library",
            "name": name,
            "version": version,
            "purl": f"pkg:pypi/{name.lower()}@{version}",
            "properties": [{"name": "appbi:workspace", "value": "backend"}],
        })
    return out


def npm_audit(workspace: pathlib.Path) -> dict:
    """`npm audit --json`, or an empty result if npm is not available."""
    try:
        result = subprocess.run(
            ["npm", "audit", "--omit=dev", "--json"],
            cwd=workspace, capture_output=True, text=True, shell=True)
        return json.loads(result.stdout or "{}")
    except Exception:  # noqa: BLE001
        return {}


# ── the reachability evidence ──────────────────────────────────────────────
#
# Not a list maintained here. `workflow-engine/tests/contract/reachability.test
# .ts` boots the runtime, builds the HTTP app, executes a real workflow and
# reads `require.cache`, then writes what it found. Every `not affected` claim
# in the VEX traces to that measurement, and it is re-taken on every test run.
#
# A hand-kept map was the first version of this, and it was already wrong:
# `express`, `path-to-regexp` and `body-parser` were listed as reachable from
# memory, and the first measurement that only ran a workflow -- without
# building the server -- disagreed. Measuring the wrong thing and writing the
# answer into a security document is the failure mode worth designing against.
REACHABILITY = ROOT / "workflow-engine" / "reachability.json"


def reachability() -> tuple[set[str], set[str], str | None]:
    """(reachable, unreachable, measuredAt) from the test's artefact."""
    if not REACHABILITY.exists():
        return set(), set(), None
    data = json.loads(REACHABILITY.read_text(encoding="utf-8"))
    return (set(data.get("reachable") or []),
            set(data.get("unreachable") or []),
            data.get("measuredAt"))


UNREACHABLE_JUSTIFICATION = (
    "code_not_reachable: measured. The engine loads a hardcoded allowlist of "
    "node classes (workflow-engine/src/nodes/registry-loader.ts) and never "
    "calls n8n's DirectoryLoader, so this package is never required into the "
    "process. Confirmed by tests/contract/reachability.test.ts, which boots "
    "the runtime, builds the HTTP app, executes a real workflow and inspects "
    "require.cache."
)

REACHABLE_NOTE = (
    "Loaded by the runtime. Measured by "
    "tests/contract/reachability.test.ts."
)

MITIGATED = {
    "axios": "Overridden to 1.18.0, outside the advisory range (ADR-024).",
    "qs": "Overridden to 6.16.0, outside the advisory range (ADR-024).",
}

# ── advisories about a component the product does not use ──────────────────
#
# Reachability at *package* granularity is too coarse for `n8n-nodes-base`: the
# package is loaded, because the engine requires six node files out of it, and
# an advisory about a seventh node is not thereby reachable.
#
# Narrow and evidenced, one entry at a time. Not a switch for silencing a
# package -- matching is on the advisory's own text, so a different advisory
# about the same package still surfaces.
ADVISORY_NOT_AFFECTED = {
    "Execute Command Node": (
        "vulnerable_code_not_present: the Execute Command node is not in the "
        "engine's allowlist and cannot be instantiated. Adding it is blocked "
        "permanently by ADR-014, and the loader never calls n8n's "
        "DirectoryLoader -- asserted by tests/contract/reachability.test.ts. "
        "The package is loaded for six other node classes; this node is not "
        "one of them."
    ),
}

# Where an advisory is real and reached, but something else stands between it
# and an attacker. Stated as a mitigation, not as an absence.
ADVISORY_MITIGATED = {
    "ASF parser": (
        "V1 has no binary data path: BinaryDataService is registered in "
        "`default` mode with no filesystem or S3 backend (ADR-012), and no "
        "certified node accepts a media upload. The parser is present but is "
        "not fed caller-controlled input. Revisit when a binary-capable node "
        "is certified."
    ),
}


def vex_statements(audit: dict) -> list[dict]:
    reachable, unreachable, _ = reachability()
    out = []
    for name, entry in (audit.get("vulnerabilities") or {}).items():
        advisories = [via for via in entry.get("via", []) if isinstance(via, dict)]
        # A package flagged only because something it depends on is flagged
        # produces no statement of its own. `npm audit` reports `n8n-core` as
        # high because `file-type`, `n8n-nodes-base` and `uuid` are -- writing
        # that out as its own finding, with no advisory behind it, pads the
        # document with rows a reviewer cannot act on and hides the three that
        # matter.
        if not advisories:
            continue
        for advisory in advisories:
            title = str(advisory.get("title") or "")
            override = next(
                (text for key, text in ADVISORY_NOT_AFFECTED.items()
                 if key in title), None)
            mitigation = next(
                (text for key, text in ADVISORY_MITIGATED.items()
                 if key in title), None)

            if override:
                state, detail = "not_affected", override
            elif name in unreachable:
                state, detail = "not_affected", UNREACHABLE_JUSTIFICATION
            elif name in reachable:
                state = "affected"
                detail = REACHABLE_NOTE
                if name in MITIGATED:
                    detail = f"{REACHABLE_NOTE} {MITIGATED[name]}"
                if mitigation:
                    detail = f"{REACHABLE_NOTE} Mitigated: {mitigation}"
            else:
                state, detail = "in_triage", (
                    "Not measured for reachability -- absent from "
                    "workflow-engine/reachability.json. Treated as affected "
                    "until the measurement covers it."
                )
            out.append({
                "id": str(advisory.get("url") or advisory.get("title") or name),
                "source": {"name": "npm audit"},
                "ratings": [{"severity": str(advisory.get("severity") or
                                             entry.get("severity") or "unknown")}],
                "description": str(advisory.get("title") or name),
                "affects": [{"ref": f"pkg:npm/{name.replace('@', '%40')}"}],
                "analysis": {"state": state, "detail": detail},
            })
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description="Write the SBOM and VEX.")
    parser.add_argument("--out", default="release")
    args = parser.parse_args()

    out_dir = pathlib.Path(args.out)
    if not out_dir.is_absolute():
        out_dir = ROOT / out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    now = dt.datetime.now(dt.timezone.utc).isoformat()
    commit = git("rev-parse", "HEAD")
    version = git("describe", "--tags", "--always")

    components = (
        npm_components(ROOT / "workflow-engine" / "package-lock.json", "workflow-engine")
        + npm_components(ROOT / "frontend" / "package-lock.json", "frontend")
        + pip_components(ROOT / "backend" / "requirements.txt")
    )

    sbom = {
        "bomFormat": "CycloneDX",
        "specVersion": "1.5",
        "version": 1,
        "metadata": {
            "timestamp": now,
            "component": {
                "type": "application",
                "name": "appbi-workflow-automation",
                "version": version,
            },
            "properties": [
                {"name": "appbi:commit", "value": commit},
                # The pinned runtime, called out because it is the thing a
                # licence and a CVE review both start from.
                {"name": "appbi:n8nVersion", "value": "1.14.1"},
            ],
        },
        "components": components,
    }

    reachable, unreachable, measured_at = reachability()
    if not reachable and not unreachable:
        print(
            "  No reachability measurement found at "
            f"{REACHABILITY.relative_to(ROOT)}.\n"
            "  Run the engine's contract tests first -- a VEX whose claims "
            "have nothing behind them\n"
            "  is worse than no VEX:\n\n"
            "    cd workflow-engine && npx vitest run tests/contract/"
            "reachability.test.ts\n",
            file=sys.stderr)
        return 2

    audit = npm_audit(ROOT / "workflow-engine")
    vex = {
        "bomFormat": "CycloneDX",
        "specVersion": "1.5",
        "version": 1,
        "metadata": {
            "timestamp": now,
            "component": {"type": "application",
                          "name": "appbi-workflow-automation",
                          "version": version},
            "properties": [
                {"name": "appbi:commit", "value": commit},
                {"name": "appbi:reachabilityMeasuredAt",
                 "value": str(measured_at)},
            ],
        },
        "vulnerabilities": vex_statements(audit),
    }

    sbom_path = out_dir / f"sbom-{version}.cdx.json"
    vex_path = out_dir / f"vex-{version}.cdx.json"
    for path, document in ((sbom_path, sbom), (vex_path, vex)):
        path.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")

    counts: dict[str, int] = {}
    for statement in vex["vulnerabilities"]:
        counts[statement["analysis"]["state"]] = (
            counts.get(statement["analysis"]["state"], 0) + 1)

    print(f"  commit    {commit[:12]}  version {version}")
    print(f"  SBOM      {sbom_path.name}  ({len(components)} components)")
    print(f"  VEX       {vex_path.name}   {json.dumps(counts)}")
    print(f"            reachability measured {measured_at}")
    for path in (sbom_path, vex_path):
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        print(f"    sha256:{digest}  {path.name}")

    if counts.get("in_triage"):
        print(f"\n  {counts['in_triage']} finding(s) are in_triage: not yet "
              "measured for reachability, and treated as affected until they "
              "are.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
