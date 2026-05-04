"""
Permission test suite: 4 test users with different permission levels.
Each user gets its own httpx client to avoid cookie interference.
"""
import asyncio
from httpx import AsyncClient

BASE = "http://localhost:8000"
ADMIN_PASS = "Admin123!"
TEST_PASS = "Test1234!"

failures = []

def check(name, condition, detail=""):
    if condition:
        print(f"  PASS: {name}")
    else:
        msg = f"  FAIL: {name} -- {detail}"
        print(msg)
        failures.append(msg)


async def login(email, password):
    """Login and return a NEW client with Bearer token only (no cookie)."""
    c = AsyncClient(base_url=BASE)
    r = await c.post("/api/auth/login", json={"email": email, "password": password})
    if r.status_code != 200:
        await c.aclose()
        raise Exception(f"Login failed for {email}: {r.status_code} {r.text}")
    token = r.json()["access_token"]
    c.cookies.clear()
    c.headers["Authorization"] = f"Bearer {token}"
    return c


async def test():
    # === Admin login ===
    admin = await login("admin@appbi.local", ADMIN_PASS)
    print("Admin logged in\n")

    # Known IDs
    WORKFLOW_CRED = "be04a1b7-d18b-49d8-9999-e5e3e3375cda"
    GDRIVE_CRED   = "46dcd984-e1d6-424f-8723-fbd73083518a"
    BACKUP_FLOW   = "cf95c321-5088-40b1-a12e-ae823d074eb7"
    FAKE_CRED     = "00000000-0000-0000-0000-000000000099"

    # === Create / find test users ===
    print("Setting up test users...")
    users_cfg = [
        ("test-editor@appbi.local",   "Test Editor",       {"apps":"edit","pipeline":"edit","backup":"edit"}),
        ("test-viewer@appbi.local",   "Test Viewer",       {"apps":"view","pipeline":"view","backup":"view"}),
        ("test-no-apps@appbi.local",  "Test NoApps",       {"apps":"none","pipeline":"view","backup":"view"}),
        ("test-pipeline@appbi.local", "Test PipelineOnly", {"apps":"view","pipeline":"edit","backup":"none"}),
    ]
    user_ids = {}
    for email, name, perms in users_cfg:
        # Create
        r = await admin.post("/api/users/", json={
            "email": email, "full_name": name,
            "password": TEST_PASS, "auth_provider": "password",
        })
        if r.status_code == 201:
            uid = r.json()["id"]
        elif r.status_code == 409:
            r2 = await admin.get("/api/users/")
            uid = next(u["id"] for u in r2.json() if u.get("email") == email)
        else:
            raise Exception(f"Cannot create {email}: {r.status_code} {r.text}")
        # Set permissions
        r = await admin.put(f"/api/permissions/{uid}", json={"permissions": perms})
        assert r.status_code == 200, f"set_permissions {email}: {r.status_code} {r.text}"
        user_ids[email] = uid

    # Login each user with separate client
    editor   = await login("test-editor@appbi.local", TEST_PASS)
    viewer   = await login("test-viewer@appbi.local", TEST_PASS)
    noapps   = await login("test-no-apps@appbi.local", TEST_PASS)
    pipeline = await login("test-pipeline@appbi.local", TEST_PASS)
    print("All users logged in.\n")

    # ======================================================
    # [A] Viewer (apps:view, pipeline:view, backup:view)
    # ======================================================
    print("[A] Viewer (apps:view, pipeline:view, backup:view)")

    r = await viewer.get("/api/apps/overview")
    check("Viewer sees apps overview", r.status_code == 200, f"status={r.status_code}")

    r = await viewer.get("/api/apps/credentials")
    check("Viewer can list credentials (empty)", r.status_code == 200, f"status={r.status_code}")
    if r.status_code == 200:
        check("  -> sees 0 (not owner)", len(r.json()) == 0, f"count={len(r.json())}")

    r = await viewer.get("/api/pipeline/overview")
    check("Viewer sees pipeline overview", r.status_code == 200, f"status={r.status_code}")

    r = await viewer.get("/api/backup-flows")
    check("Viewer sees backup list", r.status_code == 200, f"status={r.status_code}")

    # Viewer cannot create
    r = await viewer.post("/api/pipeline/pipelines", json={
        "name": "X", "source_connector_key": "gdrive",
        "source_credential_id": FAKE_CRED, "dest_connector_key": "gsheets",
        "dest_credential_id": FAKE_CRED, "bindings": [],
    })
    check("Viewer cannot create pipeline -> 403", r.status_code == 403, f"status={r.status_code}")

    r = await viewer.post("/api/backup-flows/draft", json={})
    check("Viewer cannot create backup draft -> 403", r.status_code == 403, f"status={r.status_code}")

    # ======================================================
    # [B] No-Apps (apps:none, pipeline:view, backup:view)
    # ======================================================
    print("\n[B] No-Apps (apps:none, pipeline:view, backup:view)")

    r = await noapps.get("/api/apps/overview")
    check("No-apps blocked from apps overview -> 403", r.status_code == 403, f"status={r.status_code}")

    r = await noapps.get("/api/apps/credentials")
    check("No-apps blocked from credential list -> 403", r.status_code == 403, f"status={r.status_code}")

    r = await noapps.get("/api/pipeline/overview")
    check("No-apps can view pipeline overview", r.status_code == 200, f"status={r.status_code}")

    r = await noapps.get("/api/backup-flows")
    check("No-apps can view backup list", r.status_code == 200, f"status={r.status_code}")

    # ======================================================
    # [C] Editor (apps:edit, pipeline:edit, backup:edit)
    # ======================================================
    print("\n[C] Editor (apps:edit, pipeline:edit, backup:edit)")

    r = await editor.get("/api/apps/credentials")
    check("Editor can list credentials", r.status_code == 200, f"status={r.status_code}")
    if r.status_code == 200:
        check("  -> sees 0 (not owner, no shares)", len(r.json()) == 0, f"count={len(r.json())}")

    # Editor tries to use admin's credential -> 403 (not owner)
    r = await editor.post("/api/pipeline/pipelines", json={
        "name": "Editor Pipeline", "source_connector_key": "workflow",
        "source_credential_id": WORKFLOW_CRED, "dest_connector_key": "gdrive",
        "dest_credential_id": GDRIVE_CRED, "bindings": [],
    })
    check("Editor blocked from admin credentials -> 403", r.status_code == 403, f"status={r.status_code} body={r.text[:200]}")

    # Editor tries non-existent credential -> 404
    r = await editor.post("/api/pipeline/pipelines", json={
        "name": "Editor Pipeline", "source_connector_key": "workflow",
        "source_credential_id": FAKE_CRED, "dest_connector_key": "gdrive",
        "dest_credential_id": GDRIVE_CRED, "bindings": [],
    })
    detail = r.json().get("detail", "")
    check("Editor gets 404 + Apps module hint for fake cred",
          r.status_code == 404 and "Apps module" in detail,
          f"status={r.status_code} detail={detail}")

    # ======================================================
    # [D] Pipeline-Only (apps:view, pipeline:edit, backup:none)
    # ======================================================
    print("\n[D] Pipeline-Only (apps:view, pipeline:edit, backup:none)")

    r = await pipeline.get("/api/pipeline/overview")
    check("Pipeline user sees pipeline overview", r.status_code == 200, f"status={r.status_code}")

    r = await pipeline.get("/api/backup-flows")
    check("Pipeline user blocked from backup list -> 403", r.status_code == 403, f"status={r.status_code}")

    r = await pipeline.post("/api/backup-flows/draft", json={})
    check("Pipeline user blocked from backup create -> 403", r.status_code == 403, f"status={r.status_code}")

    # ======================================================
    # [E] Cross-module dependency enforcement (admin sets invalid combos)
    # ======================================================
    print("\n[E] Cross-module dependency enforcement")

    # pipeline:edit + apps:none -> should fail
    r = await admin.put(f"/api/permissions/{user_ids['test-viewer@appbi.local']}", json={
        "permissions": {"pipeline": "edit", "apps": "none"},
    })
    detail = r.json().get("detail", "")
    check("Cannot assign pipeline:edit + apps:none -> 400",
          r.status_code == 400 and "apps" in detail.lower(),
          f"status={r.status_code} detail={detail}")

    # backup:edit + apps:none -> should fail
    r = await admin.put(f"/api/permissions/{user_ids['test-viewer@appbi.local']}", json={
        "permissions": {"backup": "edit", "apps": "none"},
    })
    detail = r.json().get("detail", "")
    check("Cannot assign backup:edit + apps:none -> 400",
          r.status_code == 400 and "apps" in detail.lower(),
          f"status={r.status_code} detail={detail}")

    # Restore viewer
    await admin.put(f"/api/permissions/{user_ids['test-viewer@appbi.local']}", json={
        "permissions": {"apps": "view", "pipeline": "view", "backup": "view"},
    })

    # ======================================================
    # [F] Admin full access (owner of all credentials)
    # ======================================================
    print("\n[F] Admin full access")

    r = await admin.get("/api/apps/credentials")
    check("Admin lists credentials", r.status_code == 200, f"status={r.status_code}")
    if r.status_code == 200:
        count = len(r.json())
        check(f"  -> sees all 4 credentials", count == 4, f"count={count}")

    r = await admin.get(f"/api/apps/credentials/{WORKFLOW_CRED}")
    check("Admin views own credential", r.status_code == 200, f"status={r.status_code}")

    r = await admin.get(f"/api/backup-flows/{BACKUP_FLOW}")
    check("Admin views backup flow", r.status_code == 200, f"status={r.status_code}")

    # ======================================================
    # Summary
    # ======================================================
    print(f"\n{'='*60}")
    if failures:
        print(f"FAILED: {len(failures)} test(s)")
        for f in failures:
            print(f"  {f}")
    else:
        print("ALL TESTS PASSED")

    # Cleanup
    print("\nDeactivating test users...")
    for uid in user_ids.values():
        await admin.delete(f"/api/users/{uid}")

    # Close all clients
    for c in [admin, editor, viewer, noapps, pipeline]:
        await c.aclose()
    print("Done.")


if __name__ == "__main__":
    asyncio.run(test())
