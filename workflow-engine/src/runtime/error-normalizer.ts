/**
 * n8n runtime errors -> product error codes (SRS 34, guardrail 16).
 *
 * The product's error contract promises a stable code, a human message and a
 * next action. n8n throws `NodeApiError`, `NodeOperationError`,
 * `ExpressionError` and plain `Error`s whose messages are upstream's to change.
 * Translating here is what keeps a message change upstream from becoming a
 * behaviour change in the product's UI.
 *
 * The classification is deliberately conservative: anything unrecognised
 * becomes NODE_EXECUTION_FAILED with a sanitized technical message, which is
 * honest, rather than being guessed into a category that would show the user
 * the wrong remediation.
 */

export interface NormalizedError {
	code: string;
	category: string;
	message: string;
	technical_message?: string;
}

const MAX_TECHNICAL_LENGTH = 800;

/** Header and token shapes that must not survive into a stored message. */
const SCRUB_PATTERNS: [RegExp, string][] = [
	[/(bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, '$1********'],
	[/(basic\s+)[A-Za-z0-9+/=]+/gi, '$1********'],
	[/("?(?:authorization|cookie|api[_-]?key|token|password|secret)"?\s*[:=]\s*)("?)[^",}\s]+/gi,
		'$1$2********'],
	[/([?&](?:api[_-]?key|access_token|token|key)=)[^&\s]+/gi, '$1********'],
];

export function scrub(text: string): string {
	let out = text;
	for (const [pattern, replacement] of SCRUB_PATTERNS) {
		out = out.replace(pattern, replacement);
	}
	return out.slice(0, MAX_TECHNICAL_LENGTH);
}

function statusOf(error: any): number | undefined {
	const candidates = [
		error?.httpCode,
		error?.statusCode,
		error?.response?.status,
		error?.cause?.statusCode,
		error?.cause?.response?.status,
	];
	for (const candidate of candidates) {
		const parsed = Number(candidate);
		if (Number.isFinite(parsed) && parsed >= 100) return parsed;
	}
	return undefined;
}

function messageOf(error: any): string {
	return String(
		error?.description ?? error?.message ?? error?.cause?.message ?? 'Unknown engine error',
	);
}

export function normalizeError(error: unknown): NormalizedError {
	const raw = error as any;
	const technical = scrub(
		[raw?.name, messageOf(raw), raw?.cause?.code].filter(Boolean).join(' | '),
	);
	const lowered = messageOf(raw).toLowerCase();
	const status = statusOf(raw);
	const errno = String(raw?.cause?.code ?? raw?.code ?? '');
	const className = String(raw?.name ?? '');

	// The engine's own egress guard rejects a URL before any request is made.
	if (raw?.code === 'EGRESS_BLOCKED' || lowered.includes('blocked by egress policy')) {
		return {
			code: 'EGRESS_BLOCKED',
			category: 'CONFIGURATION',
			message: 'Địa chỉ này bị chính sách mạng của hệ thống chặn.',
			technical_message: technical,
		};
	}

	// An expression that will not parse is a different problem from one that
	// parses and then fails: the first is fixed in the field, the second by
	// looking at the data. The pinned runtime reports the parse failure as a
	// NodeOperationError reading "invalid syntax", which is why it is matched on
	// text here -- and why a contract test pins that behaviour.
	if (lowered.includes('invalid syntax') || lowered.includes('syntax error')) {
		return {
			code: 'EXPRESSION_INVALID',
			category: 'EXPRESSION',
			message: 'Biểu thức trong bước này chưa hợp lệ.',
			technical_message: technical,
		};
	}

	// An expression naming a node that is not in the graph. The runtime reports
	// `"Ghost" node doesn't exist` as a NodeOperationError, which carries
	// neither the word "expression" nor an Expression class name, so it used to
	// land in the generic bucket -- "a step failed" for what is a typo in a
	// field. The fix is in the expression, so this is EXPRESSION_INVALID and its
	// remediation opens the field.
	if (/node doesn't exist/i.test(messageOf(raw))) {
		return {
			code: 'EXPRESSION_INVALID',
			category: 'EXPRESSION',
			message: 'Biểu thức đang tham chiếu tới một bước không có trong workflow.',
			technical_message: technical,
		};
	}

	// An expression reading from a node that did not run -- the branch an IF
	// rejected, most often. Reported as `no data, execute "X" node first`.
	//
	// Deliberately *not* the same code as above: the expression is correct and
	// the data is not there, so the user needs to look at the run rather than
	// rewrite the field. Same distinction the product already draws between
	// EXPRESSION_INVALID and EXPRESSION_EVALUATION_FAILED.
	if (/no data, execute .* node first/i.test(messageOf(raw))) {
		return {
			code: 'EXPRESSION_EVALUATION_FAILED',
			category: 'EXPRESSION',
			message: 'Biểu thức đang đọc dữ liệu từ một bước chưa chạy trong lần chạy này.',
			technical_message: technical,
		};
	}

	// Expressions are a product-facing surface (ADR-008), so their failures get
	// their own code and their own remediation ("inspect the input").
	if (className.includes('Expression') || lowered.includes('expression')) {
		return {
			code: 'EXPRESSION_EVALUATION_FAILED',
			category: 'EXPRESSION',
			message: 'Không thể tính giá trị biểu thức ở bước này.',
			technical_message: technical,
		};
	}

	if (
		lowered.includes('no runtime credential supplied') ||
		lowered.includes('credentials not found') ||
		lowered.includes('does not have any credentials')
	) {
		return {
			code: 'CREDENTIAL_REQUIRED',
			category: 'CONFIGURATION',
			message: 'Bước này cần thông tin xác thực nhưng chưa có.',
			technical_message: technical,
		};
	}

	// The service answered, and the answer could not be read as JSON.
	//
	// Three very different-looking situations arrive here as one message: a 200
	// with an empty body, a 204 that still carries `content-type:
	// application/json`, and a genuinely malformed body. All three used to fall
	// through to NODE_EXECUTION_FAILED -- "a step failed" -- which tells the
	// reader nothing and hides that the fix is one field away.
	//
	// The node's `response_format` defaults to AUTO, which makes the runtime
	// parse anything announcing itself as JSON. n8n's own `neverError` flag
	// would suppress the throw, but it also suppresses erroring on 4xx/5xx, so
	// turning it on would silently undo the authentication and rate-limit
	// classification below. Naming the problem is the honest fix; the user sets
	// Response format to Text and moves on.
	if (lowered.includes('invalid json in response body')) {
		return {
			code: 'NODE_CONFIGURATION_INVALID',
			category: 'CONFIGURATION',
			message: 'Dịch vụ trả về nội dung không phải JSON hợp lệ. '
				+ "Nếu dịch vụ trả về dạng khác, đổi 'Response format' của bước này sang Text.",
			technical_message: technical,
		};
	}

	if (status === 401 || status === 403) {
		return {
			code: 'NODE_AUTHENTICATION_FAILED',
			category: 'AUTHENTICATION',
			message: 'Không thể xác thực với dịch vụ ở bước này.',
			technical_message: technical,
		};
	}
	if (status === 429) {
		return {
			code: 'NODE_RATE_LIMITED',
			category: 'RATE_LIMIT',
			message: 'Dịch vụ đang giới hạn số yêu cầu.',
			technical_message: technical,
		};
	}
	if (status === 408 || status === 504 || errno === 'ETIMEDOUT' || errno === 'ESOCKETTIMEDOUT' ||
		lowered.includes('timeout')) {
		return {
			code: 'NODE_TIMEOUT',
			category: 'TIMEOUT',
			message: 'Dịch vụ phản hồi quá lâu.',
			technical_message: technical,
		};
	}
	// The errno, or the message it is buried in.
	//
	// n8n wraps a transport failure in a `NodeApiError`, and the original
	// error is not always reachable as `cause` -- so `raw.code` is empty and
	// the only surviving evidence is the text "getaddrinfo ENOTFOUND host".
	// Matching on errno alone therefore classified every DNS and connection
	// failure as a generic "a step failed", which tells the reader nothing
	// they can act on.
	const networkErrno = ['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET',
		'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE'];
	const upper = messageOf(raw).toUpperCase();
	if (networkErrno.includes(errno)
		|| networkErrno.some((candidate) => upper.includes(candidate))) {
		// The host, when the message names one. "Cannot reach api.acme.com" is
		// a sentence somebody can do something about; "cannot reach the
		// service" is not.
		const host = /(?:ENOTFOUND|ECONNREFUSED|EAI_AGAIN|EHOSTUNREACH)\s+([^\s,)]+)/i
			.exec(messageOf(raw))?.[1];
		return {
			code: 'NODE_NETWORK_UNREACHABLE',
			category: 'NETWORK',
			message: host
				? `Không kết nối được tới '${host}'. Kiểm tra lại địa chỉ hoặc `
					+ 'xem dịch vụ đó có đang hoạt động không.'
				: 'Không kết nối được tới dịch vụ ở bước này.',
			technical_message: technical,
		};
	}
	if (status !== undefined && status >= 400 && status < 500) {
		return {
			code: 'NODE_CONFIGURATION_INVALID',
			category: 'CONFIGURATION',
			message: `Dịch vụ từ chối yêu cầu (HTTP ${status}).`,
			technical_message: technical,
		};
	}

	if (className === 'UnsupportedNodeError' || lowered.includes('not allowlisted')) {
		return {
			code: 'NODE_UNSUPPORTED',
			category: 'CONFIGURATION',
			message: 'Bước này chưa được hỗ trợ.',
			technical_message: technical,
		};
	}

	if (lowered.includes('sub-workflow execution is disabled')) {
		return {
			code: 'NODE_UNSUPPORTED',
			category: 'CONFIGURATION',
			message: 'Chạy workflow con chưa được hỗ trợ.',
			technical_message: technical,
		};
	}

	return {
		code: 'NODE_EXECUTION_FAILED',
		category: 'NODE',
		message: 'Một bước trong workflow đã thất bại.',
		technical_message: technical,
	};
}
