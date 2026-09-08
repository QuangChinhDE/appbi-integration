"""Product workflow graph: shape, hashing and validation (SRS 13.3).

Pure functions over plain dictionaries. No database, no engine, no n8n — which
is what makes the validation rules testable on their own and keeps the same
code usable from the API, the worker and the publish path.

The graph is the product's own shape:

    {
      "nodes": [
        {"id": "start_1", "node_key": "manual_trigger", "name": "When clicked",
         "position": {"x": 80, "y": 240}, "config": {}, "product_schema_version": 1}
      ],
      "connections": [
        {"from": {"node_id": "start_1", "port": "main"},
         "to":   {"node_id": "http_1",  "port": "main"}}
      ]
    }

Nothing in here resembles an n8n workflow: that translation happens once, in
the engine's compiler (SRS 25).
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from typing import Any, Iterable

NODE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
MAX_NODES = 200
MAX_NAME_LENGTH = 200

#: An expression is any value the user marked as one. n8n's own convention is a
#: leading `=`; we keep it because the expression runtime is n8n's (ADR-008) and
#: inventing a second marker would mean translating it in two directions.
EXPRESSION_PREFIX = "="


@dataclass(slots=True)
class Issue:
    """One validation problem, addressed at the thing the user can click."""

    code: str
    message: str
    node_id: str | None = None
    field: str | None = None
    severity: str = "ERROR"

    def as_dict(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "message": self.message,
            "node_id": self.node_id,
            "field": self.field,
            "severity": self.severity,
        }


@dataclass(slots=True)
class ValidationResult:
    issues: list[Issue] = field(default_factory=list)
    #: Credential ids the graph references, so the caller can check them once
    #: instead of walking the nodes again.
    credential_ids: set[str] = field(default_factory=set)
    trigger_node_id: str | None = None
    trigger_node_key: str | None = None

    @property
    def errors(self) -> list[Issue]:
        return [i for i in self.issues if i.severity == "ERROR"]

    @property
    def ok(self) -> bool:
        return not self.errors

    def as_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "issues": [i.as_dict() for i in self.issues],
            "trigger_node_id": self.trigger_node_id,
            "trigger_node_key": self.trigger_node_key,
        }


#: What the trigger step is called on the canvas, in the words a person would
#: use rather than the registry's type name. "Manual Trigger" is what the thing
#: *is*; "Khi bấm Run" is when it happens, which is what somebody reading a
#: diagram wants to know.
TRIGGER_STEP_NAMES = {
    "manual_trigger": "Khi bấm Run",
    "webhook_trigger": "Khi có request",
    "schedule_trigger": "Theo lịch",
}


def default_config(definition: dict[str, Any] | None) -> dict[str, Any]:
    """Every field's declared default, as a config to persist.

    The registry's defaults have to be *written*, not merely rendered. A form
    that shows `POST` because the schema says so, over a config that is empty,
    produces the worst error a product can give: validation reporting a field
    as unfilled while the user is looking at it filled in.
    """
    config: dict[str, Any] = {}
    for spec in ((definition or {}).get("config_schema") or {}).get("fields") or []:
        if spec.get("default") is not None:
            config[spec["key"]] = spec["default"]
    return config


def empty_graph(
    trigger_node_key: str = "manual_trigger",
    definition: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """A new workflow already has its trigger, configured and named.

    A blank canvas is a puzzle: the first thing a user must do is find the one
    node type that is allowed to be first. Starting with it on the canvas is
    also what makes "press Run" work on a workflow that is thirty seconds old.

    `definition` is the registry entry for the chosen trigger. Passing it is
    what makes the seeded node equivalent to one added from the palette --
    same defaults, same naming. Without it the node is created bare, which is
    how a webhook workflow ended up called "Khi bấm Run" with no method set.
    """
    name = TRIGGER_STEP_NAMES.get(trigger_node_key)
    if name is None:
        name = (definition or {}).get("display_name") or trigger_node_key

    return {
        "nodes": [
            {
                "id": "start_1",
                "node_key": trigger_node_key,
                "name": name,
                "position": {"x": 120, "y": 200},
                "config": default_config(definition),
                "product_schema_version": int(
                    (definition or {}).get("product_schema_version") or 1),
            }
        ],
        "connections": [],
    }


def graph_hash(graph: dict[str, Any]) -> str:
    """Stable hash of the meaningful graph.

    Node positions are excluded on purpose: dragging a node two pixels is not a
    change to what the workflow does, and if it were part of the hash then
    "publish only when something changed" would be useless.
    """
    material = {
        "nodes": sorted(
            (
                {
                    "id": node.get("id"),
                    "node_key": node.get("node_key"),
                    "name": node.get("name"),
                    "config": node.get("config") or {},
                    "product_schema_version": node.get("product_schema_version", 1),
                    "disabled": bool(node.get("disabled")),
                }
                for node in graph.get("nodes") or []
            ),
            key=lambda n: str(n["id"]),
        ),
        "connections": sorted(
            (
                {
                    "from": conn.get("from"),
                    "to": conn.get("to"),
                }
                for conn in graph.get("connections") or []
            ),
            key=lambda c: json.dumps(c, sort_keys=True),
        ),
    }
    blob = json.dumps(material, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(blob.encode()).hexdigest()


def output_ports(node: dict[str, Any], definition: dict[str, Any]) -> list[str]:
    """The port keys this node actually offers, given its configuration.

    Switch is the reason this is a function rather than a list on the node
    definition: its branches are named by the user, so its ports only exist
    once its rules do.
    """
    capability = definition.get("capability") or {}
    if capability.get("output_ports_from") == "rules":
        config = node.get("config") or {}
        ports = [
            str(rule.get("output_key")).strip()
            for rule in (config.get("rules") or [])
            if str(rule.get("output_key") or "").strip()
        ]
        if config.get("fallback") == "EXTRA_OUTPUT":
            ports.append("other")
        return ports
    return [str(port["key"]) for port in capability.get("output_ports") or []]


def input_ports(definition: dict[str, Any]) -> list[str]:
    capability = definition.get("capability") or {}
    return [str(port["key"]) for port in capability.get("input_ports") or []]


def is_expression(value: Any) -> bool:
    return isinstance(value, str) and value.startswith(EXPRESSION_PREFIX)


def _check_expression(value: str) -> str | None:
    """Cheap structural check on an expression, in the product, before the engine.

    This is not an n8n parser and does not pretend to be: it catches the
    mistakes people actually make (unbalanced braces, an empty placeholder) so
    the editor can mark the field before a run is spent finding out. Real
    parsing happens in the engine's compile dry-run, whose verdict wins.
    """
    body = value[len(EXPRESSION_PREFIX):]
    if body.count("{{") != body.count("}}"):
        return "Biểu thức thiếu dấu đóng hoặc mở ngoặc nhọn."
    for match in re.finditer(r"\{\{(.*?)\}\}", body, flags=re.DOTALL):
        if not match.group(1).strip():
            return "Biểu thức có phần trống bên trong {{ }}."
    return None


def _walk_config_values(value: Any, prefix: str = "") -> Iterable[tuple[str, Any]]:
    if isinstance(value, dict):
        for key, item in value.items():
            yield from _walk_config_values(item, f"{prefix}.{key}" if prefix else str(key))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            yield from _walk_config_values(item, f"{prefix}[{index}]")
    else:
        yield prefix, value


def _required_field_keys(definition: dict[str, Any], config: dict[str, Any]) -> list[dict]:
    """Required fields whose display condition is currently satisfied.

    A field hidden behind a condition the user has not chosen is not missing.
    Enforcing it would make "JSON body is required" fire on a GET request.
    """
    out: list[dict] = []
    for spec in (definition.get("config_schema") or {}).get("fields") or []:
        if not spec.get("required"):
            continue
        condition = spec.get("condition")
        if condition:
            expected = condition.get("equals")
            actual = config.get(condition.get("field"))
            if actual != expected:
                continue
        out.append(spec)
    return out


def validate_graph(
    graph: dict[str, Any],
    definitions: dict[str, dict[str, Any]],
    *,
    require_trigger: bool = True,
) -> ValidationResult:
    """Everything the product can decide about a graph without an engine.

    `definitions` maps `node_key` to the registry entry (as stored in
    `node_definitions`, i.e. `config_schema`, `capability`, `certification`,
    `status`). A key that is absent is an unsupported node — that check is here
    *and* in the engine, deliberately, because a graph arrives from a browser
    (SRS 32.4).
    """
    result = ValidationResult()
    nodes = graph.get("nodes")
    connections = graph.get("connections")

    if not isinstance(nodes, list) or not isinstance(connections, list):
        result.issues.append(Issue(
            "GRAPH_MALFORMED", "Cấu trúc workflow không hợp lệ."))
        return result

    if len(nodes) > MAX_NODES:
        result.issues.append(Issue(
            "GRAPH_TOO_LARGE",
            f"Workflow vượt quá {MAX_NODES} bước."))
        return result

    by_id: dict[str, dict[str, Any]] = {}
    for node in nodes:
        node_id = str(node.get("id") or "")
        if not NODE_ID_RE.match(node_id):
            result.issues.append(Issue(
                "NODE_ID_INVALID", "Một bước có mã không hợp lệ.", node_id=node_id or None))
            continue
        if node_id in by_id:
            result.issues.append(Issue(
                "NODE_ID_DUPLICATE", f"Mã bước '{node_id}' bị trùng.", node_id=node_id))
            continue
        by_id[node_id] = node

    # ── per-node checks ────────────────────────────────────────────────────
    triggers: list[str] = []
    names_seen: dict[str, str] = {}
    for node_id, node in by_id.items():
        node_key = str(node.get("node_key") or "")
        definition = definitions.get(node_key)
        if definition is None:
            result.issues.append(Issue(
                "NODE_UNSUPPORTED",
                f"Bước '{node.get('name') or node_id}' dùng loại chưa được hỗ trợ.",
                node_id=node_id))
            continue
        if definition.get("status") == "DISABLED" or definition.get("certification") == "BLOCKED":
            result.issues.append(Issue(
                "NODE_UNSUPPORTED",
                f"Loại bước '{definition.get('display_name', node_key)}' đã bị vô hiệu hóa.",
                node_id=node_id))
            continue
        if definition.get("status") == "DEPRECATED":
            result.issues.append(Issue(
                "NODE_DEPRECATED",
                f"Loại bước '{definition.get('display_name', node_key)}' sắp ngừng hỗ trợ.",
                node_id=node_id, severity="WARNING"))

        name = str(node.get("name") or "").strip()
        if not name:
            result.issues.append(Issue(
                "NODE_NAME_REQUIRED", "Một bước chưa có tên.", node_id=node_id))
        elif len(name) > MAX_NAME_LENGTH:
            result.issues.append(Issue(
                "NODE_NAME_TOO_LONG", "Tên bước quá dài.", node_id=node_id))
        elif name in names_seen:
            # Not cosmetic: expressions address other nodes by name
            # (`$node["Get customer"]`), so two nodes with one name make an
            # expression ambiguous at runtime.
            result.issues.append(Issue(
                "NODE_NAME_DUPLICATE",
                f"Tên bước '{name}' bị trùng; biểu thức tham chiếu theo tên sẽ không xác định.",
                node_id=node_id))
        else:
            names_seen[name] = node_id

        config = node.get("config") or {}
        if not isinstance(config, dict):
            result.issues.append(Issue(
                "NODE_CONFIGURATION_INVALID", "Cấu hình của bước không hợp lệ.",
                node_id=node_id))
            continue

        if (definition.get("capability") or {}).get("is_trigger"):
            triggers.append(node_id)

        for spec in _required_field_keys(definition, config):
            value = config.get(spec["key"])
            if value is None or value == "" or value == [] or value == {}:
                result.issues.append(Issue(
                    "NODE_CONFIGURATION_INVALID",
                    f"Bước '{name or node_id}' chưa điền '{spec.get('label', spec['key'])}'.",
                    node_id=node_id, field=spec["key"]))

        # Credential references: collected here, checked against the workspace
        # by the caller (this module has no database).
        for spec in (definition.get("config_schema") or {}).get("fields") or []:
            if spec.get("type") != "credential":
                continue
            value = config.get(spec["key"])
            if value:
                result.credential_ids.add(str(value))

        for path, value in _walk_config_values(config):
            if not is_expression(value):
                continue
            problem = _check_expression(value)
            if problem:
                result.issues.append(Issue(
                    "EXPRESSION_INVALID",
                    f"Bước '{name or node_id}': {problem}",
                    node_id=node_id, field=path))

    # ── trigger rules (SRS 17.1) ───────────────────────────────────────────
    if require_trigger:
        if not triggers:
            result.issues.append(Issue(
                "TRIGGER_REQUIRED", "Workflow cần đúng một bước bắt đầu."))
        elif len(triggers) > 1:
            result.issues.append(Issue(
                "TRIGGER_AMBIGUOUS",
                "Workflow chỉ được có một bước bắt đầu.",
                node_id=triggers[1]))
    if triggers:
        result.trigger_node_id = triggers[0]
        result.trigger_node_key = str(by_id[triggers[0]].get("node_key"))

    # ── connections ────────────────────────────────────────────────────────
    seen_edges: set[tuple[str, str, str, str]] = set()
    incoming: dict[str, int] = {node_id: 0 for node_id in by_id}
    outgoing: dict[str, int] = {node_id: 0 for node_id in by_id}
    adjacency: dict[str, list[str]] = {node_id: [] for node_id in by_id}

    for conn in connections:
        source = (conn.get("from") or {})
        target = (conn.get("to") or {})
        source_id = str(source.get("node_id") or "")
        target_id = str(target.get("node_id") or "")
        source_port = str(source.get("port") or "main")
        target_port = str(target.get("port") or "main")

        if source_id not in by_id or target_id not in by_id:
            result.issues.append(Issue(
                "CONNECTION_DANGLING", "Có đường nối trỏ tới một bước không tồn tại."))
            continue
        if source_id == target_id:
            result.issues.append(Issue(
                "CONNECTION_SELF", "Một bước không thể tự nối vào chính nó.",
                node_id=source_id))
            continue

        edge = (source_id, source_port, target_id, target_port)
        if edge in seen_edges:
            result.issues.append(Issue(
                "CONNECTION_DUPLICATE", "Có hai đường nối giống nhau.", node_id=source_id))
            continue
        seen_edges.add(edge)

        source_definition = definitions.get(str(by_id[source_id].get("node_key")), {})
        target_definition = definitions.get(str(by_id[target_id].get("node_key")), {})
        valid_out = output_ports(by_id[source_id], source_definition)
        valid_in = input_ports(target_definition)

        if valid_out and source_port not in valid_out:
            result.issues.append(Issue(
                "CONNECTION_PORT_INVALID",
                f"Nhánh '{source_port}' không tồn tại ở bước "
                f"'{by_id[source_id].get('name') or source_id}'.",
                node_id=source_id))
            continue
        if valid_in and target_port not in valid_in:
            result.issues.append(Issue(
                "CONNECTION_PORT_INVALID",
                f"Cổng vào '{target_port}' không tồn tại ở bước "
                f"'{by_id[target_id].get('name') or target_id}'.",
                node_id=target_id))
            continue
        if not valid_in:
            result.issues.append(Issue(
                "CONNECTION_PORT_INVALID",
                f"Bước '{by_id[target_id].get('name') or target_id}' không nhận dữ liệu vào.",
                node_id=target_id))
            continue

        outgoing[source_id] += 1
        incoming[target_id] += 1
        adjacency[source_id].append(target_id)

    # A cycle would run forever: V1 has no loop node and no iteration limit, so
    # this is a hard error rather than a warning (SRS 13.3).
    if _has_cycle(adjacency):
        result.issues.append(Issue(
            "GRAPH_HAS_CYCLE", "Workflow có vòng lặp; V1 chưa hỗ trợ vòng lặp."))

    # Orphans are a warning, not an error: a half-built branch is a normal
    # intermediate state and blocking the save would fight the user.
    for node_id, node in by_id.items():
        definition = definitions.get(str(node.get("node_key")), {})
        if (definition.get("capability") or {}).get("is_trigger"):
            continue
        if incoming[node_id] == 0:
            result.issues.append(Issue(
                "NODE_ORPHAN",
                f"Bước '{node.get('name') or node_id}' chưa được nối vào luồng nào.",
                node_id=node_id, severity="WARNING"))

    if result.trigger_node_id and not outgoing.get(result.trigger_node_id):
        result.issues.append(Issue(
            "TRIGGER_NOT_CONNECTED",
            "Bước bắt đầu chưa nối tới bước nào.",
            node_id=result.trigger_node_id))

    return result


def _has_cycle(adjacency: dict[str, list[str]]) -> bool:
    WHITE, GREY, BLACK = 0, 1, 2
    colour = {node: WHITE for node in adjacency}

    def visit(node: str) -> bool:
        colour[node] = GREY
        for neighbour in adjacency.get(node, ()):
            state = colour.get(neighbour, WHITE)
            if state == GREY:
                return True
            if state == WHITE and visit(neighbour):
                return True
        colour[node] = BLACK
        return False

    return any(colour[node] == WHITE and visit(node) for node in list(adjacency))


def collect_credential_ids(graph: dict[str, Any], definitions: dict[str, dict]) -> set[str]:
    """Credential ids referenced by a graph, without running validation."""
    found: set[str] = set()
    for node in graph.get("nodes") or []:
        definition = definitions.get(str(node.get("node_key")), {})
        config = node.get("config") or {}
        for spec in (definition.get("config_schema") or {}).get("fields") or []:
            if spec.get("type") == "credential" and config.get(spec["key"]):
                found.add(str(config[spec["key"]]))
    return found


def trigger_of(graph: dict[str, Any], definitions: dict[str, dict]) -> dict[str, Any] | None:
    for node in graph.get("nodes") or []:
        definition = definitions.get(str(node.get("node_key")), {})
        if (definition.get("capability") or {}).get("is_trigger"):
            return node
    return None
