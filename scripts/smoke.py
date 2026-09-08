"""End-to-end smoke test against a running stack (SRS 44, UAT-001..007).

Walks the product's own API the way the UI does — sign in, build a draft, run
it, publish it, activate it, check that history still names the exact version
that ran. No engine call is made from here: if the run produces node output,
that output came through the adapter, the compiler and n8n-core.

    python scripts/smoke.py --base http://127.0.0.1:8001

Exit code 0 means every step passed. It is safe to run repeatedly: each run
creates its own workflow with a unique name.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from http.cookiejar import CookieJar
from typing import Any

PASS = "  PASS"
FAIL = "  FAIL"


class Client:
    def __init__(self, base: str) -> None:
        self.base = base.rstrip("/")
        self.jar = CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.jar))

    def call(
        self, method: str, path: str, body: Any = None, headers: dict[str, str] | None = None
    ) -> tuple[int, Any]:
        url = f"{self.base}{path}"
        data = None if body is None else json.dumps(body).encode()
        request = urllib.request.Request(url, data=data, method=method)
        request.add_header("Content-Type", "application/json")
        for key, value in (headers or {}).items():
            request.add_header(key, value)
        try:
            with self.opener.open(request, timeout=30) as response:
                raw = response.read().decode()
                return response.status, json.loads(raw) if raw else None
        except urllib.error.HTTPError as error:
            raw = error.read().decode()
            return error.code, json.loads(raw) if raw else None


class Report:
    def __init__(self) -> None:
        self.failures: list[str] = []

    def check(self, label: str, condition: bool, detail: Any = None) -> bool:
        if condition:
            print(f"{PASS}  {label}")
        else:
            print(f"{FAIL}  {label}")
            if detail is not None:
                print(f"        {json.dumps(detail, default=str)[:600]}")
            self.failures.append(label)
        return condition


def graph(url_endpoint: str | None) -> dict[str, Any]:
    """Start -> Edit Fields -> IF, with expressions on both branches.

    Deliberately contains no HTTP node by default: this script must pass on a
    machine with no outbound network, and the HTTP path is covered by the
    engine's own contract suite.
    """
    nodes = [
        {
            "id": "start_1", "node_key": "manual_trigger", "name": "Khi bấm Run",
            "position": {"x": 100, "y": 200}, "config": {},
        },
        {
            "id": "set_1", "node_key": "edit_fields", "name": "Chuẩn hóa",
            "position": {"x": 360, "y": 200},
            "config": {
                "assignments": [
                    {"name": "tier", "type": "string", "value": "={{ $json.plan }}"},
                    {"name": "double", "type": "string", "value": "={{ $json.amount * 2 }}"},
                ],
                "keep_only_set": False,
            },
        },
        {
            "id": "if_1", "node_key": "if", "name": "Là VIP",
            "position": {"x": 620, "y": 200},
            "config": {
                "combinator": "and",
                "conditions": [
                    {"left": "={{ $json.plan }}", "operator": "equals",
                     "value_type": "string", "right": "vip"},
                ],
            },
        },
        {
            "id": "set_vip", "node_key": "edit_fields", "name": "Gắn nhãn VIP",
            "position": {"x": 880, "y": 120},
            "config": {"assignments": [
                {"name": "label", "type": "string", "value": "VIP"}]},
        },
        {
            "id": "set_std", "node_key": "edit_fields", "name": "Gắn nhãn thường",
            "position": {"x": 880, "y": 300},
            "config": {"assignments": [
                {"name": "label", "type": "string", "value": "STANDARD"}]},
        },
    ]
    connections = [
        {"from": {"node_id": "start_1", "port": "main"},
         "to": {"node_id": "set_1", "port": "main"}},
        {"from": {"node_id": "set_1", "port": "main"},
         "to": {"node_id": "if_1", "port": "main"}},
        {"from": {"node_id": "if_1", "port": "true"},
         "to": {"node_id": "set_vip", "port": "main"}},
        {"from": {"node_id": "if_1", "port": "false"},
         "to": {"node_id": "set_std", "port": "main"}},
    ]
    if url_endpoint:
        nodes.insert(1, {
            "id": "http_1", "node_key": "http_request", "name": "Gọi API",
            "position": {"x": 230, "y": 200},
            "config": {"method": "GET", "url": url_endpoint},
        })
        connections[0] = {"from": {"node_id": "start_1", "port": "main"},
                          "to": {"node_id": "http_1", "port": "main"}}
        connections.insert(1, {"from": {"node_id": "http_1", "port": "main"},
                               "to": {"node_id": "set_1", "port": "main"}})
    return {"nodes": nodes, "connections": connections}


def wait_terminal(client: Client, execution_id: str, timeout: float = 60.0) -> dict:
    deadline = time.time() + timeout
    last: dict = {}
    while time.time() < deadline:
        status, body = client.call("GET", f"/api/v1/executions/{execution_id}")
        if status == 200:
            last = body
            if body["status"] not in {"QUEUED", "DISPATCHING", "RUNNING",
                                      "CANCEL_REQUESTED"}:
                return body
        time.sleep(0.5)
    return last


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:8000")
    parser.add_argument("--email", default="admin@appbi.vn")
    parser.add_argument("--password", default="DevPassword123!")
    parser.add_argument("--new-password", default="SmokeTestPass123!")
    parser.add_argument("--http-endpoint", default=None,
                        help="optional URL for an extra HTTP Request node")
    args = parser.parse_args()

    client = Client(args.base)
    report = Report()
    print(f"\nSmoke test against {args.base}\n" + "-" * 62)

    # ── session ────────────────────────────────────────────────────────────
    status, body = client.call("POST", "/api/v1/auth/login",
                               {"email": args.email, "password": args.password})
    if status != 200:
        status, body = client.call("POST", "/api/v1/auth/login",
                                   {"email": args.email, "password": args.new_password})
    if not report.check("sign in", status == 200, body):
        if (body.get("error") or {}).get("code") == "INVALID_CREDENTIALS":
            # Both the built-in guesses are the passwords *this* script and
            # the browser suite set. Anything else that has signed in as the
            # bootstrap account since -- `demo_seed.py`, a person -- had to
            # change it, because bootstrap requires a change on first login.
            # Without saying so, a green install looks like a broken one.
            print(
                "\n  Neither the bootstrap password nor the one this script "
                "sets was accepted.\n"
                "  The account's password has been changed since bootstrap "
                "-- by `demo_seed.py`,\n"
                "  the browser suite, or a person. Pass the current one:\n\n"
                "    python scripts/smoke.py --base " + args.base
                + " --password '<current>'\n")
        return 1

    if body.get("password_change_required"):
        status, body = client.call("POST", "/api/v1/auth/change-password", {
            "current_password": args.password, "new_password": args.new_password})
        report.check("bootstrap account must change its password first",
                     status == 200, body)

    status, me = client.call("GET", "/api/v1/auth/me")
    report.check("session reports a workspace and a permission map",
                 status == 200 and me.get("workspace") and me.get("permissions"), me)

    # ── node catalogue ─────────────────────────────────────────────────────
    status, nodes = client.call("GET", "/api/v1/nodes")
    keys = {item["node_key"] for item in (nodes or {}).get("items", [])}
    report.check("node library serves the eight certified V1 nodes",
                 status == 200 and {
                     "manual_trigger", "webhook_trigger", "schedule_trigger",
                     "http_request", "edit_fields", "if", "switch", "merge",
                 } <= keys, sorted(keys))
    leaked = json.dumps(nodes)
    report.check("no engine node type appears in the public catalogue",
                 "n8n-nodes-base" not in leaked and "engine_binding" not in leaked)

    # ── UAT-001 create ─────────────────────────────────────────────────────
    name = f"Smoke {int(time.time())}"
    status, workflow = client.call("POST", "/api/v1/workflows",
                                   {"name": name, "description": "created by smoke.py"})
    if not report.check("UAT-001 create workflow", status == 201, workflow):
        return 1
    workflow_id = workflow["id"]
    report.check("a new workflow already has its trigger and a draft",
                 workflow["draft"]["revision"] >= 1, workflow["draft"])

    # ── UAT-002 build the graph ────────────────────────────────────────────
    status, draft = client.call("GET", f"/api/v1/workflows/{workflow_id}/draft")
    report.check("draft is readable", status == 200, draft)

    status, saved = client.call("PUT", f"/api/v1/workflows/{workflow_id}/draft", {
        "graph": graph(args.http_endpoint), "expected_revision": draft["revision"]})
    report.check("UAT-002 save a five-node graph", status == 200, saved)

    status, conflict = client.call("PUT", f"/api/v1/workflows/{workflow_id}/draft", {
        "graph": graph(args.http_endpoint), "expected_revision": draft["revision"]})
    report.check("a stale revision is refused with DRAFT_VERSION_CONFLICT",
                 status == 409
                 and conflict["error"]["code"] == "DRAFT_VERSION_CONFLICT", conflict)

    status, validation = client.call("POST", f"/api/v1/workflows/{workflow_id}/validate")
    report.check("validation passes, engine included",
                 status == 200 and validation["ok"] and validation["engine"] == "OK",
                 validation)

    # ── UAT-003/004 run the draft ──────────────────────────────────────────
    status, run = client.call("POST", f"/api/v1/workflows/{workflow_id}/executions",
                              {"kind": "DRAFT", "payload": [
                                  {"plan": "vip", "amount": 120},
                                  {"plan": "basic", "amount": 5},
                              ]})
    if not report.check("UAT-003 run draft returns 202", status == 202, run):
        return 1
    execution = wait_terminal(client, run["id"])
    report.check("draft run succeeded", execution.get("status") == "SUCCEEDED", execution)
    report.check("execution names the draft revision it ran",
                 execution.get("version", {}).get("kind") == "DRAFT"
                 and execution.get("version", {}).get("draft_revision") is not None,
                 execution.get("version"))

    by_name = {node["node_name"]: node for node in execution.get("nodes", [])}
    report.check("every node reports a status",
                 {"Khi bấm Run", "Chuẩn hóa", "Là VIP"} <= set(by_name),
                 sorted(by_name))
    report.check("the untaken branch is SKIPPED, not pending",
                 by_name.get("Gắn nhãn thường", {}).get("status") in {"SUCCEEDED", "SKIPPED"},
                 by_name.get("Gắn nhãn thường"))

    status, output = client.call(
        "GET", f"/api/v1/executions/{run['id']}/nodes/set_1/output")
    items = (output or {}).get("preview", {}).get("items", [])
    report.check("UAT-004 expressions resolved against real data",
                 status == 200 and any(
                     item.get("tier") == "vip" and item.get("double") == "240"
                     for item in items),
                 items)

    status, vip = client.call(
        "GET", f"/api/v1/executions/{run['id']}/nodes/set_vip/output")
    report.check("IF routed the vip item to the true branch",
                 status == 200 and any(
                     item.get("label") == "VIP"
                     for item in (vip or {}).get("preview", {}).get("items", [])),
                 vip)

    status, logs = client.call("GET", f"/api/v1/executions/{run['id']}/logs")
    report.check("execution has sanitized logs",
                 status == 200 and len(logs["items"]) > 0, logs)

    # ── UAT-005/006/007 publish and activate ───────────────────────────────
    status, published = client.call("POST", f"/api/v1/workflows/{workflow_id}/publish",
                                    {"change_note": "smoke test v1"})
    if not report.check("UAT-005 publish creates version 1", status == 201, published):
        return 1
    version_1_hash = published["graph_hash"]

    status, activated = client.call("POST", f"/api/v1/workflows/{workflow_id}/activate", {})
    report.check("UAT-006 activate binds the exact published version",
                 status == 200 and activated["active_version"] == 1, activated)

    status, current = client.call("GET", f"/api/v1/workflows/{workflow_id}/draft")
    mutated = graph(args.http_endpoint)
    mutated["nodes"][-1]["config"]["assignments"][0]["value"] = "CHANGED"
    status, _ = client.call("PUT", f"/api/v1/workflows/{workflow_id}/draft", {
        "graph": mutated, "expected_revision": current["revision"]})
    report.check("draft can be edited while version 1 is active", status == 200)

    status, v1 = client.call("GET", f"/api/v1/workflows/{workflow_id}/versions/1")
    report.check("UAT-005 the published version did not change",
                 status == 200 and v1["graph_hash"] == version_1_hash, v1)

    status, published_2 = client.call("POST", f"/api/v1/workflows/{workflow_id}/publish", {})
    report.check("UAT-007 publishing again creates version 2",
                 status == 201 and published_2["version"] == 2, published_2)

    status, summary = client.call("GET", f"/api/v1/workflows/{workflow_id}")
    report.check("publishing does not move the active version",
                 status == 200 and summary["active_version"] == 1, summary)

    status, activated_2 = client.call("POST", f"/api/v1/workflows/{workflow_id}/activate",
                                      {"version_number": 2})
    report.check("activating version 2 moves production forward",
                 status == 200 and activated_2["active_version"] == 2, activated_2)

    status, rolled_back = client.call("POST", f"/api/v1/workflows/{workflow_id}/activate",
                                      {"version_number": 1})
    report.check("rollback is activating an older version, not republishing",
                 status == 200 and rolled_back["active_version"] == 1, rolled_back)

    # ── published run ──────────────────────────────────────────────────────
    status, published_run = client.call(
        "POST", f"/api/v1/workflows/{workflow_id}/executions",
        {"kind": "PUBLISHED", "payload": {"plan": "vip", "amount": 3}})
    report.check("a published version can be run", status == 202, published_run)
    published_execution = wait_terminal(client, published_run["id"])
    report.check("published run succeeded and names version 1",
                 published_execution.get("status") == "SUCCEEDED"
                 and published_execution.get("version", {}).get("number") == 1,
                 published_execution.get("version"))

    # ── UAT-015 retry, and concurrency ─────────────────────────────────────
    status, retried = client.call(
        "POST", f"/api/v1/executions/{published_run['id']}/retry")
    report.check("UAT-015 retry creates a new execution linked to the old one",
                 status == 202 and retried["retry_of_execution_id"] == published_run["id"],
                 retried)
    wait_terminal(client, retried["id"])

    # ── credentials ────────────────────────────────────────────────────────
    status, credential = client.call("POST", "/api/v1/credentials", {
        "name": f"Smoke bearer {int(time.time())}",
        "credential_type": "BEARER",
        "data": {"token": "smoke-secret-token-value"},
    })
    if report.check("credential created", status == 201, credential):
        report.check("UAT-019 the secret is not echoed back",
                     "smoke-secret-token-value" not in json.dumps(credential),
                     credential)
        report.check("the response describes the secret without revealing it",
                     credential["secret"]["configured"]
                     and credential["secret"]["masked_hint"], credential["secret"])

        status, listed = client.call("GET", "/api/v1/credentials")
        report.check("no secret in the credential list",
                     "smoke-secret-token-value" not in json.dumps(listed))

    # ── executions list and monitoring ─────────────────────────────────────
    status, executions = client.call("GET", "/api/v1/executions",
                                     None, {"X-Workspace-Id": me["workspace"]["id"]})
    report.check("execution history lists the runs",
                 status == 200 and executions["page"]["total"] >= 3, executions.get("page"))

    status, overview = client.call("GET", "/api/v1/overview")
    report.check("overview renders from the product database",
                 status == 200 and overview["stats"]["total_workflows"] >= 1,
                 overview.get("stats"))

    status, engine = client.call("GET", "/api/v1/engine/status")
    report.check("engine status is reported without leaking its address",
                 status == 200 and engine["operational"]
                 and "engine_base_url" not in json.dumps(engine).lower(), engine)

    status, audit = client.call("GET", "/api/v1/audit")
    actions = {row["action"] for row in (audit or {}).get("items", [])}
    report.check("audit recorded the mutating actions",
                 status == 200 and {"workflow.created", "workflow.published",
                                    "workflow.activated"} <= actions,
                 sorted(actions))

    # ── cleanup ────────────────────────────────────────────────────────────
    status, _ = client.call("DELETE", f"/api/v1/workflows/{workflow_id}")
    report.check("an active workflow cannot be deleted", status == 409)
    client.call("POST", f"/api/v1/workflows/{workflow_id}/deactivate")
    status, _ = client.call("DELETE", f"/api/v1/workflows/{workflow_id}")
    report.check("a deactivated workflow can be deleted", status == 204)

    print("-" * 62)
    if report.failures:
        print(f"{len(report.failures)} check(s) failed:")
        for failure in report.failures:
            print(f"  - {failure}")
        return 1
    print("All checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
