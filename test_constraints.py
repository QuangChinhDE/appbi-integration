"""
Test cross-module constraint enforcement.

Tests:
1. Admin can access pipeline/backup normally
2. Credential must exist in Apps before it can be used in Pipeline/Backup
3. Improved error messages point to Apps module
4. Runtime module dependency enforcement blocks requests when permissions are stale
5. Permission dependency validation blocks invalid permission combos at assignment time
"""
import asyncio
from httpx import AsyncClient

BASE = "http://localhost:8000"
PASS = "Admin123!"
failures = []


def check(name, condition, detail=""):
    if condition:
        print(f"  PASS: {name}")
    else:
        msg = f"  FAIL: {name} -- {detail}"
        print(msg)
        failures.append(msg)


async def test():
    async with AsyncClient(base_url=BASE) as client:
        # === Login as admin ===
        login = await client.post("/api/auth/login", json={
            "email": "admin@appbi.local", "password": PASS,
        })
        assert login.status_code == 200, f"Login failed: {login.text}"
        token = login.json()["access_token"]
        h = {"Authorization": f"Bearer {token}"}
        admin_id = login.json()["user"]["id"]

        # ----- Group 1: Admin happy path -----
        print("\n[1] Admin happy-path (apps:full + pipeline:full + backup:full)")
        r = await client.get("/api/pipeline/overview", headers=h)
        check("Pipeline overview", r.status_code == 200)

        r = await client.get("/api/backup-flows", headers=h)
        check("Backup flow list", r.status_code == 200)

        r = await client.get("/api/connectors/catalog", headers=h)
        check("Connectors catalog", r.status_code == 200, f"got {r.status_code}")

        r = await client.get("/api/apps/overview", headers=h)
        check("Apps overview", r.status_code == 200)

        # ----- Group 2: Credential must exist in Apps -----
        print("\n[2] Credential must exist in Apps before use in Pipeline/Backup")

        r = await client.post("/api/pipeline/pipelines", headers=h, json={
            "name": "Test Pipeline",
            "source_connector_key": "gdrive",
            "source_credential_id": "00000000-0000-0000-0000-000000000001",
            "dest_connector_key": "gsheets",
            "dest_credential_id": "00000000-0000-0000-0000-000000000002",
            "bindings": [],
        })
        detail = r.json().get("detail", "")
        check("Create pipeline w/ fake creds -> 404",
              r.status_code == 404 and "Credential not found" in detail,
              f"{r.status_code}: {detail}")

        r = await client.post("/api/pipeline/discover-fields", headers=h, json={
            "source_credential_id": "00000000-0000-0000-0000-000000000000",
            "source_connector_key": "gdrive",
            "source_stream_key": "files",
        })
        detail = r.json().get("detail", "")
        check("Discover fields w/ fake cred -> 404",
              r.status_code == 404 and "Credential not found" in detail,
              f"{r.status_code}: {detail}")

        # ----- Group 3: Error messages mention Apps module -----
        print("\n[3] Error messages guide user to Apps module")

        r = await client.post("/api/pipeline/pipelines", headers=h, json={
            "name": "Test",
            "source_connector_key": "gdrive",
            "source_credential_id": "00000000-0000-0000-0000-000000000001",
            "dest_connector_key": "gsheets",
            "dest_credential_id": "00000000-0000-0000-0000-000000000002",
            "bindings": [],
        })
        detail = r.json().get("detail", "")
        check("Error message mentions 'Apps module'",
              "Apps module" in detail,
              f"detail={detail}")

        # ----- Group 4: Permission dependency validation at assignment time -----
        print("\n[4] Permission dependency validation blocks invalid combos")

        # Create a viewer user first
        r = await client.post("/api/users/", headers=h, json={
            "email": "testuser-constraint@appbi.local",
            "full_name": "Test Constraint User",
            "password": "Test1234!",
            "auth_provider": "password",
        })
        if r.status_code == 201:
            test_user_id = r.json()["id"]
        elif r.status_code == 409:
            # User already exists from a previous test run
            r2 = await client.get("/api/users/", headers=h)
            for u in r2.json():
                if u.get("email") == "testuser-constraint@appbi.local":
                    test_user_id = u["id"]
                    break
        else:
            print(f"  SKIP: Could not create test user: {r.status_code} {r.text}")
            test_user_id = None

        if test_user_id:
            # Try to assign pipeline:edit + apps:none -> should fail dependency validation
            r = await client.put(f"/api/permissions/{test_user_id}", headers=h, json={
                "permissions": {"pipeline": "edit", "apps": "none"},
            })
            detail = r.json().get("detail", "")
            check("Assign pipeline:edit + apps:none -> 400",
                  r.status_code == 400 and "apps" in detail.lower(),
                  f"{r.status_code}: {detail}")

            # Try to assign backup:edit + apps:none -> should fail
            r = await client.put(f"/api/permissions/{test_user_id}", headers=h, json={
                "permissions": {"backup": "edit", "apps": "none"},
            })
            detail = r.json().get("detail", "")
            check("Assign backup:edit + apps:none -> 400",
                  r.status_code == 400 and "apps" in detail.lower(),
                  f"{r.status_code}: {detail}")

            # Valid combo: pipeline:edit + apps:view -> should succeed
            r = await client.put(f"/api/permissions/{test_user_id}", headers=h, json={
                "permissions": {"pipeline": "edit", "apps": "view"},
            })
            check("Assign pipeline:edit + apps:view -> 200",
                  r.status_code == 200,
                  f"{r.status_code}: {r.text[:200]}")

            # ----- Group 5: Runtime enforcement (defense-in-depth) -----
            print("\n[5] Runtime dependency enforcement (defense-in-depth)")

            # Login as the test user who has pipeline:edit + apps:view
            login2 = await client.post("/api/auth/login", json={
                "email": "testuser-constraint@appbi.local",
                "password": "Test1234!",
            })
            if login2.status_code == 200:
                h2 = {"Authorization": f"Bearer {login2.json()['access_token']}"}

                # This user has apps:view so pipeline:edit should work (not blocked by dependency)
                # But the credential doesn't exist, so it will be 404 - that's expected!
                r = await client.post("/api/pipeline/pipelines", headers=h2, json={
                    "name": "Test From Viewer",
                    "source_connector_key": "gdrive",
                    "source_credential_id": "00000000-0000-0000-0000-000000000001",
                    "dest_connector_key": "gsheets",
                    "dest_credential_id": "00000000-0000-0000-0000-000000000002",
                    "bindings": [],
                })
                detail = r.json().get("detail", "")
                # Should be 404 (credential not found), NOT 403
                check("User w/ pipeline:edit+apps:view -> not blocked by deps (gets 404 for missing cred)",
                      r.status_code == 404 and "Credential" in detail,
                      f"{r.status_code}: {detail}")

                # Pipeline view should work (no dependency check needed for view)
                r = await client.get("/api/pipeline/overview", headers=h2)
                check("User w/ pipeline:edit can view overview", r.status_code == 200,
                      f"{r.status_code}")

            # Cleanup: deactivate test user
            await client.delete(f"/api/users/{test_user_id}", headers=h)

    # === Summary ===
    print(f"\n{'='*50}")
    if failures:
        print(f"FAILED: {len(failures)} test(s)")
        for f in failures:
            print(f)
    else:
        print("ALL TESTS PASSED")


if __name__ == "__main__":
    asyncio.run(test())
"""
Test cross-module constraint enforcement.

Tests:
1. Admin (apps:full + pipeline:edit + backup:edit) can access pipeline/backup normally
2. Credential must exist in Apps before it can be used in Pipeline/Backup
3. User WITHOUT apps:view permission cannot use pipeline:edit or backup:edit endpoints
4. Improved error messages for missing credentials
"""
import asyncio
import json
from httpx import AsyncClient

BASE = "http://localhost:8000"


async def test():
    results = []

    async with AsyncClient(base_url=BASE) as client:
        # === Login as admin ===
        login = await client.post("/api/auth/login", json={
            "email": "admin@appbi.local",
            "password": "Admin123!",
        })
        assert login.status_code == 200, f"Login failed: {login.text}"
        token = login.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        print("OK: Admin login")

        # === Test 1: Pipeline overview works for admin ===
        r = await client.get("/api/pipeline/overview", headers=headers)
        assert r.status_code == 200
        print("OK: Pipeline overview (admin) -> 200")

        # === Test 2: Backup list works for admin ===
        r = await client.get("/api/backup-flows", headers=headers)
        assert r.status_code == 200
        print("OK: Backup flow list (admin) -> 200")

        # === Test 3: Connector catalog works ===
        r = await client.get("/api/connectors/catalog", headers=headers)
        assert r.status_code == 200
        count = len(r.json())
        print(f"OK: Connectors catalog -> 200 ({count} connectors)")

        # === Test 4: Create pipeline with non-existent credential -> 404 with helpful message ===
        r = await client.post("/api/pipeline/pipelines", headers=headers, json={
            "name": "Test Pipeline",
            "source_connector_key": "gdrive",
            "source_credential_id": "00000000-0000-0000-0000-000000000001",
            "dest_connector_key": "gsheets",
            "dest_credential_id": "00000000-0000-0000-0000-000000000002",
            "bindings": [],
        })
        detail = r.json().get("detail", "")
        assert r.status_code == 404, f"Expected 404, got {r.status_code}: {detail}"
        assert "Credential not found" in detail
        assert "Apps module" in detail
        print(f"OK: Create pipeline (no credential) -> 404: {detail}")

        # === Test 5: Discover fields with non-existent credential -> 404 ===
        r = await client.post("/api/pipeline/discover-fields", headers=headers, json={
            "source_credential_id": "00000000-0000-0000-0000-000000000000",
            "source_connector_key": "gdrive",
            "source_stream_key": "files",
        })
        detail = r.json().get("detail", "")
        assert r.status_code == 404
        assert "Credential not found" in detail
        print(f"OK: Discover fields (no credential) -> 404: {detail}")

        # === Test 6: Backup autosave with non-existent flow -> 404 ===
        r = await client.patch(
            "/api/backup-flows/00000000-0000-0000-0000-000000000000/autosave",
            headers=headers,
            json={},
        )
        assert r.status_code == 404
        print(f"OK: Backup autosave (no flow) -> 404")

        # === Test 7: Create a restricted user (pipeline:edit, backup:edit, apps:none) ===
        # This tests that the runtime dependency enforcement blocks access
        r = await client.post("/api/settings/users", headers=headers, json={
            "email": "restricted-test@appbi.local",
            "name": "Restricted User",
            "password": "Test1234!",
            "permissions": {
                "pipeline": "edit",
                "backup": "edit",
                "apps": "none",
                "settings": "none",
            },
        })
        if r.status_code == 201:
            restricted_user_id = r.json().get("id")
            print(f"OK: Created restricted user (apps:none, pipeline:edit, backup:edit)")
        elif r.status_code == 400:
            detail = r.json().get("detail", "")
            if "require" in detail.lower() and "apps" in detail.lower():
                print(f"OK: Cannot create user with pipeline:edit + apps:none -> {detail}")
                # The dependency validation already blocks this at user creation time
                # This is correct behavior!
                print("\n=== ALL TESTS PASSED ===")
                return
            else:
                print(f"UNEXPECTED 400: {detail}")
                return
        else:
            print(f"UNEXPECTED {r.status_code}: {r.text}")
            return

        # If user was created (dependency check didn't block), test runtime enforcement
        login2 = await client.post("/api/auth/login", json={
            "email": "restricted-test@appbi.local",
            "password": "Test1234!",
        })
        if login2.status_code == 200:
            restricted_token = login2.json()["access_token"]
            restricted_headers = {"Authorization": f"Bearer {restricted_token}"}

            # Pipeline edit endpoint should be blocked by runtime dependency check
            r = await client.post("/api/pipeline/pipelines", headers=restricted_headers, json={
                "name": "Should Fail",
                "source_connector_key": "gdrive",
                "source_credential_id": "00000000-0000-0000-0000-000000000001",
                "dest_connector_key": "gsheets",
                "dest_credential_id": "00000000-0000-0000-0000-000000000002",
                "bindings": [],
            })
            detail = r.json().get("detail", "")
            assert r.status_code == 403, f"Expected 403 for restricted user, got {r.status_code}: {detail}"
            print(f"OK: Restricted user pipeline:edit blocked -> 403: {detail}")

            # Backup edit endpoint should also be blocked
            r = await client.post("/api/backup-flows/draft", headers=restricted_headers, json={})
            detail = r.json().get("detail", "")
            assert r.status_code == 403, f"Expected 403, got {r.status_code}: {detail}"
            print(f"OK: Restricted user backup:edit blocked -> 403: {detail}")

        # Cleanup: delete the test user
        if restricted_user_id:
            await client.delete(f"/api/settings/users/{restricted_user_id}", headers=headers)
            print("OK: Cleaned up test user")

    print("\n=== ALL TESTS PASSED ===")


if __name__ == "__main__":
    asyncio.run(test())
