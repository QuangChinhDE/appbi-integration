/**
 * The internal HTTP contract (SRS 31.4 items 1-3, 18-20).
 *
 * Exercised over a real socket rather than by calling the handlers, because the
 * things worth checking here are the parts a function call would skip: the
 * token gate, the status codes the product's adapter branches on, and the JSON
 * envelope shape.
 */

import type { Server } from 'node:http';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { config } from '../../src/config';
import { bootstrap } from '../../src/server';
import { resetForTests } from '../../src/runtime/execution-manager';
import { link, node, request as buildRequest } from '../helpers';

let server: Server;
let base: string;

async function call(
	path: string,
	options: { method?: string; body?: unknown; token?: string | null } = {},
) {
	const headers: Record<string, string> = { 'content-type': 'application/json' };
	const token = options.token === undefined ? config.token : options.token;
	if (token !== null) headers['X-Engine-Token'] = token;

	const response = await fetch(`${base}${path}`, {
		method: options.method ?? 'GET',
		headers,
		body: options.body === undefined ? undefined : JSON.stringify(options.body),
	});
	const text = await response.text();
	return { status: response.status, body: text ? JSON.parse(text) : null };
}

beforeAll(async () => {
	// No egress override here on purpose: the guard only inspects lookups made
	// inside an execution scope, so the test's own loopback client -- like the
	// engine's own listening socket -- is not its business. The workflow this
	// suite runs reaches no network at all.
	const app = await bootstrap();
	server = await new Promise<Server>((resolve) => {
		const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
	});
	const address = server.address();
	const port = typeof address === 'object' && address ? address.port : 0;
	base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
	resetForTests();
	await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('engine internal API', () => {
	it('refuses every route without the shared token', async () => {
		for (const path of ['/internal/healthz', '/internal/capabilities']) {
			const response = await call(path, { token: null });
			expect(response.status).toBe(401);
			expect(response.body.error.code).toBe('ENGINE_UNAUTHORIZED');
		}
	});

	it('reports health with the loaded node set', async () => {
		const response = await call('/internal/healthz');
		expect(response.status).toBe(200);
		expect(response.body.status).toBe('HEALTHY');
		expect(response.body.contract_version).toBe('1');
		expect(response.body.loaded_nodes).toContain('n8n-nodes-base.httpRequest');
		expect(response.body.loaded_nodes).toContain('appbi.start');
	});

	it('reports readiness and capabilities, including the features it will not do', async () => {
		expect((await call('/internal/readyz')).status).toBe(200);

		const capabilities = await call('/internal/capabilities');
		expect(capabilities.body.supported_node_keys).toEqual(
			expect.arrayContaining(['http_request', 'if', 'merge', 'switch', 'edit_fields']),
		);
		expect(capabilities.body.features).toMatchObject({
			code_node: false,
			community_nodes: false,
			wait_resume: false,
			sub_workflows: false,
			cancellation: true,
		});
	});

	it('accepts a valid graph on validate and reports a compiled hash', async () => {
		const payload = buildRequest({
			nodes: [
				node('start_1', 'manual_trigger', 'Start'),
				node('set_1', 'edit_fields', 'Label', {
					assignments: [{ name: 'x', type: 'string', value: '1' }],
				}),
			],
			connections: [link('start_1', 'set_1')],
		});

		const response = await call('/internal/validate', { method: 'POST', body: payload });
		expect(response.status).toBe(200);
		expect(response.body.ok).toBe(true);
		expect(response.body.compiled_hash).toMatch(/^[0-9a-f]{64}$/);
		expect(response.body.compiler_version).toBe('1');
	});

	it('validate accepts a credential described without its secret', async () => {
		// This is how the product validates: it knows the credential exists and
		// what type it is, and deliberately does not send the value to a dry run.
		// The compiler must be satisfied by that -- when it was not, every
		// workflow that authenticated to anything was impossible to publish.
		const payload = buildRequest(
			{
				nodes: [
					node('start_1', 'manual_trigger', 'Start'),
					node('http_1', 'http_request', 'Call', {
						method: 'GET',
						url: 'https://api.example.com/customers',
						credential_id: 'cred_1',
					}),
				],
				connections: [link('start_1', 'http_1')],
			},
			{
				credentials: [
					{ credential_id: 'cred_1', credential_type: 'BEARER', data: {} },
				],
			},
		);

		const response = await call('/internal/validate', { method: 'POST', body: payload });
		expect(response.status).toBe(200);
		expect(response.body.ok).toBe(true);
		expect(response.body.diagnostics ?? []).toEqual([]);
	});

	it('validate still reports a credential the graph names but nothing supplies', async () => {
		// The complementary case: an unresolvable reference is a real finding,
		// and the fix above must not have turned it into silence.
		const payload = buildRequest({
			nodes: [
				node('start_1', 'manual_trigger', 'Start'),
				node('http_1', 'http_request', 'Call', {
					method: 'GET',
					url: 'https://api.example.com/customers',
					credential_id: 'cred_missing',
				}),
			],
			connections: [link('start_1', 'http_1')],
		});

		const response = await call('/internal/validate', { method: 'POST', body: payload });
		expect(response.body.ok).toBe(false);
		expect(response.body.diagnostics).toEqual([
			expect.objectContaining({ code: 'CREDENTIAL_REQUIRED', node_id: 'http_1' }),
		]);
	});

	it('validate is deterministic for the same graph', async () => {
		// SRS 25.6: same graph + same registry + same compiler must compile
		// identically, or a regression after an upgrade cannot be attributed.
		const payload = buildRequest({
			nodes: [
				node('start_1', 'manual_trigger', 'Start'),
				node('set_1', 'edit_fields', 'Label', {
					assignments: [{ name: 'x', type: 'string', value: '1' }],
				}),
			],
			connections: [link('start_1', 'set_1')],
		});

		const first = await call('/internal/validate', { method: 'POST', body: payload });
		const second = await call('/internal/validate', { method: 'POST', body: payload });
		expect(second.body.compiled_hash).toBe(first.body.compiled_hash);
	});

	it('rejects an invalid graph with diagnostics addressed to nodes', async () => {
		const payload = buildRequest({
			nodes: [node('start_1', 'manual_trigger', 'Start'), node('x_1', 'code_node', 'Run code')],
			connections: [link('start_1', 'x_1')],
		});

		const response = await call('/internal/validate', { method: 'POST', body: payload });
		expect(response.status).toBe(200);
		expect(response.body.ok).toBe(false);
		expect(response.body.diagnostics[0]).toMatchObject({
			code: 'NODE_UNSUPPORTED',
			node_id: 'x_1',
			severity: 'ERROR',
		});
	});

	it('rejects a graph with no trigger', async () => {
		const payload = buildRequest({
			nodes: [
				node('set_1', 'edit_fields', 'Label', {
					assignments: [{ name: 'x', type: 'string', value: '1' }],
				}),
			],
			connections: [],
		});

		const response = await call('/internal/validate', { method: 'POST', body: payload });
		expect(response.body.ok).toBe(false);
		expect(response.body.diagnostics.map((d: any) => d.code)).toContain('TRIGGER_REQUIRED');
	});

	it('runs a workflow end to end over HTTP and answers 202 then a terminal state', async () => {
		const payload = buildRequest({
			nodes: [
				node('start_1', 'manual_trigger', 'Start'),
				node('set_1', 'edit_fields', 'Label', {
					assignments: [{ name: 'greeting', type: 'string', value: '={{ $json.hello }} there' }],
				}),
			],
			connections: [link('start_1', 'set_1')],
		});

		const dispatched = await call('/internal/executions', { method: 'POST', body: payload });
		expect(dispatched.status).toBe(202);
		expect(dispatched.body.ref).toMatch(/^eng_/);

		let final: any = null;
		for (let attempt = 0; attempt < 200; attempt += 1) {
			const status = await call(`/internal/executions/${dispatched.body.ref}`);
			expect(status.status).toBe(200);
			if (status.body.status !== 'RUNNING') {
				final = status.body;
				break;
			}
			await new Promise((resolve) => setTimeout(resolve, 25));
		}

		expect(final?.status).toBe('SUCCEEDED');
		expect(final.execution_id).toBe(payload.execution_id);
		expect(final.node_results.find((r: any) => r.node_name === 'Label').output_preview.items[0])
			.toMatchObject({ greeting: 'world there' });
		// Admin-only diagnostics travel in `technical`, and nowhere else.
		expect(final.technical).toMatchObject({ contract_version: '1', compiler_version: '1' });
	});

	it('answers 422 with diagnostics when a dispatched graph cannot compile', async () => {
		const payload = buildRequest({
			nodes: [node('start_1', 'manual_trigger', 'Start'), node('x_1', 'shell', 'Shell')],
			connections: [link('start_1', 'x_1')],
		});

		const response = await call('/internal/executions', { method: 'POST', body: payload });
		expect(response.status).toBe(422);
		expect(response.body.error.code).toBe('WORKFLOW_INVALID');
		expect(response.body.diagnostics.length).toBeGreaterThan(0);
	});

	it('answers 404 for an unknown execution ref, distinct from being unreachable', async () => {
		const response = await call('/internal/executions/eng_nope');
		expect(response.status).toBe(404);
		expect(response.body.error.code).toBe('ENGINE_EXECUTION_UNKNOWN');
	});

	it('cancel on an unknown ref is 404, and cancel is idempotent on a finished run', async () => {
		expect((await call('/internal/executions/eng_nope/cancel', { method: 'POST' })).status)
			.toBe(404);

		const payload = buildRequest({
			nodes: [
				node('start_1', 'manual_trigger', 'Start'),
				node('set_1', 'edit_fields', 'Label', {
					assignments: [{ name: 'x', type: 'string', value: '1' }],
				}),
			],
			connections: [link('start_1', 'set_1')],
		});
		const dispatched = await call('/internal/executions', { method: 'POST', body: payload });
		const ref = dispatched.body.ref;

		for (let attempt = 0; attempt < 200; attempt += 1) {
			const status = await call(`/internal/executions/${ref}`);
			if (status.body.status !== 'RUNNING') break;
			await new Promise((resolve) => setTimeout(resolve, 25));
		}

		const first = await call(`/internal/executions/${ref}/cancel`, { method: 'POST' });
		const second = await call(`/internal/executions/${ref}/cancel`, { method: 'POST' });
		expect(first.status).toBe(200);
		expect(second.status).toBe(200);
		// Already terminal: cancel reports the state it found, it does not
		// rewrite a finished run as cancelled.
		expect(first.body.status).toBe('SUCCEEDED');
		expect(second.body.status).toBe('SUCCEEDED');
	});

	it('rejects a request with no graph', async () => {
		const response = await call('/internal/executions', {
			method: 'POST',
			body: { execution_id: 'x' },
		});
		expect(response.status).toBe(400);
		expect(response.body.error.code).toBe('ENGINE_BAD_REQUEST');
	});

	it('has no route outside /internal', async () => {
		const response = await call('/api/v1/workflows');
		expect(response.status).toBe(404);
		expect(response.body.error.code).toBe('ENGINE_NOT_FOUND');
	});
});
