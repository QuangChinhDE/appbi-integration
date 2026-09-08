/**
 * Structured logging, plus the sink n8n's own logger is pointed at.
 *
 * n8n logs through a module-level proxy that throws until initialised, so it
 * has to be initialised -- but its output is upstream's debug stream, not the
 * product's, and mixing the two would put node internals into the product's log
 * aggregation. It goes to a sink unless ENGINE_LOG_LEVEL is debug.
 */

import { LoggerProxy } from 'n8n-workflow';

import { config } from './config';

type Level = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function emit(level: Level, message: string, fields: Record<string, unknown> = {}) {
	if (ORDER[level] < (ORDER[config.logLevel as Level] ?? ORDER.info)) return;
	const line = {
		timestamp: new Date().toISOString(),
		level: level.toUpperCase(),
		service: 'appbi-workflow-engine',
		message,
		...fields,
	};
	process.stdout.write(`${JSON.stringify(line)}\n`);
}

export const log = {
	debug: (message: string, fields?: Record<string, unknown>) => emit('debug', message, fields),
	info: (message: string, fields?: Record<string, unknown>) => emit('info', message, fields),
	warn: (message: string, fields?: Record<string, unknown>) => emit('warn', message, fields),
	error: (message: string, fields?: Record<string, unknown>) => emit('error', message, fields),
};

let initialised = false;

/** Must be called once, before any workflow runs. */
export function initN8nLogger(): void {
	if (initialised) return;
	const debugEnabled = config.logLevel === 'debug';
	const forward = (level: Level) => (message: string, meta?: object) => {
		if (debugEnabled) emit(level, `n8n: ${message}`, { n8n_meta: meta });
	};
	LoggerProxy.init({
		log: (_type, message, meta) => forward('debug')(message, meta),
		debug: forward('debug'),
		verbose: forward('debug'),
		info: forward('debug'),
		warn: forward('warn'),
		error: forward('error'),
	});
	initialised = true;
}
