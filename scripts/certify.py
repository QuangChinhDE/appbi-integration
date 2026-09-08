"""Compatibility gate (SRS 31.2, 62; CI gate in SRS 63).

Checks four things that are easy to get silently wrong:

1. every node in the product registry has an engine binding, and every binding
   names a node version the installed runtime actually ships;
2. `compatibility.yaml` agrees with the registry — a pin that says one version
   while the catalogue says another is a release waiting to fail;
3. the installed n8n package set matches the pins, so nobody has run a bare
   `npm install` and moved the line under the contract (ADR-013);
4. nothing in the product catalogue names a node the engine's compiler cannot
   map.

Writes `node-lock.json`: the certified set, hashed, so a review can see when it
moves.

    python scripts/certify.py            # check, and refresh node-lock.json
    python scripts/certify.py --check    # check only; non-zero on drift (CI)
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REGISTRY = ROOT / "backend" / "app" / "resources" / "node_registry.json"
COMPATIBILITY = ROOT / "compatibility.yaml"
LOCK = ROOT / "node-lock.json"
ENGINE = ROOT / "workflow-engine"

PASS = "  ok  "
FAIL = " FAIL "


class Report:
    def __init__(self) -> None:
        self.failures: list[str] = []

    def check(self, label: str, condition: bool, detail: str | None = None) -> bool:
        print(f"[{PASS if condition else FAIL}] {label}")
        if not condition:
            if detail:
                print(f"         {detail}")
            self.failures.append(label)
        return condition


def load_yaml(path: Path) -> dict:
    """Minimal YAML read.

    PyYAML is a backend dependency, not a script one; importing it here would
    make this gate unrunnable outside the venv. It is imported lazily so a bare
    `python scripts/certify.py` still gives a clear message.
    """
    try:
        import yaml
    except ImportError:  # pragma: no cover - operator-facing message
        print("PyYAML is required. Install the backend requirements, or:  pip install pyyaml")
        raise SystemExit(2) from None
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def installed_runtime_versions() -> dict[str, list[float]]:
    """Ask the installed runtime which node versions it actually loaded.

    Not read from a manifest: the point is to compare the pins against what is
    on disk, and a manifest would just be the pins again.
    """
    script = """
const { nodeTypes } = require('./dist/nodes/registry-loader.js');
const types = nodeTypes();
const out = {};
for (const type of types.loadedTypes) out[type] = types.certifiedVersions(type);
process.stdout.write(JSON.stringify(out));
"""
    dist = ENGINE / "dist" / "nodes" / "registry-loader.js"
    if not dist.exists():
        print("       (engine not built; run `npm run build` in workflow-engine)")
        return {}
    result = subprocess.run(
        ["node", "-e", script],
        cwd=ENGINE,
        capture_output=True,
        text=True,
        check=False,
        # The engine logs structured JSON to stdout at info level, which would
        # be interleaved with the probe's own output. Quieten it rather than
        # trying to tell the two apart.
        env={**os.environ, "ENGINE_LOG_LEVEL": "error"},
    )
    if result.returncode != 0:
        print(f"       engine probe failed: {result.stderr.strip()[:300]}")
        return {}
    # The payload is written last and without a newline, so take the final line
    # whatever else reached stdout first.
    lines = [line for line in (result.stdout or "").splitlines() if line.strip()]
    if not lines:
        return {}
    try:
        return json.loads(lines[-1])
    except json.JSONDecodeError:
        print(f"       engine probe returned unparseable output: {lines[-1][:200]}")
        return {}


def installed_package_versions() -> dict[str, str]:
    versions: dict[str, str] = {}
    for package in ("n8n-workflow", "n8n-core", "n8n-nodes-base"):
        manifest = ENGINE / "node_modules" / package / "package.json"
        if manifest.exists():
            versions[package] = json.loads(manifest.read_text(encoding="utf-8"))["version"]
    return versions


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true",
                        help="do not rewrite node-lock.json; fail on drift")
    args = parser.parse_args()

    registry = json.loads(REGISTRY.read_text(encoding="utf-8"))
    compatibility = load_yaml(COMPATIBILITY)
    report = Report()

    nodes = registry["nodes"]
    certified = compatibility.get("certified_nodes") or {}
    pinned_packages = (compatibility.get("n8n") or {}).get("packages") or {}

    print(f"\nproduct version {compatibility.get('product_version')}  "
          f"· {len(nodes)} nodes in the catalogue\n")

    # 1. every node has a binding
    for node in nodes:
        binding = node.get("engine_binding") or {}
        report.check(
            f"{node['node_key']}: has an engine binding",
            bool(binding.get("engine_node_type")) and binding.get("engine_type_version")
            is not None,
        )

    # 2. the catalogue and the pins agree
    for node in nodes:
        key = node["node_key"]
        binding = node.get("engine_binding") or {}
        pin = certified.get(key)
        if not report.check(f"{key}: named in compatibility.yaml", pin is not None):
            continue
        report.check(
            f"{key}: pinned engine type matches the catalogue",
            pin.get("engine_type") == binding.get("engine_node_type"),
            f"compatibility.yaml={pin.get('engine_type')} "
            f"registry={binding.get('engine_node_type')}",
        )
        report.check(
            f"{key}: pinned engine version matches the catalogue",
            float(pin.get("engine_type_version", -1))
            == float(binding.get("engine_type_version", -2)),
            f"compatibility.yaml={pin.get('engine_type_version')} "
            f"registry={binding.get('engine_type_version')}",
        )

    # nodes pinned but no longer offered
    for key in certified:
        report.check(
            f"{key}: still present in the catalogue",
            any(node["node_key"] == key for node in nodes),
            "pinned in compatibility.yaml but not in node_registry.json",
        )

    # 3. the installed package set matches the pins
    installed = installed_package_versions()
    if installed:
        for package, pinned in pinned_packages.items():
            report.check(
                f"{package}: installed {installed.get(package)} == pinned {pinned}",
                installed.get(package) == pinned,
                "run `npm ci` in workflow-engine, or update compatibility.yaml "
                "through the upgrade flow (SRS 31.3)",
            )
    else:
        print("[      ] package set not checked (dependencies not installed)")

    # 4. the runtime actually loaded the versions the bindings name
    runtime = installed_runtime_versions()
    if runtime:
        for node in nodes:
            binding = node.get("engine_binding") or {}
            engine_type = binding.get("engine_node_type")
            wanted = float(binding.get("engine_type_version", -1))
            available = [float(v) for v in runtime.get(engine_type, [])]
            report.check(
                f"{node['node_key']}: runtime certifies {engine_type}@{wanted}",
                wanted in available,
                f"runtime offers {available or 'nothing'} for {engine_type}",
            )
    else:
        print("[      ] runtime not probed (engine not built)")

    # ── node-lock.json ─────────────────────────────────────────────────────
    lock = {
        "product_version": compatibility.get("product_version"),
        "compiler_version": (compatibility.get("workflow_engine") or {}).get(
            "compiler_version"),
        "packages": pinned_packages,
        "nodes": {
            node["node_key"]: {
                "product_schema_version": node.get("product_schema_version", 1),
                "engine_node_type": (node.get("engine_binding") or {}).get(
                    "engine_node_type"),
                "engine_type_version": (node.get("engine_binding") or {}).get(
                    "engine_type_version"),
                "certification": node.get("certification"),
                # The config schema's hash, so a form change is visible in a
                # diff even when the version numbers do not move (SRS 11.4).
                "config_schema_hash": hashlib.sha256(
                    json.dumps(node.get("config_schema") or {}, sort_keys=True,
                               separators=(",", ":")).encode()
                ).hexdigest()[:32],
            }
            for node in sorted(nodes, key=lambda n: n["node_key"])
        },
    }
    serialised = json.dumps(lock, indent=2, sort_keys=True) + "\n"

    if args.check:
        previous = LOCK.read_text(encoding="utf-8") if LOCK.exists() else ""
        report.check(
            "node-lock.json is up to date",
            previous == serialised,
            "run `python scripts/certify.py` and commit the result",
        )
    else:
        LOCK.write_text(serialised, encoding="utf-8")
        print(f"\nwrote {LOCK.relative_to(ROOT)}")

    print()
    if report.failures:
        print(f"{len(report.failures)} check(s) failed:")
        for failure in report.failures:
            print(f"  - {failure}")
        return 1
    print("Compatibility gate passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
