"""Give a fresh deployment something to look at, and something to try.

    python scripts/demo_seed.py --base http://127.0.0.1:8010

Provisions one tenant and builds seven workflows that between them use all
eight certified nodes, then runs the ones that can be run so there is real
execution data behind every screen.

Deliberately a separate script rather than part of `bootstrap`: a real first
deploy must come up empty. This is for looking at the product, and for finding
out whether the engine does what the canvas says it does -- the HTTP steps call
real public APIs, so a green node means a request genuinely left the machine.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request

# Everything this script prints is Vietnamese, and it is run on Windows, where
# the console is cp1252 unless somebody has changed it. Without this the script
# dies partway through -- after creating half the demos -- on a print, which is
# an absurd way to lose a seed. Encoding is this script's problem, not the
# operator's.
for stream in (sys.stdout, sys.stderr):
    if hasattr(stream, "reconfigure"):
        stream.reconfigure(encoding="utf-8", errors="replace")


class Client:
    def __init__(self, base: str) -> None:
        self.base = base.rstrip("/")
        self.cookie: str | None = None
        self.workspace: str | None = None

    def call(self, method: str, path: str, body=None, headers=None):
        request = urllib.request.Request(
            f"{self.base}{path}", method=method,
            data=json.dumps(body).encode() if body is not None else None)
        request.add_header("Content-Type", "application/json")
        if self.cookie:
            request.add_header("Cookie", self.cookie)
        if self.workspace:
            request.add_header("X-Workspace-Id", self.workspace)
        for key, value in (headers or {}).items():
            request.add_header(key, value)
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                raw = response.read().decode() or "{}"
                if "Set-Cookie" in response.headers:
                    self.cookie = response.headers["Set-Cookie"].split(";")[0]
                return response.status, json.loads(raw)
        except urllib.error.HTTPError as error:
            raw = error.read().decode() or "{}"
            try:
                return error.code, json.loads(raw)
            except json.JSONDecodeError:
                return error.code, {"raw": raw[:300]}


def node(node_id, key, name, x, y, **config):
    return {"id": node_id, "node_key": key, "name": name,
            "position": {"x": x, "y": y}, "config": config}


def link(source, target, port="main", to_port="main"):
    return {"from": {"node_id": source, "port": port},
            "to": {"node_id": target, "port": to_port}}


def assign(*pairs):
    return [{"name": name, "type": "string", "value": value}
            for name, value in pairs]


TERMINAL = {"SUCCEEDED", "FAILED", "TIMED_OUT", "CANCELLED",
            "ENGINE_INTERRUPTED", "FAILED_TO_START"}


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed a demonstration tenant.")
    parser.add_argument("--base", default="http://127.0.0.1:8010")
    parser.add_argument("--ui", default=None,
                        help="the frontend's origin, for the summary")
    parser.add_argument("--admin-email", default="admin@appbi.vn")
    parser.add_argument("--admin-password", default="SmokeTestPass123!")
    parser.add_argument("--admin-new-password", default="E2EOwnerPassword123")
    parser.add_argument("--tenant-name", default="Công ty Demo")
    parser.add_argument("--owner-email", default="demo@example.com")
    parser.add_argument("--owner-password", default="DemoPassword123")
    args = parser.parse_args()

    ui = args.ui or args.base.replace(":8010", ":3010").replace(":8000", ":3000")
    client = Client(args.base)

    status, body = client.call("POST", "/api/v1/auth/login", {
        "email": args.admin_email, "password": args.admin_password})
    if status != 200:
        status, body = client.call("POST", "/api/v1/auth/login", {
            "email": args.admin_email, "password": args.admin_new_password})
    if status != 200:
        print(f"could not sign in as {args.admin_email}: {body}")
        return 1
    if body.get("password_change_required"):
        client.call("POST", "/api/v1/auth/change-password", {
            "current_password": args.admin_password,
            "new_password": args.admin_new_password})

    status, tenant = client.call("POST", "/api/v1/platform/workspaces", {
        "name": args.tenant_name,
        "owner_email": args.owner_email,
        "owner_password": args.owner_password,
        "max_concurrent_executions": 10,
    })
    if status != 201:
        code = (tenant.get("error") or {}).get("code")
        if code == "WORKSPACE_SLUG_TAKEN":
            # Almost always a second run of this script. Say so, and say the
            # one thing that fixes it, rather than printing an error envelope
            # and leaving the operator to work out that the tenant is stale.
            print(
                f"A tenant named '{args.tenant_name}' already exists.\n\n"
                "This script builds a demo from nothing, so it will not seed "
                "into one that is already there --\n"
                "the owner's password may have been changed since, and a "
                "half-seeded demo is worse than none. Deleting a tenant is "
                "not something the product exposes, on purpose, so either "
                "seed a second one:\n\n"
                "  python scripts/demo_seed.py --tenant-name 'Demo 2' "
                "--owner-email demo2@example.com\n\n"
                "or start from an empty database:\n\n"
                "  docker compose down -v && docker compose up -d --wait",
                file=sys.stderr)
            return 1
        print(f"could not provision the tenant: {tenant}", file=sys.stderr)
        return 1
    client.workspace = tenant["id"]
    print(f"  tenant: {tenant['name']} ({tenant['slug']})\n")

    _, credential = client.call("POST", "/api/v1/credentials", {
        "name": "Token API nội bộ",
        "credential_type": "BEARER",
        "data": {"token": "demo-token-not-a-real-secret"},
    })

    def build(name, description, nodes, connections, trigger="manual_trigger"):
        _, workflow = client.call("POST", "/api/v1/workflows", {
            "name": name, "description": description,
            "trigger_node_key": trigger})
        if "id" not in workflow:
            print(f"  ! could not create {name}: {workflow}")
            return None
        _, draft = client.call(
            "GET", f"/api/v1/workflows/{workflow['id']}/draft")
        status, saved = client.call(
            "PUT", f"/api/v1/workflows/{workflow['id']}/draft", {
                "expected_revision": draft["revision"],
                "graph": {"nodes": nodes, "connections": connections}})
        if status != 200:
            print(f"  ! could not save {name}: {saved}")
        return workflow["id"]

    def run(workflow_id, payload, label):
        status, execution = client.call(
            "POST", f"/api/v1/workflows/{workflow_id}/executions",
            {"kind": "DRAFT", "payload": payload})
        if status != 202:
            print(f"    {label}: không chạy được ({execution})")
            return
        for _ in range(120):
            _, detail = client.call(
                "GET", f"/api/v1/executions/{execution['id']}")
            if detail.get("status") in TERMINAL:
                mark = "OK  " if detail["status"] == "SUCCEEDED" else "FAIL"
                extra = ""
                if detail.get("error_summary"):
                    extra = f"  <- {detail['error_summary'][:70]}"
                print(f"    {mark} {label}: {detail['status']}{extra}")
                return
            time.sleep(0.5)
        print(f"    ??  {label}: vẫn đang chạy")

    def publish_and_activate(workflow_id, note):
        status, _ = client.call(
            "POST", f"/api/v1/workflows/{workflow_id}/publish",
            {"change_note": note})
        if status == 201:
            client.call("POST", f"/api/v1/workflows/{workflow_id}/activate", {})

    # ── 1. IF: hai nhánh rồi gộp lại (if + merge + edit_fields) ────────────
    print("  1/7  Duyệt đơn hàng — IF chia hai nhánh rồi Merge gộp lại")
    approval = build(
        "Duyệt đơn hàng theo giá trị",
        "Đơn trên 5 triệu cần duyệt tay, dưới thì tự động. Hai nhánh gộp lại "
        "bằng bước Merge.",
        [
            node("start_1", "manual_trigger", "Khi bấm Run", 60, 240),
            node("norm", "edit_fields", "Chuẩn hoá đơn", 300, 240,
                 assignments=[
                     {"name": "ma_don", "type": "string",
                      "value": "={{ $json.order_id }}"},
                     {"name": "gia_tri", "type": "number",
                      "value": "={{ $json.amount }}"},
                     {"name": "khach", "type": "string",
                      "value": "={{ $json.customer }}"},
                 ], keep_only_set=False),
            node("gate", "if", "Trên 5 triệu?", 560, 240,
                 combinator="and",
                 conditions=[{"left": "={{ $json.amount }}", "operator": "gt",
                              "value_type": "number", "right": "5000000"}]),
            node("manual_ok", "edit_fields", "Chờ duyệt tay", 820, 130,
                 assignments=assign(("trang_thai", "cho_duyet"),
                                    ("nguoi_xu_ly", "quan_ly"))),
            node("auto_ok", "edit_fields", "Tự động duyệt", 820, 350,
                 assignments=assign(("trang_thai", "da_duyet"),
                                    ("nguoi_xu_ly", "he_thong"))),
            node("gop", "merge", "Gộp kết quả", 1080, 240, mode="APPEND"),
            node("ket", "edit_fields", "Kết luận", 1320, 240,
                 assignments=[
                     {"name": "tom_tat", "type": "string",
                      "value": "={{ $json.ma_don }} - {{ $json.trang_thai }}"},
                 ], keep_only_set=False),
        ],
        [link("start_1", "norm"), link("norm", "gate"),
         link("gate", "manual_ok", "true"), link("gate", "auto_ok", "false"),
         link("manual_ok", "gop", "main", "input_1"),
         link("auto_ok", "gop", "main", "input_2"),
         link("gop", "ket")],
    )
    if approval:
        run(approval, [{"order_id": "DH-1001", "amount": 8500000,
                        "customer": "Công ty A"}], "đơn 8.5tr (nhánh duyệt tay)")
        run(approval, [{"order_id": "DH-1002", "amount": 1200000,
                        "customer": "Công ty B"}], "đơn 1.2tr (nhánh tự động)")

    # ── 2. SWITCH: nhiều nhánh có tên + nhánh mặc định ─────────────────────
    print("  2/7  Phân loại ticket — Switch bốn nhánh, có nhánh mặc định")
    tickets = build(
        "Phân loại ticket hỗ trợ",
        "Switch chia theo mức độ ưu tiên, mọi giá trị lạ rơi vào nhánh 'other'.",
        [
            node("start_1", "manual_trigger", "Khi bấm Run", 60, 260),
            node("sw", "switch", "Theo mức độ", 320, 260,
                 value="={{ $json.priority }}",
                 rules=[
                     {"output_key": "khan_cap", "operator": "equals",
                      "value_type": "string", "compare_to": "urgent"},
                     {"output_key": "cao", "operator": "equals",
                      "value_type": "string", "compare_to": "high"},
                     {"output_key": "thuong", "operator": "equals",
                      "value_type": "string", "compare_to": "normal"},
                 ],
                 fallback="EXTRA_OUTPUT"),
            node("p1", "edit_fields", "Gọi trực page", 620, 60,
                 assignments=assign(("sla", "15 phút"), ("kenh", "goi_dien"))),
            node("p2", "edit_fields", "Vào hàng đợi ưu tiên", 620, 200,
                 assignments=assign(("sla", "2 giờ"), ("kenh", "chat"))),
            node("p3", "edit_fields", "Hàng đợi thường", 620, 340,
                 assignments=assign(("sla", "24 giờ"), ("kenh", "email"))),
            node("p4", "edit_fields", "Cần phân loại lại", 620, 480,
                 assignments=assign(("sla", "chưa xác định"),
                                    ("kenh", "cho_xu_ly"))),
        ],
        [link("start_1", "sw"),
         link("sw", "p1", "khan_cap"), link("sw", "p2", "cao"),
         link("sw", "p3", "thuong"), link("sw", "p4", "other")],
    )
    if tickets:
        run(tickets, [{"ticket": "T-1", "priority": "urgent"}], "urgent")
        run(tickets, [{"ticket": "T-2", "priority": "normal"}], "normal")
        run(tickets, [{"ticket": "T-3", "priority": "khong-biet"}],
            "giá trị lạ (rơi vào 'other')")

    # ── 3. HTTP thật + biểu thức trên dữ liệu trả về ───────────────────────
    print("  3/7  Gọi API thật — HTTP Request tới jsonplaceholder rồi xử lý")
    fetch = build(
        "Lấy bài viết từ API và phân loại",
        "Gọi một API công khai thật, rồi dùng biểu thức trên dữ liệu trả về. "
        "Bước xanh nghĩa là request đã thực sự đi ra ngoài.",
        [
            node("start_1", "manual_trigger", "Khi bấm Run", 60, 240),
            node("http_1", "http_request", "Lấy bài viết", 300, 240,
                 method="GET",
                 url="https://jsonplaceholder.typicode.com/posts/1",
                 body_mode="NONE", response_format="AUTO",
                 timeout_ms=20000, continue_on_error=False),
            node("do", "edit_fields", "Đo độ dài", 560, 240,
                 assignments=[
                     {"name": "tieu_de", "type": "string",
                      "value": "={{ $json.title }}"},
                     {"name": "so_ky_tu", "type": "number",
                      "value": "={{ $json.body.length }}"},
                     {"name": "so_tu", "type": "number",
                      "value": "={{ $json.body.split(' ').length }}"},
                 ], keep_only_set=False),
            node("gate", "if", "Bài dài?", 820, 240,
                 combinator="and",
                 conditions=[{"left": "={{ $json.so_ky_tu }}", "operator": "gt",
                              "value_type": "number", "right": "100"}]),
            node("dai", "edit_fields", "Cần tóm tắt", 1080, 150,
                 assignments=assign(("xu_ly", "tom_tat"))),
            node("ngan", "edit_fields", "Đăng nguyên văn", 1080, 340,
                 assignments=assign(("xu_ly", "dang_nguyen_van"))),
        ],
        [link("start_1", "http_1"), link("http_1", "do"), link("do", "gate"),
         link("gate", "dai", "true"), link("gate", "ngan", "false")],
    )
    if fetch:
        run(fetch, [{}], "gọi jsonplaceholder")

    # ── 4. MERGE hai nguồn HTTP song song ──────────────────────────────────
    print("  4/7  Gộp hai nguồn — hai HTTP Request song song rồi Merge")
    combine = build(
        "Gộp dữ liệu từ hai nguồn",
        "Hai lời gọi API chạy song song, Merge ghép theo vị trí.",
        [
            node("start_1", "manual_trigger", "Khi bấm Run", 60, 240),
            node("a", "http_request", "Nguồn A: người dùng", 320, 130,
                 method="GET",
                 url="https://jsonplaceholder.typicode.com/users/1",
                 body_mode="NONE", timeout_ms=20000),
            node("b", "http_request", "Nguồn B: bài viết", 320, 360,
                 method="GET",
                 url="https://jsonplaceholder.typicode.com/posts/1",
                 body_mode="NONE", timeout_ms=20000),
            node("gop", "merge", "Ghép theo vị trí", 620, 240,
                 mode="COMBINE_BY_POSITION"),
            node("out", "edit_fields", "Kết quả", 880, 240,
                 assignments=[
                     {"name": "nguoi_dung", "type": "string",
                      "value": "={{ $json.name }}"},
                     {"name": "bai_viet", "type": "string",
                      "value": "={{ $json.title }}"},
                 ], keep_only_set=False),
        ],
        [link("start_1", "a"), link("start_1", "b"),
         link("a", "gop", "main", "input_1"),
         link("b", "gop", "main", "input_2"),
         link("gop", "out")],
    )
    if combine:
        run(combine, [{}], "gộp hai nguồn")

    # ── 5. Webhook, publish và bật ─────────────────────────────────────────
    print("  5/7  Webhook — publish và bật, có URL để gọi thật")
    hook = build(
        "Nhận đơn hàng từ website",
        "Webhook nhận đơn mới. URL có ngay từ lúc tạo, ký HMAC-SHA256.",
        [
            node("start_1", "webhook_trigger", "Khi có request", 60, 240,
                 method="POST", auth_mode="HEADER_SIGNATURE",
                 allowed_content_type="application/json"),
            node("ghi", "edit_fields", "Ghi nhận đơn", 320, 240,
                 assignments=[
                     {"name": "ma_don", "type": "string",
                      "value": "={{ $json.order_id }}"},
                     {"name": "nhan_luc", "type": "string",
                      "value": "={{ $now }}"},
                     {"name": "trang_thai", "type": "string",
                      "value": "da_nhan"},
                 ], keep_only_set=False),
            node("gate", "if", "Đơn gấp?", 580, 240,
                 combinator="and",
                 conditions=[{"left": "={{ $json.rush }}", "operator": "equals",
                              "value_type": "boolean", "right": "true"}]),
            node("gap", "edit_fields", "Đẩy lên đầu", 840, 150,
                 assignments=assign(("uu_tien", "cao"))),
            node("thuong", "edit_fields", "Xếp hàng bình thường", 840, 340,
                 assignments=assign(("uu_tien", "thuong"))),
        ],
        [link("start_1", "ghi"), link("ghi", "gate"),
         link("gate", "gap", "true"), link("gate", "thuong", "false")],
        trigger="webhook_trigger",
    )
    hook_url = None
    if hook:
        publish_and_activate(hook, "Bản đầu tiên")
        _, trigger = client.call("GET", f"/api/v1/workflows/{hook}/trigger")
        hook_url = (trigger.get("webhook") or {}).get("url")
        print(f"    URL: {hook_url}")

    # ── 6. Lịch chạy ───────────────────────────────────────────────────────
    print("  6/7  Lịch chạy — mỗi giờ, kèm ba lần chạy kế tiếp")
    scheduled = build(
        "Kiểm tra sức khoẻ dịch vụ mỗi giờ",
        "Gọi một endpoint kiểm tra mỗi giờ và ghi lại kết quả.",
        [
            node("start_1", "schedule_trigger", "Theo lịch", 60, 240,
                 schedule_type="INTERVAL", interval_seconds=3600,
                 timezone="Asia/Bangkok", overlap_policy="SKIP_IF_RUNNING"),
            node("ping", "http_request", "Ping dịch vụ", 320, 240,
                 method="GET", url="https://httpbin.org/status/200",
                 body_mode="NONE", timeout_ms=15000, continue_on_error=True),
            node("ghi", "edit_fields", "Ghi nhận", 580, 240,
                 assignments=assign(("kiem_tra", "hoan_tat"))),
        ],
        [link("start_1", "ping"), link("ping", "ghi")],
        trigger="schedule_trigger",
    )
    if scheduled:
        publish_and_activate(scheduled, "Bản đầu tiên")
        run(scheduled, [{}], "chạy thử ngay (không đợi tới giờ)")

    # ── 7. Một cái hỏng, để xem sản phẩm giải thích lỗi thế nào ────────────
    print("  7/7  Một workflow lỗi — để xem màn hình lỗi nói gì")
    broken = build(
        "Gọi API đối tác (đang lỗi)",
        "Ví dụ về một lần chạy thất bại và cách sản phẩm giải thích nguyên nhân.",
        [
            node("start_1", "manual_trigger", "Khi bấm Run", 60, 240),
            node("http_1", "http_request", "Gọi API đối tác", 320, 240,
                 method="GET", url="https://api.invalid.example/orders",
                 body_mode="NONE", timeout_ms=8000, continue_on_error=False,
                 credential_id=credential.get("id")),
        ],
        [link("start_1", "http_1")],
    )
    if broken:
        run(broken, [{}], "địa chỉ không tồn tại")

    # ── một bản nháp dở, vì workspace thật đều có ──────────────────────────
    build(
        "Đồng bộ khách hàng sang CRM (đang làm)",
        "Bản nháp chưa hoàn thiện — bước HTTP chưa điền URL.",
        [
            node("start_1", "manual_trigger", "Khi bấm Run", 60, 240),
            node("http_1", "http_request", "Đẩy sang CRM", 320, 240,
                 method="POST", body_mode="JSON"),
        ],
        [link("start_1", "http_1")],
    )

    _, listed = client.call("GET", "/api/v1/executions?page_size=100")
    total = len(listed.get("items", []))
    ok = sum(1 for i in listed.get("items", []) if i["status"] == "SUCCEEDED")

    print(f"""
{'=' * 70}
  Sẵn sàng dùng thử

  Giao diện     {ui}
  Đăng nhập     {args.owner_email} / {args.owner_password}
                (đổi mật khẩu ở lần đăng nhập đầu tiên)

  Quản trị nền tảng
                {args.admin_email} / {args.admin_new_password}

  Đã dựng       8 workflow, {total} lần chạy ({ok} thành công)
                dùng đủ cả 8 loại bước được chứng nhận

  Gợi ý xem
    - "Duyệt đơn hàng theo giá trị": mở một lần chạy, xem nhánh không đi
      qua bị làm mờ, nhánh đi qua có số item
    - "Gọi API thật": bấm vào bước HTTP trong panel dưới để xem đúng JSON
      mà jsonplaceholder trả về
    - "Phân loại ticket": ba lần chạy đi ba nhánh khác nhau của Switch
    - "Gọi API đối tác (đang lỗi)": màn hình lỗi mở sẵn tab Lỗi
    - "Nhận đơn hàng từ website": copy URL webhook trong panel cấu hình
{'=' * 70}
""")
    if hook_url:
        print(f"  Gọi thử webhook (chữ ký HMAC bắt buộc):\n"
              f"    python scripts/demo_webhook.py --url {hook_url}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
