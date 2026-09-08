/**
 * Double submission, and limits that hold across replicas (SRS 27.4, 68.2).
 *
 * Both of these are properties of the *deployment*, not of a function, and
 * neither can be tested by calling something once:
 *
 * * idempotency is only interesting when two requests arrive together. The
 *   requests here are fired concurrently and deliberately not awaited in turn,
 *   because a sequential pair is answered by the service's own lookup and
 *   never reaches the database constraint that actually settles it.
 * * a rate limit is only interesting when more than one process is counting.
 *   The last test scales the API to two replicas and proves the limit is still
 *   the configured number rather than twice it.
 */

import { expect, test } from '@playwright/test';
import { createHmac } from 'node:crypto';

import { API_SERVICE, COMPOSE_PROJECT, compose } from './deployment';
import { createWorkflow, deleteWorkflow, unique } from './fixtures';

/** A trivial but valid graph: start -> set a field. */
function simpleGraph(triggerKey = 'manual_trigger') {
  return {
    nodes: [
      {
        id: 'start_1', node_key: triggerKey, name: 'Start',
        position: { x: 80, y: 200 },
        config: triggerKey === 'webhook_trigger'
          ? { method: 'POST', auth_mode: 'HEADER_SIGNATURE',
              allowed_content_type: 'application/json' }
          : {},
      },
      {
        id: 'set_1', node_key: 'edit_fields', name: 'Label',
        position: { x: 360, y: 200 },
        config: { assignments: [{ name: 'ran', type: 'string', value: 'yes' }] },
      },
    ],
    connections: [{
      from: { node_id: 'start_1', port: 'main' },
      to: { node_id: 'set_1', port: 'main' },
    }],
  };
}

test.describe('idempotency', () => {
  let workflowId: string;

  test.beforeEach(async ({ page }) => {
    workflowId = await createWorkflow(page, unique('E2E idempotent'));
    const draft = await (await page.request.get(
      `/api/v1/workflows/${workflowId}/draft`)).json();
    await page.request.put(`/api/v1/workflows/${workflowId}/draft`, {
      data: { expected_revision: draft.revision, graph: simpleGraph() },
    });
  });

  test.afterEach(async ({ page }) => {
    await deleteWorkflow(page, workflowId);
  });

  test('two Run requests with the same key produce one execution',
    async ({ page }) => {
      const key = `e2e-run-${Date.now().toString(36)}`;

      // Fired together, not one after the other. Sequentially the second is
      // answered by the service's own lookup; concurrently both look, both
      // find nothing, and the unique index is what decides.
      const [first, second] = await Promise.all([
        page.request.post(`/api/v1/workflows/${workflowId}/executions`, {
          headers: { 'Idempotency-Key': key },
          data: { kind: 'DRAFT', payload: [{ n: 1 }] },
        }),
        page.request.post(`/api/v1/workflows/${workflowId}/executions`, {
          headers: { 'Idempotency-Key': key },
          data: { kind: 'DRAFT', payload: [{ n: 2 }] },
        }),
      ]);

      // Neither is an error. The loser of the race is told about the winner,
      // which is what "idempotent" means to the caller.
      expect(first.ok(), await first.text()).toBeTruthy();
      expect(second.ok(), await second.text()).toBeTruthy();

      const a = await first.json();
      const b = await second.json();
      expect(a.id).toBe(b.id);

      const listed = await (await page.request.get(
        `/api/v1/executions?workflow_id=${workflowId}`)).json();
      expect(listed.items).toHaveLength(1);
    });

  test('ten concurrent requests with one key still produce one execution',
    async ({ page }) => {
      // The two-request version can pass by luck. Ten cannot.
      const key = `e2e-storm-${Date.now().toString(36)}`;
      const responses = await Promise.all(
        Array.from({ length: 10 }, (_, index) =>
          page.request.post(`/api/v1/workflows/${workflowId}/executions`, {
            headers: { 'Idempotency-Key': key },
            data: { kind: 'DRAFT', payload: [{ n: index }] },
          })),
      );

      const bodies = await Promise.all(responses.map((r) => r.json()));
      const ids = new Set(bodies.map((body) => body.id));
      // Every response has to name the same run, and none may be an error --
      // a 500 from a unique-violation nobody caught would also produce one
      // row, and would be a bug.
      for (const [index, response] of responses.entries()) {
        expect(response.ok(), `#${index}: ${JSON.stringify(bodies[index])}`)
          .toBeTruthy();
      }
      expect(ids.size).toBe(1);

      const listed = await (await page.request.get(
        `/api/v1/executions?workflow_id=${workflowId}`)).json();
      expect(listed.items).toHaveLength(1);
    });

  test('the workspace ceiling holds against a concurrent burst of distinct keys',
    async ({ page }) => {
      // The case the suite did not have. Same-key bursts were covered — the
      // unique index settles those — and different keys were only ever fired
      // *sequentially*, which never exercised the window between counting
      // active runs and inserting one.
      //
      // Concurrent, distinct keys: every request counts `ceiling - 1` and
      // every request inserts, so a workspace capped at N ends up with more
      // than N in flight and the quota is a number the product displays
      // rather than one it keeps.
      const me = await (await page.request.get('/api/v1/auth/me')).json();
      const workspaceId = me.workspace.id as string;

      // A ceiling low enough that a burst of this size must hit it, set
      // through the platform API — the same path a real quota change takes.
      const CEILING = 3;
      const BURST = 12;
      const quota = await page.request.put(
        `/api/v1/platform/workspaces/${workspaceId}/quota`,
        { data: { max_concurrent_executions: CEILING } });
      expect(quota.ok(), await quota.text()).toBeTruthy();

      try {
        const responses = await Promise.all(
          Array.from({ length: BURST }, (_, index) => page.request.post(
            `/api/v1/workflows/${workflowId}/executions`, {
              headers: { 'Idempotency-Key': `e2e-burst-${index}-${Date.now().toString(36)}` },
              data: { kind: 'DRAFT' },
            })));

        const accepted = responses.filter((response) => response.ok()).length;
        const refused = responses.length - accepted;

        // Not "some were refused" — the exact promise. More than the ceiling
        // accepted means the count-then-insert raced, which is the whole
        // point of the test.
        expect(accepted,
          `accepted ${accepted} with a ceiling of ${CEILING}`)
          .toBeLessThanOrEqual(CEILING);
        expect(refused, 'a burst of 12 against a ceiling of 3 refused none')
          .toBeGreaterThan(0);

        // And the database agrees: the refusals were refusals, not rows the
        // API declined to mention.
        const listed = await (await page.request.get(
          `/api/v1/executions?workflow_id=${workflowId}&page_size=100`)).json();
        expect(listed.items.length).toBeLessThanOrEqual(CEILING);
      } finally {
        // Back to something a later test can work with.
        await page.request.put(
          `/api/v1/platform/workspaces/${workspaceId}/quota`,
          { data: { max_concurrent_executions: 20 } });
      }
    });

  test('different keys produce different executions', async ({ page }) => {
    // The complementary case. A constraint that collapses everything would
    // also make the test above pass.
    const first = await page.request.post(
      `/api/v1/workflows/${workflowId}/executions`, {
        headers: { 'Idempotency-Key': `e2e-a-${Date.now().toString(36)}` },
        data: { kind: 'DRAFT' },
      });
    const second = await page.request.post(
      `/api/v1/workflows/${workflowId}/executions`, {
        headers: { 'Idempotency-Key': `e2e-b-${Date.now().toString(36)}` },
        data: { kind: 'DRAFT' },
      });
    expect((await first.json()).id).not.toBe((await second.json()).id);
  });

  test('runs with no key at all are not collapsed into one', async ({ page }) => {
    // Why the unique index is partial. A plain unique constraint over the
    // three columns would permit exactly one keyless run per workflow, since
    // Postgres treats nulls as distinct only outside NULLS NOT DISTINCT --
    // and this is the assertion that would have caught getting that wrong.
    const first = await page.request.post(
      `/api/v1/workflows/${workflowId}/executions`, { data: { kind: 'DRAFT' } });
    expect(first.ok()).toBeTruthy();

    // Wait for the first to finish: the per-workflow concurrency ceiling is 1,
    // so a second run while one is active is refused for a different reason.
    await expect.poll(async () => {
      const listed = await (await page.request.get(
        `/api/v1/executions?workflow_id=${workflowId}`)).json();
      return listed.items[0]?.status;
    }, { timeout: 60_000 }).toMatch(/SUCCEEDED|FAILED/);

    const second = await page.request.post(
      `/api/v1/workflows/${workflowId}/executions`, { data: { kind: 'DRAFT' } });
    expect(second.ok(), await second.text()).toBeTruthy();
    expect((await second.json()).id).not.toBe((await first.json()).id);
  });
});

test.describe('webhook idempotency', () => {
  let workflowId: string;
  let hookUrl: string;
  let secret: string;

  test.beforeEach(async ({ page }) => {
    workflowId = await createWorkflow(
      page, unique('E2E hook idem'), 'webhook_trigger');
    const draft = await (await page.request.get(
      `/api/v1/workflows/${workflowId}/draft`)).json();
    await page.request.put(`/api/v1/workflows/${workflowId}/draft`, {
      data: {
        expected_revision: draft.revision,
        graph: simpleGraph('webhook_trigger'),
      },
    });
    await page.request.post(`/api/v1/workflows/${workflowId}/publish`, { data: {} });
    await page.request.post(`/api/v1/workflows/${workflowId}/activate`, { data: {} });

    const trigger = await (await page.request.get(
      `/api/v1/workflows/${workflowId}/trigger`)).json();
    hookUrl = trigger.webhook.url;

    // The signing secret is shown exactly once, when it is rotated.
    const rotated = await (await page.request.post(
      `/api/v1/workflows/${workflowId}/trigger/rotate-secret`)).json();
    secret = rotated.secret;
  });

  test.afterEach(async ({ page }) => {
    await deleteWorkflow(page, workflowId);
  });

  test('a retried delivery with the same Idempotency-Key runs once',
    async ({ page }) => {
      // What a real sender does when it does not get a 2xx in time: send it
      // again. Two runs of a workflow that charges a card is the failure this
      // prevents.
      const body = JSON.stringify({ order: 'A-1001' });
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = createHmac('sha256', secret)
        .update(`${timestamp}.${body}`).digest('hex');
      const key = `delivery-${Date.now().toString(36)}`;

      const headers = {
        'Content-Type': 'application/json',
        'X-Appbi-Timestamp': timestamp,
        'X-Appbi-Signature': `sha256=${signature}`,
        'Idempotency-Key': key,
      };

      // The path is relative to the frontend origin, which proxies /hooks.
      const path = new URL(hookUrl).pathname;
      const [first, second] = await Promise.all([
        page.request.post(path, { headers, data: body }),
        page.request.post(path, { headers, data: body }),
      ]);

      expect(first.status()).toBe(202);
      expect(second.status()).toBe(202);

      await expect.poll(async () => {
        const listed = await (await page.request.get(
          `/api/v1/executions?workflow_id=${workflowId}`)).json();
        return listed.items.length;
      }, { timeout: 60_000 }).toBe(1);

      // Still one after everything has settled, rather than one that becomes
      // two when the second delivery is processed a moment later.
      await page.waitForTimeout(3000);
      const listed = await (await page.request.get(
        `/api/v1/executions?workflow_id=${workflowId}`)).json();
      expect(listed.items).toHaveLength(1);
      expect(listed.items[0].trigger_type).toBe('WEBHOOK');
    });
});

test.describe('the rate limit is shared across replicas', () => {
  /**
   * The only test in the suite that changes the shape of the deployment.
   *
   * An in-process counter multiplies the configured limit by the replica
   * count, and the number it is multiplied by changes whenever somebody
   * scales the deployment -- so the single-replica version of this test would
   * pass against an implementation that is wrong in production and right on a
   * laptop.
   *
   * Scaling needs `deploy/compose.scale.yaml`, which drops the API's published
   * host port: a fixed published port cannot be replicated. With the port
   * gone the API is reached the way a browser reaches it, through the
   * frontend's proxy, and compose's service DNS round-robins across replicas.
   */
  // Addressed at the project under test rather than a hardcoded name: two
  // stacks on one machine, or a CI job that names its project after the
  // branch, would otherwise have this scale somebody else's API.
  const SCALE_OVERLAY = 'deploy/compose.scale.yaml';

  const scaleTo = (replicas: number) =>
    // Deliberately without `--no-recreate`: the existing container holds the
    // published port from the base file, so it has to be recreated under the
    // overlay before a second one can bind.
    compose(['up', '-d', '--scale', `${API_SERVICE}=${replicas}`, API_SERVICE],
      { extraFiles: [SCALE_OVERLAY] });

  const healthyApiReplicas = () =>
    compose(['ps', '--format', '{{.Name}}\t{{.Status}}'],
      { extraFiles: [SCALE_OVERLAY] })
      .split('\n')
      .filter((line) =>
        new RegExp(`^${COMPOSE_PROJECT}-${API_SERVICE}-\\d`).test(line)
        && line.includes('healthy'))
      .length;

  let hookPath: string;
  let workflowId: string;

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage({ storageState: '.auth/owner.json' });
    workflowId = await createWorkflow(
      page, unique('E2E ratelimit'), 'webhook_trigger');
    const draft = await (await page.request.get(
      `/api/v1/workflows/${workflowId}/draft`)).json();
    await page.request.put(`/api/v1/workflows/${workflowId}/draft`, {
      data: {
        expected_revision: draft.revision,
        graph: simpleGraph('webhook_trigger'),
      },
    });
    const trigger = await (await page.request.get(
      `/api/v1/workflows/${workflowId}/trigger`)).json();
    hookPath = new URL(trigger.webhook.url).pathname;
    await page.close();
  });

  test.afterAll(async ({ browser }) => {
    // Back to one replica and the published port, so the rest of the stack --
    // and anything else pointed at the API's host port -- works afterwards.
    // Without the overlay, so the port comes back.
    try {
      compose(['up', '-d', '--scale', `${API_SERVICE}=1`, API_SERVICE]);
    } catch {
      /* teardown should not mask the test's own result */
    }
    const page = await browser.newPage({ storageState: '.auth/owner.json' });

    // The API has just been scaled back to one replica, so the first request
    // through the host port can land while the survivor is still coming up.
    // Retrying is right; swallowing is not -- a bare `.catch(() => {})` here
    // was the last place a failed delete could leave a row behind without
    // saying so, and the run teardown caught exactly this one.
    await expect(async () => {
      await deleteWorkflow(page, workflowId);
    }).toPass({ timeout: 60_000 });

    await page.close();
  });

  test('two API replicas enforce one limit, not two', async ({ page }) => {
    test.slow();

    // The configured per-key, per-minute limit.
    const limit = 120;

    scaleTo(2);
    await expect
      .poll(healthyApiReplicas, { timeout: 180_000 })
      .toBe(2);

    // Asserted again, outside the poll, with a message. A poll that times out
    // reports "expected 2, received 1", which does not say the thing that
    // matters: the rest of this test would then measure one replica and pass,
    // proving nothing about the property it exists for.
    expect(
      healthyApiReplicas(),
      `only ${healthyApiReplicas()} healthy ${API_SERVICE} replica(s) in `
      + `project ${COMPOSE_PROJECT}; this test measures nothing with one`,
    ).toBe(2);

    // A fresh window. Without this the count could already be part-used by an
    // earlier test, and "how many were allowed" would mean nothing.
    const key = `e2e-shared-limit-${Date.now().toString(36)}`;
    const path = `/hooks/${key}`;

    const attempts = limit + 40;
    const statuses: number[] = [];
    for (let i = 0; i < attempts; i += 1) {
      const response = await page.request.post(path, {
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify({ i }),
        failOnStatusCode: false,
      });
      statuses.push(response.status());
    }

    const limited = statuses.filter((status) => status === 429).length;
    const allowed = statuses.length - limited;

    // The key names no real webhook, so every non-429 is a 404. What is being
    // measured is *how many got as far as the lookup* before the limiter
    // started refusing.
    expect(statuses.filter((status) => status === 404).length).toBeGreaterThan(0);

    // The discriminator, and the only assertion that distinguishes a shared
    // counter from a per-replica one: with two replicas counting separately
    // the capacity is 2 x limit, which is more than this burst, so *nothing*
    // would be refused.
    expect(limited, 'a per-replica counter would refuse none of these')
      .toBeGreaterThan(0);

    // The bound the design actually promises. A fixed window can allow up to
    // twice the rate across a boundary -- that is the stated trade for being
    // correct across replicas (ADR-020) -- so asserting `allowed <= limit`
    // exactly would fail whenever a burst happens to straddle a minute.
    expect(allowed).toBeLessThan(limit * 2);

    // In practice the burst finishes inside one window, so the number is the
    // limit plus at most the few that land after a boundary.
    expect(allowed).toBeLessThanOrEqual(limit + 30);
  });
});
