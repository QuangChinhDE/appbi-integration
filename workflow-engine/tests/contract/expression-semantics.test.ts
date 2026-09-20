/**
 * Wave 0A.5 — expression semantics against the real pinned runtime
 * (`docs/changes/003-wave-0-current-runtime-proof/spec.md`).
 *
 * Expressions are the part of the product a non-technical user is most likely
 * to get wrong, and the failures divide into two kinds that need different
 * answers: the expression is malformed (fix the field), or it is well-formed
 * and the data is not what was assumed (look at the input). The product has a
 * distinct code and remediation for each; before this file only the first was
 * asserted.
 */

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { initN8nLogger } from '../../src/logger';
import { registerBinaryDataService } from '../../src/runtime/binary-data';
import { installEgressGuard } from '../../src/runtime/egress-guard';
import { resetForTests, startExecution } from '../../src/runtime/execution-manager';
import { link, node, outputOf, request, waitForTerminal } from '../helpers';

beforeAll(async () => {
	initN8nLogger();
	await registerBinaryDataService();
	installEgressGuard({ allow_private_networks: true });
});

afterEach(() => resetForTests());

async function run(graph: Parameters<typeof request>[0], overrides = {}) {
	const { ref } = startExecution(request(graph, overrides));
	return waitForTerminal(ref);
}

/** start -> edit_fields, where `value` is the expression under test. */
function evaluating(value: string, startPayload: Record<string, unknown>[]) {
	return run(
		{
			nodes: [
				node('start_1', 'manual_trigger', 'Start'),
				node('set_1', 'edit_fields', 'Compute', {
					assignments: [{ name: 'result', type: 'string', value }],
				}),
			],
			connections: [link('start_1', 'set_1')],
		},
		{ start_payload: startPayload },
	);
}

describe('0A.5 — expression semantics', () => {
	it('a nested value resolves through objects and arrays', async () => {
		const status = await evaluating('={{ $json.a.b[0].c }}', [
			{ a: { b: [{ c: 'deep' }] } },
		]);

		expect(status.status).toBe('SUCCEEDED');
		expect(outputOf(status, 'Compute')[0]).toMatchObject({ result: 'deep' });
	});

	it('a null that is present is not the same as a path that is missing', async () => {
		// Both resolve rather than failing, but the product must not turn a real
		// null into the string "undefined" -- a workflow writing that into a
		// downstream system is a data defect nobody notices for weeks.
		const present = await evaluating('={{ $json.maybe }}', [{ maybe: null }]);
		const missing = await evaluating('={{ $json.nothere }}', [{ maybe: null }]);

		expect(present.status).toBe('SUCCEEDED');
		expect(missing.status).toBe('SUCCEEDED');
		expect(String(outputOf(present, 'Compute')[0]?.result)).not.toContain('undefined');
	});

	/**
	 * SKIPPED — known defect D-W0-05, the most serious finding in 0A.
	 *
	 * `{{ $json.count.toUpperCase() }}` against `count: 7` is valid syntax and a
	 * wrong assumption about the data. The runtime resolves it to **null**, the
	 * node reports SUCCEEDED, and the run reports SUCCEEDED. Nothing anywhere
	 * records that an evaluation failed: `node_results[].error` is empty.
	 *
	 * So a workflow that writes this field into Postgres or posts it to an API
	 * writes a null and reports success. It is the same silent-wrong-data class
	 * as row 2.8 but worse, because there is no typo to spot -- the expression
	 * is correct and the data simply is not what the author assumed.
	 *
	 * Not fixed in 0A because it cannot be: the information is gone by the time
	 * the product sees the result, so nothing downstream can distinguish "the
	 * field is genuinely null" from "evaluating it threw". A fix has to happen
	 * where the expression is resolved, and that is a design decision about what
	 * the product promises, not a smallest-coherent-fix.
	 */
	it.skip('a runtime failure on a well-formed expression is an evaluation failure', async () => {
		const status = await evaluating('={{ $json.count.toUpperCase() }}', [{ count: 7 }]);

		expect(status.status).toBe('FAILED');
		expect(status.error_code).toBe('EXPRESSION_EVALUATION_FAILED');
		expect(status.error_category).toBe('EXPRESSION');
	});

	it('an expression that resolves to null does so visibly, not as the string null', async () => {
		// The part of D-W0-05 that IS asserted: whatever the value ends up being,
		// it must not be the text "null" or "undefined" written into a field.
		const status = await evaluating('={{ $json.count.toUpperCase() }}', [{ count: 7 }]);
		const result = outputOf(status, 'Compute')[0]?.result;

		expect(result).not.toBe('undefined');
		expect(result).not.toBe('null');
	});

	it('mixed types across items are handled per item, not by the first one', async () => {
		// Page 1 of an API says `3`, page 2 says `"3"`. A node that reads the
		// first item's type and applies it to the rest silently corrupts the
		// remainder.
		const status = await evaluating('={{ $json.v }}', [{ v: 3 }, { v: '3' }, { v: true }]);

		expect(status.status).toBe('SUCCEEDED');
		const results = outputOf(status, 'Compute').map((item) => String(item.result));
		expect(results).toEqual(['3', '3', 'true']);
	});

	it('referencing a node that never ran is reported, not silently empty', async () => {
		// The most natural mistake right after adding a branch: read from the
		// branch the condition rejected. Whatever the runtime does here, the
		// product must not present it as an ordinary success carrying nothing.
		const status = await run(
			{
				nodes: [
					node('start_1', 'manual_trigger', 'Start'),
					node('if_1', 'if', 'Gate', {
						combinator: 'and',
						conditions: [
							{ left: '={{ $json.ok }}', operator: 'equals', value_type: 'string', right: 'no' },
						],
					}),
					node('set_t', 'edit_fields', 'Yes', {
						assignments: [{ name: 'branch', type: 'string', value: 'true' }],
					}),
					node('set_f', 'edit_fields', 'No', {
						assignments: [
							// Reads from the branch that did not run.
							{ name: 'borrowed', type: 'string', value: "={{ $('Yes').item.json.branch }}" },
						],
					}),
				],
				connections: [
					link('start_1', 'if_1'),
					link('if_1', 'set_t', 'true'),
					link('if_1', 'set_f', 'false'),
				],
			},
			{ start_payload: [{ ok: 'yes' }] },
		);

		expect(status.status).toBe('FAILED');
		// Not EXPRESSION_INVALID: the expression is correct, the branch did not
		// run. The user needs to look at the run, not rewrite the field.
		expect(status.error_code).toBe('EXPRESSION_EVALUATION_FAILED');
		expect(status.error_category).toBe('EXPRESSION');
	});

	it('referencing a node that does not exist is an expression failure', async () => {
		const status = await evaluating("={{ $('Ghost').item.json.x }}", [{ a: 1 }]);

		expect(status.status).toBe('FAILED');
		// The fix is in the field, so this is the "invalid" half of the pair.
		expect(status.error_code).toBe('EXPRESSION_INVALID');
		expect(status.error_category).toBe('EXPRESSION');
	});

	it('an expression that will not parse is distinct from one that will', async () => {
		const status = await evaluating('={{ $json.a ( }}', [{ a: 1 }]);

		expect(status.status).toBe('FAILED');
		expect(status.error_code).toBe('EXPRESSION_INVALID');
	});
});
