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
    ASSIGNABLE_ROLES, MATRIX, ORG_MATRIX, ORG_ROLES_WITH_WORKSPACE_ACCESS, Action,
    Module, OrgRole, Role, allowed, allowed_effective, effective, org_allowed,
    org_require, parse_overrides, permission_map, require, serialise,
)
from app.core.redaction import preview, redact, sanitize_headers
from app.core.config import settings
from app.core.security import password_problems
from app.models.identity import User
from app.services import schedules
from app.services.access import effective_role


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


class TestEffectivePermissions:
    """A role is a preset; `effective()` is what a membership actually holds
    once an administrator has edited it (per-member `permissions` override)."""

    def test_no_override_resolves_to_exactly_the_preset(self):
        assert effective(Role.ANALYST) == {
            module: set(actions) for module, actions in MATRIX[Role.ANALYST].items()
        }

    def test_an_override_replaces_its_module_outright(self):
        # An Analyst is never allowed EXECUTE on workflows by preset; an
        # override naming the module wins over that preset entirely.
        perms = effective(Role.ANALYST, {"workflows": ["view", "execute"]})
        assert allowed_effective(perms, Module.WORKFLOWS, Action.EXECUTE)
        # Modules not named in the override still fall back to the preset.
        assert perms[Module.CREDENTIALS] == set(MATRIX[Role.ANALYST][Module.CREDENTIALS])

    def test_an_empty_list_override_is_a_revocation_not_a_no_op(self):
        # OWNER can view audit by preset; an explicit empty list must survive
        # resolution as "nothing", not be treated as "no override given".
        perms = effective(Role.OWNER, {"audit": []})
        assert perms[Module.AUDIT] == set()

    def test_a_module_absent_from_the_override_keeps_its_preset(self):
        perms = effective(Role.ANALYST, {"workflows": ["view"]})
        assert perms[Module.EXECUTIONS] == set(MATRIX[Role.ANALYST][Module.EXECUTIONS])

    def test_platform_admin_ignores_overrides_entirely(self):
        # A stale restrictive override on some membership of theirs must never
        # narrow what the account flag already grants.
        perms = effective(Role.ANALYST, {"workflows": []}, is_platform_admin=True)
        assert perms[Module.WORKFLOWS] == set(Action)

    def test_unknown_module_or_action_in_an_override_is_dropped_not_guessed(self):
        perms = effective(Role.ANALYST, {"not_a_module": ["view"], "workflows": ["not_a_verb"]})
        assert perms[Module.WORKFLOWS] == set()

    def test_parse_overrides_round_trips_a_valid_map(self):
        stored = parse_overrides({"workflows": ["view", "execute"]})
        assert stored == {"workflows": ["execute", "view"]}

    def test_parse_overrides_rejects_an_unknown_module(self):
        with pytest.raises(ValueError):
            parse_overrides({"not_a_module": ["view"]})

    def test_parse_overrides_rejects_an_unknown_action(self):
        with pytest.raises(ValueError):
            parse_overrides({"workflows": ["not_a_verb"]})

    def test_serialise_matches_permission_map_when_nothing_overrides(self):
        assert serialise(effective(Role.OPERATOR)) == permission_map(Role.OPERATOR)


class TestEffectiveRole:
    """Which role actually applies inside one workspace, given a real
    membership row, the platform-admin flag, and an organisation grant."""

    def test_a_real_membership_wins_even_for_a_platform_admin(self):
        # `app.bootstrap` gives the first admin a real OWNER membership in
        # their own workspace. If the flag outranked that row, their home
        # workspace would read "Platform Admin" the moment the flag exists,
        # and revoking the membership later would silently change nothing.
        admin = User(is_platform_admin=True)
        assert effective_role(admin, Role.OWNER, None) is Role.OWNER
        assert effective_role(admin, Role.ANALYST, None) is Role.ANALYST

    def test_the_platform_flag_grants_reach_where_there_is_no_membership(self):
        admin = User(is_platform_admin=True)
        assert effective_role(admin, None, None) is Role.PLATFORM_ADMIN

    def test_an_org_grant_gives_owner_where_there_is_no_membership(self):
        member = User(is_platform_admin=False)
        assert effective_role(member, None, OrgRole.ORG_ADMIN) is Role.OWNER
        assert effective_role(member, None, OrgRole.ORG_OWNER) is Role.OWNER

    def test_a_real_membership_wins_over_an_org_grant_too(self):
        member = User(is_platform_admin=False)
        assert effective_role(member, Role.ANALYST, OrgRole.ORG_ADMIN) is Role.ANALYST

    def test_no_claim_at_all_is_the_callers_to_refuse(self):
        member = User(is_platform_admin=False)
        with pytest.raises(LookupError):
            effective_role(member, None, None)
        with pytest.raises(LookupError):
            effective_role(member, None, OrgRole.ORG_MEMBER)


class TestOrganizationRole:
    """The organisation axis: separate from a workspace role, and the one
    thing that makes a department created today administrable today."""

    def test_org_owner_and_org_admin_reach_every_workspace_the_org_holds(self):
        assert OrgRole.ORG_OWNER in ORG_ROLES_WITH_WORKSPACE_ACCESS
        assert OrgRole.ORG_ADMIN in ORG_ROLES_WITH_WORKSPACE_ACCESS
        assert OrgRole.ORG_MEMBER not in ORG_ROLES_WITH_WORKSPACE_ACCESS

    def test_only_org_owner_can_delete_the_organization(self):
        assert org_allowed(OrgRole.ORG_OWNER, Action.DELETE)
        assert not org_allowed(OrgRole.ORG_ADMIN, Action.DELETE)

    def test_org_admin_can_create_departments_but_not_dissolve_the_org(self):
        assert org_allowed(OrgRole.ORG_ADMIN, Action.CREATE)
        assert not org_allowed(OrgRole.ORG_ADMIN, Action.DELETE)

    def test_org_member_only_views(self):
        assert ORG_MATRIX[OrgRole.ORG_MEMBER] == {Action.VIEW}

    def test_no_org_role_is_never_allowed_anything(self):
        assert not org_allowed(None, Action.VIEW)

    def test_org_require_raises_naming_the_organization_scope(self):
        with pytest.raises(ForbiddenError) as caught:
            org_require(OrgRole.ORG_MEMBER, Action.CREATE)
        assert caught.value.details["scope"] == "organization"
        assert caught.value.details["action"] == "create"


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


class TestRemediationReachesAFailedRun:
    """Wave 0C, D-W0-10 — the run panel could only act on one code in twenty-three.

    `ERROR_UX_MATRIX` says what a user should do about each code, and that
    answer reached API error envelopes but never a *failed execution*, which is
    where most of these codes are actually met. The frontend had compensated by
    hardcoding `NODE_AUTHENTICATION_FAILED -> UPDATE_CREDENTIAL`, so a timeout
    or an unreachable host showed a message and no way forward.
    """

    def test_every_code_with_an_action_offers_it(self):
        from app.core.errors import ERROR_UX_MATRIX, remediation_for

        for code, (_status, _category, _message, action) in ERROR_UX_MATRIX.items():
            result = remediation_for(code)
            if action is None:
                assert result is None, f"{code} has no action but returned {result}"
            else:
                assert result == {"action": action}, code

    def test_the_codes_a_failed_http_step_actually_produces(self):
        # The four the Wave 0A contract tests prove the engine emits. Each one
        # must give the user somewhere to go.
        from app.core.errors import remediation_for

        for code in (
            "NODE_AUTHENTICATION_FAILED",
            "NODE_NETWORK_UNREACHABLE",
            "NODE_TIMEOUT",
            "NODE_CONFIGURATION_INVALID",
        ):
            assert remediation_for(code) is not None, code

    def test_an_unknown_or_absent_code_is_honest_about_having_no_answer(self):
        from app.core.errors import remediation_for

        assert remediation_for(None) is None
        assert remediation_for("SOMETHING_NEW") is None

    def test_a_stored_node_error_is_enriched_without_being_rewritten(self):
        from app.services.executions import _error_with_remediation

        stored = {
            "code": "NODE_NETWORK_UNREACHABLE",
            "category": "NETWORK",
            "message": "Không kết nối được tới 'api.acme.com'.",
            "technical_message": "ENOTFOUND",
        }
        enriched = _error_with_remediation(dict(stored))

        assert enriched["remediation"] == {"action": "CHECK_ENDPOINT"}
        # Everything the engine recorded survives untouched.
        for key, value in stored.items():
            assert enriched[key] == value

    def test_nothing_is_invented_for_an_error_that_has_no_code(self):
        from app.services.executions import _error_with_remediation

        assert _error_with_remediation(None) is None
        assert _error_with_remediation({}) == {}
        assert "remediation" not in _error_with_remediation({"message": "x"})
