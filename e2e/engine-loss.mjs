/**
 * Wave 0D — engine loss and recovery, against real containers.
 *
 * ADR-010 says the product must never leave a run stuck in RUNNING when the
 * engine disappears, and a worker reconciliation pass is the mechanism. That
 * guarantee has never been exercised: nothing in the repository has ever
 * stopped the engine and watched what happens. `.claude/rules/architecture.md`
 * lists it as an invariant with no mechanical enforcement, which is exactly the
 * kind of claim Wave 0 exists to convert into evidence.
 *
 * This is a script rather than a Playwright spec because it stops and starts
 * containers, and because the reconciler's window is the real configured
 * `execution_stale_after_seconds` (120s) — deliberately not shortened, so the
 * behaviour under test is the deployed one.
 *
 *   node e2e/engine-loss.mjs
 *
 * Requires the stack up, and `e2e/reference-endpoint.mjs` running on the host.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

const API = process.env.WAVE0_API ?? 'http://127.0.0.1:8010';
const REF = `http://host.docker.internal:${process.env.REFERENCE_ENDPOINT_PORT ?? 4599}`;
const ENGINE = process.env.WAVE0_ENGINE_CONTAINER ?? 'appbi-workflow-engine-1';
const EMAIL = process.env.WAVE0_EMAIL ?? 'admin@appbi.vn';
// The browser suite settles the bootstrap account to its own password, so that
// is the one most likely to work here; the bootstrap value is the fallback for
// a genuinely fresh deployment (`e2e/tests/global.setup.ts`).
const SETTLED = process.env.E2E_SETTLED_PASSWORD ?? 'E2EOwnerPassword123';
const INITIAL = process.env.E2E_PASSWORD ?? 'SmokeTestPass123!';
const PASSWORDS = [process.env.WAVE0_PASSWORD, SETTLED, INITIAL].filter(Boolean);

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n        ${detail}` : ''}`);
};

let cookie = '';

async function call(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  if (setCookie.length) cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
  const text = await res.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text.slice(0, 200) }; }
  return { status: res.status, body: json };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const docker = (...args) => run('docker', args, { windowsHide: true });

async function signIn() {
  for (const password of PASSWORDS) {
    const { status, body } = await call('POST', '/api/v1/auth/login', { email: EMAIL, password });
    if (status === 200) {
      if (body.password_change_required) {
        await call('POST', '/api/v1/auth/change-password', {
          current_password: password, new_password: SETTLED,
        });
      }
      return true;
    }
  }
  return false;
}

/** A published workflow whose single step takes `ms` to answer. */
async function slowWorkflow(name, ms) {
  const created = await call('POST', '/api/v1/workflows', { name, trigger_type: 'MANUAL' });
  const id = created.body.id;
  const draft = await call('GET', `/api/v1/workflows/${id}/draft`);
  const graph = {
    nodes: [
      { id: 'start_1', node_key: 'manual_trigger', name: 'Start', position: { x: 0, y: 0 }, config: {} },
      {
        id: 'http_1', node_key: 'http_request', name: 'Slow call',
        position: { x: 240, y: 0 },
        config: { method: 'GET', url: `${REF}/slow?ms=${ms}`, timeout_ms: 120000 },
      },
    ],
    connections: [{ from: { node_id: 'start_1', port: 'main' }, to: { node_id: 'http_1', port: 'main' } }],
  };
  await call('PUT', `/api/v1/workflows/${id}/draft`, {
    graph, expected_revision: draft.body.revision,
  });
  return id;
}

const statusOf = async (executionId) =>
  (await call('GET', `/api/v1/executions/${executionId}`)).body;

/**
 * The product's own terminal set (`backend/app/models/enums.py`).
 *
 * Spelled out rather than approximated. The first version of this harness
 * asked "is it not RUNNING and not QUEUED", which let DISPATCHING through --
 * an ACTIVE status -- and reported a run still in flight as a pass.
 */
const TERMINAL = new Set([
  'SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT', 'FAILED_TO_START', 'ENGINE_INTERRUPTED',
]);

/** Poll until the run reaches a terminal status, or the budget runs out. */
async function settle(executionId, budgetMs) {
  const deadline = Date.now() + budgetMs;
  let state = await statusOf(executionId);
  while (Date.now() < deadline && !TERMINAL.has(state.status)) {
    await sleep(5000);
    state = await statusOf(executionId);
  }
  return state;
}

async function main() {
  console.log(`\nWave 0D — engine loss, against ${API}\n${'-'.repeat(62)}`);

  if (!await signIn()) {
    console.error('Could not sign in. Pass WAVE0_PASSWORD=<current>.');
    process.exit(2);
  }

  // Make sure we start from a healthy engine whatever the last run left behind.
  await docker('start', ENGINE).catch(() => {});
  await sleep(4000);

  // ── Scenario 1: the engine is down before Run ───────────────────────────
  {
    const id = await slowWorkflow(`0D down-before-run ${Date.now()}`, 1000);
    await docker('stop', ENGINE);

    const dispatched = await call('POST', `/api/v1/workflows/${id}/executions`, { kind: 'DRAFT', payload: [{ go: 1 }] });
    // Either the API refuses cleanly, or it accepts and the run ends badly --
    // both are acceptable. Silently succeeding, or hanging, is not.
    let verdict = `dispatch returned ${dispatched.status}`
      + ` ${JSON.stringify(dispatched.body).slice(0, 140)}`;
    // A refusal is acceptable; a 404 is not -- that means this harness asked
    // for the wrong endpoint, which is how the first version reported a false
    // PASS.
    let ok = dispatched.status >= 400 && dispatched.status !== 404;

    if (dispatched.status < 400 && dispatched.body.id) {
      // The full reconciliation window, because a run that cannot dispatch is
      // only resolved by the reconciler: 120s stale plus a 10s poll.
      const state = await settle(dispatched.body.id, 200_000);
      ok = TERMINAL.has(state.status);
      verdict = `execution ended ${state.status} / ${state.error_code ?? 'no code'}`;
    }
    record('engine down before Run: the run reaches a terminal status', ok, verdict);

    // The product stays readable with the engine gone -- the point of the
    // adapter boundary.
    const list = await call('GET', '/api/v1/workflows');
    record('the product stays readable with no engine',
      list.status === 200, `GET /workflows -> ${list.status}`);

    // `/api/v1/engine/status`, the endpoint the smoke test uses. An earlier
    // version of this check asked for a path that does not exist and accepted
    // 404 as a pass, which is the same false-pass shape as the dispatch bug
    // above.
    const health = await call('GET', '/api/v1/engine/status');
    record('engine status answers, and says the engine is not healthy',
      health.status === 200
        && JSON.stringify(health.body).toUpperCase().match(/OFFLINE|DEGRADED|UNAVAILABLE|FALSE/) !== null,
      `engine/status -> ${health.status} ${JSON.stringify(health.body).slice(0, 160)}`);
  }

  // ── Scenario 2: the engine dies mid-run ─────────────────────────────────
  await docker('start', ENGINE);
  await sleep(6000);

  {
    const id = await slowWorkflow(`0D killed-mid-run ${Date.now()}`, 90_000);
    const dispatched = await call('POST', `/api/v1/workflows/${id}/executions`, { kind: 'DRAFT', payload: [{ go: 1 }] });
    if (dispatched.status >= 400) {
      record('dispatch a long run before killing the engine', false,
        `dispatch -> ${dispatched.status} ${JSON.stringify(dispatched.body).slice(0, 160)}`);
    } else {
      const executionId = dispatched.body.id;
      await sleep(4000);
      const before = await statusOf(executionId);
      record('the long run is in flight before the kill',
        ['RUNNING', 'QUEUED'].includes(before.status), `status ${before.status}`);

      // The kill. `kill` rather than `stop`, so nothing gets to shut down
      // politely -- this is the case ADR-010 is about.
      await docker('kill', ENGINE);
      record('engine killed mid-run', true, `docker kill ${ENGINE}`);

      // The reconciler's real window, not a shortened one: 120s stale +
      // a 10s poll, plus room to spare.
      const state = await settle(executionId, 200_000);

      record('the run does not stay active after the engine is gone',
        TERMINAL.has(state.status),
        `ended ${state.status} / ${state.error_code ?? 'no code'}`);
      record('and it is reported as an interruption, not a workflow failure',
        state.status === 'ENGINE_INTERRUPTED' || state.error_code === 'ENGINE_INTERRUPTED',
        `status ${state.status}, code ${state.error_code ?? 'none'}`);
      record('the interruption carries something the user can act on',
        Boolean(state.error_summary || state.error_code),
        `summary ${JSON.stringify(state.error_summary ?? null)}`);
    }
  }

  // ── Scenario 3: the engine comes back ───────────────────────────────────
  await docker('start', ENGINE);
  await sleep(8000);

  {
    const id = await slowWorkflow(`0D after-restart ${Date.now()}`, 500);
    const dispatched = await call('POST', `/api/v1/workflows/${id}/executions`, { kind: 'DRAFT', payload: [{ go: 1 }] });
    let ok = false;
    let detail = `dispatch -> ${dispatched.status}`;
    if (dispatched.status < 400) {
      const state = await settle(dispatched.body.id, 90_000);
      ok = state.status === 'SUCCEEDED';
      detail = `ended ${state.status} / ${state.error_code ?? 'no code'}`;
    }
    record('after the engine returns, a new run succeeds', ok, detail);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`${'-'.repeat(62)}\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    console.log('\nFailed:');
    for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
  }
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error('harness error:', error);
  process.exit(2);
});
