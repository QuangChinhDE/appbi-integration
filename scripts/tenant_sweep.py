"""Empty and retire the tenants an E2E run left behind.

An operations script, deliberately not a product feature. Deleting a tenant is
not something the product exposes -- a workspace holds a customer's audit trail
and their execution history, and "remove it entirely" is not an action anybody
should be one click away from. So test tenants are emptied and suspended, and
this is the tool that does it in bulk when a pile has built up.

    python scripts/tenant_sweep.py --base http://127.0.0.1:8010 --dry-run
    python scripts/tenant_sweep.py --base http://127.0.0.1:8010

Keeps, by name, whatever `--keep` lists; everything else created after `--since`
is swept. Both have deliberately conservative defaults, and `--dry-run` prints
the plan without touching anything -- because the failure mode of this script is
emptying a tenant somebody was using.

A suspended workspace refuses every request including the platform admin's, so
each one is reinstated, emptied, and suspended again.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request

for stream in (sys.stdout, sys.stderr):
    if hasattr(stream, "reconfigure"):
        stream.reconfigure(encoding="utf-8", errors="replace")


class Client:
    def __init__(self, base: str) -> None:
        self.base = base.rstrip("/")
        self.cookie: str | None = None

    def call(self, method: str, path: str, body=None):
        request = urllib.request.Request(
            f"{self.base}{path}", method=method,
            data=json.dumps(body).encode() if body is not None else None)
        request.add_header("Content-Type", "application/json")
        if self.cookie:
            request.add_header("Cookie", self.cookie)
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                raw = response.read().decode()
                if "set-cookie" in response.headers:
                    self.cookie = response.headers["set-cookie"].split(";")[0]
                return response.status, json.loads(raw) if raw else {}
        except urllib.error.HTTPError as error:
            raw = error.read().decode()
            return error.code, json.loads(raw) if raw else {}
        except urllib.error.URLError as error:
            return 0, {"error": str(error)}


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Empty and suspend leftover E2E tenants.")
    parser.add_argument("--base", default="http://127.0.0.1:8010")
    parser.add_argument("--email", default="admin@appbi.vn")
    parser.add_argument("--password", default=None,
                        help="the platform admin's current password")
    parser.add_argument(
        "--keep", nargs="*",
        default=["AppBI Automation"],
        help="workspace names to leave alone, by exact name")
    parser.add_argument(
        "--since", default="2000-01-01",
        help="only sweep tenants created on or after this ISO date")
    parser.add_argument("--dry-run", action="store_true",
                        help="print the plan and change nothing")
    args = parser.parse_args()

    if not args.password:
        print("--password is required: this script empties tenants, and it is "
              "not going to guess its way in.", file=sys.stderr)
        return 2

    client = Client(args.base)
    status, _ = client.call("POST", "/api/v1/auth/login",
                            {"email": args.email, "password": args.password})
    if status != 200:
        print(f"sign in failed: {status}", file=sys.stderr)
        return 1

    status, body = client.call("GET", "/api/v1/platform/workspaces")
    if status != 200:
        print(f"could not list workspaces: {status} {body}", file=sys.stderr)
        return 1
    rows = body.get("items", body) if isinstance(body, dict) else body

    keep = set(args.keep)
    home = next((r for r in rows if r["name"] in keep and r["status"] == "ACTIVE"),
                None)
    if home is None:
        print("None of the --keep workspaces is active. Refusing to run: the "
              "session has to end up somewhere reachable.", file=sys.stderr)
        return 1

    targets = [r for r in rows
               if r["name"] not in keep and r["created_at"] >= args.since]

    print(f"  {len(rows)} workspace(s); keeping {sorted(keep)}")
    print(f"  {len(targets)} to sweep (created on or after {args.since})")
    if args.dry_run:
        for row in targets[:20]:
            print(f"    would sweep  {row['status']:9} {row['name']}")
        if len(targets) > 20:
            print(f"    ... and {len(targets) - 20} more")
        print("\n  --dry-run: nothing was changed.")
        return 0

    print("-" * 62)
    removed = 0
    emptied = 0
    failed = 0

    for tenant in targets:
        if tenant["status"] != "ACTIVE":
            code, _ = client.call(
                f"PUT", f"/api/v1/platform/workspaces/{tenant['id']}/status",
                {"status": "ACTIVE"})
            if code not in (200, 204):
                failed += 1
                continue

        code, _ = client.call("POST", f"/api/v1/auth/switch-workspace/{tenant['id']}")
        if code == 200:
            code, listed = client.call("GET", "/api/v1/workflows?page_size=100")
            items = (listed.get("items") or []) if code == 200 else []
            for flow in items:
                client.call("POST", f"/api/v1/workflows/{flow['id']}/deactivate")
                code, _ = client.call("DELETE", f"/api/v1/workflows/{flow['id']}")
                if code in (200, 204):
                    removed += 1
            if items:
                emptied += 1
                print(f"  {tenant['name']}: removed {len(items)}")

        # Home before suspending, or the session is stranded in a workspace
        # that refuses it.
        client.call("POST", f"/api/v1/auth/switch-workspace/{home['id']}")
        client.call("PUT", f"/api/v1/platform/workspaces/{tenant['id']}/status",
                    {"status": "SUSPENDED"})

    print("-" * 62)
    print(f"  removed {removed} workflow(s) from {emptied} tenant(s); "
          f"{len(targets)} suspended")
    if failed:
        print(f"  {failed} tenant(s) could not be reinstated and were skipped")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
