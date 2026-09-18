"""The canonical verification entry point (docs/ai-sdlc/DEFINITION_OF_DONE.md).

Three depths, because "did I break anything" and "may this be released" are
different questions and pretending otherwise means one of them stops being
asked:

    python scripts/verify.py quick              # seconds. Run it while working.
    python scripts/verify.py targeted <area>    # one subsystem, end to end.
    python scripts/verify.py full               # release-quality.

`targeted` areas: backend, frontend, engine, deployment, guardrails, e2e.

This is a thin front end over the commands CI already runs -- it does not
reimplement them, and it does not own a second definition of "passing". If a
stage here disagrees with `.github/workflows/ci.yml`, the workflow is right and
this file is the bug.

Two rules it keeps, which is the whole reason it exists rather than a list of
commands in a README:

  * a stage that could not run is reported SKIP, never PASS. A wrapper that
    turns a missing toolchain into a green tick is worse than no wrapper: it
    launders "I did not check" into "I checked".
  * the exit status is non-zero if any stage FAILED, and the summary names the
    stage. `--allow-skips` is required before a run with SKIPs can exit zero,
    so `full` cannot quietly pass on a machine with no Docker.
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

PASS, FAIL, SKIP = "PASS", "FAIL", "SKIP"


def _python() -> str:
    """The interpreter the backend runs under.

    Prefers the repository venv, because `run.ps1 setup` builds one and the
    backend's dependencies are not on the system interpreter.
    """
    for candidate in (
        ROOT / ".venv" / "Scripts" / "python.exe",
        ROOT / ".venv" / "bin" / "python",
    ):
        if candidate.exists():
            return str(candidate)
    return sys.executable


class Runner:
    def __init__(self, *, verbose: bool) -> None:
        self.results: list[tuple[str, str, str]] = []
        self.verbose = verbose

    def stage(
        self,
        name: str,
        command: list[str],
        *,
        cwd: Path | None = None,
        needs: list[str] | None = None,
        env: dict[str, str] | None = None,
    ) -> str:
        """Run one stage. `needs` names executables that must be on PATH."""
        for tool in needs or []:
            if shutil.which(tool) is None:
                return self._record(name, SKIP, f"{tool} is not on PATH")

        workdir = cwd or ROOT
        if not workdir.exists():
            return self._record(name, SKIP, f"{workdir} does not exist")

        print(f"\n--- {name}")
        print(f"    $ {' '.join(command)}")
        started = time.monotonic()
        merged = {**os.environ, **(env or {})}
        try:
            completed = subprocess.run(
                command,
                cwd=workdir,
                env=merged,
                capture_output=not self.verbose,
                text=True,
                encoding="utf-8",
                errors="replace",
            )
        except FileNotFoundError as exc:
            return self._record(name, SKIP, f"cannot execute: {exc}")

        took = time.monotonic() - started
        if completed.returncode == 0:
            return self._record(name, PASS, f"{took:.1f}s")

        # The tail is what a failure is actually diagnosed from, and a wrapper
        # that swallows it forces the next step to be "re-run it by hand".
        if not self.verbose:
            for stream in (completed.stdout, completed.stderr):
                if stream:
                    print("    " + "\n    ".join(stream.strip().splitlines()[-25:]))
        return self._record(name, FAIL, f"exit {completed.returncode}")

    def _record(self, name: str, status: str, detail: str) -> str:
        self.results.append((name, status, detail))
        if status != PASS:
            print(f"[{status}] {name} -- {detail}")
        return status

    def report(self, *, allow_skips: bool) -> int:
        print("\n" + "=" * 68)
        width = max((len(n) for n, _, _ in self.results), default=0)
        for name, status, detail in self.results:
            print(f"  {status:<4}  {name:<{width}}  {detail}")
        print("=" * 68)

        failed = [n for n, s, _ in self.results if s == FAIL]
        skipped = [n for n, s, _ in self.results if s == SKIP]

        if failed:
            print(f"\nFAILED ({len(failed)}): " + ", ".join(failed))
            print("Fix the implementation. Do not weaken the check.")
            return 1
        if skipped and not allow_skips:
            print(f"\nNOT RUN ({len(skipped)}): " + ", ".join(skipped))
            print(
                "\nEvery stage that ran passed, but the run is incomplete, so it\n"
                "is not evidence of a green repository. Install what is missing,\n"
                "or pass --allow-skips and report the SKIPs verbatim."
            )
            return 2
        if skipped:
            print(f"\nPASS, with {len(skipped)} stage(s) NOT RUN: " + ", ".join(skipped))
            print("Report those as NOT RUN. They are not passes.")
            return 0
        print("\nPASS -- every stage ran.")
        return 0


# --- the stages, grouped the way CI groups them ------------------------------


def backend(r: Runner) -> None:
    py = _python()
    r.stage("backend: lint", [py, "-m", "ruff", "check", "app", "tests"], cwd=ROOT / "backend")
    r.stage("backend: unit tests", [py, "-m", "pytest", "-q"], cwd=ROOT / "backend")


def backend_migrations(r: Runner) -> None:
    """Needs a live database, so it is a `full`/`targeted backend` stage only."""
    py = _python()
    if not os.environ.get("DATABASE_URL"):
        r._record("backend: migrations", SKIP, "DATABASE_URL is not set")
        return
    r.stage("backend: migration round-trip", [py, "-m", "alembic", "upgrade", "head"], cwd=ROOT / "backend")
    r.stage("backend: migration matches models", [py, "-m", "alembic", "check"], cwd=ROOT / "backend")
    r.stage("backend: no schema drift", [py, str(ROOT / "scripts" / "schema_drift.py")])


def frontend(r: Runner) -> None:
    fe = ROOT / "frontend"
    npm = "npm.cmd" if os.name == "nt" else "npm"
    r.stage("frontend: typecheck", [npm, "run", "typecheck"], cwd=fe, needs=[npm])
    r.stage("frontend: lint", [npm, "run", "lint"], cwd=fe, needs=[npm])
    r.stage("frontend: component tests", [npm, "test"], cwd=fe, needs=[npm])


def frontend_build(r: Runner) -> None:
    npm = "npm.cmd" if os.name == "nt" else "npm"
    r.stage("frontend: build", [npm, "run", "build"], cwd=ROOT / "frontend", needs=[npm])


def engine(r: Runner) -> None:
    eng = ROOT / "workflow-engine"
    npm = "npm.cmd" if os.name == "nt" else "npm"
    r.stage("engine: typecheck", [npm, "run", "typecheck"], cwd=eng, needs=[npm])
    r.stage("engine: contract suite (real pinned n8n)", [npm, "test"], cwd=eng, needs=[npm])
    r.stage("engine: compatibility gate", [_python(), str(ROOT / "scripts" / "certify.py"), "--check"])


def engine_build(r: Runner) -> None:
    npm = "npm.cmd" if os.name == "nt" else "npm"
    r.stage("engine: build", [npm, "run", "build"], cwd=ROOT / "workflow-engine", needs=[npm])


def deployment(r: Runner) -> None:
    py = _python()
    r.stage(
        "deployment: manifests, alerts, production gate",
        [py, "-m", "pytest", "-q",
         "tests/test_deployment_manifests.py",
         "tests/test_alert_rules.py",
         "tests/test_production_doctor.py"],
        cwd=ROOT / "backend",
    )
    r.stage(
        "deployment: the production template is refused",
        [py, str(ROOT / "scripts" / "refuse.py"),
         py, str(ROOT / "scripts" / "doctor.py"),
         "--env-file", str(ROOT / ".env.production.example")],
    )
    r.stage("deployment: compose parses", ["docker", "compose", "config", "--quiet"], needs=["docker"])
    r.stage(
        "deployment: kubernetes manifests render",
        ["kubectl", "kustomize", "deploy/kustomize/overlays/production"],
        needs=["kubectl"],
    )


def guardrails(r: Runner) -> None:
    r.stage("guardrails: architectural boundaries", [_python(), str(ROOT / "scripts" / "guardrails.py")])


def e2e(r: Runner) -> None:
    npx = "npx.cmd" if os.name == "nt" else "npx"
    if not (ROOT / "e2e" / "node_modules").exists():
        r._record("e2e: browser suite", SKIP, "e2e/node_modules is missing (npm ci in e2e/)")
        return
    if shutil.which("docker") is None:
        r._record("e2e: browser suite", SKIP, "docker is not on PATH; the suite runs the images")
        return
    r.stage(
        "e2e: browser suite",
        [npx, "playwright", "test"],
        cwd=ROOT / "e2e",
        needs=[npx],
        env={"E2E_BASE_URL": os.environ.get("E2E_BASE_URL", "http://127.0.0.1:3000")},
    )


AREAS = {
    "backend": [backend, backend_migrations],
    "frontend": [frontend, frontend_build],
    "engine": [engine, engine_build],
    "deployment": [deployment],
    "guardrails": [guardrails],
    "e2e": [e2e],
}


def main() -> int:
    parser = argparse.ArgumentParser(
        description="The repository's verification entry point.",
        epilog="areas for `targeted`: " + ", ".join(sorted(AREAS)),
    )
    parser.add_argument("depth", choices=["quick", "targeted", "full"])
    parser.add_argument("area", nargs="?", help="required for `targeted`")
    parser.add_argument("--allow-skips", action="store_true",
                        help="exit 0 even when a stage could not run (report the SKIPs)")
    parser.add_argument("-v", "--verbose", action="store_true", help="stream stage output")
    args = parser.parse_args()

    r = Runner(verbose=args.verbose)

    if args.depth == "quick":
        # Fast enough to run between edits: lint, typecheck and the pure-logic
        # suites. No database, no containers, no build.
        print("QUICK verification -- not sufficient for Done.")
        backend(r)
        frontend(r)
        engine(r)
        guardrails(r)
        # quick is a working aid, so a missing toolchain should not fail it
        args.allow_skips = True

    elif args.depth == "targeted":
        if args.area not in AREAS:
            parser.error(f"area must be one of: {', '.join(sorted(AREAS))}")
        print(f"TARGETED verification: {args.area}")
        for group in AREAS[args.area]:
            group(r)
        # Guardrails are cheap and catch the mistake this repo most fears.
        if args.area != "guardrails":
            guardrails(r)

    else:
        print("FULL verification -- release quality.")
        for area in ("backend", "frontend", "engine", "guardrails", "deployment", "e2e"):
            for group in AREAS[area]:
                group(r)

    return r.report(allow_skips=args.allow_skips)


if __name__ == "__main__":
    sys.exit(main())
