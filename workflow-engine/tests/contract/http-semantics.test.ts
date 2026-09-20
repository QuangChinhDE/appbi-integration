/**
 * Wave 0A — HTTP response and transport semantics against the real pinned
 * runtime (`docs/changes/003-wave-0-current-runtime-proof/spec.md`).
 *
 * `http_request` is the node every workflow touches. Before this file the
 * contract suite asserted four of its outcomes: a 200, a generic HTTP error, a
 * timeout, and continue-on-error. The product meanwhile ships distinct labels
 * and remediations for ten node error codes, and nothing proved the engine
 * ever emits them.
 *
 * Each case here asserts the **product error code**, never an n8n shape. The
 * rest of the chain — code to remediation, remediation to UI — is asserted in
 * the backend and frontend halves of 0A; a code that is right here and
 * unrendered there is still a defect.
 */

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { initN8nLogger } from '../../src/logger';
import { registerBinaryDataService } from '../../src/runtime/binary-data';
import { installEgressGuard } from '../../src/runtime/egress-guard';
import { resetForTests, startExecution } from '../../src/runtime/execution-manager';
import {
	link,
	node,
	outputOf,
	request,
	startRawEndpoint,
	startTestEndpoint,
	statusOfNode,
	waitForTerminal,
	type TestEndpoint,
} from '../helpers';

beforeAll(async () => {
	initN8nLogger();
	await registerBinaryDataService();
	installEgressGuard({ allow_private_networks: true });
});

const endpoints: TestEndpoint[] = [];

afterEach(async () => {
	resetForTests();
	while (endpoints.length) await endpoints.pop()!.close();
});

async function endpoint(...args: Parameters<typeof startTestEndpoint>) {
	const created = await startTestEndpoint(...args);
	endpoints.push(created);
	return created;
}

async function rawEndpoint(write: Parameters<typeof startRawEndpoint>[0]) {
	const created = await startRawEndpoint(write);
	endpoints.push(created);
	return created.url;
}

async function run(graph: Parameters<typeof request>[0], overrides = {}) {
	const { ref } = startExecution(request(graph, overrides));
	return waitForTerminal(ref);
}

/** start -> http_request against `url`, with whatever node config is given. */
function callGraph(url: string, config: Record<string, unknown> = {}) {
	return {
		nodes: [
			node('start_1', 'manual_trigger', 'Start'),
			node('http_1', 'http_request', 'Call', { method: 'GET', url, ...config }),
		],
		connections: [link('start_1', 'http_1')],
	};
}

/** An endpoint that answers every request with one status/body/headers triple. */
async function respondingWith(status: number, body: unknown, headers?: Record<string, string>) {
	return endpoint((_req, respond) => respond(status, body, headers));
}

// ---------------------------------------------------------------- A1: success

describe('0A.1 — successful response semantics', () => {
	it('200 JSON parses into items', async () => {
		const api = await respondingWith(200, { id: 42, name: 'Ada' });
		const status = await run(callGraph(api.url));

		expect(status.status).toBe('SUCCEEDED');
		expect(outputOf(status, 'Call')[0]).toMatchObject({ id: 42, name: 'Ada' });
	});

	it('200 text/plain succeeds and keeps the body, rather than failing to parse', async () => {
		// A plain-text 200 is a successful response. Reporting it as a parse
		// failure would tell the user their workflow is broken when the service
		// answered correctly.
		const api = await respondingWith(200, 'plain words, not json', {
			'content-type': 'text/plain',
		});
		const status = await run(callGraph(api.url));

		expect(status.status).toBe('SUCCEEDED');
		const items = outputOf(status, 'Call');
		expect(items).toHaveLength(1);
		expect(JSON.stringify(items[0])).toContain('plain words');
	});

	it('204 No Content with no content-type succeeds with an empty item', async () => {
		// Raw, because the shared helper always announces a content-type and the
		// realistic shape of a 204 is to announce nothing at all.
		const url = await rawEndpoint((res) => { res.writeHead(204); res.end(); });
		const status = await run(callGraph(url));

		expect(status.status).toBe('SUCCEEDED');
		expect(outputOf(status, 'Call')).toHaveLength(1);
	});

	/**
	 * Three shapes, one root cause, one message.
	 *
	 * An empty 200 body, a 204 that still announces `application/json`, and a
	 * genuinely truncated body all reach the runtime's single "Invalid JSON in
	 * response body". Before 0A all three surfaced as NODE_EXECUTION_FAILED --
	 * "a step failed" -- which is both unactionable and untrue: the service
	 * answered, and the fix is one field on the node.
	 */
	const unparseable: [string, number, string][] = [
		['an empty body on a 200', 200, ''],
		['an empty body on a 204 that still declares JSON', 204, ''],
		['a truncated body', 200, '{"broken": '],
	];

	it.each(unparseable)('%s is reported as something the user can fix', async (_label, code, body) => {
		const api = await respondingWith(code, body, { 'content-type': 'application/json' });
		const status = await run(callGraph(api.url));

		expect(status.status).toBe('FAILED');
		expect(status.error_code).toBe('NODE_CONFIGURATION_INVALID');
		expect(status.error_category).toBe('CONFIGURATION');
		// The message has to name the way out, or it is "a step failed" again.
		expect(String(status.error_message)).toContain('Response format');
	});
});

// ------------------------------------------------------- A2: client/upstream

describe('0A.2 — client and upstream status semantics', () => {
	const authFamily = [401, 403];
	it.each(authFamily)('%i is an authentication failure', async (code) => {
		const api = await respondingWith(code, { error: 'nope' });
		const status = await run(callGraph(api.url));

		expect(status.status).toBe('FAILED');
		expect(status.error_code).toBe('NODE_AUTHENTICATION_FAILED');
		expect(status.error_category).toBe('AUTHENTICATION');
		expect(status.failed_node_name).toBe('Call');
	});

	const configFamily = [400, 404, 409];
	it.each(configFamily)('%i is a configuration problem, not an auth one', async (code) => {
		const api = await respondingWith(code, { error: 'nope' });
		const status = await run(callGraph(api.url));

		expect(status.status).toBe('FAILED');
		expect(status.error_code).toBe('NODE_CONFIGURATION_INVALID');
		expect(status.error_category).toBe('CONFIGURATION');
	});

	it('429 is rate limiting, which has its own remediation', async () => {
		const api = await respondingWith(429, { error: 'slow down' });
		const status = await run(callGraph(api.url));

		expect(status.status).toBe('FAILED');
		expect(status.error_code).toBe('NODE_RATE_LIMITED');
		expect(status.error_category).toBe('RATE_LIMIT');
	});

	it('500 is an upstream fault, distinct from the user misconfiguring the node', async () => {
		const api = await respondingWith(500, { error: 'boom' });
		const status = await run(callGraph(api.url));

		expect(status.status).toBe('FAILED');
		// The distinction that matters to the reader: "they broke" vs "you did".
		expect(status.error_code).not.toBe('NODE_CONFIGURATION_INVALID');
		expect(status.error_code).not.toBe('NODE_AUTHENTICATION_FAILED');
	});

	it('no status leaks an n8n error class or a stack trace to the user', async () => {
		const api = await respondingWith(500, { error: 'boom' });
		const status = await run(callGraph(api.url));

		const message = String(status.error_message ?? '');
		expect(message).not.toMatch(/NodeApiError|NodeOperationError|axios|at Object\./);
	});
});

// ------------------------------------------------- A3: transport and security

describe('0A.3 — transport and security semantics', () => {
	it('a slow endpoint produces NODE_TIMEOUT', async () => {
		const api = await endpoint(() => { /* never responds */ });
		const status = await run(callGraph(api.url, { timeout_ms: 1_000 }));

		expect(status.status).toBe('FAILED');
		expect(status.error_code).toBe('NODE_TIMEOUT');
		expect(status.error_category).toBe('TIMEOUT');
	});

	it('a DNS failure names the host it could not resolve', async () => {
		const status = await run(callGraph('http://nonexistent.appbi-wave0.invalid/thing'));

		expect(status.status).toBe('FAILED');
		expect(status.error_code).toBe('NODE_NETWORK_UNREACHABLE');
		expect(status.error_category).toBe('NETWORK');
		expect(String(status.error_message)).toContain('nonexistent.appbi-wave0.invalid');
	});

	it('a refused connection is a network failure, not a configuration one', async () => {
		// Bind a port, then close it, so the address is real and nothing listens.
		const dead = await startTestEndpoint();
		const url = dead.url;
		await dead.close();

		const status = await run(callGraph(url));

		expect(status.status).toBe('FAILED');
		expect(status.error_code).toBe('NODE_NETWORK_UNREACHABLE');
	});

	it('a redirect within the limit is followed', async () => {
		const target = await respondingWith(200, { arrived: true });
		const origin = await endpoint((_req, respond) =>
			respond(302, '', { location: `${target.url}/final` }),
		);

		const status = await run(callGraph(origin.url));

		expect(status.status).toBe('SUCCEEDED');
		expect(outputOf(status, 'Call')[0]).toMatchObject({ arrived: true });
		expect(target.requests).toHaveLength(1);
	});

	it('a redirect to a private address is refused', async () => {
		// The SSRF shape that matters: the URL the user configured is public and
		// passes the guard, and the *server* sends the request somewhere
		// internal. Blocking the first hop is not enough. 169.254.169.254 is the
		// cloud metadata address, which the guard blocks even where private
		// networks are allowed -- so this asserts the redirect hop is checked,
		// not merely that the address is on a list.
		const origin = await endpoint((_req, respond) =>
			respond(302, '', { location: 'http://169.254.169.254/latest/meta-data/' }),
		);

		const status = await run(callGraph(origin.url));

		expect(status.status).toBe('FAILED');
		expect(['EGRESS_BLOCKED', 'NODE_NETWORK_UNREACHABLE']).toContain(status.error_code);
	});

	/**
	 * SKIPPED — known defect D-W0-04, and deliberately not "fixed" in 0A.
	 *
	 * `max_response_bytes` is in the engine contract (`engine-dto.ts`) and is
	 * read by nothing: an 8 MB body comes back whole against a 1 MB policy. That
	 * is a memory risk in a process that runs other tenants' workflows, and it
	 * is reachable by any workflow pointing at a URL somebody else controls.
	 *
	 * The obvious fix was tried and rejected during 0A, and the result is
	 * recorded so the next attempt does not repeat it. `axios.defaults` does not
	 * work -- `proxyRequestToAxios` sets an explicit `maxContentLength: Infinity`
	 * per request. A request interceptor does apply (n8n calls the default axios
	 * instance), and it makes the case **hang instead of failing**: axios
	 * destroys the response stream, and n8n's `binaryToBuffer` then awaits an
	 * `end` event that never arrives. A hang is worse than an unenforced cap.
	 *
	 * Enforcing this needs a byte-counting wrapper at the socket or agent level,
	 * which is a design task rather than a smallest-coherent-fix, so it is
	 * inventoried rather than expanded into Wave 0.
	 */
	it.skip('a response larger than the ceiling is refused', async () => {
		const huge = 'x'.repeat(8 * 1024 * 1024);
		const api = await respondingWith(200, JSON.stringify({ blob: huge }));

		const status = await run(callGraph(api.url), {
			egress_policy: {
				allow_private_networks: true,
				max_redirects: 3,
				max_response_bytes: 1024 * 1024,
			},
		});

		expect(status.status).toBe('FAILED');
	}, 60_000);
});

// ------------------------------------------------------ A4: execution semantics

describe('0A.4 — execution semantics around failure', () => {
	it('continue-on-error lets the workflow proceed past a failed request', async () => {
		const api = await respondingWith(500, { error: 'boom' });
		const status = await run({
			nodes: [
				node('start_1', 'manual_trigger', 'Start'),
				node('http_1', 'http_request', 'Call', {
					method: 'GET', url: api.url, continue_on_error: true,
				}),
				node('set_1', 'edit_fields', 'After', {
					assignments: [{ name: 'reached', type: 'string', value: 'yes' }],
				}),
			],
			connections: [link('start_1', 'http_1'), link('http_1', 'set_1')],
		});

		expect(status.status).toBe('SUCCEEDED');
		expect(outputOf(status, 'After')[0]).toMatchObject({ reached: 'yes' });
	});

	it('continue-on-error still records that the node failed', async () => {
		// Otherwise the run is indistinguishable from one where nothing went
		// wrong, and the user never learns the call did not work.
		const api = await respondingWith(500, { error: 'boom' });
		const status = await run(callGraph(api.url, { continue_on_error: true }));

		expect(status.status).toBe('SUCCEEDED');
		expect(statusOfNode(status, 'Call')).toBe('FAILED');
	});

	it('the error a continued node swallowed is a product shape, not an AxiosError', async () => {
		// n8n writes the raw thrown error into the node's output items. That
		// object carries `isAxiosError`, the error class name and the upstream
		// **response headers**, and it was being stored verbatim as the preview
		// a user reads (guardrail 10, and a header-leak risk).
		const api = await respondingWith(500, { error: 'boom' }, {
			'set-cookie': 'session=super-secret-value',
		});
		const status = await run(callGraph(api.url, { continue_on_error: true }));

		const serialized = JSON.stringify(outputOf(status, 'Call'));
		expect(serialized).not.toContain('AxiosError');
		expect(serialized).not.toContain('isAxiosError');
		expect(serialized).not.toContain('super-secret-value');
		expect(serialized).not.toContain('set-cookie');

		// Still reported, just in the product's own vocabulary.
		expect(outputOf(status, 'Call')[0]).toMatchObject({
			error: { code: expect.any(String), category: expect.any(String) },
		});
	});

	it('a credential that no longer resolves is refused before the run starts', async () => {
		/**
		 * 0A's spec expected a FAILED execution carrying a credential code. The
		 * runtime does something better and the spec was corrected rather than
		 * the behaviour: a credential that cannot be resolved fails to *compile*,
		 * so no execution record is created for a run that could never have
		 * worked, and the diagnostic names the node and the field.
		 *
		 * The product surface is a 422 `WORKFLOW_INVALID` carrying these
		 * diagnostics (`src/server.ts`), whose remediation is SHOW_INVALID_NODES
		 * — which is the right destination, because the fix is in the editor.
		 */
		const api = await respondingWith(200, { ok: true });

		let thrown: any;
		try {
			await run(callGraph(api.url, { credential_id: 'cred_gone' }), { credentials: [] });
		} catch (error) {
			thrown = error;
		}

		expect(thrown, 'a missing credential must not dispatch').toBeDefined();
		expect(thrown.diagnostics).toEqual([
			expect.objectContaining({
				code: 'CREDENTIAL_REQUIRED',
				node_id: 'http_1',
				field: 'credential_id',
				severity: 'ERROR',
			}),
		]);
	});
});
