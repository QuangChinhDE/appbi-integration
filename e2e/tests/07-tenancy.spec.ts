/**
 * Provisioning a tenant, and proving one tenant cannot reach another
 * (SRS 4.1, 32.1; guardrail 19).
 *
 * The isolation tests are the important ones, and they are deliberately hostile
 * rather than polite: they do not check that workspace B's rows are absent from
 * a list, they take a real id from workspace B and ask for it directly, with
 * and without an `X-Workspace-Id` header naming B. Every product with a
 * `workspace_id` column passes the polite version.
 *
 * Two tenants are provisioned per run rather than reused, so a leak cannot be
 * masked by a workspace that happens to be empty.
 */

import { APIRequestContext, Browser, expect, test } from '@playwright/test';

import { OWNER, unique } from './fixtures';

interface Tenant {
  id: string;
  slug: string;
  email: string;
  password: string;
  /** Populated by `seed`. */
  workflowId: string;
  credentialId: string;
  executionId: string;
}

const PASSWORD = 'TenantOwnerPass123';
const CHANGED = 'TenantOwnerPass456';

/** A signed-in request context for a tenant's owner. */
async function signIn(browser: Browser, tenant: Tenant): Promise<APIRequestContext> {
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('/login');
  await page.getByLabel('Email').fill(tenant.email);
  await page.getByLabel(/Mật khẩu|Password/).fill(tenant.password);
  await page.getByRole('button', { name: /Đăng nhập|Sign in/ }).click();

  // A provisioned owner must change its password before it can do anything.
  await expect(page).toHaveURL(/\/change-password/);
  await page.getByLabel(/Mật khẩu hiện tại|Current password/).fill(tenant.password);
  await page.getByLabel(/^Mật khẩu mới|^New password/).fill(CHANGED);
  await page.getByLabel(/Nhập lại|Confirm/).fill(CHANGED);
  await page.getByRole('button', { name: /Đổi mật khẩu|Change password/ }).click();
  await expect(page).toHaveURL(/\/overview/);

  return context.request;
}

async function provision(
  platform: APIRequestContext, label: string,
): Promise<Tenant> {
  const name = unique(label);
  const email = `${label.toLowerCase()}-${Date.now().toString(36)}`
    + `-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const response = await platform.post('/api/v1/platform/workspaces', {
    data: { name, owner_email: email, owner_password: PASSWORD },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  const body = await response.json();
  return {
    id: body.id, slug: body.slug, email, password: PASSWORD,
    workflowId: '', credentialId: '', executionId: '',
  };
}

/** Give a tenant one of everything, so there is something to fail to reach. */
async function seed(api: APIRequestContext, tenant: Tenant): Promise<void> {
  const credential = await (await api.post('/api/v1/credentials', {
    data: {
      name: `${tenant.slug} bearer`,
      credential_type: 'BEARER',
      data: { token: `token-for-${tenant.slug}` },
    },
  })).json();
  tenant.credentialId = credential.id;

  const workflow = await (await api.post('/api/v1/workflows', {
    data: { name: `${tenant.slug} workflow`, trigger_node_key: 'manual_trigger' },
  })).json();
  tenant.workflowId = workflow.id;

  const draft = await (await api.get(`/api/v1/workflows/${workflow.id}/draft`)).json();
  await api.put(`/api/v1/workflows/${workflow.id}/draft`, {
    data: {
      expected_revision: draft.revision,
      graph: {
        nodes: [
          {
            id: 'start_1', node_key: 'manual_trigger', name: 'Start',
            position: { x: 80, y: 200 }, config: {},
          },
          {
            id: 'set_1', node_key: 'edit_fields', name: 'Label',
            position: { x: 360, y: 200 },
            config: {
              assignments: [
                { name: 'tenant', type: 'string', value: tenant.slug },
              ],
            },
          },
        ],
        connections: [{
          from: { node_id: 'start_1', port: 'main' },
          to: { node_id: 'set_1', port: 'main' },
        }],
      },
    },
  });

  const execution = await (await api.post(
    `/api/v1/workflows/${workflow.id}/executions`,
    { data: { kind: 'DRAFT', payload: [{ hello: tenant.slug }] } },
  )).json();
  tenant.executionId = execution.id;
}

test.describe('tenant provisioning', () => {
  test('a platform admin creates a workspace with an owner, quota and audit',
    async ({ page }) => {
      const name = unique('E2E provisioned');
      const email = `provisioned-${Date.now().toString(36)}@example.com`;

      const created = await page.request.post('/api/v1/platform/workspaces', {
        data: {
          name,
          owner_email: email,
          max_concurrent_executions: 7,
          timezone: 'Asia/Singapore',
        },
      });
      expect(created.status()).toBe(201);
      const body = await created.json();

      expect(body.slug).toMatch(/^e2e-provisioned-/);
      expect(body.max_concurrent_executions).toBe(7);
      expect(body.timezone).toBe('Asia/Singapore');
      expect(body.status).toBe('ACTIVE');

      // A generated password, returned exactly once, and the account cannot do
      // anything else until it is changed. What is handed to the customer is a
      // one-time secret rather than a standing credential.
      expect(body.owner.one_time_password).toMatch(/\S{16,}/);
      expect(body.owner.password_change_required).toBe(true);

      // Reading the workspace back does not return it again.
      const listed = await (await page.request.get(
        '/api/v1/platform/workspaces')).json();
      const row = listed.items.find((item: { id: string }) => item.id === body.id);
      expect(row.owners).toEqual([email]);
      expect(JSON.stringify(row)).not.toContain(body.owner.one_time_password);

      // The tenant's own audit trail starts with who created it, which is the
      // first question asked when a customer queries their history.
      const audit = await (await page.request.get('/api/v1/audit', {
        headers: { 'X-Workspace-Id': body.id },
      })).json();
      const provisioned = audit.items.find(
        (item: { action: string }) => item.action === 'workspace.provisioned');
      expect(provisioned).toBeTruthy();
      expect(provisioned.actor_label).toBe(OWNER.email);

      await page.request.put(`/api/v1/platform/workspaces/${body.id}/status`,
        { data: { status: 'ARCHIVED' } });
    });

  test('a duplicate slug is refused by name rather than by constraint',
    async ({ page }) => {
      const slug = `e2e-dup-${Date.now().toString(36)}`;
      const first = await page.request.post('/api/v1/platform/workspaces', {
        data: { name: 'E2E duplicate one', slug,
                owner_email: `dup1-${Date.now().toString(36)}@example.com` },
      });
      expect(first.status()).toBe(201);

      const second = await page.request.post('/api/v1/platform/workspaces', {
        data: { name: 'E2E duplicate two', slug,
                owner_email: `dup2-${Date.now().toString(36)}@example.com` },
      });
      expect(second.status()).toBe(409);
      const error = (await second.json()).error;
      expect(error.code).toBe('WORKSPACE_SLUG_TAKEN');
      // Names the conflict, rather than surfacing a database constraint.
      expect(error.message).toContain(slug);

      const created = await first.json();
      await page.request.put(`/api/v1/platform/workspaces/${created.id}/status`,
        { data: { status: 'ARCHIVED' } });
    });

  test('a reserved slug is refused', async ({ page }) => {
    // `/api/...` as a workspace slug would collide with a product route.
    const response = await page.request.post('/api/v1/platform/workspaces', {
      data: { name: 'E2E reserved', slug: 'api',
              owner_email: `reserved-${Date.now().toString(36)}@example.com` },
    });
    expect(response.status()).toBe(422);
    expect((await response.json()).error.code).toBe('WORKSPACE_SLUG_RESERVED');
  });

  test('a tenant owner cannot provision another tenant', async ({ browser, page }) => {
    // Creating a tenant is not an action *within* a tenant, so no workspace
    // role grants it -- not even Owner, which is the top of the customer's own
    // hierarchy.
    const tenant = await provision(page.request, 'Escalation');
    const api = await signIn(browser, tenant);

    const attempt = await api.post('/api/v1/platform/workspaces', {
      data: { name: 'should not exist',
              owner_email: `nope-${Date.now().toString(36)}@example.com` },
    });
    expect(attempt.status()).toBe(403);
    expect((await attempt.json()).error.code).toBe('PLATFORM_ADMIN_REQUIRED');

    // And cannot even enumerate the deployment's tenants.
    expect((await api.get('/api/v1/platform/workspaces')).status()).toBe(403);

    await page.request.put(`/api/v1/platform/workspaces/${tenant.id}/status`,
      { data: { status: 'ARCHIVED' } });
  });

  test('a tenant quota is enforced, not merely stored', async ({ browser, page }) => {
    /**
     * A quota that is displayed and not applied is worse than no quota: it is
     * a number a customer is told and a limit nobody honours. The deployment's
     * global ceiling is ten, so if the tenant's own value were ignored the
     * second run below would simply start.
     */
    test.slow();

    const tenant = await provision(page.request, 'Quota');
    await page.request.put(`/api/v1/platform/workspaces/${tenant.id}/quota`,
      { data: { max_concurrent_executions: 1 } });
    const api = await signIn(browser, tenant);

    // Two workflows, so the *workspace* ceiling is what refuses rather than
    // the per-workflow one, which is 1 by design and would refuse anyway.
    const ids: string[] = [];
    for (const label of ['a', 'b']) {
      const workflow = await (await api.post('/api/v1/workflows', {
        data: { name: `${tenant.slug}-${label}`,
                trigger_node_key: 'manual_trigger' },
      })).json();
      const draft = await (await api.get(
        `/api/v1/workflows/${workflow.id}/draft`)).json();
      await api.put(`/api/v1/workflows/${workflow.id}/draft`, {
        data: {
          expected_revision: draft.revision,
          graph: {
            nodes: [
              { id: 'start_1', node_key: 'manual_trigger', name: 'Start',
                position: { x: 80, y: 200 }, config: {} },
              // Long enough that the two genuinely overlap. The engine is
              // reached, so this is a real in-flight execution rather than a
              // row that finishes before the second request arrives.
              { id: 'http_1', node_key: 'http_request', name: 'Chờ',
                position: { x: 360, y: 200 },
                config: { method: 'GET', url: 'https://httpbin.org/delay/8',
                          timeout_ms: 20000, continue_on_error: true } },
            ],
            connections: [{ from: { node_id: 'start_1', port: 'main' },
                            to: { node_id: 'http_1', port: 'main' } }],
          },
        },
      });
      ids.push(workflow.id);
    }

    const first = await api.post(`/api/v1/workflows/${ids[0]}/executions`,
      { data: { kind: 'DRAFT' } });
    expect(first.status(), await first.text()).toBe(202);

    await expect.poll(async () => {
      const listed = await (await api.get(
        `/api/v1/executions?workflow_id=${ids[0]}`)).json();
      return listed.items[0]?.status;
    }, { timeout: 30_000 }).toMatch(/QUEUED|DISPATCHING|RUNNING/);

    const second = await api.post(`/api/v1/workflows/${ids[1]}/executions`,
      { data: { kind: 'DRAFT' } });
    expect(second.status(), 'the tenant quota of 1 was not enforced').toBe(429);
    const error = (await second.json()).error;
    expect(error.code).toBe('QUOTA_EXCEEDED');
    // The message says the number, so the customer can see what to ask for.
    expect(error.message).toContain('1');
    expect(error.remediation.action).toBe('WAIT_OR_CANCEL');

    // Raising the quota takes effect on the next request, with no restart:
    // it is read live, which is what makes `provision quota` an operation an
    // operator can perform during an incident.
    await page.request.put(`/api/v1/platform/workspaces/${tenant.id}/quota`,
      { data: { max_concurrent_executions: 5 } });
    const third = await api.post(`/api/v1/workflows/${ids[1]}/executions`,
      { data: { kind: 'DRAFT' } });
    expect(third.status(), await third.text()).toBe(202);

    for (const id of ids) {
      await api.post(`/api/v1/workflows/${id}/deactivate`);
      await api.delete(`/api/v1/workflows/${id}`);
    }
    await page.request.put(`/api/v1/platform/workspaces/${tenant.id}/status`,
      { data: { status: 'ARCHIVED' } });
  });

  test('a suspended tenant is refused, including to its own owner',
    async ({ browser, page }) => {
      const tenant = await provision(page.request, 'Suspended');
      const api = await signIn(browser, tenant);
      expect((await api.get('/api/v1/workflows')).ok()).toBeTruthy();

      await page.request.put(
        `/api/v1/platform/workspaces/${tenant.id}/status`,
        { data: { status: 'SUSPENDED' } });

      // A billing hold that deletes nothing. The owner's existing session
      // stops working rather than continuing until it expires.
      const after = await api.get('/api/v1/workflows');
      expect(after.status()).toBe(403);

      await page.request.put(
        `/api/v1/platform/workspaces/${tenant.id}/status`,
        { data: { status: 'ACTIVE' } });
      expect((await api.get('/api/v1/workflows')).ok()).toBeTruthy();

      await page.request.put(`/api/v1/platform/workspaces/${tenant.id}/status`,
        { data: { status: 'ARCHIVED' } });
    });
});

test.describe('tenant isolation', () => {
  let a: Tenant;
  let b: Tenant;
  let apiA: APIRequestContext;
  // B's own session, so a test can check that a refused cross-tenant call left
  // B's data alone. Previously local to `beforeAll`, which meant no test could
  // ask B anything.
  let apiB: APIRequestContext;

  test.beforeAll(async ({ browser }) => {
    const platformPage = await browser.newPage({ storageState: '.auth/owner.json' });
    a = await provision(platformPage.request, 'TenantA');
    b = await provision(platformPage.request, 'TenantB');
    await platformPage.close();

    apiA = await signIn(browser, a);
    apiB = await signIn(browser, b);
    await seed(apiA, a);
    await seed(apiB, b);
  });

  test.afterAll(async ({ browser }) => {
    const platformPage = await browser.newPage({ storageState: '.auth/owner.json' });
    for (const tenant of [a, b]) {
      await platformPage.request.put(
        `/api/v1/platform/workspaces/${tenant.id}/status`,
        { data: { status: 'ARCHIVED' } });
    }
    await platformPage.close();
  });

  test('each tenant sees only its own workflows', async () => {
    const listed = await (await apiA.get('/api/v1/workflows')).json();
    const names = listed.items.map((item: { name: string }) => item.name);
    expect(names).toContain(`${a.slug} workflow`);
    expect(names).not.toContain(`${b.slug} workflow`);
  });

  test('B\'s workflow is not readable by A, by id', async () => {
    // The hostile version: a real id, asked for directly.
    const response = await apiA.get(`/api/v1/workflows/${b.workflowId}`);
    expect(response.status()).toBe(404);
    // 404 rather than 403: telling A that the id exists but belongs to
    // somebody else is an existence oracle (SRS 32.3).
    expect((await response.json()).error.code).toBe('RESOURCE_NOT_FOUND');
  });

  test('B\'s workflow is not writable by A', async () => {
    for (const [method, path, data] of [
      ['patch', `/api/v1/workflows/${b.workflowId}`, { name: 'renamed by A' }],
      ['post', `/api/v1/workflows/${b.workflowId}/publish`, {}],
      ['post', `/api/v1/workflows/${b.workflowId}/activate`, {}],
      ['post', `/api/v1/workflows/${b.workflowId}/executions`,
       { kind: 'DRAFT' }],
    ] as const) {
      const response = await apiA.fetch(path, { method, data });
      expect(
        [403, 404], `${method.toUpperCase()} ${path}`,
      ).toContain(response.status());
    }

    // And nothing about it changed.
    const platform = await apiA.get(`/api/v1/workflows/${b.workflowId}`);
    expect(platform.status()).toBe(404);
  });

  test('B\'s credential is not readable by A, and not deletable', async () => {
    expect((await apiA.get(`/api/v1/credentials/${b.credentialId}`)).status())
      .toBe(404);
    expect((await apiA.delete(`/api/v1/credentials/${b.credentialId}`)).status())
      .toBe(404);

    const listed = await (await apiA.get('/api/v1/credentials')).json();
    const names = listed.items.map((item: { name: string }) => item.name);
    expect(names).not.toContain(`${b.slug} bearer`);
  });

  test('B\'s executions are not readable by A', async () => {
    expect((await apiA.get(`/api/v1/executions/${b.executionId}`)).status())
      .toBe(404);
    // Nor its payloads, which is a separate permission and a separate route.
    expect((await apiA.get(
      `/api/v1/executions/${b.executionId}/nodes/set_1/output`)).status())
      .toBe(404);
    expect((await apiA.get(`/api/v1/executions/${b.executionId}/logs`)).status())
      .toBe(404);

    const listed = await (await apiA.get('/api/v1/executions')).json();
    for (const row of listed.items) {
      expect(row.workflow_id).not.toBe(b.workflowId);
    }
  });

  test('every mutating route on B is refused to A, not only the reads',
    async () => {
      // The isolation guard in the backend is an AST scan over `select()`
      // calls: real, and shaped so that a `get`, an `update`, a `delete` or
      // anything reaching for raw SQL sits outside it. The reads above are
      // covered by both; these are the routes that change something, and only
      // an integration test can speak for them.
      //
      // 404 rather than 403 throughout: telling A that B's id exists is
      // already a leak, so a resource in another tenant is simply not there.
      const refusals: [string, () => Promise<{ status(): number }>][] = [
        ['delete the workflow',
          () => apiA.delete(`/api/v1/workflows/${b.workflowId}`)],
        ['deactivate the workflow',
          () => apiA.post(`/api/v1/workflows/${b.workflowId}/deactivate`, { data: {} })],
        ['publish the workflow',
          () => apiA.post(`/api/v1/workflows/${b.workflowId}/publish`, { data: {} })],
        ['rotate the webhook secret',
          () => apiA.post(`/api/v1/workflows/${b.workflowId}/trigger/rotate-secret`,
            { data: {} })],
        ['run the workflow',
          () => apiA.post(`/api/v1/workflows/${b.workflowId}/executions`,
            { data: { kind: 'DRAFT' } })],
        ['duplicate the workflow',
          () => apiA.post(`/api/v1/workflows/${b.workflowId}/duplicate`, { data: {} })],
        ['read the draft',
          () => apiA.get(`/api/v1/workflows/${b.workflowId}/draft`)],
        ['write the draft',
          () => apiA.put(`/api/v1/workflows/${b.workflowId}/draft`,
            { data: { expected_revision: 1, graph: { nodes: [], connections: [] } } })],
        ['cancel the execution',
          () => apiA.post(`/api/v1/executions/${b.executionId}/cancel`, { data: {} })],
        ['retry the execution',
          () => apiA.post(`/api/v1/executions/${b.executionId}/retry`, { data: {} })],
        ['read the execution nodes',
          () => apiA.get(`/api/v1/executions/${b.executionId}/nodes`)],
        ['read a node input',
          () => apiA.get(`/api/v1/executions/${b.executionId}/nodes/set_1/input`)],
      ];

      const wrong: string[] = [];
      for (const [what, call] of refusals) {
        const status = (await call()).status();
        // 404 is the answer; 403 would also be a refusal but would confirm the
        // id exists. Anything 2xx is a breach.
        if (status !== 404) wrong.push(`${what} -> ${status}`);
      }

      expect(wrong, 'these routes did not answer 404 for another tenant')
        .toEqual([]);

      // And B still has everything it had: a refusal that half-executed would
      // pass the check above and still be a disaster.
      const stillThere = await apiB.get(`/api/v1/workflows/${b.workflowId}`);
      expect(stillThere.ok()).toBeTruthy();
    });

  test('B\'s audit trail is not readable by A', async () => {
    const listed = await (await apiA.get('/api/v1/audit')).json();
    const labels = listed.items.map(
      (item: { resource_label: string | null }) => item.resource_label ?? '');
    expect(labels.some((label: string) => label.includes(b.slug))).toBe(false);
  });

  test('naming B in X-Workspace-Id is refused, not honoured', async () => {
    // The header is the caller saying "operate on this one". A caller who
    // cannot reach it must be refused rather than quietly served their own
    // workspace -- otherwise A, believing it addressed B, writes into A.
    const headers = { 'X-Workspace-Id': b.id };

    const listed = await apiA.get('/api/v1/workflows', { headers });
    expect(listed.status()).toBe(403);
    expect((await listed.json()).error.message)
      .toMatch(/không truy cập được|cannot access/i);

    for (const path of ['/api/v1/credentials', '/api/v1/executions',
                        '/api/v1/audit', '/api/v1/workspace/members']) {
      expect((await apiA.get(path, { headers })).status(), path).toBe(403);
    }

    // Including writes, which is the case that would actually corrupt data.
    const created = await apiA.post('/api/v1/workflows', {
      headers, data: { name: 'created into B' },
    });
    expect(created.status()).toBe(403);
  });

  test('a malformed X-Workspace-Id is refused rather than ignored', async () => {
    const response = await apiA.get('/api/v1/workflows', {
      headers: { 'X-Workspace-Id': 'not-a-uuid' },
    });
    // Ignoring it would serve A's data to a caller who asked for something
    // else, and they would have no way to tell.
    expect(response.status()).toBe(403);
  });

  test('a workflow graph naming B\'s credential does not describe it',
    async () => {
      // A graph is JSONB, so it can name any UUID -- the reference is not a
      // foreign key. Without a tenant filter on the health lookup, A could
      // learn B's credential *name* from its own workflow's health message.
      const draft = await (await apiA.get(
        `/api/v1/workflows/${a.workflowId}/draft`)).json();
      await apiA.put(`/api/v1/workflows/${a.workflowId}/draft`, {
        data: {
          expected_revision: draft.revision,
          graph: {
            nodes: [
              {
                id: 'start_1', node_key: 'manual_trigger', name: 'Start',
                position: { x: 80, y: 200 }, config: {},
              },
              {
                id: 'http_1', node_key: 'http_request', name: 'Call',
                position: { x: 360, y: 200 },
                config: {
                  method: 'GET',
                  url: 'https://api.example.com',
                  credential_id: b.credentialId,
                },
              },
            ],
            connections: [{
              from: { node_id: 'start_1', port: 'main' },
              to: { node_id: 'http_1', port: 'main' },
            }],
          },
        },
      });

      const summary = await (await apiA.get(
        `/api/v1/workflows/${a.workflowId}`)).json();
      const rendered = JSON.stringify(summary);
      expect(rendered).not.toContain(`${b.slug} bearer`);

      // The reference is reported as unusable, which is the correct answer:
      // from A's side that credential does not exist.
      const validated = await (await apiA.post(
        `/api/v1/workflows/${a.workflowId}/validate`)).json();
      expect(validated.ok).toBe(false);
      expect(JSON.stringify(validated)).not.toContain(`${b.slug} bearer`);
    });

  test('a tenant cannot invite itself into another workspace', async () => {
    const response = await apiA.post('/api/v1/workspace/members', {
      headers: { 'X-Workspace-Id': b.id },
      data: { email: a.email, full_name: 'A', role: 'OWNER',
              password: 'ShouldNotWork123' },
    });
    expect(response.status()).toBe(403);
  });
});
