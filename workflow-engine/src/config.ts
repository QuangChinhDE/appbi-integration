/** Engine service configuration. Internal service: no public surface at all. */

import { readFileSync } from 'node:fs';

function int(name: string, fallback: number): number {
	const raw = process.env[name];
	const parsed = raw === undefined ? NaN : Number(raw);
	return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * A secret from `NAME_FILE` if that is set, otherwise from `NAME`.
 *
 * The file form is how Docker secrets and Kubernetes projected volumes deliver
 * a value, and it is the better one: `docker inspect` and
 * `/proc/<pid>/environ` both show environment variables to anybody who can
 * read them, while a file can be root-owned and mode 0400.
 *
 * A `_FILE` that is set but unreadable throws rather than falling back. Silent
 * degradation to a default token would leave the engine running with a secret
 * the product does not share, and every dispatch would fail authentication for
 * a reason nothing explains.
 */
function secret(name: string, fallback: string): string {
	const path = process.env[`${name}_FILE`];
	if (path) {
		return readFileSync(path, 'utf-8').trim();
	}
	return process.env[name] ?? fallback;
}

export const config = {
	port: int('ENGINE_PORT', 8099),
	// Loopback by default. The engine must not be reachable from outside the
	// private network, and a default of 0.0.0.0 is how that rule gets broken by
	// a deployment nobody reviewed (guardrail 15).
	host: process.env.ENGINE_HOST ?? '127.0.0.1',
	/** Shared secret between the product API/worker and this service. */
	token: secret('ENGINE_INTERNAL_TOKEN', 'dev-engine-token'),
	logLevel: (process.env.ENGINE_LOG_LEVEL ?? 'info').toLowerCase(),
	engineVersion: process.env.ENGINE_VERSION ?? 'n8n-core@1.14.1',
	/** Hard ceiling on one run, regardless of what the request asks for. */
	maxExecutionSeconds: int('ENGINE_MAX_EXECUTION_SECONDS', 1800),
	/** How long a finished run stays queryable before the product must have read it. */
	resultTtlSeconds: int('ENGINE_RESULT_TTL_SECONDS', 900),
	maxConcurrentExecutions: int('ENGINE_MAX_CONCURRENT', 20),
	previewMaxItems: int('ENGINE_PREVIEW_MAX_ITEMS', 20),
	previewMaxBytes: int('ENGINE_PREVIEW_MAX_BYTES', 32 * 1024),
	timezone: process.env.ENGINE_TIMEZONE ?? 'Asia/Bangkok',
} as const;
