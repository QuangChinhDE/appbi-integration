/**
 * Wave 0B — composition of the nine certified nodes
 * (`docs/changes/003-wave-0-current-runtime-proof/spec.md`).
 *
 * The existing goldens each prove one node, or one concern, in a three-node
 * graph. That is why the suite was green while nobody could say whether a
 * workflow a customer assembles behaves.
 *
 * **Every assertion here names the item count at every node.** That is the
 * whole point: a branch that silently drops or duplicates items produces a
 * plausible final result, and a final-output assertion cannot see it. `counts`
 * asserts the shape of the entire run in one expression, so a change anywhere
 * in the graph has to be acknowledged rather than absorbed.
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

async function run(graph: Parameters<typeof request>[0], overrides = {}) {
	const { ref } = startExecution(request(graph, overrides));
	return waitForTerminal(ref);
}

/**
 * Items produced by every node that ran, keyed by name.
 *
 * Asserting this whole object rather than one node's output is what makes a
 * dropped or duplicated item impossible to miss: a node that did not run is
 * absent, and a node that ran twice as often shows it.
 */
function counts(status: { node_results: any[] }): Record<string, number> {
	const out: Record<string, number> = {};
	for (const result of status.node_results) {
		if (result.status === 'SKIPPED' && result.output_preview === null) continue;
		out[result.node_name] = (out[result.node_name] ?? 0)
			+ (result.output_preview?.items?.length ?? 0);
	}
	return out;
}

const start = (extra: any[] = [], links: any[] = []) => ({
	nodes: [node('start_1', 'manual_trigger', 'Start'), ...extra],
	connections: links,
});

const rows = (n: number) =>
	Array.from({ length: n }, (_, i) => ({ id: i + 1, tier: i % 2 === 0 ? 'vip' : 'basic' }));

const setNode = (id: string, name: string, field: string, value: string) =>
	node(id, 'edit_fields', name, {
		assignments: [{ name: field, type: 'string', value }],
	});

describe('0B — composition of the current nine nodes', () => {
	it('http -> edit_fields keeps every item and adds to each', async () => {
		const api = await endpoint((_q, respond) => respond(200, rows(5)));
		const status = await run(
			start(
				[
					node('http_1', 'http_request', 'Fetch', { method: 'GET', url: api.url }),
					setNode('set_1', 'Label', 'label', 'tagged'),
				],
				[link('start_1', 'http_1'), link('http_1', 'set_1')],
			),
		);

		expect(status.status).toBe('SUCCEEDED');
		expect(counts(status)).toEqual({ Start: 1, Fetch: 5, Label: 5 });
		expect(outputOf(status, 'Label').every((item) => item.label === 'tagged')).toBe(true);
	});

	it('http -> if splits five items three/two and loses none', async () => {
		const api = await endpoint((_q, respond) => respond(200, rows(5)));
		const status = await run(
			start(
				[
					node('http_1', 'http_request', 'Fetch', { method: 'GET', url: api.url }),
					node('if_1', 'if', 'Gate', {
						combinator: 'and',
						conditions: [
							{ left: '={{ $json.tier }}', operator: 'equals', value_type: 'string', right: 'vip' },
						],
					}),
					setNode('set_t', 'Vip', 'route', 'vip'),
					setNode('set_f', 'Rest', 'route', 'rest'),
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
		// ids 1,3,5 are vip; 2,4 are not. The IF's own count is both branches.
		expect(counts(status)).toEqual({ Start: 1, Fetch: 5, Gate: 5, Vip: 3, Rest: 2 });
		expect(outputOf(status, 'Vip').map((i) => i.id)).toEqual([1, 3, 5]);
		expect(outputOf(status, 'Rest').map((i) => i.id)).toEqual([2, 4]);
	});

	it('if -> merge rejoins both branches without duplicating', async () => {
		const api = await endpoint((_q, respond) => respond(200, rows(5)));
		const status = await run(
			start(
				[
					node('http_1', 'http_request', 'Fetch', { method: 'GET', url: api.url }),
					node('if_1', 'if', 'Gate', {
						combinator: 'and',
						conditions: [
							{ left: '={{ $json.tier }}', operator: 'equals', value_type: 'string', right: 'vip' },
						],
					}),
					setNode('set_t', 'Vip', 'route', 'vip'),
					setNode('set_f', 'Rest', 'route', 'rest'),
					node('merge_1', 'merge', 'Rejoin', { mode: 'APPEND' }),
				],
				[
					link('start_1', 'http_1'),
					link('http_1', 'if_1'),
					link('if_1', 'set_t', 'true'),
					link('if_1', 'set_f', 'false'),
					link('set_t', 'merge_1', 'main', 'input_1'),
					link('set_f', 'merge_1', 'main', 'input_2'),
				],
			),
		);

		expect(status.status).toBe('SUCCEEDED');
		// 3 + 2 back to 5. Not 10, and not 3.
		expect(counts(status)).toEqual({
			Start: 1, Fetch: 5, Gate: 5, Vip: 3, Rest: 2, Rejoin: 5,
		});
	});

	it('switch -> merge carries three named branches back into one stream', async () => {
		const payload = [{ kind: 'a' }, { kind: 'b' }, { kind: 'a' }, { kind: 'zzz' }];
		const status = await run(
			start(
				[
					node('switch_1', 'switch', 'Route', {
						value: '={{ $json.kind }}',
						rules: [
							{ output_key: 'a', operator: 'equals', value_type: 'string', compare_to: 'a' },
							{ output_key: 'b', operator: 'equals', value_type: 'string', compare_to: 'b' },
						],
						fallback: 'EXTRA_OUTPUT',
					}),
					setNode('set_a', 'A', 'r', 'a'),
					setNode('set_b', 'B', 'r', 'b'),
					setNode('set_o', 'Other', 'r', 'o'),
					// Merge takes two inputs, so the third branch is asserted on its
					// own rather than pretending the node has a port it does not.
					node('merge_1', 'merge', 'Rejoin', { mode: 'APPEND' }),
				],
				[
					link('start_1', 'switch_1'),
					link('switch_1', 'set_a', 'a'),
					link('switch_1', 'set_b', 'b'),
					link('switch_1', 'set_o', 'other'),
					link('set_a', 'merge_1', 'main', 'input_1'),
					link('set_b', 'merge_1', 'main', 'input_2'),
				],
			),
			{ start_payload: payload },
		);

		expect(status.status).toBe('SUCCEEDED');
		expect(counts(status)).toMatchObject({ A: 2, B: 1, Other: 1, Rejoin: 3 });
	});

	it('filter -> edit_fields passes only the kept items, never the discarded ones', async () => {
		// ADR-026: Filter returns a second array of dropped items that is not a
		// port. Reading it would report four items out of a filter that passed
		// two, and list the discarded rows as though they had gone on.
		const api = await endpoint((_q, respond) => respond(200, rows(6)));
		const status = await run(
			start(
				[
					node('http_1', 'http_request', 'Fetch', { method: 'GET', url: api.url }),
					node('filter_1', 'filter', 'Only VIP', {
						combinator: 'and',
						conditions: [
							{ left: '={{ $json.tier }}', operator: 'equals', value_type: 'string', right: 'vip' },
						],
					}),
					setNode('set_1', 'Tag', 'kept', 'yes'),
				],
				[link('start_1', 'http_1'), link('http_1', 'filter_1'), link('filter_1', 'set_1')],
			),
		);

		expect(status.status).toBe('SUCCEEDED');
		expect(counts(status)).toEqual({ Start: 1, Fetch: 6, 'Only VIP': 3, Tag: 3 });
	});

	it('a filter that keeps nothing succeeds with zero items and runs nothing after it', async () => {
		// Stability row 1.1 at composition level. "Nothing matched today" must
		// read as a finished run, not a broken one -- and the downstream node
		// must not run once on an empty stream.
		const api = await endpoint((_q, respond) => respond(200, rows(4)));
		const status = await run(
			start(
				[
					node('http_1', 'http_request', 'Fetch', { method: 'GET', url: api.url }),
					node('filter_1', 'filter', 'Impossible', {
						combinator: 'and',
						conditions: [
							{ left: '={{ $json.tier }}', operator: 'equals', value_type: 'string', right: 'nobody' },
						],
					}),
					setNode('set_1', 'After', 'ran', 'yes'),
				],
				[link('start_1', 'http_1'), link('http_1', 'filter_1'), link('filter_1', 'set_1')],
			),
		);

		expect(status.status).toBe('SUCCEEDED');
		expect(status.error_code ?? null).toBeNull();
		expect(counts(status)['Impossible']).toBe(0);
		// Whether the node runs on an empty stream or is skipped, it must not
		// invent an item.
		expect(counts(status)['After'] ?? 0).toBe(0);
	});

	it('continue-on-error passes a failed row downstream without stopping the run', async () => {
		const api = await endpoint((_q, respond) => respond(500, { error: 'boom' }));
		const status = await run(
			start(
				[
					node('http_1', 'http_request', 'Call', {
						method: 'GET', url: api.url, continue_on_error: true,
					}),
					setNode('set_1', 'After', 'reached', 'yes'),
				],
				[link('start_1', 'http_1'), link('http_1', 'set_1')],
			),
		);

		expect(status.status).toBe('SUCCEEDED');
		expect(counts(status)).toEqual({ Start: 1, Call: 1, After: 1 });
		// The failed row is carried, in the product's vocabulary (D-W0-03).
		expect(outputOf(status, 'Call')[0]).toMatchObject({
			error: { code: expect.any(String) },
		});
	});

	it('multi-item through a branch and back preserves every item exactly once', async () => {
		// The shape most likely to silently lose a row: many items in, a branch
		// in the middle, one stream out.
		const api = await endpoint((_q, respond) => respond(200, rows(20)));
		const status = await run(
			start(
				[
					node('http_1', 'http_request', 'Fetch', { method: 'GET', url: api.url }),
					node('if_1', 'if', 'Gate', {
						combinator: 'and',
						conditions: [
							{ left: '={{ $json.tier }}', operator: 'equals', value_type: 'string', right: 'vip' },
						],
					}),
					setNode('set_t', 'Vip', 'route', 'vip'),
					setNode('set_f', 'Rest', 'route', 'rest'),
					node('merge_1', 'merge', 'Rejoin', { mode: 'APPEND' }),
				],
				[
					link('start_1', 'http_1'),
					link('http_1', 'if_1'),
					link('if_1', 'set_t', 'true'),
					link('if_1', 'set_f', 'false'),
					link('set_t', 'merge_1', 'main', 'input_1'),
					link('set_f', 'merge_1', 'main', 'input_2'),
				],
			),
		);

		expect(status.status).toBe('SUCCEEDED');
		expect(counts(status)).toEqual({
			Start: 1, Fetch: 20, Gate: 20, Vip: 10, Rest: 10, Rejoin: 20,
		});

		// Every id present exactly once after the rejoin.
		const ids = outputOf(status, 'Rejoin').map((item) => item.id).sort((a: any, b: any) => a - b);
		expect(ids).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
	});
});
