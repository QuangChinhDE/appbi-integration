"""The production configuration gate (`scripts/doctor.py`).

The doctor is the only thing standing between a copied template and a
production deployment, so each of its refusals is pinned individually. A gate
that passes everything is worse than no gate: it is a gate people trust.

Imported by path rather than as a package: `scripts/` is deliberately not
importable application code, and the doctor deliberately does not import the
application.
"""

from __future__ import annotations

import base64
import importlib.util
import os
import pathlib
import secrets
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent


def _load_doctor():
    spec = importlib.util.spec_from_file_location(
        "appbi_doctor", ROOT / "scripts" / "doctor.py")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    # Registered before executing: `@dataclass` resolves annotations through
    # `sys.modules[cls.__module__]`, and a module that is not there yet makes
    # the decorator fail with an AttributeError about NoneType.
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


doctor = _load_doctor()


def _good_env() -> dict[str, str]:
    """A configuration the doctor should accept, with no findings at all."""
    return {
        "APP_ENV": "production",
        "PRODUCT_VERSION": "1.2.0",
        "DATABASE_URL":
            "postgresql+asyncpg://appbi_prod:s3cret@db.internal.example.com"
            ":5432/appbi_workflow?ssl=require",
        "JWT_SECRET": secrets.token_urlsafe(48),
        "SECRET_ENCRYPTION_KEY":
            base64.urlsafe_b64encode(os.urandom(32)).decode(),
        "ENGINE_INTERNAL_TOKEN": secrets.token_urlsafe(32),
        "SESSION_COOKIE_SECURE": "true",
        "ALLOW_DERIVED_ENCRYPTION_KEY": "false",
        "ENGINE_BASE_URL": "http://engine.appbi.svc.cluster.local:8099",
        "PUBLIC_BASE_URL": "https://automation.example.com",
        "NEXT_PUBLIC_API_BASE": "https://automation.example.com",
        "EGRESS_ALLOW_PRIVATE_NETWORKS": "false",
        "EGRESS_ALLOWED_HOSTS": "api.acme.com",
        "STARTUP_REQUIRE_ENGINE": "false",
        "IMAGE_REGISTRY": "registry.example.com/appbi",
        "IMAGE_TAG": "v1.2.0",
        "ONCALL_CONTACT": "automation-oncall@example.com",
        "BACKUP_S3_BUCKET": "appbi-workflow-backups",
    }


def _keys_failing(env: dict[str, str]) -> set[str]:
    return {f.key for f in doctor.run(env).errors}


class TestAcceptsACorrectConfiguration:
    def test_a_complete_production_config_has_no_findings(self):
        report = doctor.run(_good_env())
        assert report.ok, [f.message for f in report.errors]
        # Not merely "no blockers": a correct configuration should be quiet, or
        # the advisory findings become noise nobody reads.
        assert report.warnings == []

    def test_the_shipped_template_is_rejected_until_it_is_edited(self):
        # The whole point of the template. If this ever passes, somebody has
        # given a placeholder a working default.
        env = doctor.parse_env_file(ROOT / ".env.production.example")
        report = doctor.run(env)
        assert not report.ok
        assert {"JWT_SECRET", "SECRET_ENCRYPTION_KEY", "ENGINE_INTERNAL_TOKEN",
                "PUBLIC_BASE_URL", "IMAGE_TAG", "ONCALL_CONTACT"} <= _keys_failing(env)


class TestPlaceholders:
    @pytest.mark.parametrize(
        "value", ["", "FILL_ME", "fill_me", "changeme", "CHANGE-ME", "TODO",
                  "your-secret-here"])
    def test_a_placeholder_secret_is_refused(self, value):
        env = _good_env() | {"JWT_SECRET": value}
        assert "JWT_SECRET" in _keys_failing(env)

    def test_a_placeholder_is_not_matched_inside_a_real_secret(self):
        # A generated secret can contain any substring by chance. The check
        # must not be so eager that it rejects real values -- that is how a
        # gate gets switched off.
        env = _good_env() | {"JWT_SECRET": "x" * 20 + "todo" + "y" * 30}
        assert "JWT_SECRET" not in _keys_failing(env)


class TestDevelopmentSecrets:
    @pytest.mark.parametrize(
        "key,value",
        [("JWT_SECRET", "dev-only-change-me-please-32-chars-min"),
         ("ENGINE_INTERNAL_TOKEN", "dev-engine-token")],
    )
    def test_a_value_from_the_repository_is_refused(self, key, value):
        # These are published in `.env.example`. A deployment carrying one is
        # a deployment anybody who can read the repository can forge a session
        # for.
        assert key in _keys_failing(_good_env() | {key: value})

    def test_the_development_database_password_is_refused(self):
        env = _good_env() | {
            "DATABASE_URL":
                "postgresql+asyncpg://appbi:appbi@db.internal.example.com"
                ":5432/appbi_workflow?ssl=require"}
        assert "DATABASE_URL" in _keys_failing(env)

    def test_a_short_secret_is_refused_even_when_it_is_real(self):
        env = _good_env() | {"JWT_SECRET": secrets.token_urlsafe(8)}
        assert "JWT_SECRET" in _keys_failing(env)


class TestTransportSecurity:
    @pytest.mark.parametrize("key", ["PUBLIC_BASE_URL", "NEXT_PUBLIC_API_BASE"])
    def test_a_plaintext_public_url_is_refused(self, key):
        env = _good_env() | {key: "http://automation.example.com"}
        assert key in _keys_failing(env)

    def test_a_public_url_pointing_at_localhost_is_refused(self):
        env = _good_env() | {"PUBLIC_BASE_URL": "https://localhost:8000"}
        assert "PUBLIC_BASE_URL" in _keys_failing(env)

    def test_the_session_cookie_must_be_secure(self):
        env = _good_env() | {"SESSION_COOKIE_SECURE": "false"}
        assert "SESSION_COOKIE_SECURE" in _keys_failing(env)

    def test_an_internal_engine_address_is_accepted_over_plain_http(self):
        # The engine's own address is the one URL that should *not* be public,
        # so http inside the cluster is correct rather than a finding.
        assert doctor.run(_good_env()).ok


class TestDatabase:
    def test_a_database_without_tls_is_refused(self):
        env = _good_env() | {
            "DATABASE_URL":
                "postgresql+asyncpg://u:p@db.internal.example.com:5432/appbi"}
        assert "DATABASE_URL" in _keys_failing(env)

    def test_sslmode_is_refused_because_asyncpg_ignores_it(self):
        # The dangerous case: it looks like TLS was requested, and the
        # connection is made without it.
        env = _good_env() | {
            "DATABASE_URL":
                "postgresql+asyncpg://u:p@db.internal.example.com:5432/appbi"
                "?sslmode=require"}
        assert "DATABASE_URL" in _keys_failing(env)

    @pytest.mark.parametrize("host", ["localhost", "127.0.0.1", "postgres", "db"])
    def test_a_database_in_the_compose_file_is_refused(self, host):
        env = _good_env() | {
            "DATABASE_URL":
                f"postgresql+asyncpg://u:p@{host}:5432/appbi?ssl=require"}
        assert "DATABASE_URL" in _keys_failing(env)


class TestImagePinning:
    @pytest.mark.parametrize("tag", ["latest", "main", "master", "stable", "edge"])
    def test_a_moving_tag_is_refused(self, tag):
        # A rollback has to be able to name what it is rolling back to.
        assert "IMAGE_TAG" in _keys_failing(_good_env() | {"IMAGE_TAG": tag})

    def test_a_release_tag_is_accepted(self):
        assert doctor.run(_good_env() | {"IMAGE_TAG": "v1.4.2"}).ok

    def test_a_digest_is_accepted(self):
        env = _good_env() | {"IMAGE_TAG": "sha256:" + "ab" * 32}
        assert doctor.run(env).ok


class TestHardening:
    def test_a_derived_encryption_key_is_refused(self):
        env = _good_env() | {"ALLOW_DERIVED_ENCRYPTION_KEY": "true"}
        assert "ALLOW_DERIVED_ENCRYPTION_KEY" in _keys_failing(env)

    def test_private_network_egress_is_refused(self):
        # True here means any tenant's HTTP step can reach the database and the
        # engine's internal port.
        env = _good_env() | {"EGRESS_ALLOW_PRIVATE_NETWORKS": "true"}
        assert "EGRESS_ALLOW_PRIVATE_NETWORKS" in _keys_failing(env)

    def test_a_non_production_app_env_fails_the_whole_check(self):
        # Otherwise the strict startup checks are inactive and the deployment
        # is running with development semantics.
        env = _good_env() | {"APP_ENV": "staging"}
        assert "APP_ENV" in _keys_failing(env)

    def test_requiring_the_engine_at_startup_is_advisory_not_fatal(self):
        env = _good_env() | {"STARTUP_REQUIRE_ENGINE": "true"}
        report = doctor.run(env)
        assert report.ok
        assert "STARTUP_REQUIRE_ENGINE" in {f.key for f in report.warnings}


class TestOperations:
    def test_a_release_needs_somebody_to_call(self):
        env = _good_env() | {"ONCALL_CONTACT": ""}
        assert "ONCALL_CONTACT" in _keys_failing(env)

    def test_a_missing_backup_target_is_advisory(self):
        # The managed database may have its own backups covering the recovery
        # objective, so this is a question rather than a refusal.
        env = _good_env() | {"BACKUP_S3_BUCKET": ""}
        report = doctor.run(env)
        assert report.ok
        assert "BACKUP_S3_BUCKET" in {f.key for f in report.warnings}

    def test_a_leftover_bootstrap_password_is_advisory(self):
        env = _good_env() | {
            "BOOTSTRAP_ADMIN_EMAIL": "admin@example.com",
            "BOOTSTRAP_ADMIN_PASSWORD": secrets.token_urlsafe(16)}
        report = doctor.run(env)
        assert report.ok
        assert "BOOTSTRAP_ADMIN_PASSWORD" in {f.key for f in report.warnings}

    def test_a_bootstrap_password_from_the_test_suite_is_refused(self):
        env = _good_env() | {
            "BOOTSTRAP_ADMIN_EMAIL": "admin@example.com",
            "BOOTSTRAP_ADMIN_PASSWORD": "SmokeTestPass123!"}
        assert "BOOTSTRAP_ADMIN_PASSWORD" in _keys_failing(env)


class TestFileBackedSecrets:
    """`DATABASE_URL_FILE` and friends.

    `deploy/production.yaml.example` configures the whole deployment this way,
    because `docker inspect` and `/proc/<pid>/environ` show environment
    variables to anybody who can read them and a file can be mode 0400. The
    gate has to understand the same thing the application does: a checker that
    refuses a configuration which would have started is a checker people learn
    to bypass, and this one refused every production deployment the example
    describes.
    """

    def _write(self, tmp_path, name: str, value: str) -> str:
        path = tmp_path / name
        path.write_text(value + "\n", encoding="utf-8")
        return str(path)

    def _file_backed_env(self, tmp_path) -> dict[str, str]:
        env = _good_env()
        moved = {
            "DATABASE_URL": "database_url",
            "JWT_SECRET": "jwt_secret",
            "SECRET_ENCRYPTION_KEY": "encryption_key",
            "ENGINE_INTERNAL_TOKEN": "engine_token",
        }
        for key, filename in moved.items():
            env[f"{key}_FILE"] = self._write(tmp_path, filename, env.pop(key))
        return env

    def test_a_fully_file_backed_configuration_passes(self, tmp_path):
        report = doctor.run(self._file_backed_env(tmp_path))
        assert report.ok, [f"{f.key}: {f.message}" for f in report.errors]
        assert report.warnings == []

    def test_the_value_is_read_from_the_file_and_trimmed(self, tmp_path):
        env = _good_env()
        secret = env.pop("JWT_SECRET")
        path = tmp_path / "jwt"
        path.write_text(f"  {secret}  \n", encoding="utf-8")
        env["JWT_SECRET_FILE"] = str(path)

        resolved, problems = doctor.resolve_file_backed(env)
        assert problems == []
        assert resolved["JWT_SECRET"] == secret

    def test_a_weak_secret_in_a_file_is_still_refused(self, tmp_path):
        # The file is a delivery mechanism, not an exemption from the checks.
        env = _good_env()
        env.pop("JWT_SECRET")
        env["JWT_SECRET_FILE"] = self._write(tmp_path, "jwt", "short")
        assert "JWT_SECRET" in _keys_failing(env)

    def test_a_development_secret_in_a_file_is_still_refused(self, tmp_path):
        env = _good_env()
        env.pop("ENGINE_INTERNAL_TOKEN")
        env["ENGINE_INTERNAL_TOKEN_FILE"] = self._write(
            tmp_path, "engine", "dev-engine-token")
        assert "ENGINE_INTERNAL_TOKEN" in _keys_failing(env)

    def test_a_missing_secret_file_is_a_blocking_error(self, tmp_path):
        env = _good_env()
        env.pop("DATABASE_URL")
        env["DATABASE_URL_FILE"] = str(tmp_path / "not-there")

        report = doctor.run(env)
        assert not report.ok
        keys = {f.key for f in report.errors}
        assert "DATABASE_URL_FILE" in keys
        # And it says the application refuses rather than falling back, which
        # is the behaviour an operator needs to predict.
        message = next(f.message for f in report.errors
                       if f.key == "DATABASE_URL_FILE")
        assert "refuses to start" in message

    def test_an_empty_secret_file_is_a_blocking_error(self, tmp_path):
        env = _good_env()
        env.pop("JWT_SECRET")
        env["JWT_SECRET_FILE"] = self._write(tmp_path, "jwt", "")
        assert "JWT_SECRET_FILE" in _keys_failing(env)

    def test_setting_both_a_value_and_a_file_is_reported(self, tmp_path):
        # Two sources for one secret is a question, not a configuration: the
        # operator should be told which one is winning.
        env = _good_env()
        env["JWT_SECRET_FILE"] = self._write(tmp_path, "jwt", "x" * 60)
        report = doctor.run(env)
        assert not report.ok
        assert "JWT_SECRET" in {f.key for f in report.errors}

    def test_the_resolution_list_matches_the_application(self):
        """The two lists have to agree, or the gate checks a different thing.

        Read from the application's source rather than imported, because the
        doctor deliberately does not import the application.
        """
        import re

        config = (ROOT / "backend" / "app" / "core" / "config.py").read_text(
            encoding="utf-8")
        block = re.search(r"_FILE_BACKED = \((.*?)\)", config, re.S)
        assert block, "_FILE_BACKED not found in app/core/config.py"
        names = set(re.findall(r'"(\w+)"', block.group(1)))
        assert names == set(doctor.FILE_BACKED), (
            f"the application resolves {sorted(names)} but the doctor "
            f"resolves {sorted(doctor.FILE_BACKED)}")


class TestEnvFileParsing:
    def test_a_trailing_comment_is_not_part_of_the_value(self, tmp_path):
        # `.env.example` writes `SESSION_COOKIE_SECURE=false  # must be true`.
        # Reading the comment as part of the value would make every such line
        # unparseable and the check meaningless.
        path = tmp_path / "env"
        path.write_text(
            "SESSION_COOKIE_SECURE=true   # must be true in production\n"
            "export APP_ENV=production\n"
            'JWT_SECRET="quoted value with spaces"\n',
            encoding="utf-8")
        values = doctor.parse_env_file(path)
        assert values["SESSION_COOKIE_SECURE"] == "true"
        assert values["APP_ENV"] == "production"
        assert values["JWT_SECRET"] == "quoted value with spaces"

    def test_a_hash_inside_a_quoted_value_is_kept(self):
        # A generated secret can contain a `#`. Stripping from the first hash
        # would silently truncate it.
        import pathlib as _pathlib
        import tempfile

        with tempfile.TemporaryDirectory() as directory:
            path = _pathlib.Path(directory) / "env"
            path.write_text('JWT_SECRET="abc#def"\n', encoding="utf-8")
            assert doctor.parse_env_file(path)["JWT_SECRET"] == "abc#def"
