"""Refuse to deploy a configuration that is not safe to deploy.

    python scripts/doctor.py                          # check the live environment
    python scripts/doctor.py --env-file .env.production
    python scripts/doctor.py --env-file .env.production --json

Exit code 0 when everything a production deployment requires is present and
plausible, 1 otherwise. Designed to be the gate in a pipeline, so it reads a
file without importing the application: a deployment must be checkable before
anything is running, and `pydantic` refusing to construct `Settings` is a
worse error message than a list of what is wrong.

Every check here is a failure somebody has actually shipped: a placeholder
secret that boots fine on a laptop, an `http://` webhook base handed to a
customer's system, a `DATABASE_URL` still pointing at the compose container
that `down -v` deletes, `:latest` in an image tag so a rollback has nothing to
name.

The checks are deliberately textual and dumb. A subtle checker that reads
config the way the application does would agree with the application's bugs.

One exception: `NAME_FILE` is resolved to `NAME` exactly the way
`app/core/config.py` does it, because a gate that refuses a configuration the
application would have accepted is worse than no gate -- it is a gate people
learn to bypass.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys
from dataclasses import dataclass, field
from typing import Callable
from urllib.parse import urlparse

ROOT = pathlib.Path(__file__).resolve().parent.parent

#: Values that mean "nobody filled this in". Compared case-insensitively
#: against the whole value and, for the marker forms, as a substring.
PLACEHOLDER_EXACT = {
    "", "fill_me", "fillme", "changeme", "change-me", "change_me",
    "todo", "tbd", "xxx", "none", "null", "replace-me", "your-value-here",
}
PLACEHOLDER_SUBSTRINGS = ("fill_me", "fill-me", "changeme", "change-me",
                          "your-", "example-secret", "replace_me")

#: Secrets that ship in the development template. Any of these in a production
#: environment means the file was copied and not edited.
DEV_SECRETS = {
    "dev-only-change-me",
    "dev-only-change-me-please-32-chars-min",
    "dev-engine-token",
    "smoketestpass123!",
    "appbi",
}

SEVERITY_ERROR = "ERROR"
SEVERITY_WARNING = "WARNING"


@dataclass
class Finding:
    severity: str
    key: str
    message: str
    #: What to do about it, because a check that only says "wrong" makes the
    #: reader go and find the documentation.
    fix: str = ""


@dataclass
class Report:
    findings: list[Finding] = field(default_factory=list)

    def error(self, key: str, message: str, fix: str = "") -> None:
        self.findings.append(Finding(SEVERITY_ERROR, key, message, fix))

    def warn(self, key: str, message: str, fix: str = "") -> None:
        self.findings.append(Finding(SEVERITY_WARNING, key, message, fix))

    @property
    def errors(self) -> list[Finding]:
        return [f for f in self.findings if f.severity == SEVERITY_ERROR]

    @property
    def warnings(self) -> list[Finding]:
        return [f for f in self.findings if f.severity == SEVERITY_WARNING]

    @property
    def ok(self) -> bool:
        return not self.errors


# ── reading configuration ──────────────────────────────────────────────────
def parse_env_file(path: pathlib.Path) -> dict[str, str]:
    """A dotenv reader that does not import anything.

    Handles `KEY=value`, `export KEY=value`, quoted values and trailing
    comments after a value. Not a shell: it does not expand anything, because
    expansion is what makes a config file's real value hard to predict.
    """
    values: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()
        if value[:1] in {'"', "'"} and value[:1] == value[-1:] and len(value) > 1:
            value = value[1:-1]
        else:
            # An unquoted trailing comment. `SESSION_COOKIE_SECURE=false  # ...`
            value = re.split(r"\s+#", value, maxsplit=1)[0].strip()
        values[key] = value
    return values


#: Settings a deployment may deliver as a file instead of a value.
#:
#: Must match `_FILE_BACKED` in `backend/app/core/config.py`. The application
#: reads `NAME_FILE` and the operator writes `NAME_FILE`, so a gate that only
#: understands `NAME` refuses a configuration that would in fact have started
#: -- which is exactly the shape of failure that gets a gate switched off.
FILE_BACKED = (
    "DATABASE_URL",
    "JWT_SECRET",
    "SECRET_ENCRYPTION_KEY",
    "ENGINE_INTERNAL_TOKEN",
)


def resolve_file_backed(
    env: dict[str, str],
) -> tuple[dict[str, str], list[tuple[str, str]]]:
    """Promote every readable `NAME_FILE` to `NAME`.

    Returns the resolved environment and a list of `(key, problem)` for files
    that are named but unusable. An unreadable or empty secret file is a
    blocking fault, not a fallback: the application refuses to start on one
    rather than run with a secret nobody chose, and the gate has to agree with
    the application or it is not a gate.

    A direct value wins over a file, matching the application: `NAME` set
    explicitly is an operator overriding the mount on purpose.
    """
    resolved = dict(env)
    problems: list[tuple[str, str]] = []

    for name in FILE_BACKED:
        path_value = env.get(f"{name}_FILE", "").strip()
        if not path_value:
            continue
        if env.get(name, "").strip():
            # Both are set. Say so rather than silently preferring one: two
            # sources for one secret is a question, not a configuration.
            problems.append((
                name,
                f"both {name} and {name}_FILE are set. The direct value wins, "
                "which may not be what the mount intended."))
            continue

        path = pathlib.Path(path_value)
        try:
            content = path.read_text(encoding="utf-8").strip()
        except OSError as exc:
            detail = exc.strerror or str(exc)
            problems.append((
                f"{name}_FILE",
                f"points at {path_value!r}, which cannot be read ({detail}). "
                "The application refuses to start on this rather than fall "
                "back to a default."))
            continue
        if not content:
            problems.append((f"{name}_FILE", f"{path_value!r} is empty."))
            continue
        resolved[name] = content

    return resolved, problems


def _is_placeholder(value: str) -> bool:
    lowered = value.strip().lower()
    if lowered in PLACEHOLDER_EXACT:
        return True
    return any(marker in lowered for marker in PLACEHOLDER_SUBSTRINGS)


def _truthy(value: str) -> bool:
    return value.strip().lower() in {"1", "true", "yes", "on"}


# ── the checks ─────────────────────────────────────────────────────────────
#: Every value that must be present, non-placeholder and not a dev secret.
REQUIRED_SECRETS = (
    ("JWT_SECRET", 48,
     'python -c "import secrets;print(secrets.token_urlsafe(48))"'),
    ("SECRET_ENCRYPTION_KEY", 43,
     'python -c "import base64,os;print(base64.urlsafe_b64encode(os.urandom(32)).decode())"'),
    ("ENGINE_INTERNAL_TOKEN", 32,
     'python -c "import secrets;print(secrets.token_urlsafe(32))"'),
)


def check_environment_flag(env: dict[str, str], report: Report) -> None:
    value = env.get("APP_ENV", "").strip().lower()
    if value not in {"production", "prod"}:
        report.error(
            "APP_ENV",
            f"is {value or '(unset)'}, so none of the production checks the "
            "application performs at startup are active.",
            "Set APP_ENV=production.")


def check_secrets(env: dict[str, str], report: Report) -> None:
    for key, min_length, how in REQUIRED_SECRETS:
        value = env.get(key, "")
        if _is_placeholder(value):
            report.error(key, "is unset or still a placeholder.",
                         f"Generate one: {how}")
            continue
        if value.strip().lower() in DEV_SECRETS:
            report.error(
                key,
                "is a value from the development template, which is published "
                "in this repository.",
                f"Generate a real one: {how}")
            continue
        if len(value) < min_length:
            report.error(
                key,
                f"is {len(value)} characters; at least {min_length} is expected.",
                f"Generate one: {how}")


def check_database(env: dict[str, str], report: Report) -> None:
    url = env.get("DATABASE_URL", "")
    if _is_placeholder(url):
        report.error("DATABASE_URL", "is unset or still a placeholder.",
                     "Point it at the managed Postgres instance.")
        return

    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()

    if host in {"localhost", "127.0.0.1", "::1", "postgres", "db", "database"}:
        report.error(
            "DATABASE_URL",
            f"points at '{host}', which is a container in this compose file "
            "rather than a managed database. Its lifecycle would be tied to "
            "the application's -- `docker compose down -v` deletes it.",
            "Use a managed instance with its own backups and failover.")

    if "ssl" not in url.lower():
        report.error(
            "DATABASE_URL",
            "does not request TLS, so credentials and workflow payloads cross "
            "the network in plaintext.",
            "Append ?ssl=require (asyncpg does not accept sslmode=).")
    elif "sslmode" in url.lower():
        report.error(
            "DATABASE_URL",
            "uses `sslmode`, which asyncpg does not understand -- the "
            "connection would be made without TLS rather than failing.",
            "Use ssl=require or ssl=verify-full instead.")

    password = parsed.password or ""
    if password and password.lower() in DEV_SECRETS:
        report.error(
            "DATABASE_URL",
            "carries the development database password.",
            "Use the managed instance's own credentials.")


def check_public_urls(env: dict[str, str], report: Report) -> None:
    """Anything a browser or a third party sees has to be https.

    `PUBLIC_BASE_URL` is the strictest of these: webhook URLs are built from
    it and handed to other people's systems, and those requests carry a
    signature over the body.
    """
    for key in ("PUBLIC_BASE_URL", "NEXT_PUBLIC_API_BASE"):
        value = env.get(key, "")
        if _is_placeholder(value):
            report.error(key, "is unset or still a placeholder.",
                         "Set it to the deployment's https origin.")
            continue
        if value.startswith("http://"):
            report.error(
                key,
                "is http://, so traffic to it is not encrypted.",
                "Use https:// and terminate TLS at the ingress.")
        elif not value.startswith("https://"):
            report.error(key, f"is not a URL: {value!r}",
                         "Use an absolute https:// origin.")
        if "localhost" in value or "127.0.0.1" in value:
            report.error(key, "points at localhost.",
                         "Use the deployment's public hostname.")


def check_internal_urls(env: dict[str, str], report: Report) -> None:
    """The engine address is the opposite rule: it must NOT be public.

    Guardrail 15. An engine reachable from outside the cluster is the whole
    n8n surface exposed without the product's authorization in front of it.
    """
    value = env.get("ENGINE_BASE_URL", "")
    if _is_placeholder(value):
        report.error("ENGINE_BASE_URL", "is unset.",
                     "Point it at the engine's cluster-internal service.")
        return
    host = (urlparse(value).hostname or "").lower()
    public_looking = (
        "." in host
        and not host.endswith((".local", ".internal", ".svc", ".cluster.local"))
        and not host.startswith(("10.", "127.", "192.168."))
    )
    if public_looking:
        report.warn(
            "ENGINE_BASE_URL",
            f"resolves through what looks like a public name ('{host}'). The "
            "engine must not be reachable from outside the cluster.",
            "Use the internal service name, and keep the network policy that "
            "denies ingress to it.")


def check_hardening(env: dict[str, str], report: Report) -> None:
    if not _truthy(env.get("SESSION_COOKIE_SECURE", "")):
        report.error(
            "SESSION_COOKIE_SECURE",
            "is not true, so the session cookie would be sent over plaintext "
            "http as well.",
            "Set SESSION_COOKIE_SECURE=true.")

    if _truthy(env.get("ALLOW_DERIVED_ENCRYPTION_KEY", "")):
        report.error(
            "ALLOW_DERIVED_ENCRYPTION_KEY",
            "is true, which lets a passphrase stand in for a real key -- every "
            "stored credential would be protected by that passphrase's entropy.",
            "Set ALLOW_DERIVED_ENCRYPTION_KEY=false.")

    if _truthy(env.get("EGRESS_ALLOW_PRIVATE_NETWORKS", "")):
        report.error(
            "EGRESS_ALLOW_PRIVATE_NETWORKS",
            "is true, so any tenant's HTTP Request step can reach the "
            "database, the engine's internal port and every other service in "
            "the cluster.",
            "Set it to false and use EGRESS_ALLOWED_HOSTS for the exceptions.")

    if not env.get("EGRESS_ALLOWED_HOSTS", "").strip():
        report.warn(
            "EGRESS_ALLOWED_HOSTS",
            "is empty, so workflows may call any public address. That is a "
            "supported configuration, not a safe default for a shared "
            "deployment.",
            "Consider an explicit allowlist of the systems tenants integrate "
            "with.")

    if _truthy(env.get("STARTUP_REQUIRE_ENGINE", "")):
        report.warn(
            "STARTUP_REQUIRE_ENGINE",
            "is true, so an engine outage stops every API replica from "
            "starting -- turning a degraded product into a full outage.",
            "Leave it false (SRS 9.6).")


def check_images(env: dict[str, str], report: Report) -> None:
    """A release has to be able to name what it is rolling back to."""
    tag = env.get("IMAGE_TAG", "")
    if _is_placeholder(tag):
        report.error("IMAGE_TAG", "is unset or still a placeholder.",
                     "Set it to the immutable tag or digest being deployed.")
        return
    if tag in {"latest", "main", "master", "edge", "stable"}:
        report.error(
            "IMAGE_TAG",
            f"is '{tag}', which is a moving target: two deploys of the same "
            "config would run different code, and a rollback has nothing to "
            "name.",
            "Use a release tag or an image digest.")

    registry = env.get("IMAGE_REGISTRY", "")
    if _is_placeholder(registry):
        report.error("IMAGE_REGISTRY", "is unset or still a placeholder.",
                     "Set it to the registry the release was pushed to.")


def check_bootstrap(env: dict[str, str], report: Report) -> None:
    """The first-deploy values, which must not outlive the first deploy."""
    raw_password = env.get("BOOTSTRAP_ADMIN_PASSWORD", "")
    # A placeholder is "not filled in", which for these two is the correct
    # state after the first deploy -- so it reads as absent rather than wrong.
    password = "" if _is_placeholder(raw_password) else raw_password
    if password and password.strip().lower() in DEV_SECRETS:
        report.error(
            "BOOTSTRAP_ADMIN_PASSWORD",
            "is a value from this repository's test configuration.",
            "Use a one-time secret, or remove it after the first deploy.")
    elif password:
        report.warn(
            "BOOTSTRAP_ADMIN_PASSWORD",
            "is set. It is only needed for the very first deploy; leaving it "
            "in the environment leaves a known password in the pipeline.",
            "Remove it once the admin account exists.")
    if _is_placeholder(env.get("BOOTSTRAP_ADMIN_EMAIL", "")) and password:
        report.error(
            "BOOTSTRAP_ADMIN_EMAIL",
            "is unset while a bootstrap password is set.",
            "Set both, or neither.")


def check_ops(env: dict[str, str], report: Report) -> None:
    if _is_placeholder(env.get("ONCALL_CONTACT", "")):
        report.error(
            "ONCALL_CONTACT",
            "is unset. A release with nobody named to call is not a release: "
            "the runbooks all end in 'escalate to', and this is who.",
            "Set it to a rota address or a paging handle.")
    if _is_placeholder(env.get("BACKUP_S3_BUCKET", "")):
        report.warn(
            "BACKUP_S3_BUCKET",
            "is unset, so `scripts/backup.py` writes locally only. A backup "
            "on the same host as the thing it backs up is not a backup.",
            "Set a bucket, or confirm the managed database's own backups cover "
            "the recovery objective.")


CHECKS: tuple[Callable[[dict[str, str], Report], None], ...] = (
    check_environment_flag,
    check_secrets,
    check_database,
    check_public_urls,
    check_internal_urls,
    check_hardening,
    check_images,
    check_bootstrap,
    check_ops,
)


def run(env: dict[str, str]) -> Report:
    """Check a configuration, resolving file-backed secrets first.

    The resolution happens here rather than in the caller so that every entry
    point -- the CLI, `install.py`, the release gate and the tests -- sees the
    same environment the application will.
    """
    resolved, file_problems = resolve_file_backed(env)

    report = Report()
    for key, message in file_problems:
        report.error(key, message,
                     "Check the mount path and the file's permissions.")
    for check in CHECKS:
        check(resolved, report)
    return report


# ── output ─────────────────────────────────────────────────────────────────
def _render(report: Report, source: str) -> None:
    print(f"\nProduction readiness: {source}")
    print("=" * 72)
    if not report.findings:
        print("  Everything checked is present and plausible.")
    for finding in report.findings:
        marker = "FAIL" if finding.severity == SEVERITY_ERROR else "warn"
        print(f"  [{marker}] {finding.key}: {finding.message}")
        if finding.fix:
            print(f"         -> {finding.fix}")
    print("=" * 72)
    print(f"  {len(report.errors)} blocking, {len(report.warnings)} advisory")
    if report.ok:
        print("  PASS -- safe to deploy as far as configuration goes.\n")
    else:
        print("  FAIL -- fix the blocking items above before deploying.\n")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Check a production configuration before deploying it.")
    parser.add_argument(
        "--env-file", default=None,
        help="dotenv file to check (default: the current environment)")
    parser.add_argument("--json", action="store_true", dest="as_json")
    parser.add_argument(
        "--warnings-as-errors", action="store_true",
        help="fail on advisory findings too")
    args = parser.parse_args()

    if args.env_file:
        path = pathlib.Path(args.env_file)
        if not path.is_absolute():
            path = ROOT / path
        if not path.exists():
            print(f"No such file: {path}", file=sys.stderr)
            return 2
        env = parse_env_file(path)
        source = str(path)
    else:
        import os

        env = dict(os.environ)
        source = "process environment"

    report = run(env)

    if args.as_json:
        print(json.dumps({
            "source": source,
            "ok": report.ok,
            "errors": len(report.errors),
            "warnings": len(report.warnings),
            "findings": [
                {"severity": f.severity, "key": f.key,
                 "message": f.message, "fix": f.fix}
                for f in report.findings
            ],
        }, indent=2))
    else:
        _render(report, source)

    if not report.ok:
        return 1
    if args.warnings_as_errors and report.warnings:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
