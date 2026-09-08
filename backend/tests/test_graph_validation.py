"""Graph validation rules (SRS 13.3).

These are the checks that decide whether a user can publish, so they get tested
against the real node registry rather than a fixture: a rule that passes on a
hand-written definition and fails on the shipped one is worse than no test.

No database and no engine — `services.graph` is pure on purpose.
"""

from __future__ import annotations

import pytest

from app.services import catalog
from app.services.graph import (
    empty_graph, graph_hash, output_ports, validate_graph,
)


@pytest.fixture(scope="module")
def definitions() -> dict[str, dict]:
    """The shipped catalogue, in the shape the validator expects."""
    return {
        entry["node_key"]: {
            "node_key": entry["node_key"],
            "display_name": entry["display_name"],
            "category": entry["category"],
            "config_schema": entry.get("config_schema") or {},
            "capability": entry.get("capability") or {},
            "certification": entry.get("certification", "BETA"),
            "status": entry.get("status", "ACTIVE"),
            "product_schema_version": entry.get("product_schema_version", 1),
            "engine_binding": entry.get("engine_binding") or {},
        }
        for entry in catalog.bundled_nodes()
    }


def node(node_id: str, key: str, name: str, config: dict | None = None) -> dict:
    return {
        "id": node_id, "node_key": key, "name": name,
        "position": {"x": 0, "y": 0}, "config": config or {},
    }


def link(source: str, target: str, from_port: str = "main", to_port: str = "main") -> dict:
    return {
        "from": {"node_id": source, "port": from_port},
        "to": {"node_id": target, "port": to_port},
    }


def codes(result) -> set[str]:
    return {issue.code for issue in result.issues}


class TestShape:
    def test_a_new_workflow_is_valid_except_for_its_unconnected_trigger(self, definitions):
        # A brand-new workflow has a trigger and nothing else. That is a normal
        # state, and the only complaint should be the one that tells the user
        # what to do next.
        result = validate_graph(empty_graph(), definitions)
        assert codes(result) == {"TRIGGER_NOT_CONNECTED"}

    def test_a_minimal_two_node_workflow_is_valid(self, definitions):
        graph = {
            "nodes": [
                node("start_1", "manual_trigger", "Start"),
                node("set_1", "edit_fields", "Label", {
                    "assignments": [{"name": "x", "type": "string", "value": "1"}],
                }),
            ],
            "connections": [link("start_1", "set_1")],
        }
        result = validate_graph(graph, definitions)
        assert result.ok, [i.as_dict() for i in result.issues]
        assert result.trigger_node_key == "manual_trigger"

    def test_malformed_graph_is_rejected_without_crashing(self, definitions):
        assert not validate_graph({"nodes": "nope", "connections": []}, definitions).ok
        assert not validate_graph({}, definitions).ok


class TestTriggerRule:
    def test_a_workflow_needs_a_trigger(self, definitions):
        graph = {
            "nodes": [node("set_1", "edit_fields", "Label", {
                "assignments": [{"name": "x", "type": "string", "value": "1"}],
            })],
            "connections": [],
        }
        assert "TRIGGER_REQUIRED" in codes(validate_graph(graph, definitions))

    def test_two_triggers_are_rejected(self, definitions):
        graph = {
            "nodes": [
                node("start_1", "manual_trigger", "Start"),
                node("start_2", "webhook_trigger", "Hook"),
                node("set_1", "edit_fields", "Label", {
                    "assignments": [{"name": "x", "type": "string", "value": "1"}],
                }),
            ],
            "connections": [link("start_1", "set_1")],
        }
        assert "TRIGGER_AMBIGUOUS" in codes(validate_graph(graph, definitions))


class TestNodes:
    def test_an_unknown_node_key_is_unsupported(self, definitions):
        graph = {
            "nodes": [
                node("start_1", "manual_trigger", "Start"),
                node("x_1", "shell_command", "Run shell"),
            ],
            "connections": [link("start_1", "x_1")],
        }
        assert "NODE_UNSUPPORTED" in codes(validate_graph(graph, definitions))

    def test_a_disabled_definition_is_unsupported(self, definitions):
        # An admin turning a node off must stop new runs using it, not just
        # hide it from the palette.
        local = {**definitions, "http_request": {**definitions["http_request"],
                                                "status": "DISABLED"}}
        graph = {
            "nodes": [
                node("start_1", "manual_trigger", "Start"),
                node("http_1", "http_request", "Call", {"method": "GET", "url": "https://x"}),
            ],
            "connections": [link("start_1", "http_1")],
        }
        assert "NODE_UNSUPPORTED" in codes(validate_graph(graph, local))

    def test_duplicate_node_names_are_rejected(self, definitions):
        # Not cosmetic: expressions address nodes by name, so two nodes sharing
        # one name make `$node["Same"]` ambiguous at runtime.
        graph = {
            "nodes": [
                node("start_1", "manual_trigger", "Same"),
                node("set_1", "edit_fields", "Same", {
                    "assignments": [{"name": "x", "type": "string", "value": "1"}],
                }),
            ],
            "connections": [link("start_1", "set_1")],
        }
        assert "NODE_NAME_DUPLICATE" in codes(validate_graph(graph, definitions))

    def test_duplicate_node_ids_are_rejected(self, definitions):
        graph = {
            "nodes": [
                node("same", "manual_trigger", "Start"),
                node("same", "edit_fields", "Label"),
            ],
            "connections": [],
        }
        assert "NODE_ID_DUPLICATE" in codes(validate_graph(graph, definitions))

    def test_a_required_field_is_enforced(self, definitions):
        graph = {
            "nodes": [
                node("start_1", "manual_trigger", "Start"),
                node("http_1", "http_request", "Call", {"method": "GET"}),
            ],
            "connections": [link("start_1", "http_1")],
        }
        result = validate_graph(graph, definitions)
        assert "NODE_CONFIGURATION_INVALID" in codes(result)
        assert any(issue.field == "url" for issue in result.issues)

    def test_a_field_hidden_by_its_condition_is_not_required(self, definitions):
        # `json_body` is required only when body_mode is JSON. Enforcing it on a
        # GET would make the form impossible to satisfy.
        graph = {
            "nodes": [
                node("start_1", "manual_trigger", "Start"),
                node("http_1", "http_request", "Call", {
                    "method": "GET", "url": "https://api.example.com", "body_mode": "NONE",
                }),
            ],
            "connections": [link("start_1", "http_1")],
        }
        assert validate_graph(graph, definitions).ok


class TestConnections:
    def test_an_if_branch_port_is_accepted(self, definitions):
        graph = {
            "nodes": [
                node("start_1", "manual_trigger", "Start"),
                node("if_1", "if", "Check", {
                    "conditions": [{"left": "=1", "operator": "equals", "right": "1"}],
                }),
                node("set_1", "edit_fields", "Yes", {
                    "assignments": [{"name": "x", "type": "string", "value": "1"}],
                }),
            ],
            "connections": [link("start_1", "if_1"), link("if_1", "set_1", "true")],
        }
        assert validate_graph(graph, definitions).ok

    def test_an_unknown_port_is_rejected(self, definitions):
        graph = {
            "nodes": [
                node("start_1", "manual_trigger", "Start"),
                node("if_1", "if", "Check", {
                    "conditions": [{"left": "=1", "operator": "equals", "right": "1"}],
                }),
                node("set_1", "edit_fields", "Yes", {
                    "assignments": [{"name": "x", "type": "string", "value": "1"}],
                }),
            ],
            "connections": [link("start_1", "if_1"), link("if_1", "set_1", "maybe")],
        }
        assert "CONNECTION_PORT_INVALID" in codes(validate_graph(graph, definitions))

    def test_nothing_can_connect_into_a_trigger(self, definitions):
        graph = {
            "nodes": [
                node("start_1", "manual_trigger", "Start"),
                node("set_1", "edit_fields", "Label", {
                    "assignments": [{"name": "x", "type": "string", "value": "1"}],
                }),
            ],
            "connections": [link("start_1", "set_1"), link("set_1", "start_1")],
        }
        assert "CONNECTION_PORT_INVALID" in codes(validate_graph(graph, definitions))

    def test_a_cycle_is_rejected(self, definitions):
        graph = {
            "nodes": [
                node("start_1", "manual_trigger", "Start"),
                node("a", "edit_fields", "A", {
                    "assignments": [{"name": "x", "type": "string", "value": "1"}]}),
                node("b", "edit_fields", "B", {
                    "assignments": [{"name": "y", "type": "string", "value": "2"}]}),
            ],
            "connections": [link("start_1", "a"), link("a", "b"), link("b", "a")],
        }
        assert "GRAPH_HAS_CYCLE" in codes(validate_graph(graph, definitions))

    def test_a_dangling_connection_is_rejected(self, definitions):
        graph = {
            "nodes": [node("start_1", "manual_trigger", "Start")],
            "connections": [link("start_1", "ghost")],
        }
        assert "CONNECTION_DANGLING" in codes(validate_graph(graph, definitions))

    def test_an_orphan_node_is_a_warning_not_an_error(self, definitions):
        # A half-built branch is a normal intermediate state; blocking the save
        # would fight the user while they work.
        graph = {
            "nodes": [
                node("start_1", "manual_trigger", "Start"),
                node("set_1", "edit_fields", "Wired", {
                    "assignments": [{"name": "x", "type": "string", "value": "1"}]}),
                node("set_2", "edit_fields", "Loose", {
                    "assignments": [{"name": "y", "type": "string", "value": "2"}]}),
            ],
            "connections": [link("start_1", "set_1")],
        }
        result = validate_graph(graph, definitions)
        assert result.ok
        assert "NODE_ORPHAN" in codes(result)


class TestSwitchPorts:
    def test_switch_ports_come_from_its_rules(self, definitions):
        switch = node("sw_1", "switch", "By type", {
            "value": "={{ $json.type }}",
            "rules": [{"output_key": "a"}, {"output_key": "b"}],
        })
        assert output_ports(switch, definitions["switch"]) == ["a", "b"]

    def test_the_fallback_adds_an_other_port(self, definitions):
        switch = node("sw_1", "switch", "By type", {
            "value": "={{ $json.type }}",
            "rules": [{"output_key": "a"}],
            "fallback": "EXTRA_OUTPUT",
        })
        assert output_ports(switch, definitions["switch"]) == ["a", "other"]

    def test_connecting_a_branch_that_no_rule_declares_is_rejected(self, definitions):
        graph = {
            "nodes": [
                node("start_1", "manual_trigger", "Start"),
                node("sw_1", "switch", "By type", {
                    "value": "={{ $json.type }}",
                    "rules": [{"output_key": "a", "operator": "equals", "compare_to": "x"}],
                }),
                node("set_1", "edit_fields", "B", {
                    "assignments": [{"name": "x", "type": "string", "value": "1"}]}),
            ],
            "connections": [link("start_1", "sw_1"), link("sw_1", "set_1", "b")],
        }
        assert "CONNECTION_PORT_INVALID" in codes(validate_graph(graph, definitions))


class TestExpressions:
    def test_an_unbalanced_expression_is_caught_before_the_engine(self, definitions):
        graph = {
            "nodes": [
                node("start_1", "manual_trigger", "Start"),
                node("set_1", "edit_fields", "Broken", {
                    "assignments": [
                        {"name": "x", "type": "string", "value": "={{ $json.a "},
                    ],
                }),
            ],
            "connections": [link("start_1", "set_1")],
        }
        assert "EXPRESSION_INVALID" in codes(validate_graph(graph, definitions))

    def test_an_empty_placeholder_is_caught(self, definitions):
        graph = {
            "nodes": [
                node("start_1", "manual_trigger", "Start"),
                node("set_1", "edit_fields", "Broken", {
                    "assignments": [{"name": "x", "type": "string", "value": "={{  }}"}],
                }),
            ],
            "connections": [link("start_1", "set_1")],
        }
        assert "EXPRESSION_INVALID" in codes(validate_graph(graph, definitions))

    def test_a_valid_expression_passes(self, definitions):
        graph = {
            "nodes": [
                node("start_1", "manual_trigger", "Start"),
                node("set_1", "edit_fields", "Fine", {
                    "assignments": [
                        {"name": "x", "type": "string",
                         "value": '={{ $node["Start"].json.id }}'},
                    ],
                }),
            ],
            "connections": [link("start_1", "set_1")],
        }
        assert validate_graph(graph, definitions).ok


class TestCredentialCollection:
    def test_referenced_credentials_are_collected(self, definitions):
        graph = {
            "nodes": [
                node("start_1", "manual_trigger", "Start"),
                node("http_1", "http_request", "Call", {
                    "method": "GET", "url": "https://api.example.com",
                    "credential_id": "cred-123",
                }),
            ],
            "connections": [link("start_1", "http_1")],
        }
        assert validate_graph(graph, definitions).credential_ids == {"cred-123"}


class TestGraphHash:
    def test_moving_a_node_does_not_change_the_hash(self):
        # Dragging a node two pixels is not a change to what the workflow does,
        # and if it were hashed then "publish only what changed" would be
        # useless.
        base = empty_graph()
        moved = {
            **base,
            "nodes": [{**base["nodes"][0], "position": {"x": 999, "y": 42}}],
        }
        assert graph_hash(base) == graph_hash(moved)

    def test_changing_config_changes_the_hash(self):
        base = empty_graph()
        edited = {
            **base,
            "nodes": [{**base["nodes"][0], "config": {"test_payload": {"a": 1}}}],
        }
        assert graph_hash(base) != graph_hash(edited)

    def test_the_hash_is_order_independent(self):
        first = {
            "nodes": [
                node("a", "manual_trigger", "Start"),
                node("b", "edit_fields", "Label"),
            ],
            "connections": [link("a", "b")],
        }
        second = {"nodes": list(reversed(first["nodes"])), "connections": first["connections"]}
        assert graph_hash(first) == graph_hash(second)
