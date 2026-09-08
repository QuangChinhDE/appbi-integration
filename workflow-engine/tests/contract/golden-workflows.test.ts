/**
 * Golden workflow tests against the real pinned n8n runtime (SRS 43.3, 43.4).
 *
 * No mocks of the engine. These fifteen graphs are the ones an upgrade has to
 * keep passing, and the assertions are on the *normalized product result* — not
 * on `IRun` — because that is the shape the product depends on. Snapshotting
 * `IRun` would make the tests fail on upstream changes that do not affect the
 * product at all, and pass on ones that do.
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
	startTestEndpoint,
	statusOfNode,
	waitForTerminal,
	type TestEndpoint,
} from '../helpers';

beforeAll(async () => {
	initN8nLogger();
	await registerBinaryDataService();
	// The contract suite talks to a loopback endpoint, so the process-wide guard
	// is installed in its "private networks allowed" configuration. The blocked
	// cases are covered by the egress test, which uses literal metadata IPs that
	// stay blocked either way.
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

async function run(graph: Parameters<typeof request>[0], overrides = {}) {
	const { ref } = startExecution(request(graph, overrides));
	return waitForTerminal(ref);
}

const startOnly = (extra: ReturnType<typeof node>[] = [], links: ReturnType<typeof link>[] = []) => ({
	nodes: [node('start_1', 'manual_trigger', 'Start'), ...extra],
	connections: links,
});

describe('golden workflows', () => {
	// 1
	it('start -> edit fields sets a field on every item', async () => {
		const status = await run(
			startOnly(
				[
					node('set_1', 'edit_fields', 'Label', {
						assignments: [{ name: 'label', type: 'string', value: 'fixed' }],
					}),
				],
				[link('start_1', 'set_1')],
			),
			{ start_payload: [{ a: 1 }, { a: 2 }] },
		);

		expect(status.status).toBe('SUCCEEDED');
		expect(outputOf(status, 'Label')).toEqual([
			{ a: 1, label: 'fixed' },
			{ a: 2, label: 'fixed' },
		]);
	});

	// 2
	it('start -> http request performs a real request', async () => {
		const api = await endpoint((_req, respond) => respond(200, { id: 42, name: 'Ada' }));
		const status = await run(
			startOnly(
				[node('http_1', 'http_request', 'Get customer', { method: 'GET', url: `${api.url}/c/42` })],
				[link('start_1', 'http_1')],
			),
		);

		expect(status.status).toBe('SUCCEEDED');
		expect(outputOf(status, 'Get customer')[0]).toMatchObject({ id: 42, name: 'Ada' });
		expect(api.requests[0].path).toBe('/c/42');
	});

	// 3 + 4
	it('http -> if routes to the true branch and leaves false empty', async () => {
		const api = await endpoint((_req, respond) => respond(200, { status: 'vip' }));
		const status = await run(
			startOnly(
				[
					node('http_1', 'http_request', 'Fetch', { method: 'GET', url: api.url }),
					node('if_1', 'if', 'Is VIP', {
						combinator: 'and',
						conditions: [
							{ left: '={{ $json.status }}', operator: 'equals', value_type: 'string', right: 'vip' },
						],
					}),
					node('set_t', 'edit_fields', 'Yes', {
						assignments: [{ name: 'tier', type: 'string', value: 'VIP' }],
					}),
					node('set_f', 'edit_fields', 'No', {
						assignments: [{ name: 'tier', type: 'string', value: 'STANDARD' }],
					}),
				],
				[
					link('start_1', 'http_1'),
					link('http_1', 'if_1'),
					link('if_1', 'set_t', 'true'),
					link('if_1', 'set_f', 'false'),
				],
			),
		);

		expect(status.status).toBe('SUCCEEDED');
		expect(outputOf(status, 'Yes')[0]).toMatchObject({ tier: 'VIP' });
		// The false branch never ran, and the product says SKIPPED rather than
		// omitting it -- the canvas needs to grey the node out.
		expect(statusOfNode(status, 'No')).toBe('SKIPPED');
	});

	it('if routes to the false branch when the condition fails', async () => {
		const status = await run(
			startOnly(
				[
					node('if_1', 'if', 'Is VIP', {
						combinator: 'and',
						conditions: [
							{ left: '={{ $json.status }}', operator: 'equals', value_type: 'string', right: 'vip' },
						],
					}),
					node('set_f', 'edit_fields', 'No', {
						assignments: [{ name: 'tier', type: 'string', value: 'STANDARD' }],
					}),
				],
				[link('start_1', 'if_1'), link('if_1', 'set_f', 'false')],
			),
			{ start_payload: [{ status: 'basic' }] },
		);

		expect(status.status).toBe('SUCCEEDED');
		expect(outputOf(status, 'No')[0]).toMatchObject({ tier: 'STANDARD' });
	});

	// 5
	it('switch sends each item down its named branch', async () => {
		const status = await run(
			startOnly(
				[
					node('sw_1', 'switch', 'By type', {
						value: '={{ $json.type }}',
						rules: [
							{ output_key: 'a', operator: 'equals', value_type: 'string', compare_to: 'alpha' },
							{ output_key: 'b', operator: 'equals', value_type: 'string', compare_to: 'beta' },
							{ output_key: 'c', operator: 'equals', value_type: 'string', compare_to: 'gamma' },
						],
					}),
					node('set_a', 'edit_fields', 'A', {
						assignments: [{ name: 'branch', type: 'string', value: 'A' }],
					}),
					node('set_b', 'edit_fields', 'B', {
						assignments: [{ name: 'branch', type: 'string', value: 'B' }],
					}),
					node('set_c', 'edit_fields', 'C', {
						assignments: [{ name: 'branch', type: 'string', value: 'C' }],
					}),
				],
				[
					link('start_1', 'sw_1'),
					link('sw_1', 'set_a', 'a'),
					link('sw_1', 'set_b', 'b'),
					link('sw_1', 'set_c', 'c'),
				],
			),
			{ start_payload: [{ type: 'alpha' }, { type: 'gamma' }] },
		);

		expect(status.status).toBe('SUCCEEDED');
		expect(outputOf(status, 'A')[0]).toMatchObject({ type: 'alpha', branch: 'A' });
		expect(outputOf(status, 'C')[0]).toMatchObject({ type: 'gamma', branch: 'C' });
		expect(statusOfNode(status, 'B')).toBe('SKIPPED');
	});

	it('switch sends unmatched items down the fallback branch', async () => {
		// The fallback is the product's own idea: Switch v2 has no extra output,
		// so the compiler appends a catch-all rule. This is the test that pins
		// that mapping -- without it the node crashes inside its own output
		// array, which is exactly how the bug was found.
		const status = await run(
			startOnly(
				[
					node('sw_1', 'switch', 'By tier', {
						value: '={{ $json.tier }}',
						rules: [
							{ output_key: 'vip', operator: 'equals', value_type: 'string', compare_to: 'vip' },
						],
						fallback: 'EXTRA_OUTPUT',
					}),
					node('set_vip', 'edit_fields', 'VIP', {
						assignments: [{ name: 'label', type: 'string', value: 'VIP' }],
					}),
					node('set_other', 'edit_fields', 'Other', {
						assignments: [{ name: 'label', type: 'string', value: 'OTHER' }],
					}),
				],
				[
					link('start_1', 'sw_1'),
					link('sw_1', 'set_vip', 'vip'),
					link('sw_1', 'set_other', 'other'),
				],
			),
			{ start_payload: [{ tier: 'vip' }, { tier: 'free' }, { tier: null }] },
		);

		expect(status.status).toBe('SUCCEEDED');
		expect(outputOf(status, 'VIP')).toHaveLength(1);
		// Both the unmatched value and the null one land in the fallback: a
		// catch-all that missed nulls would silently drop items.
		expect(outputOf(status, 'Other')).toHaveLength(2);
	});

	// 6
	it('two branches merge back into one stream', async () => {
		const status = await run(
			startOnly(
				[
					node('if_1', 'if', 'Split', {
						combinator: 'and',
						conditions: [
							{ left: '={{ $json.n }}', operator: 'gt', value_type: 'number', right: '1' },
						],
					}),
					node('set_hi', 'edit_fields', 'High', {
						assignments: [{ name: 'bucket', type: 'string', value: 'high' }],
					}),
					node('set_lo', 'edit_fields', 'Low', {
						assignments: [{ name: 'bucket', type: 'string', value: 'low' }],
					}),
					node('merge_1', 'merge', 'Recombine', { mode: 'APPEND' }),
				],
				[
					link('start_1', 'if_1'),
					link('if_1', 'set_hi', 'true'),
					link('if_1', 'set_lo', 'false'),
					link('set_hi', 'merge_1', 'main', 'input_1'),
					link('set_lo', 'merge_1', 'main', 'input_2'),
				],
			),
			{ start_payload: [{ n: 0 }, { n: 5 }] },
		);

		expect(status.status).toBe('SUCCEEDED');
		const merged = outputOf(status, 'Recombine');
		expect(merged).toHaveLength(2);
		expect(merged.map((item) => item.bucket).sort()).toEqual(['high', 'low']);
	});

	// 7
	it('an expression can read a named earlier node', async () => {
		const status = await run(
			startOnly(
				[
					node('set_1', 'edit_fields', 'Seed', {
						assignments: [{ name: 'code', type: 'string', value: 'AB-12' }],
					}),
					node('set_2', 'edit_fields', 'Copy', {
						assignments: [
							{ name: 'copied', type: 'string', value: '={{ $node["Seed"].json.code }}' },
						],
					}),
				],
				[link('start_1', 'set_1'), link('set_1', 'set_2')],
			),
		);

		expect(status.status).toBe('SUCCEEDED');
		expect(outputOf(status, 'Copy')[0]).toMatchObject({ copied: 'AB-12' });
	});

	// 8
	it('multi-item input propagates through every node', async () => {
		const status = await run(
			startOnly(
				[
					node('set_1', 'edit_fields', 'Double', {
						assignments: [{ name: 'doubled', type: 'string', value: '={{ $json.n * 2 }}' }],
					}),
				],
				[link('start_1', 'set_1')],
			),
			{ start_payload: [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }] },
		);

		expect(status.status).toBe('SUCCEEDED');
		const items = outputOf(status, 'Double');
		expect(items).toHaveLength(4);
		expect(items.map((item) => item.doubled)).toEqual(['2', '4', '6', '8']);
	});

	// 8b
	it('an IF into a Merge does not execute the branch the condition rejected',
		async () => {
			/**
			 * The most ordinary branching shape there is, and it was silently
			 * wrong: both branches ran and the merged output carried a phantom
			 * record built from empty input, while the canvas showed two green
			 * nodes.
			 *
			 * `WorkflowExecute` reads a node's `requiredInputs` only when
			 * `settings.executionOrder` is 'v1'. Without it every input of a
			 * multi-input node is treated as required, so n8n executed the
			 * rejected branch to satisfy an input Merge had declared it did not
			 * need. Nothing errored; the data was just wrong.
			 */
			const graph = {
				nodes: [
					node('start_1', 'manual_trigger', 'Start'),
					node('gate', 'if', 'Gate', {
						combinator: 'and',
						conditions: [{
							left: '={{ $json.amount }}', operator: 'gt',
							value_type: 'number', right: '100',
						}],
					}),
					node('big', 'edit_fields', 'Big', {
						assignments: [{ name: 'branch', type: 'string', value: 'big' }],
					}),
					node('small', 'edit_fields', 'Small', {
						assignments: [{ name: 'branch', type: 'string', value: 'small' }],
					}),
					node('m', 'merge', 'Merge', { mode: 'APPEND' }),
				],
				connections: [
					link('start_1', 'gate'),
					{ from: { node_id: 'gate', port: 'true' },
					  to: { node_id: 'big', port: 'main' } },
					{ from: { node_id: 'gate', port: 'false' },
					  to: { node_id: 'small', port: 'main' } },
					{ from: { node_id: 'big', port: 'main' },
					  to: { node_id: 'm', port: 'input_1' } },
					{ from: { node_id: 'small', port: 'main' },
					  to: { node_id: 'm', port: 'input_2' } },
				],
			};

			const low = await run(graph, { start_payload: [{ amount: 5 }] });
			expect(low.status).toBe('SUCCEEDED');
			expect(statusOfNode(low, 'Big')).toBe('SKIPPED');
			expect(statusOfNode(low, 'Small')).toBe('SUCCEEDED');
			// One item, from the branch that was actually taken.
			expect(outputOf(low, 'Merge').map((item) => item.branch)).toEqual(['small']);

			// And the mirror image, so the test cannot pass by always skipping
			// the same node.
			const high = await run(graph, { start_payload: [{ amount: 900 }] });
			expect(statusOfNode(high, 'Small')).toBe('SKIPPED');
			expect(statusOfNode(high, 'Big')).toBe('SUCCEEDED');
			expect(outputOf(high, 'Merge').map((item) => item.branch)).toEqual(['big']);
		});

	// 8c
	it('an IF on a boolean field routes on the value, not on its spelling',
		async () => {
			/**
			 * `value_type: boolean` used to land in n8n's *string* condition
			 * bucket, where a real `true` was compared against the text "true"
			 * and never matched. The step ran, the canvas was green, and the
			 * branch simply never fired -- the worst shape a bug can take in a
			 * product whose whole job is deciding which branch to take.
			 */
			const graph = {
				nodes: [
					node('start_1', 'manual_trigger', 'Start'),
					node('gate', 'if', 'Urgent?', {
						combinator: 'and',
						conditions: [{
							left: '={{ $json.rush }}', operator: 'equals',
							value_type: 'boolean', right: 'true',
						}],
					}),
					node('yes', 'edit_fields', 'Rush', {
						assignments: [{ name: 'lane', type: 'string', value: 'rush' }],
					}),
					node('no', 'edit_fields', 'Normal', {
						assignments: [{ name: 'lane', type: 'string', value: 'normal' }],
					}),
				],
				connections: [
					link('start_1', 'gate'),
					{ from: { node_id: 'gate', port: 'true' },
					  to: { node_id: 'yes', port: 'main' } },
					{ from: { node_id: 'gate', port: 'false' },
					  to: { node_id: 'no', port: 'main' } },
				],
			};

			const rush = await run(graph, { start_payload: [{ rush: true }] });
			expect(rush.status).toBe('SUCCEEDED');
			expect(statusOfNode(rush, 'Rush')).toBe('SUCCEEDED');
			expect(statusOfNode(rush, 'Normal')).toBe('SKIPPED');

			const normal = await run(graph, { start_payload: [{ rush: false }] });
			expect(statusOfNode(normal, 'Normal')).toBe('SUCCEEDED');
			expect(statusOfNode(normal, 'Rush')).toBe('SKIPPED');
		});

	// 8d
	it('an IF on a number compares numerically, not lexicographically',
		async () => {
			// The other half of the same decision: "9" > "10" is true as text
			// and false as arithmetic, and a threshold that is wrong only for
			// some values is worse than one that is always wrong.
			const graph = {
				nodes: [
					node('start_1', 'manual_trigger', 'Start'),
					node('gate', 'if', 'Over ten?', {
						combinator: 'and',
						conditions: [{
							left: '={{ $json.n }}', operator: 'gt',
							value_type: 'number', right: '10',
						}],
					}),
					node('yes', 'edit_fields', 'Over', {
						assignments: [{ name: 'lane', type: 'string', value: 'over' }],
					}),
					node('no', 'edit_fields', 'Under', {
						assignments: [{ name: 'lane', type: 'string', value: 'under' }],
					}),
				],
				connections: [
					link('start_1', 'gate'),
					{ from: { node_id: 'gate', port: 'true' },
					  to: { node_id: 'yes', port: 'main' } },
					{ from: { node_id: 'gate', port: 'false' },
					  to: { node_id: 'no', port: 'main' } },
				],
			};

			const nine = await run(graph, { start_payload: [{ n: 9 }] });
			expect(statusOfNode(nine, 'Under')).toBe('SUCCEEDED');
			expect(statusOfNode(nine, 'Over')).toBe('SKIPPED');

			const eleven = await run(graph, { start_payload: [{ n: 11 }] });
			expect(statusOfNode(eleven, 'Over')).toBe('SUCCEEDED');
			expect(statusOfNode(eleven, 'Under')).toBe('SKIPPED');
		});

	// 9
	it('a bearer credential reaches the request as an Authorization header', async () => {
		const api = await endpoint((_req, respond) => respond(200, { ok: true }));
		const status = await run(
			startOnly(
				[
					node('http_1', 'http_request', 'Call', {
						method: 'GET',
						url: api.url,
						credential_id: 'cred_1',
					}),
				],
				[link('start_1', 'http_1')],
			),
			{
				credentials: [
					{ credential_id: 'cred_1', credential_type: 'BEARER', data: { token: 's3cr3t-token' } },
				],
			},
		);

		expect(status.status).toBe('SUCCEEDED');
		expect(api.requests[0].headers.authorization).toBe('Bearer s3cr3t-token');
	});

	// 10
	it('an HTTP error becomes a product error code, not a stack trace', async () => {
		const api = await endpoint((_req, respond) => respond(401, { message: 'nope' }));
		const status = await run(
			startOnly(
				[node('http_1', 'http_request', 'Call', { method: 'GET', url: api.url })],
				[link('start_1', 'http_1')],
			),
		);

		expect(status.status).toBe('FAILED');
		expect(status.error_code).toBe('NODE_AUTHENTICATION_FAILED');
		expect(status.error_category).toBe('AUTHENTICATION');
		expect(status.failed_node_name).toBe('Call');
		// The user-facing message is the product's, never upstream's.
		expect(status.error_message).not.toContain('AxiosError');
	});

	// 11
	it('a slow endpoint produces NODE_TIMEOUT', async () => {
		const api = await endpoint((_req, respond) => {
			setTimeout(() => respond(200, { late: true }), 2_000);
		});
		const status = await run(
			startOnly(
				[
					node('http_1', 'http_request', 'Slow', {
						method: 'GET',
						url: api.url,
						timeout_ms: 1_000,
					}),
				],
				[link('start_1', 'http_1')],
			),
		);

		expect(status.status).toBe('FAILED');
		expect(status.error_code).toBe('NODE_TIMEOUT');
	}, 20_000);

	// 12
	it('continue-on-error keeps the workflow running past a failed request', async () => {
		const api = await endpoint((_req, respond) => respond(500, { message: 'boom' }));
		const status = await run(
			startOnly(
				[
					node('http_1', 'http_request', 'Call', {
						method: 'GET',
						url: api.url,
						continue_on_error: true,
					}),
					node('set_1', 'edit_fields', 'After', {
						assignments: [{ name: 'reached', type: 'string', value: 'yes' }],
					}),
				],
				[link('start_1', 'http_1'), link('http_1', 'set_1')],
			),
		);

		expect(status.status).toBe('SUCCEEDED');
		expect(outputOf(status, 'After')[0]).toMatchObject({ reached: 'yes' });
	});

	// 13
	it('a node outside the allowlist is refused before anything runs', async () => {
		expect(() =>
			startExecution(
				request({
					nodes: [
						node('start_1', 'manual_trigger', 'Start'),
						node('bad_1', 'shell_command', 'Run shell'),
					],
					connections: [link('start_1', 'bad_1')],
				}),
			),
		).toThrowError(/compile failed/);
	});

	it('a disabled node and an uncertified node version are both refused', async () => {
		for (const key of ['disabled_node', 'uncertified_version']) {
			expect(() =>
				startExecution(
					request({
						nodes: [node('start_1', 'manual_trigger', 'Start'), node('n_1', key, 'Nope')],
						connections: [link('start_1', 'n_1')],
					}),
				),
			).toThrowError(/compile failed/);
		}
	});

	// 14
	it('an expression that will not parse is reported as EXPRESSION_INVALID', async () => {
		const status = await run(
			startOnly(
				[
					node('set_1', 'edit_fields', 'Broken', {
						assignments: [{ name: 'value', type: 'string', value: '={{ 1 + }}' }],
					}),
				],
				[link('start_1', 'set_1')],
			),
		);

		expect(status.status).toBe('FAILED');
		expect(status.error_code).toBe('EXPRESSION_INVALID');
	});

	it('a missing path in an expression resolves to null rather than failing', async () => {
		// Pinning upstream behaviour, not endorsing it. The 1.14 expression
		// runtime is lenient: a missing property, a method call on undefined and
		// an unknown variable all resolve to null and the workflow succeeds. That
		// is a product-visible fact -- a user debugging an empty field needs to
		// know the run did not fail -- and an upgrade that changes it must show up
		// here rather than in somebody's production workflow.
		const status = await run(
			startOnly(
				[
					node('set_1', 'edit_fields', 'Lenient', {
						assignments: [
							{ name: 'a', type: 'string', value: '={{ $json.missing.deeper.gone }}' },
							{ name: 'b', type: 'string', value: '={{ $json.missing.toUpperCase() }}' },
						],
					}),
				],
				[link('start_1', 'set_1')],
			),
		);

		expect(status.status).toBe('SUCCEEDED');
		expect(outputOf(status, 'Lenient')[0]).toMatchObject({ a: null, b: null });
	});

	// 15
	it('a secret in a response body is redacted in the stored preview', async () => {
		const api = await endpoint((_req, respond) =>
			respond(200, {
				id: 7,
				access_token: 'super-secret-value',
				nested: { api_key: 'another-secret' },
			}),
		);
		const status = await run(
			startOnly(
				[node('http_1', 'http_request', 'Call', { method: 'GET', url: api.url })],
				[link('start_1', 'http_1')],
			),
		);

		expect(status.status).toBe('SUCCEEDED');
		const body = JSON.stringify(outputOf(status, 'Call'));
		expect(body).not.toContain('super-secret-value');
		expect(body).not.toContain('another-secret');
		expect(body).toContain('********');
	});

	it('a credential value never appears in any result the engine returns', async () => {
		const api = await endpoint((_req, respond) => respond(200, { ok: true }));
		const status = await run(
			startOnly(
				[
					node('http_1', 'http_request', 'Call', {
						method: 'GET',
						url: api.url,
						credential_id: 'cred_1',
					}),
				],
				[link('start_1', 'http_1')],
			),
			{
				credentials: [
					{
						credential_id: 'cred_1',
						credential_type: 'HEADER_API_KEY',
						data: { header_name: 'X-API-Key', value: 'leak-me-if-you-can' },
					},
				],
			},
		);

		expect(status.status).toBe('SUCCEEDED');
		expect(JSON.stringify(status)).not.toContain('leak-me-if-you-can');
	});
});

describe('cancellation', () => {
	it('cancels an in-flight run and reports CANCELLED', async () => {
		const api = await endpoint((_req, respond) => {
			setTimeout(() => respond(200, { late: true }), 5_000);
		});
		const { ref } = startExecution(
			request(
				startOnly(
					[node('http_1', 'http_request', 'Slow', { method: 'GET', url: api.url })],
					[link('start_1', 'http_1')],
				),
			),
		);

		const { cancelExecution, statusOf } = await import('../../src/runtime/execution-manager');
		await new Promise((resolve) => setTimeout(resolve, 200));
		cancelExecution(ref);
		// Idempotent: asking twice is the same question, not a second command.
		cancelExecution(ref);

		const final = await waitForTerminal(ref, 15_000);
		expect(final.status).toBe('CANCELLED');
		expect(statusOf(ref)?.status).toBe('CANCELLED');
	}, 25_000);

	it('cancelling an unknown ref answers with null rather than throwing', async () => {
		const { cancelExecution } = await import('../../src/runtime/execution-manager');
		expect(cancelExecution('eng_does_not_exist')).toBeNull();
	});
});

describe('idempotency', () => {
	it('the same idempotency key does not start a second run', async () => {
		const first = startExecution(
			request(
				startOnly(
					[
						node('set_1', 'edit_fields', 'Once', {
							assignments: [{ name: 'x', type: 'string', value: '1' }],
						}),
					],
					[link('start_1', 'set_1')],
				),
				{ idempotency_key: 'key-abc' },
			),
		);
		const second = startExecution(
			request(
				startOnly(
					[
						node('set_1', 'edit_fields', 'Once', {
							assignments: [{ name: 'x', type: 'string', value: '1' }],
						}),
					],
					[link('start_1', 'set_1')],
				),
				{ idempotency_key: 'key-abc' },
			),
		);

		expect(second.ref).toBe(first.ref);
		await waitForTerminal(first.ref);
	});
});
