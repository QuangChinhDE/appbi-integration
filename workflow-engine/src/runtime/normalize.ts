/**
 * `IRun` -> the product's execution DTO (SRS 26.1, guardrail: appendix G item 13).
 *
 * The one place n8n's run shape is read. Above this function nothing knows what
 * an `IRun`, a `taskData` or a `runData` key is, which is the whole point: an
 * upstream change to that shape breaks one file and one contract test.
 */

import type { IRun, ITaskData } from 'n8n-workflow';

import type {
	ExecutionStatusDto,
	LogLineDto,
	NodeResultDto,
	ProductExecutionStatus,
	ProductNodeStatus,
} from '../contracts/engine-dto';
import { normalizeError } from './error-normalizer';
import { preview } from './redaction';

export interface NormalizeInput {
	ref: string;
	executionId: string;
	run: IRun;
	/** node name -> product node id, from the compiler. */
	nodeIdByName: Map<string, string>;
	nodeKeyByName: Map<string, string>;
	/** node name -> declared output port count, from the product registry. */
	outputPortsByName?: Map<string, number>;
	/** Every node in the graph, so ones that never ran can be reported as skipped. */
	allNodes: { id: string; name: string; node_key: string }[];
	cancelled: boolean;
	timedOut: boolean;
	technical: Record<string, unknown>;
}

function iso(value: unknown): string | null {
	if (!value) return null;
	const date = value instanceof Date ? value : new Date(value as any);
	return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function nodeStatus(task: ITaskData): ProductNodeStatus {
	if (task.error) return 'FAILED';
	if (continuedError(task)) return 'FAILED';
	return 'SUCCEEDED';
}

/**
 * The error a node swallowed because it was told to continue.
 *
 * With `continueOnFail` n8n does not set `task.error`. It writes the thrown
 * error into the node's *output items* as `{ error: <the raw error object> }`
 * and records the task as a success, which produced two defects at once: the
 * product reported the node SUCCEEDED when the call had failed, and the raw
 * `AxiosError` -- name, `isAxiosError`, and the upstream **response headers**
 * -- was stored verbatim as the item preview a user reads.
 *
 * Both are the same root cause, so both are fixed here rather than at the two
 * call sites: this is the one place that reads n8n's run shape.
 */
function continuedError(task: ITaskData): unknown | null {
	for (const branch of task.data?.main ?? []) {
		for (const item of branch ?? []) {
			const error = (item as { json?: Record<string, unknown> })?.json?.error;
			if (error && typeof error === 'object') return error;
		}
	}
	return null;
}

/**
 * A node's output items, across the ports it actually has.
 *
 * `ports` bounds how many branches are read. Some n8n implementations return
 * more arrays than they declare outputs for: `Filter` declares one and returns
 * two -- kept items and dropped ones -- and the second is never connected to
 * anything. Flattening all of them reported four items out of a filter that
 * passed two, and listed the discarded rows as though they had gone on.
 *
 * Unbounded when the count is unknown, which is the previous behaviour and the
 * right default: showing too much is better than a preview that silently drops
 * a branch the product does know about.
 */
function itemsOf(
	task: ITaskData,
	ports?: number,
): { json?: unknown; binary?: unknown }[] {
	const branches = task.data?.main ?? [];
	const visible = ports === undefined ? branches : branches.slice(0, ports);
	return visible.flatMap((branch) => (branch ?? []) as { json?: unknown }[]);
}

/**
 * The product's error shape in place of the runtime's, inside a continued item.
 *
 * The item itself is kept — downstream nodes are entitled to see that this row
 * failed and to branch on it — but what they see is `{code, category, message}`
 * rather than an `AxiosError` with the upstream's response headers attached.
 */
function replaceErrorWithProductShape(
	item: { json?: unknown; binary?: unknown },
): { json?: unknown; binary?: unknown } {
	const json = item?.json as Record<string, unknown> | undefined;
	if (!json || typeof json.error !== 'object' || json.error === null) return item;
	const normalized = normalizeError(json.error);
	return {
		...item,
		json: {
			...json,
			error: {
				code: normalized.code,
				category: normalized.category,
				message: normalized.message,
			},
		},
	};
}

/**
 * Which output ports produced items.
 *
 * This is how the canvas can show that an IF went down its false branch: the
 * indices with items are the ports that fired (SRS 16.6 `branch_metadata`).
 */
function branchMetadata(task: ITaskData): Record<string, unknown> {
	const branches = task.data?.main ?? [];
	const produced = branches
		.map((branch, index) => ({ index, count: (branch ?? []).length }))
		.filter((entry) => entry.count > 0);
	return { produced_outputs: produced, output_count: branches.length };
}

export function normalizeRun(input: NormalizeInput): ExecutionStatusDto {
	const { run } = input;
	const runData = run.data?.resultData?.runData ?? {};
	const logs: LogLineDto[] = [];
	const nodeResults: NodeResultDto[] = [];

	let failedNodeName: string | null = null;
	let firstError: ReturnType<typeof normalizeError> | null = null;

	for (const [nodeName, tasks] of Object.entries(runData)) {
		const nodeId = input.nodeIdByName.get(nodeName) ?? nodeName;
		const nodeKey = input.nodeKeyByName.get(nodeName) ?? 'unknown';

		(tasks as ITaskData[]).forEach((task, index) => {
			// A continued error is normalized before it is ever previewed: the
			// raw object is an n8n/axios shape carrying upstream response
			// headers, and it must not cross the boundary (guardrail 10).
			const swallowed = task.error ? null : continuedError(task);
			const rawItems = itemsOf(task, input.outputPortsByName?.get(nodeName));
			const output = preview(
				swallowed ? rawItems.map(replaceErrorWithProductShape) : rawItems,
			);
			// n8n does not retain a node's input separately from its parent's
			// output, so the input preview is the source data the task recorded.
			// Better an honest empty than a reconstruction that could be wrong.
			const inputItems = (task.source ?? []).length > 0 ? undefined : undefined;
			const status = nodeStatus(task);
			const error = task.error
				? normalizeError(task.error)
				: swallowed
					? normalizeError(swallowed)
					: null;

			// Only a real task error decides the *run's* verdict. A continued
			// error is reported on its node and deliberately does not fail the
			// run -- that is precisely what continue-on-error was asked for.
			if (task.error && error && !firstError) {
				firstError = error;
				failedNodeName = nodeName;
			}

			nodeResults.push({
				node_id: nodeId,
				node_name: nodeName,
				status,
				execution_index: index,
				started_at: iso(task.startTime),
				ended_at: iso(
					task.startTime && task.executionTime !== undefined
						? new Date(Number(task.startTime) + Number(task.executionTime))
						: null,
				),
				duration_ms:
					task.executionTime === undefined ? null : Math.round(Number(task.executionTime)),
				item_count: output.preview.item_count,
				input_preview: inputItems ?? null,
				output_preview: output.preview,
				truncated: output.truncated,
				error: error
					? {
						code: error.code,
						category: error.category,
						message: error.message,
						technical_message: error.technical_message,
					}
					: null,
				branch_metadata: branchMetadata(task),
			});

			logs.push({
				at: iso(task.startTime) ?? new Date().toISOString(),
				level: error ? 'ERROR' : 'INFO',
				node_name: nodeName,
				message: error
					? `${nodeName}: ${error.message}`
					: `${nodeName}: ${output.preview.item_count} item(s) trong ${
						task.executionTime ?? 0
					}ms`,
			});
			void nodeKey;
		});
	}

	// Nodes that never ran. Reported as SKIPPED rather than omitted so the
	// canvas can grey them out instead of leaving them looking pending forever.
	const ran = new Set(Object.keys(runData));
	for (const node of input.allNodes) {
		if (ran.has(node.name)) continue;
		nodeResults.push({
			node_id: node.id,
			node_name: node.name,
			status: 'SKIPPED',
			execution_index: 0,
			started_at: null,
			ended_at: null,
			duration_ms: null,
			item_count: null,
			input_preview: null,
			output_preview: null,
			truncated: false,
			error: null,
			branch_metadata: {},
		});
	}

	const runError = run.data?.resultData?.error;
	if (runError && !firstError) {
		firstError = normalizeError(runError);
	}

	let status: ProductExecutionStatus;
	if (input.cancelled) status = 'CANCELLED';
	else if (input.timedOut) status = 'TIMED_OUT';
	else if (firstError) status = 'FAILED';
	else if (run.finished) status = 'SUCCEEDED';
	// `finished: false` with no error means the run stopped without completing
	// its graph -- reported as FAILED rather than SUCCEEDED, because claiming
	// success for a workflow that did not finish is the worst of the options.
	else status = 'FAILED';

	const startedAt = iso(run.startedAt);
	const endedAt = iso(run.stoppedAt) ?? new Date().toISOString();
	const durationMs =
		run.startedAt && run.stoppedAt
			? Math.max(0, new Date(run.stoppedAt as any).getTime() - new Date(run.startedAt as any).getTime())
			: null;

	const lastNode = nodeResults
		.filter((result) => result.status === 'SUCCEEDED')
		.at(-1);

	return {
		ref: input.ref,
		execution_id: input.executionId,
		status,
		started_at: startedAt,
		ended_at: endedAt,
		duration_ms: durationMs,
		error_code: firstError?.code ?? null,
		error_category: firstError?.category ?? null,
		error_message: firstError?.message ?? null,
		failed_node_name: failedNodeName,
		node_results: nodeResults.sort(
			(a, b) => a.node_name.localeCompare(b.node_name) || a.execution_index - b.execution_index,
		),
		logs: logs.sort((a, b) => a.at.localeCompare(b.at)),
		output_summary: {
			node_count: nodeResults.length,
			last_node: lastNode?.node_name ?? null,
			item_count: lastNode?.item_count ?? 0,
		},
		technical: input.technical,
	};
}
