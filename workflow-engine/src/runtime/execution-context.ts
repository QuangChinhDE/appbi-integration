/**
 * Per-execution ambient context.
 *
 * The egress allowlist is a property of the request, but the node that has to
 * honour it is an upstream class we do not pass arguments to. An
 * AsyncLocalStorage store is how a concurrent-safe "which run am I inside"
 * reaches it: two executions with different policies running at the same time
 * each see their own, which a module-level variable could not manage.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

import type { EgressPolicy } from '../contracts/engine-dto';

export interface ExecutionScope {
	executionId: string;
	traceId: string;
	egressPolicy: EgressPolicy;
}

export const executionScope = new AsyncLocalStorage<ExecutionScope>();

export function currentScope(): ExecutionScope | undefined {
	return executionScope.getStore();
}
