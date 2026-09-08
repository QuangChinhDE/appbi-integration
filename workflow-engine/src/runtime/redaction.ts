/**
 * Preview redaction and truncation, engine side (SRS 21.3).
 *
 * Applied before anything leaves the engine. The product redacts again on the
 * way into its database — deliberately twice, because these are the two places
 * a payload can escape and each has to be safe on its own.
 */

import { config } from '../config';

const MASK = '********';

const SENSITIVE_KEY_HINTS = [
	'password', 'passwd', 'secret', 'token', 'credential', 'api_key', 'apikey',
	'api-key', 'authorization', 'auth', 'private_key', 'client_secret',
	'access_key', 'passphrase', 'cookie', 'set-cookie', 'session', 'x-api-key',
	'signature', 'bearer',
];

const DROP_KEYS = ['authorization', 'proxy-authorization', 'cookie', 'set-cookie'];

const MAX_DEPTH = 8;
const MAX_STRING = 2048;

function isSensitive(key: string): boolean {
	const lowered = key.toLowerCase();
	return SENSITIVE_KEY_HINTS.some((hint) => lowered.includes(hint));
}

export function redact(value: unknown, depth = 0): unknown {
	if (depth > MAX_DEPTH) return '<depth limit>';
	if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
	if (value && typeof value === 'object') {
		const out: Record<string, unknown> = {};
		for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
			if (DROP_KEYS.includes(key.toLowerCase())) continue;
			out[key] = isSensitive(key) ? MASK : redact(item, depth + 1);
		}
		return out;
	}
	if (typeof value === 'string' && value.length > MAX_STRING) {
		return `${value.slice(0, MAX_STRING)}…<truncated>`;
	}
	return value;
}

export interface Preview {
	items: unknown[];
	item_count: number;
	note?: string;
}

/**
 * Turn node items into a stored preview.
 *
 * Binary is dropped rather than encoded: V1 has no binary boundary (ADR-012),
 * and base64 in a JSONB column is how a debugging aid becomes a storage
 * problem.
 */
export function preview(items: { json?: unknown; binary?: unknown }[] | undefined): {
	preview: Preview;
	truncated: boolean;
} {
	if (!items || items.length === 0) {
		return { preview: { items: [], item_count: 0 }, truncated: false };
	}

	const total = items.length;
	let kept = items.slice(0, config.previewMaxItems).map((item) => {
		const json = redact(item?.json ?? {});
		return item?.binary ? { ...(json as object), _binary: '<binary omitted>' } : json;
	});
	let truncated = total > config.previewMaxItems;
	let note: string | undefined;

	const size = () => Buffer.byteLength(JSON.stringify({ items: kept }), 'utf8');
	while (kept.length > 1 && size() > config.previewMaxBytes) {
		kept = kept.slice(0, kept.length - 1);
		truncated = true;
		note = 'PREVIEW_TRUNCATED_BY_SIZE';
	}
	if (kept.length === 1 && size() > config.previewMaxBytes) {
		kept = [{ _note: 'item too large to preview' }];
		truncated = true;
		note = 'PREVIEW_TRUNCATED_BY_SIZE';
	}

	return { preview: { items: kept, item_count: total, ...(note ? { note } : {}) }, truncated };
}
