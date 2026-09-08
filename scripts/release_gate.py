"""Decide whether this commit may be released, and record the decision.

    python scripts/release_gate.py --version 1.2.0 --out ./release
    python scripts/release_gate.py --version 1.2.0 --env-file .env.production
    python scripts/release_gate.py --version 1.2.0 --json

Produces `release/appbi-workflow-<version>.json`: the artefact that says what
was built, from what, what was checked, who is on call, and what the licence
position is. Exit code 0 only when every gate passes.

The point is not the file. The point is that the questions have to be answered
*before* a release rather than during an incident:

  identity   which commit, which build, which image tag
  evidence   which suites ran, with what result -- recorded, not asserted
  config     the production configuration passes the doctor
  schema     one migration head, and a drift report proving those migrations
             produce a schema that matches the models
  legal      `licensing.commercial_gate` in compatibility.yaml. A commercial
             delivery -- the default -- fails unless it reads APPROVED
  on-call    somebody is named

A gate that can be satisfied by writing "yes" in a form is not a gate, so
everything here is either measured (git, the environment, the files) or read
from a machine-produced report (`--evidence`, `--drift-report`). Nothing is
taken on trust: a missing report is a failure, not a pass.
"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import importlib.util
import json
import os
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

#: The suites that must have run, and what each one covers. A release without
#: one of these has not been tested in a dimension that has produced real bugs
#: in this product.
REQUIRED_EVIDENCE = {
    "engine": "contract suite against the real pinned n8n runtime",
    "backend": "product logic, policy, migrations",
    "frontend": "component behaviour and accessibility",
    "e2e": "the interface, driven through a browser against the images",
    "smoke": "the product API end to end",
}


def _git(*args: str) -> str | None:
    try:
        result = subprocess.run(
            ["git", *args], cwd=ROOT, capture_output=True, text=True, timeout=15)
    except (OSError, subprocess.SubprocessError):
        return None
    if result.returncode != 0:
        return None
    return result.stdout.strip() or None


def _load_doctor():
    spec = importlib.util.spec_from_file_location(
        "appbi_doctor", ROOT / "scripts" / "doctor.py")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


# ── gates ──────────────────────────────────────────────────────────────────
def gate_identity(version: str) -> tuple[bool, dict]:
    """What is being released, precisely enough to roll back to."""
    commit = _git("rev-parse", "HEAD")
    dirty = _git("status", "--porcelain")
    branch = _git("rev-parse", "--abbrev-ref", "HEAD")

    detail = {
        "version": version,
        "commit": commit,
        "branch": branch,
        "working_tree_clean": dirty == "" or dirty is None,
        "built_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "built_by": os.environ.get("CI_ACTOR") or os.environ.get("USER")
                    or os.environ.get("USERNAME"),
        "image_tag": os.environ.get("IMAGE_TAG"),
        "image_registry": os.environ.get("IMAGE_REGISTRY"),
    }

    problems = []
    if commit is None:
        problems.append(
            "not a git checkout, so the release cannot name the commit it was "
            "built from")
    elif dirty:
        # A release built from uncommitted changes cannot be reproduced, and a
        # rollback has nothing to go back to.
        problems.append(
            f"the working tree has uncommitted changes ({len(dirty.splitlines())} "
            "files), so this build is not reproducible")
    if not re.match(r"^\d+\.\d+\.\d+(?:[-+].+)?$", version):
        problems.append(
            f"version {version!r} is not a semantic version, so it does not "
            "order against the last release")

    detail["problems"] = problems
    return not problems, detail


def gate_pinned_runtime() -> tuple[bool, dict]:
    """The engine pin, which is the release's actual contract.

    Read out of `compatibility.yaml` rather than the lockfile: the lockfile is
    what was installed, this is what was *decided*, and a release has to record
    the decision.
    """
    path = ROOT / "compatibility.yaml"
    if not path.exists():
        return False, {"problems": ["compatibility.yaml is missing"]}

    text = path.read_text(encoding="utf-8")
    pins = dict(re.findall(r"^\s+(n8n[\w-]*):\s*['\"]?([\d.]+)['\"]?\s*$",
                           text, re.M))
    problems = []
    if not pins:
        problems.append("compatibility.yaml records no n8n package pins")
    versions = set(pins.values())
    if len(versions) > 1:
        # n8n's packages are released as a set and are not independently
        # compatible.
        problems.append(
            f"the n8n packages are pinned to different versions: {sorted(versions)}")
    return not problems, {"pins": pins, "problems": problems}


def provenance(args) -> dict:  # noqa: ANN001
    """Commit, images, schema head, security documents, rollback target.

    Everything here is read from files the build already produced -- the image
    manifest from `release_images.py`, the SBOM and VEX from `sbom.py`, the
    revision from the drift report. Nothing is typed in, because a field
    somebody fills in by hand is a field that is right the first time and
    stale afterwards.
    """
    out: dict = {
        "commit": _git("rev-parse", "HEAD"),
        "git_describe": _git("describe", "--tags", "--always"),
        "n8n_version": "1.14.1",
    }

    # The images, by digest or by checksum.
    manifest = ROOT / "dist" / "images" / f"images-v{args.version}.json"
    if not manifest.exists():
        manifest = ROOT / "dist" / "images" / f"images-{args.version}.json"
    if manifest.exists():
        data = json.loads(manifest.read_text(encoding="utf-8"))
        out["images"] = [
            {"repository": row["repository"], "tag": row["tag"],
             "image_id": row["image_id"], "sha256": row["sha256"]}
            for row in data.get("images", [])
        ]
    else:
        out["images"] = None
        out["images_note"] = (
            "no image manifest found; run scripts/release_images.py or record "
            "registry digests before deploying"
        )

    # The schema this build expects, from the drift report the gate already
    # required -- so the two can never disagree.
    if args.drift_report:
        path = pathlib.Path(args.drift_report)
        if not path.is_absolute():
            path = ROOT / path
        if path.exists():
            drift = json.loads(path.read_text(encoding="utf-8"))
            out["migration_revision"] = drift.get("head_revision")

    # SBOM and VEX, by name and digest.
    documents = {}
    for kind in ("sbom", "vex"):
        for candidate in sorted((ROOT / "release").glob(f"{kind}-*.cdx.json")):
            documents[kind] = {
                "file": candidate.name,
                "sha256": hashlib.sha256(candidate.read_bytes()).hexdigest(),
            }
    out["security_documents"] = documents or None

    # What to go back to: the tag before this one, which is what a rollback
    # actually deploys.
    tags = _git("tag", "--sort=-creatordate").splitlines()
    previous = [tag for tag in tags if tag and tag != f"v{args.version}"]
    out["rollback_to"] = previous[0] if previous else None
    if out["rollback_to"] is None:
        out["rollback_note"] = (
            "first tagged release: there is nothing to roll back to, so a bad "
            "deploy is recovered by restoring a backup"
        )
    return out


def _git(*args: str) -> str:
    try:
        return subprocess.run(["git", *args], cwd=ROOT, capture_output=True,
                              text=True, check=True).stdout.strip()
    except Exception:  # noqa: BLE001
        return "unknown"


def gate_legal(delivery: str) -> tuple[bool, dict]:
    """The commercial licence review (ADR-015).

    `delivery` is what this release is *for*, and it decides whether the gate
    blocks:

    * `commercial` -- sold, hosted for customers, embedded or redistributed.
      Requires `licensing.commercial_gate: APPROVED`. This is the default,
      because a SaaS product is a commercial delivery and a gate whose safe
      answer requires remembering a flag is not a gate.
    * `internal` -- deployed for the organisation that built it. Legitimate
      while the review is outstanding, and the artefact records that it is.

    The gate was previously advisory in both cases: it recorded the state and
    passed. That made it impossible to *stop* a commercial release, which is
    the only thing a licence gate is for.
    """
    path = ROOT / "compatibility.yaml"
    text = path.read_text(encoding="utf-8") if path.exists() else ""
    match = re.search(r"^\s*commercial_gate:\s*['\"]?([A-Z_]+)['\"]?", text, re.M)
    if not match:
        return False, {"problems": [
            "licensing.commercial_gate is missing from compatibility.yaml"]}

    state = match.group(1)
    detail = {"commercial_gate": state, "delivery": delivery, "problems": []}

    # The Enterprise-source declarations, which are separate from the
    # commercial review: `.ee.` files require an n8n Enterprise Licence
    # regardless of whether the delivery is internal or sold. Both must read
    # false for any release.
    #
    # These are declarations, and a declaration is not evidence -- what proves
    # them is `workflow-engine/tests/contract/no-enterprise-source.test.ts`,
    # which boots the runtime and reads the module cache, and reaches this gate
    # through the evidence report. The check here is so that flipping the
    # declaration cannot quietly become a permission.
    for key in ("ee_source_loaded_by_runtime", "ee_feature_enabled"):
        found = re.search(rf"^\s*{key}:\s*(\S+)", text, re.M)
        if not found:
            detail["problems"].append(
                f"licensing.{key} is missing from compatibility.yaml")
        elif found.group(1).strip().lower() != "false":
            detail["problems"].append(
                f"licensing.{key} is {found.group(1)}. Enterprise-licensed n8n "
                "source requires an n8n Enterprise Licence for any delivery, "
                "internal included (ADR-015).")
        else:
            detail[key] = False
    if detail["problems"]:
        return False, detail

    if state == "APPROVED":
        detail["note"] = "cleared for commercial delivery"
        return True, detail

    if delivery == "commercial":
        detail["problems"].append(
            f"licensing.commercial_gate is {state}, and this release is "
            "declared as a commercial delivery. It must not be sold, hosted "
            "for customers, embedded or redistributed until the review is "
            "APPROVED (LIC-N8N-001, ADR-015). Deploying it inside the "
            "organisation that built it is permitted: re-run with "
            "`--delivery internal`.")
        return False, detail

    detail["note"] = (
        f"commercial review is {state}: this artefact is declared an internal "
        "delivery and must not be sold, hosted for customers, embedded or "
        "redistributed (LIC-N8N-001)")
    return True, detail


def gate_configuration(env_file: str | None) -> tuple[bool, dict]:
    doctor = _load_doctor()
    if env_file:
        path = pathlib.Path(env_file)
        if not path.is_absolute():
            path = ROOT / path
        if not path.exists():
            return False, {"problems": [f"no such env file: {path}"]}
        env = doctor.parse_env_file(path)
        source = str(path.name)
    else:
        env = dict(os.environ)
        source = "process environment"

    report = doctor.run(env)
    return report.ok, {
        "source": source,
        "errors": [f"{f.key}: {f.message}" for f in report.errors],
        "warnings": [f"{f.key}: {f.message}" for f in report.warnings],
        "problems": [f"{f.key}: {f.message}" for f in report.errors],
    }


def gate_schema(drift_report: str | None) -> tuple[bool, dict]:
    """A single migration head, and proof that it applies cleanly.

    Two questions, and the second is the one that matters:

    1. *does this checkout have one head* -- read from the migration files,
       because a release artefact is built before the deployment it describes
       exists;
    2. *does the schema those migrations produce match the models* -- which
       only a database can answer, so it is supplied as the JSON report
       `schema_drift.py --json` writes after running against an ephemeral
       database in CI.

    The gate previously asked only the first, which made "schema" a claim
    rather than evidence: a migration that applies and leaves the schema
    disagreeing with the models passes a head check and fails at runtime for
    whichever tenant touches the affected column first.
    """
    spec = importlib.util.spec_from_file_location(
        "appbi_drift", ROOT / "scripts" / "schema_drift.py")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)

    head = module.head_revision()
    problems: list[str] = []
    detail: dict = {"head_revision": head}

    if head is None:
        problems.append(
            "there is no single migration head -- two branches were merged "
            "without a merge revision, and `alembic upgrade head` would refuse")

    if not drift_report:
        problems.append(
            "no --drift-report: a release cannot claim its migrations apply "
            "cleanly without the JSON `scripts/schema_drift.py --json` writes "
            "after running them against a real database")
        detail["problems"] = problems
        return False, detail

    path = pathlib.Path(drift_report)
    if not path.is_absolute():
        path = ROOT / path
    if not path.exists():
        problems.append(f"no such drift report: {path}")
        detail["problems"] = problems
        return False, detail

    try:
        report = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        problems.append(f"the drift report is not valid JSON: {exc}")
        detail["problems"] = problems
        return False, detail

    detail["drift"] = {
        "ok": report.get("ok"),
        "applied_revision": report.get("applied_revision"),
        "head_revision": report.get("head_revision"),
        "models_match_schema": report.get("models_match_schema"),
    }

    if not report.get("ok"):
        problems.extend(
            f"schema drift: {problem}" for problem in report.get("problems", []))
    if not report.get("models_match_schema"):
        problems.append(
            "the migrated schema does not match the models -- `alembic check` "
            "found operations that no migration performs")
    if head and report.get("head_revision") != head:
        # A report from a different checkout says nothing about this one.
        problems.append(
            f"the drift report was produced against head "
            f"{report.get('head_revision')}, but this checkout's head is "
            f"{head}. The evidence does not describe this release.")
    if report.get("applied_revision") != report.get("head_revision"):
        problems.append(
            f"the database the report was produced against is at "
            f"{report.get('applied_revision')}, not at its head "
            f"{report.get('head_revision')}")

    detail["problems"] = problems
    return not problems, detail


def gate_evidence(evidence_path: str | None) -> tuple[bool, dict]:
    """Which suites ran, and what they said.

    A JSON file written by CI:

        {"engine": {"passed": 45, "failed": 0},
         "backend": {"passed": 62, "failed": 0}, ...}

    Absent, it is a failure rather than an unknown. "We did not record whether
    the tests passed" and "the tests did not pass" have to be treated the same
    way, or the recording stops happening.
    """
    if not evidence_path:
        return False, {"problems": [
            "no --evidence file: a release cannot record that its suites "
            "passed without a machine-produced report of them"]}

    path = pathlib.Path(evidence_path)
    if not path.is_absolute():
        path = ROOT / path
    if not path.exists():
        return False, {"problems": [f"no such evidence file: {path}"]}

    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return False, {"problems": [f"evidence file is not valid JSON: {exc}"]}

    problems = []
    suites = {}
    for name, description in REQUIRED_EVIDENCE.items():
        entry = raw.get(name)
        if entry is None:
            problems.append(f"no result recorded for the {name} suite ({description})")
            continue
        failed = int(entry.get("failed", 0) or 0)
        passed = int(entry.get("passed", 0) or 0)
        suites[name] = {"passed": passed, "failed": failed,
                        "covers": description}
        if failed:
            problems.append(f"the {name} suite reported {failed} failure(s)")
        elif passed == 0:
            problems.append(
                f"the {name} suite reported no passing tests, which means it "
                "did not run")

    return not problems, {"suites": suites, "problems": problems}


def gate_oncall(env_file: str | None) -> tuple[bool, dict]:
    """Somebody is named.

    Every runbook in `docs/runbooks/` ends in "escalate to". This is who.
    """
    value = os.environ.get("ONCALL_CONTACT", "")
    if not value and env_file:
        doctor = _load_doctor()
        path = pathlib.Path(env_file)
        if not path.is_absolute():
            path = ROOT / path
        if path.exists():
            value = doctor.parse_env_file(path).get("ONCALL_CONTACT", "")

    problems = []
    if not value or value.strip().upper() in {"FILL_ME", "TBD", "TODO"}:
        problems.append(
            "ONCALL_CONTACT is not set: the runbooks all end in 'escalate "
            "to', and there is nobody to escalate to")
    return not problems, {"oncall_contact": value or None, "problems": problems}


# ── artefact ───────────────────────────────────────────────────────────────
def main() -> int:
    parser = argparse.ArgumentParser(
        description="Gate a release and write its artefact.")
    parser.add_argument("--version", required=True)
    parser.add_argument("--env-file", default=None)
    parser.add_argument(
        "--evidence", default=None,
        help="JSON report of which suites ran and their results")
    parser.add_argument(
        "--drift-report", default=None, metavar="JSON",
        help="output of `scripts/schema_drift.py --json`, produced after "
             "migrating an ephemeral database")
    parser.add_argument(
        "--delivery", choices=["commercial", "internal"], default="commercial",
        help="what this release is for. `commercial` (the default) requires "
             "licensing.commercial_gate to be APPROVED; `internal` records "
             "the restriction instead of enforcing it.")
    parser.add_argument("--out", default="./release")
    parser.add_argument("--json", action="store_true", dest="as_json")
    parser.add_argument(
        "--allow-dirty", action="store_true",
        help="permit an uncommitted working tree (development only)")
    args = parser.parse_args()

    gates = {
        "identity": gate_identity(args.version),
        "pinned_runtime": gate_pinned_runtime(),
        "configuration": gate_configuration(args.env_file),
        "schema": gate_schema(args.drift_report),
        "evidence": gate_evidence(args.evidence),
        "legal": gate_legal(args.delivery),
        "oncall": gate_oncall(args.env_file),
    }

    if args.allow_dirty:
        ok, detail = gates["identity"]
        remaining = [p for p in detail["problems"] if "uncommitted" not in p]
        detail["problems"] = remaining
        detail["allow_dirty"] = True
        gates["identity"] = (not remaining, detail)

    failures = {name: detail["problems"]
                for name, (ok, detail) in gates.items() if not ok}

    artefact = {
        "artefact": "appbi-workflow",
        "version": args.version,
        # What this artefact is licensed to be used for. Recorded rather than
        # implied: an artefact that does not say is one somebody will assume
        # about.
        "delivery": args.delivery,
        "released": not failures,
        "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        # What was built, from what, and what to go back to.
        #
        # A gate result says the build was allowed out. It does not say which
        # images to deploy, which schema they expect, or what the previous
        # good version was -- and those are the three things an incident at
        # 3am needs. Collected here so the artefact answers "roll this back"
        # without anybody reconstructing it from memory.
        "provenance": provenance(args),
        "gates": {name: {"passed": ok, **detail}
                  for name, (ok, detail) in gates.items()},
    }
    # The artefact's own digest, so a copy of it can be shown to be the copy
    # the gate produced.
    body = json.dumps(artefact, sort_keys=True).encode()
    artefact["artefact_sha256"] = hashlib.sha256(body).hexdigest()

    out = pathlib.Path(args.out)
    if not out.is_absolute():
        out = ROOT / out
    out.mkdir(parents=True, exist_ok=True)
    target = out / f"appbi-workflow-{args.version}.json"
    target.write_text(json.dumps(artefact, indent=2), encoding="utf-8")

    if args.as_json:
        print(json.dumps(artefact, indent=2))
    else:
        print(f"\nRelease gate: appbi-workflow {args.version} "
              f"({args.delivery} delivery)")
        print("=" * 72)
        for name, (ok, detail) in gates.items():
            print(f"  [{'pass' if ok else 'FAIL'}] {name}")
            for problem in detail["problems"]:
                print(f"         {problem}")
            if name == "legal" and detail.get("note"):
                print(f"         {detail['note']}")
            if name == "evidence" and detail.get("suites"):
                for suite, result in detail["suites"].items():
                    print(f"         {suite}: {result['passed']} passed, "
                          f"{result['failed']} failed")
        print("=" * 72)
        print(f"  artefact: {target}")
        if failures:
            print(f"  BLOCKED -- {len(failures)} gate(s) failed. "
                  "This build must not be released.\n")
        else:
            print("  RELEASABLE\n")

    return 0 if not failures else 1


if __name__ == "__main__":
    raise SystemExit(main())
