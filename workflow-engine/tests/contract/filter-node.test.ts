/**
 * Filter: keep the items that match, drop the rest.
 *
 * Certified because the alternative people were using is an IF with an empty
 * false branch, which draws a line to nothing and reads as an unfinished
 * workflow.
 *
 * Asserted per node rather than on the workflow's output, for the reason
 * ADR-023 gives: both defects found in the IF mapping were invisible to
 * output-only assertions and obvious in `node_results`. A Filter that lets
 * everything through produces the same *shape* of answer as one that filters
 * correctly, so only the item counts tell them apart.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { initN8nLogger } from '../../src/logger';
import { registerBinaryDataService } from '../../src/runtime/binary-data';
import { installEgressGuard } from '../../src/runtime/egress-guard';
import { startExecution } from '../../src/runtime/execution-manager';
import { link, node, request, statusOfNode, waitForTerminal } from '../helpers';

beforeAll(async () => {
  initN8nLogger();
  await registerBinaryDataService();
  installEgressGuard({ allow_private_networks: true });
});

/** start -> filter, with whatever conditions the case needs. */
function graphWith(config: Record<string, unknown>) {
  return {
    nodes: [
      node('start_1', 'manual_trigger', 'Bắt đầu'),
      node('filter_1', 'filter', 'Lọc', config),
    ],
    connections: [link('start_1', 'filter_1')],
  };
}

/** How many items the filter let through. */
function itemsOut(status: Awaited<ReturnType<typeof waitForTerminal>>): number {
  const result = (status.node_results ?? []).find((row) => row.node_name === 'Lọc');
  return result?.output_preview?.item_count ?? -1;
}

describe('filter', () => {
  it('passes the matching items and drops the others', async () => {
    const graph = graphWith({
      combinator: 'and',
      conditions: [{
        left: '={{ $json.amount }}', operator: 'gt',
        value_type: 'number', right: '100',
      }],
    });

    const { ref } = startExecution(request(graph, {
      start_payload: [
        { amount: 50 }, { amount: 150 }, { amount: 900 }, { amount: 99 },
      ],
    }));
    const status = await waitForTerminal(ref);

    expect(status.status).toBe('SUCCEEDED');
    expect(statusOfNode(status, 'Lọc')).toBe('SUCCEEDED');
    // Two of four. A mapper that dropped the conditions entirely would let all
    // four through and still succeed, which is why this asserts the count.
    expect(itemsOut(status)).toBe(2);
  }, 30_000);

  it('a numeric comparison is numeric, not lexicographic', async () => {
    // `9 > 10` is false; `"9" > "10"` is true. Putting a numeric operator in
    // n8n's string bucket gives the second answer and looks fine doing it.
    const graph = graphWith({
      combinator: 'and',
      conditions: [{
        left: '={{ $json.n }}', operator: 'gt',
        value_type: 'number', right: '10',
      }],
    });

    const { ref } = startExecution(request(graph, {
      start_payload: [{ n: 9 }, { n: 11 }],
    }));
    const status = await waitForTerminal(ref);

    expect(status.status).toBe('SUCCEEDED');
    expect(itemsOut(status)).toBe(1);
  }, 30_000);

  it('a boolean condition compares booleans', async () => {
    // The defect from ADR-023, asked of the node that shares that code: a
    // `boolean` equality landing in the string bucket compares `true` with
    // the text "true" and matches nothing, forever.
    const graph = graphWith({
      combinator: 'and',
      conditions: [{
        left: '={{ $json.rush }}', operator: 'equals',
        value_type: 'boolean', right: 'true',
      }],
    });

    const { ref } = startExecution(request(graph, {
      start_payload: [{ rush: true }, { rush: false }, { rush: true }],
    }));
    const status = await waitForTerminal(ref);

    expect(status.status).toBe('SUCCEEDED');
    expect(itemsOut(status)).toBe(2);
  }, 30_000);

  it('OR keeps an item that matches either condition', async () => {
    // Filter spells its combinator `combineConditions: AND | OR`, where IF
    // says `combineOperation: all | any`. Sending IF's spelling would not
    // error -- the node would fall back to AND and quietly return fewer items
    // than the user asked for, which is what this case would catch.
    const graph = graphWith({
      combinator: 'or',
      conditions: [
        { left: '={{ $json.tier }}', operator: 'equals',
          value_type: 'string', right: 'vip' },
        { left: '={{ $json.amount }}', operator: 'gt',
          value_type: 'number', right: '500' },
      ],
    });

    const { ref } = startExecution(request(graph, {
      start_payload: [
        { tier: 'vip', amount: 1 },      // first condition
        { tier: 'basic', amount: 900 },  // second condition
        { tier: 'basic', amount: 1 },    // neither
      ],
    }));
    const status = await waitForTerminal(ref);

    expect(status.status).toBe('SUCCEEDED');
    expect(itemsOut(status)).toBe(2);
  }, 30_000);

  it('a filter with no conditions is refused before it runs', () => {
    // Refused at compile time, so `startExecution` throws rather than
    // producing a failed run. That is the better of the two: a step with
    // nothing configured is a workflow somebody has not finished writing, and
    // there is no reason to spend an execution finding that out. A filter that
    // ran with no conditions would pass everything through and look fine.
    let thrown: unknown;
    try {
      startExecution(request(graphWith({ conditions: [] }),
        { start_payload: [{ a: 1 }] }));
    } catch (error) {
      thrown = error;
    }

    expect(thrown, 'a filter with no conditions was accepted').toBeDefined();
    // The message is 'compile failed'; the reason is in the diagnostics, which
    // is what the product shows the user and therefore what is worth pinning.
    const diagnostics = (thrown as { diagnostics?: { message: string }[] })
      .diagnostics ?? [];
    expect(diagnostics.map((d) => d.message).join(' | '))
      .toMatch(/điều kiện/);
  });
});
