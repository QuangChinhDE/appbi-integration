/**
 * Item fan-out semantics — a product contract, not an n8n implementation
 * detail.
 *
 * AppBI's App-to-App integration story rests on this behaviour: a JSON array
 * response becomes one item per element, and a downstream node executes once
 * per item carrying that item's own values. Every "call API B for each row of
 * API A" workflow depends on it, and no product node implements it — it is
 * inherited from the execution runtime, which is precisely why it needs a
 * contract test rather than an assumption.
 *
 * **An engine upgrade must keep every assertion in this file true.** If a
 * future runtime stops fanning out, or changes the pairing, the product's
 * reference workflows produce silently wrong data rather than failing.
 *
 * Written originally as a spike, to settle whether `split_in_batches` belonged
 * at P0 in the node catalogue. It does not — fan-out needs no loop node
 * (`docs/changes/002-capability-audit/SPIKE_FANOUT_FINDINGS.md`). Promoted out
 * of `tests/spike/` because what it measured turned out to be load-bearing:
 * this is a release gate, and its name should say so.
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

/** A list endpoint returning `count` rows, and a downstream recorder. */
async function fanOutGraph(count: number) {
	const rows = Array.from({ length: count }, (_, i) => ({ id: i + 1, name: `row-${i + 1}` }));

	const list = await endpoint((_req, respond) => respond(200, rows));
	const detail = await endpoint((req, respond) => respond(200, { echoed: req.path }));

	const graph = {
		nodes: [
			node('start_1', 'manual_trigger', 'Start'),
			node('http_list', 'http_request', 'List', { method: 'GET', url: list.url }),
			node('http_detail', 'http_request', 'Detail', {
				method: 'GET',
				// The `=` prefix marks the WHOLE field as an expression; putting it
				// mid-string sends the braces to the server as literal text.
				url: `=${detail.url}/item/{{ $json.id }}`,
			}),
		],
		connections: [link('start_1', 'http_list'), link('http_list', 'http_detail')],
	};

	return { rows, list, detail, graph };
}

describe('item fan-out semantics', () => {
	it('a JSON array response becomes one item per element', async () => {
		const { graph } = await fanOutGraph(10);
		const status = await run(graph);

		expect(status.status).toBe('SUCCEEDED');
		// The question underneath everything else: does the runtime split the
		// array itself, or hand downstream a single item holding an array?
		expect(outputOf(status, 'List')).toHaveLength(10);
	});

	it('the downstream node runs once per item, with that item values', async () => {
		const { detail, graph } = await fanOutGraph(10);
		const status = await run(graph);

		expect(status.status).toBe('SUCCEEDED');
		expect(detail.requests).toHaveLength(10);

		// Pairing, not just count: request k must carry row k's own id, in order.
		expect(detail.requests.map((r) => r.path)).toEqual(
			Array.from({ length: 10 }, (_, i) => `/item/${i + 1}`),
		);
	});

	it('scales to 100 items with no batching node', async () => {
		const { detail, graph } = await fanOutGraph(100);
		const status = await run(graph);

		expect(status.status).toBe('SUCCEEDED');
		expect(detail.requests).toHaveLength(100);
		expect(new Set(detail.requests.map((r) => r.path)).size).toBe(100);
	}, 60_000);

	it('a NESTED array does not fan out — this is what needs splitOut', async () => {
		// The boundary of the finding above. `{data: [...]}` is at least as common
		// an API shape as a top-level array, and it arrives as ONE item. If this
		// also fanned out, `item_lists` would lose its P0 justification too.
		const list = await endpoint((_req, respond) =>
			respond(200, { data: [{ id: 1 }, { id: 2 }, { id: 3 }] }),
		);
		const detail = await endpoint((_req, respond) => respond(200, { ok: true }));

		const status = await run({
			nodes: [
				node('start_1', 'manual_trigger', 'Start'),
				node('http_list', 'http_request', 'List', { method: 'GET', url: list.url }),
				node('http_detail', 'http_request', 'Detail', { method: 'GET', url: detail.url }),
			],
			connections: [link('start_1', 'http_list'), link('http_list', 'http_detail')],
		});

		expect(status.status).toBe('SUCCEEDED');
		expect(outputOf(status, 'List')).toHaveLength(1);
		expect(detail.requests).toHaveLength(1);
	});

	it('an empty array fans out to zero requests and still succeeds', async () => {
		// Stability matrix 1.1. If this reports FAILED, "no results today" looks
		// like a broken workflow to a customer.
		const { detail, graph } = await fanOutGraph(0);
		const status = await run(graph);

		expect(status.status).toBe('SUCCEEDED');
		expect(detail.requests).toHaveLength(0);
	});
});
