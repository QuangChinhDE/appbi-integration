"""What a workflow contains the moment it is created.

Every other test in this repository builds its graph explicitly, which is
exactly why none of them noticed that the *seeded* one was wrong: a webhook
workflow was created with the manual trigger's name, an empty config and a
MANUAL binding. On screen that meant a step called "Khi bấm Run" on a webhook
workflow, a header badge reading "Thủ công", no webhook URL anywhere, and --
worst -- validation reporting `HTTP method` as unfilled while the form showed
it set to POST, because the registry's defaults were rendered but never
written.

The last one is the reason these are unit tests rather than a note in a review:
a form that displays a value the database does not have will produce a
contradiction somewhere, and it is cheaper to assert the config than to find
the contradiction again.
"""

from __future__ import annotations

import io
import json
import pathlib

import pytest

from app.services.graph import (
    TRIGGER_STEP_NAMES, default_config, empty_graph, validate_graph,
)

REGISTRY = pathlib.Path(__file__).resolve().parent.parent / "app" / "resources" \
    / "node_registry.json"


@pytest.fixture(scope="module")
def definitions() -> dict[str, dict]:
    """The node registry, keyed the way `definitions_map` returns it."""
    raw = json.loads(io.open(REGISTRY, encoding="utf-8").read())
    return {node["node_key"]: node for node in raw["nodes"]}


TRIGGERS = ["manual_trigger", "webhook_trigger", "schedule_trigger"]


class TestTheSeededTriggerIsComplete:
    @pytest.mark.parametrize("trigger", TRIGGERS)
    def test_it_reports_no_configuration_problems(self, definitions, trigger):
        """A workflow nobody has touched must not already be misconfigured.

        This is the assertion that would have caught the original defect: the
        graph validated with two `NODE_CONFIGURATION_INVALID` issues on
        creation, both naming fields the config panel displayed as filled.

        `TRIGGER_NOT_CONNECTED` is expected and excluded: a one-node workflow
        genuinely has nothing after its trigger, and saying so is correct. The
        distinction is the point -- "you have not finished building this" is
        useful, "this field you can see filled in is empty" is not.
        """
        graph = empty_graph(trigger, definitions[trigger])
        result = validate_graph(graph, definitions)

        misconfigured = [
            issue for issue in result.issues
            if issue.node_id == "start_1"
            and issue.code != "TRIGGER_NOT_CONNECTED"
        ]
        assert not misconfigured, (
            "a freshly created workflow reports its own trigger as "
            "misconfigured: "
            + "; ".join(f"{i.code}: {i.message}" for i in misconfigured))

    @pytest.mark.parametrize("trigger", TRIGGERS)
    def test_every_required_field_has_a_value(self, definitions, trigger):
        node = empty_graph(trigger, definitions[trigger])["nodes"][0]
        required = [
            field["key"]
            for field in definitions[trigger]["config_schema"]["fields"]
            if field.get("required")
        ]
        for key in required:
            assert node["config"].get(key) not in (None, "", [], {}), (
                f"{trigger}.{key} is required and unset, so the first thing "
                "the user sees is an error about a field the form shows as "
                "filled")

    @pytest.mark.parametrize("trigger", TRIGGERS)
    def test_the_step_is_named_in_the_words_a_person_would_use(
            self, definitions, trigger):
        node = empty_graph(trigger, definitions[trigger])["nodes"][0]
        assert node["name"] == TRIGGER_STEP_NAMES[trigger]
        # Not the registry's type name: "Webhook Trigger" is what the thing is,
        # and a canvas wants to say when it happens.
        assert node["name"] != definitions[trigger]["display_name"]

    def test_each_trigger_gets_its_own_name(self, definitions):
        """The original bug, stated directly.

        Every trigger was called "Khi bấm Run" -- correct for one of the three,
        and actively misleading for the other two.
        """
        names = {t: empty_graph(t, definitions[t])["nodes"][0]["name"]
                 for t in TRIGGERS}
        assert len(set(names.values())) == len(TRIGGERS), names
        assert names["manual_trigger"] == "Khi bấm Run"

    @pytest.mark.parametrize("trigger", TRIGGERS)
    def test_the_node_records_a_schema_version(self, definitions, trigger):
        # The registry file does not carry one today, so this exercises the
        # fallback -- but the field has to be present and sane, because a
        # version migration reads it to decide what a stored config means.
        node = empty_graph(trigger, definitions[trigger])["nodes"][0]
        assert isinstance(node["product_schema_version"], int)
        assert node["product_schema_version"] >= 1


class TestDefaultsAreWrittenNotAssumed:
    def test_webhook_defaults_match_the_registry(self, definitions):
        config = empty_graph(
            "webhook_trigger", definitions["webhook_trigger"])["nodes"][0]["config"]
        # The exact values the panel renders. If these two ever disagree, the
        # user is shown one thing and the engine is given another.
        assert config["method"] == "POST"
        assert config["auth_mode"] == "HEADER_SIGNATURE"
        assert config["allowed_content_type"] == "application/json"

    def test_default_config_skips_fields_with_no_default(self, definitions):
        # `url` on an HTTP step has no default and must stay unset, so the
        # product can honestly report it as needing a value.
        config = default_config(definitions["http_request"])
        assert "url" not in config
        assert config["method"] == "GET"

    def test_default_config_tolerates_a_missing_definition(self):
        # The seed path runs before the registry is guaranteed present in
        # every deployment shape; it must degrade to an empty config rather
        # than raise.
        assert default_config(None) == {}
        assert default_config({}) == {}


class TestWithoutADefinition:
    def test_it_still_produces_a_usable_graph(self):
        """The fallback path, for a caller that has no registry to hand.

        Degraded but coherent: one trigger node, no connections, a name.
        """
        graph = empty_graph("webhook_trigger")
        node = graph["nodes"][0]
        assert node["node_key"] == "webhook_trigger"
        assert node["name"] == "Khi có request"
        assert graph["connections"] == []

    def test_an_unknown_trigger_falls_back_to_its_key(self):
        graph = empty_graph("some_future_trigger")
        assert graph["nodes"][0]["name"] == "some_future_trigger"

    def test_an_unknown_trigger_uses_the_definition_name_when_given(self):
        graph = empty_graph(
            "some_future_trigger",
            {"display_name": "Future Trigger", "config_schema": {"fields": []}})
        assert graph["nodes"][0]["name"] == "Future Trigger"


class TestSlugsAreReadable:
    """A tenant's slug appears in URLs and log lines, and is how an operator
    recognises it. Dropping accents rather than folding them turned "Công ty
    Demo" into `c-ng-ty-demo`, which is not a name anybody would recognise --
    and this deployment's customers are Vietnamese.
    """

    @pytest.mark.parametrize(
        "name,expected",
        [
            ("Công ty Demo", "cong-ty-demo"),
            ("Tập đoàn Đại Việt", "tap-doan-dai-viet"),
            ("Nhà máy Ô tô Trường Hải", "nha-may-o-to-truong-hai"),
            ("Acme Corp", "acme-corp"),
            ("  Trailing and   inner  spaces ", "trailing-and-inner-spaces"),
        ],
    )
    def test_accents_are_folded_not_dropped(self, name, expected):
        from app.services.provisioning import slugify

        assert slugify(name) == expected

    def test_a_name_with_nothing_usable_still_produces_a_slug(self):
        from app.services.provisioning import slugify

        # A slug is required, so this degrades rather than raising.
        assert slugify("   ") == "workspace"
        assert slugify("!!!") == "workspace"

    def test_the_slug_stays_within_the_column(self):
        from app.services.provisioning import slugify

        assert len(slugify("Rất " * 100)) <= 60

    def test_the_result_is_always_a_valid_slug(self):
        """Whatever goes in, what comes out has to pass the validator.

        Otherwise `provision create --name "..."` fails on a name the operator
        was never asked to sanitise.
        """
        from app.services.provisioning import _SLUG_OK, slugify

        for name in ["Công ty Demo", "Tập đoàn Đại Việt", "  ", "!!!",
                     "A", "Ố Ồ Ổ", "x" * 200]:
            assert _SLUG_OK.match(slugify(name)), name
