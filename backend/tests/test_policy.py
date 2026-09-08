"""Schedules, redaction, permissions and the error matrix.

Four small pure modules that carry disproportionate risk: a timezone bug fires
every scheduled workflow at the wrong hour, a redaction bug writes a customer's
token into a JSONB column, and a permission bug hands an Analyst the publish
button.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.core.errors import ERROR_UX_MATRIX, ForbiddenError, error_from_matrix
from app.core.permissions import (
    ASSIGNABLE_ROLES, Action, Module, Role, allowed, permission_map, require,
)
from app.core.redaction import preview, redact, sanitize_headers
from app.core.config import settings
from app.core.security import password_problems
from app.services import schedules


class TestSchedules:
    def test_daily_fires_in_the_workspace_zone_not_utc(self):
        # The classic version of this bug: "every day at 02:00" firing at 09:00
        # for a workspace in Asia/Bangkok, unnoticed for a week.
        config = schedules.validate(
            {"schedule_type": "DAILY", "time_of_day": "02:00", "timezone": "Asia/Bangkok"},
            workspace_timezone="UTC",
        )
        after = datetime(2026, 5, 1, 10, 0, tzinfo=timezone.utc)
        fires = schedules.next_run_at(config, after=after)

        local = fires.astimezone(schedules.resolve_zone("Asia/Bangkok"))
        assert (local.hour, local.minute) == (2, 0)
        assert fires > after

    def test_daily_today_is_skipped_once_the_time_has_passed(self):
        config = schedules.validate(
            {"schedule_type": "DAILY", "time_of_day": "02:00", "timezone": "UTC"},
            workspace_timezone="UTC",
        )
        after = datetime(2026, 5, 1, 3, 0, tzinfo=timezone.utc)
        assert schedules.next_run_at(config, after=after).day == 2

    def test_interval_is_measured_from_the_last_computation(self):
        # Not from a fixed epoch: a schedule that was paused must not fire once
        # for every tick it missed the moment it resumes (SRS 67 catch-up).
        config = schedules.validate(
            {"schedule_type": "INTERVAL", "interval_seconds": 3600},
            workspace_timezone="UTC",
        )
        after = datetime(2026, 5, 1, 10, 0, tzinfo=timezone.utc)
        assert schedules.next_run_at(config, after=after) == after + timedelta(hours=1)

    def test_cron_is_evaluated_in_the_declared_zone(self):
        config = schedules.validate(
            {"schedule_type": "CRON", "cron_expression": "0 2 * * *",
             "timezone": "Asia/Bangkok"},
            workspace_timezone="UTC",
        )
        after = datetime(2026, 5, 1, 10, 0, tzinfo=timezone.utc)
        local = schedules.next_run_at(config, after=after).astimezone(
            schedules.resolve_zone("Asia/Bangkok"))
        assert (local.hour, local.minute) == (2, 0)

    def test_an_interval_below_the_floor_is_refused(self):
        with pytest.raises(Exception) as caught:
            schedules.validate(
                {"schedule_type": "INTERVAL", "interval_seconds": 5},
                workspace_timezone="UTC")
        assert caught.value.code == "SCHEDULE_INVALID"

    def test_a_broken_cron_expression_is_refused(self):
        with pytest.raises(Exception) as caught:
            schedules.validate(
                {"schedule_type": "CRON", "cron_expression": "not a cron"},
                workspace_timezone="UTC")
        assert caught.value.code == "SCHEDULE_INVALID"

    def test_an_unknown_timezone_is_refused(self):
        with pytest.raises(Exception):
            schedules.validate(
                {"schedule_type": "DAILY", "time_of_day": "02:00",
                 "timezone": "Mars/Olympus"},
                workspace_timezone="UTC")

    def test_the_preview_returns_three_increasing_times(self):
        config = schedules.validate(
            {"schedule_type": "INTERVAL", "interval_seconds": 3600},
            workspace_timezone="UTC")
        upcoming = schedules.preview(config, count=3)
        assert len(upcoming) == 3
        assert upcoming == sorted(upcoming)

    def test_the_description_always_names_the_zone(self):
        # A schedule shown without its timezone is a schedule the reader will
        # misinterpret (SRS 39).
        described = schedules.describe(
            {"schedule_type": "DAILY", "time_of_day": "02:00", "timezone": "Asia/Bangkok"})
        assert "Asia/Bangkok" in described


class TestRedaction:
    def test_credential_shaped_keys_are_masked_at_any_depth(self):
        payload = {
            "id": 7,
            "access_token": "super-secret",
            "nested": {"api_key": "another", "items": [{"password": "third"}]},
        }
        cleaned = redact(payload)
        blob = str(cleaned)
        assert "super-secret" not in blob
        assert "another" not in blob
        assert "third" not in blob
        assert cleaned["id"] == 7

    def test_authorization_is_dropped_rather_than_masked(self):
        # Masking leaves a field somebody will later "temporarily" log for real.
        cleaned = redact({"authorization": "Bearer abc", "accept": "application/json"})
        assert "authorization" not in cleaned
        assert cleaned["accept"] == "application/json"

    def test_headers_kept_on_an_execution_are_filtered(self):
        kept = sanitize_headers({
            "Content-Type": "application/json",
            "Authorization": "Bearer abc",
            "X-API-Key": "secret",
            "User-Agent": "curl/8",
        })
        assert set(kept) == {"Content-Type", "User-Agent"}

    def test_a_preview_caps_the_item_count_and_says_so(self):
        body, truncated = preview([{"n": index} for index in range(500)])
        assert truncated
        assert body["item_count"] == 500
        assert len(body["items"]) <= 50

    def test_a_preview_caps_total_size(self):
        body, truncated = preview(
            [{"blob": "x" * 5_000} for _ in range(20)], max_bytes=4_000)
        assert truncated
        assert body["note"] == "PREVIEW_TRUNCATED_BY_SIZE"

    def test_an_empty_preview_is_not_truncated(self):
        body, truncated = preview([])
        assert body == {"items": [], "item_count": 0}
        assert not truncated


class TestPermissions:
    def test_an_analyst_cannot_publish_or_execute(self):
        assert not allowed(Role.ANALYST, Module.WORKFLOWS, Action.PUBLISH)
        assert not allowed(Role.ANALYST, Module.WORKFLOWS, Action.EXECUTE)
        assert allowed(Role.ANALYST, Module.WORKFLOWS, Action.VIEW)

    def test_a_builder_can_run_but_not_publish(self):
        # The line the role model exists to draw: proving a workflow works is
        # not the same authority as committing the workspace to it.
        assert allowed(Role.AUTOMATION_BUILDER, Module.WORKFLOWS, Action.EXECUTE)
        assert not allowed(Role.AUTOMATION_BUILDER, Module.WORKFLOWS, Action.PUBLISH)

    def test_an_operator_can_intervene_but_not_edit(self):
        assert allowed(Role.OPERATOR, Module.EXECUTIONS, Action.EXECUTE)
        assert not allowed(Role.OPERATOR, Module.WORKFLOWS, Action.EDIT)
        assert not allowed(Role.OPERATOR, Module.CREDENTIALS, Action.USE)

    def test_an_auditor_never_sees_payloads(self):
        # An auditor reviews configuration and who changed it, not the customer
        # data that passed through.
        for module in Module:
            assert not allowed(Role.AUDITOR, module, Action.VIEW_DATA)
        assert allowed(Role.AUDITOR, Module.AUDIT, Action.VIEW)

    def test_only_an_owner_or_admin_reaches_the_audit_log(self):
        assert not allowed(Role.AUTOMATION_BUILDER, Module.AUDIT, Action.VIEW)
        assert allowed(Role.AUTOMATION_ADMIN, Module.AUDIT, Action.VIEW)
        assert allowed(Role.OWNER, Module.AUDIT, Action.VIEW)

    def test_require_raises_a_forbidden_error_naming_the_decision(self):
        with pytest.raises(ForbiddenError) as caught:
            require(Role.ANALYST, Module.WORKFLOWS, Action.DELETE)
        assert caught.value.details["action"] == "delete"
        assert caught.value.details["module"] == "workflows"

    def test_platform_admin_is_not_assignable_from_a_workspace(self):
        # It is a property of the account, so offering it in a role picker would
        # be a control that silently does nothing.
        assert Role.PLATFORM_ADMIN not in ASSIGNABLE_ROLES

    def test_the_permission_map_covers_every_module(self):
        serialised = permission_map(Role.OWNER)
        assert set(serialised) == {module.value for module in Module}


class TestErrorMatrix:
    def test_every_matrix_entry_produces_a_usable_envelope(self):
        for code in ERROR_UX_MATRIX:
            error = error_from_matrix(code)
            envelope = error.to_envelope("trc_test")["error"]
            assert envelope["code"] == code
            assert envelope["message"]
            assert envelope["category"]
            assert envelope["trace_id"] == "trc_test"

    def test_a_remediation_carries_the_resource_it_points_at(self):
        error = error_from_matrix("CREDENTIAL_INVALID", resource_id="cred-1")
        assert error.remediation == {
            "action": "UPDATE_CREDENTIAL", "resource_id": "cred-1"}

    def test_an_unknown_code_still_produces_a_readable_error(self):
        error = error_from_matrix("SOMETHING_NEW")
        assert error.code == "SOMETHING_NEW"
        assert error.message
        assert error.remediation is None

    def test_the_codes_the_ui_branches_on_all_exist(self):
        # These are referenced by name in the frontend; a rename here without a
        # rename there is a silent regression in the error UX.
        for code in (
            "WORKFLOW_INVALID", "CREDENTIAL_INVALID", "DRAFT_VERSION_CONFLICT",
            "WORKFLOW_ALREADY_RUNNING", "ENGINE_UNAVAILABLE",
            "NODE_AUTHENTICATION_FAILED", "EXPRESSION_INVALID", "EGRESS_BLOCKED",
            "WEBHOOK_AUTH_FAILED", "SCHEDULE_INVALID",
        ):
            assert code in ERROR_UX_MATRIX


class TestPasswordPolicy:
    def test_every_reason_is_reported_at_once(self):
        # A rule the user cannot see is a rule they retry against blindly.
        problems = password_problems("short")
        assert len(problems) >= 2

    def test_a_reasonable_password_passes(self):
        assert password_problems("Str0ngEnoughPassphrase") == []

    def test_whitespace_is_not_a_password(self):
        assert password_problems("              ") != []


class TestSessionTokensSurviveClockSkew:
    """Two API replicas whose clocks differ by a second.

    `iat` and `nbf` are compared against *now* with no tolerance by default, so
    a replica a second behind the one that issued a token answers "The token is
    not yet valid" -- and the user is told their session expired moments after
    signing in. NTP drift of a second is ordinary; this was seen for real
    between two API replicas of this product.
    """

    def test_a_token_from_a_slightly_fast_clock_is_accepted(self, monkeypatch):
        import time
        import uuid

        from app.core import security

        # Issue as though this replica's clock is five seconds ahead.
        real_time = time.time
        monkeypatch.setattr(
            security.time, "time", lambda: real_time() + 5)
        token = security.issue_session_token(uuid.uuid4(), uuid.uuid4())
        monkeypatch.setattr(security.time, "time", real_time)

        claims = security.decode_session_token(token)
        assert claims["sub"]

    def test_a_token_from_a_wildly_wrong_clock_is_still_refused(
            self, monkeypatch):
        # The leeway is for drift, not for forgery: a token minted an hour in
        # the future is not a clock problem.
        import time
        import uuid

        from app.core.errors import UnauthorizedError
        from app.core import security

        real_time = time.time
        monkeypatch.setattr(
            security.time, "time", lambda: real_time() + 3600)
        token = security.issue_session_token(uuid.uuid4(), uuid.uuid4())
        monkeypatch.setattr(security.time, "time", real_time)

        with pytest.raises(UnauthorizedError):
            security.decode_session_token(token)

    def test_an_expired_token_is_still_refused(self, monkeypatch):
        import time
        import uuid

        from app.core.errors import UnauthorizedError
        from app.core import security

        real_time = time.time
        monkeypatch.setattr(
            security.time, "time",
            lambda: real_time() - settings.session_ttl_seconds - 600)
        token = security.issue_session_token(uuid.uuid4(), uuid.uuid4())
        monkeypatch.setattr(security.time, "time", real_time)

        with pytest.raises(UnauthorizedError):
            security.decode_session_token(token)
