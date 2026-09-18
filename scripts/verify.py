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

A third property, added once evidence needed to survive past the terminal
scrollback: **a run's result is recorded against the exact repository state
that produced it** (`scripts/evidence.py`, keyed by `scripts/repo_fingerprint.py`).
`scripts/completion_gate.py` refuses a "Done" claim unless that record's
fingerprint still matches the tree -- so editing a file after verifying it
does not get to reuse the old green result. Pass `--no-evidence` to skip
recording (for one-off manual runs that should not appear in the record).
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
sys.path.insert(0, str(ROOT / "scripts"))
import evidence  # noqa: E402  (needs ROOT on sys.path first)

# A failing stage's captured output can contain characters (Vietnamese UI
# strings, box-drawing glyphs Playwright uses for its diff output, ...) that
# the Windows console's legacy code page cannot encode. Reporting *why* a
# stage failed must not itself crash -- that turns "the e2e suite failed, see
# below" into a traceback with no "below" in it. `errors="replace"` substitutes
# an unprintable character rather than raising.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(errors="replace")

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

    def mark(self) -> int:
        """An index into `self.results`, to slice out one area's stages later."""
        return len(self.results)

    def since(self, mark: int) -> list[tuple[str, str, str]]:
        return self.results[mark:]

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


def _tool_versions() -> dict[str, str]:
    """Best-effort, for the evidence record. Never fails the run."""
    versions: dict[str, str] = {}
    checks = {
        "python": [_python(), "--version"],
        "node": ["node", "--version"],
        "npm": ["npm.cmd" if os.name == "nt" else "npm", "--version"],
        "docker": ["docker", "--version"],
    }
    for name, cmd in checks.items():
        try:
            out = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
            versions[name] = (out.stdout or out.stderr).strip().splitlines()[0] if out.stdout or out.stderr else "?"
        except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
            versions[name] = "not available"
    return versions


def record_evidence(r: Runner, *, area: str, depth: str, mark: int, fp_before: str) -> None:
    """Record this area's result against the fingerprint it was checked at.

    Fingerprints *before and after* the stages ran: if they differ, something
    edited the tree mid-run (another process, a background hook, the person
    at the keyboard) and the result is not trustworthy evidence about any
    single state -- it is skipped with a loud warning rather than recorded
    under either fingerprint.
    """
    stages = r.since(mark)
    if not stages:
        return

    fp_after = evidence.current_fingerprint()
    if fp_after != fp_before:
        print(f"\n[evidence] NOT recorded for verification/{area}: the repository "
              f"changed while these stages ran ({fp_before[:12]} -> {fp_after[:12]}). "
              f"A result spanning two states is not evidence about either one -- "
              f"re-run verification once the tree is settled.")
        return

    failed = [n for n, s, _ in stages if s == FAIL]
    skipped = [n for n, s, _ in stages if s == SKIP]
    status = "FAIL" if failed else ("PARTIAL" if skipped else "PASS")

    detail = {
        "stages": [{"name": n, "status": s, "detail": d} for n, s, d in stages],
        "failed": failed,
        "skipped": skipped,
        "tool_versions": _tool_versions(),
    }
    rec = evidence.record(
        kind="verification", area=area, status=status, depth=depth,
        fingerprint=fp_after, detail=detail,
    )
    print(f"\n[evidence] recorded verification/{area} = {status} "
          f"at fingerprint {rec['fingerprint'][:12]}")


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
    parser.add_argument("--no-evidence", action="store_true",
                        help="do not record an evidence file for this run")
    args = parser.parse_args()

    r = Runner(verbose=args.verbose)
    record = not args.no_evidence

    if args.depth == "quick":
        # Fast enough to run between edits: lint, typecheck and the pure-logic
        # suites. No database, no containers, no build.
        print("QUICK verification -- not sufficient for Done.")
        fp_before = evidence.current_fingerprint() if record else ""
        mark = r.mark()
        backend(r)
        frontend(r)
        engine(r)
        guardrails(r)
        if record:
            record_evidence(r, area="quick", depth="quick", mark=mark, fp_before=fp_before)
        # quick is a working aid, so a missing toolchain should not fail it
        args.allow_skips = True

    elif args.depth == "targeted":
        if args.area not in AREAS:
            parser.error(f"area must be one of: {', '.join(sorted(AREAS))}")
        print(f"TARGETED verification: {args.area}")
        fp_before = evidence.current_fingerprint() if record else ""
        mark = r.mark()
        for group in AREAS[args.area]:
            group(r)
        # Guardrails are cheap and catch the mistake this repo most fears.
        if args.area != "guardrails":
            guardrails(r)
        if record:
            record_evidence(r, area=args.area, depth="targeted", mark=mark, fp_before=fp_before)

    else:
        print("FULL verification -- release quality.")
        fp_before = evidence.current_fingerprint() if record else ""
        full_mark = r.mark()
        for area in ("backend", "frontend", "engine", "guardrails", "deployment", "e2e"):
            area_mark = r.mark()
            for group in AREAS[area]:
                group(r)
            if record:
                record_evidence(r, area=area, depth="full", mark=area_mark, fp_before=fp_before)
        if record:
            record_evidence(r, area="full", depth="full", mark=full_mark, fp_before=fp_before)

    return r.report(allow_skips=args.allow_skips)


if __name__ == "__main__":
    sys.exit(main())
