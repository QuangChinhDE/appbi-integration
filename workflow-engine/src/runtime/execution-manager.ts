/**
 * Active executions, cancel handles and results (SRS 26.6, 16.7).
 *
 * In-memory and deliberately so: the product's database is the system of record
 * for execution history (ADR-002), and a second store here would be a second
 * truth to reconcile. What this holds is the part that only exists while a run
 * is in flight — the cancel handle, and the result until the product has read it.
 *
 * The consequence is stated rather than hidden: if this process dies, its
 * in-flight runs are gone, and the product's reconciler marks them
 * ENGINE_INTERRUPTED (ADR-010). That is why V1 has no Wait node.
 */

import { randomUUID } from 'node:crypto';

// Deep import for the same reason as in `binary-data.ts`: `n8n-core`'s entry
// point statically pulls in Enterprise-licensed source. See the note there.
import { WorkflowExecute } from 'n8n-core/dist/WorkflowExecute';
import type { IDataObject, IRun } from 'n8n-workflow';

import { config } from '../config';
import { compile } from '../compiler/compiler';
import type { ExecutionRequest, ExecutionStatusDto } from '../contracts/engine-dto';
import { COMPILER_VERSION, CONTRACT_VERSION } from '../contracts/engine-dto';
import { log } from '../logger';
import { buildAdditionalData } from './additional-data';
import { executionScope } from './execution-context';
import { normalizeError } from './error-normalizer';
import { normalizeRun } from './normalize';

export class EngineBusyError extends Error {
	readonly code = 'ENGINE_BUSY';
}

export class CompileFailedError extends Error {
	readonly code = 'WORKFLOW_INVALID';

	constructor(readonly diagnostics: unknown[]) {
		super('compile failed');
	}
}

interface ActiveRun {
	ref: string;
	executionId: string;
	startedAt: number;
	/** The PCancelable returned by WorkflowExecute.run. */
	handle: { cancel: () => void } | null;
	cancelRequested: boolean;
	timedOut: boolean;
	timer: NodeJS.Timeout | null;
}

interface StoredResult {
	dto: ExecutionStatusDto;
	storedAt: number;
}

/** Idempotency: key -> ref, so a retried dispatch does not start a second run. */
const idempotency = new Map<string, string>();
const active = new Map<string, ActiveRun>();
const results = new Map<string, StoredResult>();

function sweep(): void {
	const cutoff = Date.now() - config.resultTtlSeconds * 1000;
	for (const [ref, stored] of results) {
		if (stored.storedAt < cutoff) results.delete(ref);
	}
	for (const [key, ref] of idempotency) {
		if (!active.has(ref) && !results.has(ref)) idempotency.delete(key);
	}
}

export function activeCount(): number {
	return active.size;
}

export function findByIdempotencyKey(key: string): string | null {
	return idempotency.get(key) ?? null;
}

export function statusOf(ref: string): ExecutionStatusDto | null {
	const stored = results.get(ref);
	if (stored) return stored.dto;

	const run = active.get(ref);
	if (!run) return null;
	// Still running: report what is true now rather than nothing. The product
	// polls this, and "no answer" would be indistinguishable from "the engine
	// forgot the run".
	return {
		ref,
		execution_id: run.executionId,
		status: 'RUNNING',
		started_at: new Date(run.startedAt).toISOString(),
		ended_at: null,
		duration_ms: Date.now() - run.startedAt,
		error_code: null,
		error_category: null,
		error_message: null,
		failed_node_name: null,
		node_results: [],
		logs: [],
		output_summary: {},
		technical: {
			contract_version: CONTRACT_VERSION,
			compiler_version: COMPILER_VERSION,
			engine_version: config.engineVersion,
			cancel_requested: run.cancelRequested,
		},
	};
}

/**
 * Start an execution. Returns as soon as the run is accepted, not when it ends:
 * the product's dispatch call must not hold a connection open for a workflow
 * that may run for minutes (SRS 82).
 */
export function startExecution(request: ExecutionRequest): { ref: string; accepted: boolean } {
	sweep();

	if (request.idempotency_key) {
		const existing = idempotency.get(request.idempotency_key);
		if (existing) {
			log.info('execution.idempotent_hit', {
				execution_id: request.execution_id,
				ref: existing,
			});
			return { ref: existing, accepted: true };
		}
	}

	if (active.size >= config.maxConcurrentExecutions) {
		throw new EngineBusyError(
			`engine is at capacity (${config.maxConcurrentExecutions} concurrent executions)`,
		);
	}

	const compiled = compile(request);
	if (!compiled.ok || !compiled.workflow) {
		throw new CompileFailedError(compiled.diagnostics);
	}

	const ref = `eng_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
	const timeoutSeconds = Math.min(
		Number(request.timeout_seconds ?? config.maxExecutionSeconds),
		config.maxExecutionSeconds,
	);

	const startNode = compiled.workflow.getNode(compiled.startNodeName!);
	if (!startNode) {
		throw new CompileFailedError([
			{
				code: 'TRIGGER_REQUIRED',
				message: 'Không xác định được bước bắt đầu sau khi biên dịch.',
				severity: 'ERROR',
			},
		]);
	}

	const payload = request.start_payload;
	const items = (Array.isArray(payload) ? payload : [payload ?? {}]).map((json) => ({
		json: (json ?? {}) as IDataObject,
	}));

	const workflowExecute = new WorkflowExecute(
		buildAdditionalData({
			executionId: request.execution_id,
			credentialData: compiled.credentialData,
			timeoutSeconds,
		}),
		'manual',
		{
			startData: {},
			resultData: { runData: {} },
			executionData: {
				contextData: {},
				// Seeding the stack is how the product's payload enters the run.
				// `run()` would look for one of n8n's own trigger types instead, and
				// the product's start node is deliberately not one (ADR-004).
				nodeExecutionStack: [{ node: startNode, data: { main: [items] }, source: null }],
				metadata: {},
				waitingExecution: {},
				waitingExecutionSource: {},
			},
		},
	);

	const record: ActiveRun = {
		ref,
		executionId: request.execution_id,
		startedAt: Date.now(),
		handle: null,
		cancelRequested: false,
		timedOut: false,
		timer: null,
	};
	active.set(ref, record);
	if (request.idempotency_key) idempotency.set(request.idempotency_key, ref);

	const allNodes = (request.graph?.nodes ?? []).map((node) => ({
		id: node.id,
		name: compiled.nodeNameById.get(node.id) ?? node.name,
		node_key: node.node_key,
	}));

	// The whole run happens inside the scope, so the egress guard in front of
	// HTTP Request sees this request's policy even with other runs in flight.
	executionScope.run(
		{
			executionId: request.execution_id,
			traceId: request.trace_id ?? '',
			egressPolicy: request.egress_policy ?? {},
		},
		() => {
			const promise = workflowExecute.processRunExecutionData(compiled.workflow!);
			record.handle = promise as unknown as { cancel: () => void };

			record.timer = setTimeout(() => {
				const still = active.get(ref);
				if (!still) return;
				still.timedOut = true;
				log.warn('execution.timeout', { ref, execution_id: request.execution_id });
				try {
					still.handle?.cancel();
				} catch {
					/* already settled */
				}
			}, timeoutSeconds * 1000);

			promise
				.then((run: IRun) => finish(ref, run, request, compiled, allNodes))
				.catch((error: unknown) => failRun(ref, error, request, allNodes));
		},
	);

	log.info('execution.started', {
		ref,
		execution_id: request.execution_id,
		trace_id: request.trace_id,
		node_count: allNodes.length,
	});
	return { ref, accepted: true };
}

function finish(
	ref: string,
	run: IRun,
	request: ExecutionRequest,
	compiled: ReturnType<typeof compile>,
	allNodes: { id: string; name: string; node_key: string }[],
): void {
	const record = active.get(ref);
	if (record?.timer) clearTimeout(record.timer);

	const dto = normalizeRun({
		ref,
		executionId: request.execution_id,
		run,
		nodeIdByName: compiled.nodeIdByName,
		nodeKeyByName: compiled.nodeKeyByName,
		outputPortsByName: compiled.outputPortsByName,
		allNodes,
		cancelled: Boolean(record?.cancelRequested),
		timedOut: Boolean(record?.timedOut),
		technical: {
			contract_version: CONTRACT_VERSION,
			compiler_version: COMPILER_VERSION,
			engine_version: config.engineVersion,
			compiled_hash: compiled.compiledHash,
			trace_id: request.trace_id,
		},
	});

	results.set(ref, { dto, storedAt: Date.now() });
	active.delete(ref);
	log.info('execution.finished', {
		ref,
		execution_id: request.execution_id,
		status: dto.status,
		duration_ms: dto.duration_ms,
	});
}

function failRun(
	ref: string,
	error: unknown,
	request: ExecutionRequest,
	allNodes: { id: string; name: string; node_key: string }[],
): void {
	const record = active.get(ref);
	if (record?.timer) clearTimeout(record.timer);
	const normalized = normalizeError(error);

	// A rejection here means the run never produced an IRun: a cancel that
	// aborted it, a timeout, or a bootstrap failure. Reported with the same DTO
	// shape as a normal finish so the product has one path to read.
	results.set(ref, {
		dto: {
			ref,
			execution_id: request.execution_id,
			status: record?.cancelRequested ? 'CANCELLED' : record?.timedOut ? 'TIMED_OUT' : 'FAILED',
			started_at: record ? new Date(record.startedAt).toISOString() : null,
			ended_at: new Date().toISOString(),
			duration_ms: record ? Date.now() - record.startedAt : null,
			error_code: normalized.code,
			error_category: normalized.category,
			error_message: normalized.message,
			failed_node_name: null,
			node_results: allNodes.map((node) => ({
				node_id: node.id,
				node_name: node.name,
				status: 'SKIPPED' as const,
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
			})),
			logs: [
				{
					at: new Date().toISOString(),
					level: 'ERROR',
					message: normalized.message,
					node_name: null,
				},
			],
			output_summary: {},
			technical: {
				contract_version: CONTRACT_VERSION,
				compiler_version: COMPILER_VERSION,
				engine_version: config.engineVersion,
				technical_message: normalized.technical_message,
			},
		},
		storedAt: Date.now(),
	});
	active.delete(ref);
	log.error('execution.failed', {
		ref,
		execution_id: request.execution_id,
		code: normalized.code,
	});
}

/**
 * Request cancellation. Idempotent (SRS 16.7): cancelling a finished run
 * returns its terminal state instead of failing, and cancelling twice is not an
 * error — the second caller is asking the same question, not making a mistake.
 */
export function cancelExecution(ref: string): ExecutionStatusDto | null {
	const stored = results.get(ref);
	if (stored) return stored.dto;

	const record = active.get(ref);
	if (!record) return null;

	record.cancelRequested = true;
	try {
		record.handle?.cancel();
	} catch (error) {
		// Already settling. Not an error condition: the run is ending anyway,
		// and the product will see the terminal state on its next poll.
		log.debug('execution.cancel_noop', {
			ref,
			error: error instanceof Error ? error.message : String(error),
		});
	}
	log.info('execution.cancel_requested', { ref, execution_id: record.executionId });
	return statusOf(ref);
}

/** Test seam: drop all state between contract tests. */
export function resetForTests(): void {
	for (const record of active.values()) {
		if (record.timer) clearTimeout(record.timer);
	}
	active.clear();
	results.clear();
	idempotency.clear();
}
