/**
 * Product node config -> n8n node parameters (SRS 25.2).
 *
 * One mapper per certified node. Each is a pure function from the product's own
 * config shape to the parameter shape of one exact pinned node version — the
 * versions are named in the file because that is what the mapping is valid
 * against, and a bump is a certification exercise (ADR-013).
 *
 * The expression convention: a product config value that starts with `=` is an
 * expression, which is also n8n's convention (ADR-008), so those values pass
 * through untouched. Everything else is quoted as a literal.
 */

import type { INode } from 'n8n-workflow';

import type { ProductGraphNode, RuntimeCredential } from '../contracts/engine-dto';
import { PRODUCT_START_NODE_VERSION, PRODUCT_START_NODE_TYPE } from '../nodes/product-start.node';

export interface MapperContext {
	/** Product credential id -> the resolved credential for this run. */
	credentials: Map<string, RuntimeCredential>;
	/** Collects diagnostics rather than throwing, so one bad node does not hide the rest. */
	report: (code: string, message: string, nodeId: string, field?: string) => void;
	egress: {
		maxRedirects: number;
		requestTimeoutSeconds: number;
	};
}

export interface MappedNode {
	parameters: Record<string, unknown>;
	credentials?: INode['credentials'];
	continueOnFail?: boolean;
}

type Mapper = (node: ProductGraphNode, ctx: MapperContext) => MappedNode;

const asString = (value: unknown, fallback = ''): string =>
	value === undefined || value === null ? fallback : String(value);

/** Product credential type -> (n8n generic auth key, the field shape that node expects). */
function genericAuth(
	credential: RuntimeCredential,
): { authType: string; data: Record<string, unknown> } | null {
	const data = credential.data ?? {};
	switch (credential.credential_type) {
		case 'HTTP_BASIC':
			// nodes-base httpBasicAuth reads `user`/`password`.
			return {
				authType: 'httpBasicAuth',
				data: { user: asString(data.username), password: asString(data.password) },
			};
		case 'BEARER':
			// There is no bearer credential type in the pinned tree, and there does
			// not need to be: a bearer token is an Authorization header, and
			// httpHeaderAuth is exactly that.
			return {
				authType: 'httpHeaderAuth',
				data: { name: 'Authorization', value: `Bearer ${asString(data.token)}` },
			};
		case 'HEADER_API_KEY':
			return {
				authType: 'httpHeaderAuth',
				data: {
					name: asString(data.header_name, 'X-API-Key'),
					value: asString(data.value),
				},
			};
		case 'QUERY_API_KEY':
			return {
				authType: 'httpQueryAuth',
				data: { name: asString(data.param_name, 'api_key'), value: asString(data.value) },
			};
		default:
			return null;
	}
}

/**
 * Credential payloads the runtime helper serves, keyed by n8n generic auth type.
 *
 * Filled by the http_request mapper and read by the credentials helper: the
 * mapper is where the product's credential type becomes an n8n one, so it is
 * also where the translated payload belongs.
 */
export const runtimeCredentialData = new WeakMap<
	MapperContext,
	Map<string, Record<string, unknown>>
>();

function rememberCredential(
	ctx: MapperContext,
	authType: string,
	data: Record<string, unknown>,
): void {
	let table = runtimeCredentialData.get(ctx);
	if (!table) {
		table = new Map();
		runtimeCredentialData.set(ctx, table);
	}
	table.set(authType, data);
}

// ── appbi.start ────────────────────────────────────────────────────────────
const mapStart: Mapper = (node) => ({
	parameters: {
		triggerType:
			node.node_key === 'webhook_trigger'
				? 'WEBHOOK'
				: node.node_key === 'schedule_trigger'
					? 'SCHEDULE'
					: 'MANUAL',
	},
});

// ── http_request -> n8n-nodes-base.httpRequest@4.1 ─────────────────────────
const mapHttpRequest: Mapper = (node, ctx) => {
	const config = node.config ?? {};
	const parameters: Record<string, unknown> = {
		method: asString(config.method, 'GET').toUpperCase(),
		url: asString(config.url),
		authentication: 'none',
	};

	let credentials: INode['credentials'] | undefined;
	const credentialId = config.credential_id ? String(config.credential_id) : '';
	if (credentialId) {
		const resolved = ctx.credentials.get(credentialId);
		if (!resolved) {
			// Reported, not thrown: publish-time validation already checks this,
			// so reaching here means the credential was deleted or revoked between
			// activation and this run. The product turns the code into an
			// "Update credential" card (SRS 34).
			ctx.report(
				'CREDENTIAL_REQUIRED',
				'Thông tin xác thực của bước này không còn khả dụng.',
				node.id,
				'credential_id',
			);
		} else {
			const mapped = genericAuth(resolved);
			if (!mapped) {
				ctx.report(
					'CREDENTIAL_INVALID',
					`Loại thông tin xác thực '${resolved.credential_type}' chưa được hỗ trợ.`,
					node.id,
					'credential_id',
				);
			} else {
				parameters.authentication = 'genericCredentialType';
				parameters.genericAuthType = mapped.authType;
				credentials = {
					[mapped.authType]: { id: resolved.credential_id, name: mapped.authType },
				};
				rememberCredential(ctx, mapped.authType, mapped.data);
			}
		}
	}

	const query = Array.isArray(config.query_parameters) ? config.query_parameters : [];
	if (query.length > 0) {
		parameters.sendQuery = true;
		parameters.specifyQuery = 'keypair';
		parameters.queryParameters = {
			parameters: query.map((item: any) => ({
				name: asString(item?.name),
				value: asString(item?.value),
			})),
		};
	}

	const headers = Array.isArray(config.headers) ? config.headers : [];
	if (headers.length > 0) {
		parameters.sendHeaders = true;
		parameters.specifyHeaders = 'keypair';
		parameters.headerParameters = {
			parameters: headers.map((item: any) => ({
				name: asString(item?.name),
				value: asString(item?.value),
			})),
		};
	}

	const bodyMode = asString(config.body_mode, 'NONE').toUpperCase();
	if (bodyMode === 'JSON') {
		parameters.sendBody = true;
		parameters.contentType = 'json';
		parameters.specifyBody = 'json';
		const body = config.json_body;
		parameters.jsonBody = typeof body === 'string' ? body : JSON.stringify(body ?? {});
	} else if (bodyMode === 'FORM') {
		parameters.sendBody = true;
		parameters.contentType = 'form-urlencoded';
		parameters.specifyBody = 'keypair';
		const form = Array.isArray(config.form_body) ? config.form_body : [];
		parameters.bodyParameters = {
			parameters: form.map((item: any) => ({
				name: asString(item?.name),
				value: asString(item?.value),
			})),
		};
	}

	const responseFormat = asString(config.response_format, 'AUTO').toUpperCase();
	const options: Record<string, unknown> = {
		// Both caps come from the product's egress policy rather than from the
		// node's defaults: they are platform limits, not per-workflow taste
		// (SRS 32.2).
		timeout: Math.min(
			Number(config.timeout_ms ?? 30000),
			ctx.egress.requestTimeoutSeconds * 1000,
		),
		redirect: { redirect: { followRedirects: true, maxRedirects: ctx.egress.maxRedirects } },
		// Certificate validation is never negotiable from a workflow config.
		allowUnauthorizedCerts: false,
	};
	if (responseFormat !== 'AUTO') {
		options.response = {
			response: { responseFormat: responseFormat === 'JSON' ? 'json' : 'text' },
		};
	}
	parameters.options = options;

	return {
		parameters,
		credentials,
		continueOnFail: Boolean(config.continue_on_error),
	};
};

// ── edit_fields -> n8n-nodes-base.set@3.2 ──────────────────────────────────
const SET_VALUE_KEY: Record<string, string> = {
	string: 'stringValue',
	number: 'numberValue',
	boolean: 'booleanValue',
	object: 'objectValue',
	array: 'arrayValue',
};

const mapEditFields: Mapper = (node, ctx) => {
	const config = node.config ?? {};
	const assignments = Array.isArray(config.assignments) ? config.assignments : [];
	if (assignments.length === 0) {
		ctx.report(
			'NODE_CONFIGURATION_INVALID',
			'Bước Edit Fields chưa khai báo field nào.',
			node.id,
			'assignments',
		);
	}

	const values = assignments.map((item: any) => {
		const type = asString(item?.type, 'string');
		const valueKey = SET_VALUE_KEY[type] ?? 'stringValue';
		return {
			name: asString(item?.name),
			// Set v3.2 names the discriminator by its value key, not by the type.
			type: valueKey,
			[valueKey]: asString(item?.value),
		};
	});

	return {
		parameters: {
			mode: 'manual',
			include: config.keep_only_set ? 'none' : 'all',
			fields: { values },
			options: {},
		},
	};
};

// ── if -> n8n-nodes-base.if@1 ──────────────────────────────────────────────
/** Product operator -> the operator name If v1 uses, per value type. */
const IF_OPERATORS: Record<string, { op: string; bucket: 'string' | 'number' | 'boolean' }> = {
	equals: { op: 'equal', bucket: 'string' },
	not_equals: { op: 'notEqual', bucket: 'string' },
	contains: { op: 'contains', bucket: 'string' },
	not_contains: { op: 'notContains', bucket: 'string' },
	starts_with: { op: 'startsWith', bucket: 'string' },
	ends_with: { op: 'endsWith', bucket: 'string' },
	is_empty: { op: 'isEmpty', bucket: 'string' },
	is_not_empty: { op: 'isNotEmpty', bucket: 'string' },
	gt: { op: 'larger', bucket: 'number' },
	gte: { op: 'largerEqual', bucket: 'number' },
	lt: { op: 'smaller', bucket: 'number' },
	lte: { op: 'smallerEqual', bucket: 'number' },
	is_true: { op: 'equal', bucket: 'boolean' },
	is_false: { op: 'notEqual', bucket: 'boolean' },
};

function coerceRight(operator: string, valueType: string, raw: unknown): unknown {
	if (operator === 'is_true') return true;
	if (operator === 'is_false') return true; // compared with notEqual
	if (valueType === 'number') {
		const asNumber = Number(raw);
		// An expression cannot be coerced here -- it is resolved at runtime, so it
		// has to travel as the string it is.
		if (typeof raw === 'string' && raw.startsWith('=')) return raw;
		return Number.isFinite(asNumber) ? asNumber : 0;
	}
	if (valueType === 'boolean') {
		if (typeof raw === 'string' && raw.startsWith('=')) return raw;
		return raw === true || raw === 'true';
	}
	return asString(raw);
}

/**
 * Product conditions -> n8n's typed condition buckets.
 *
 * Shared by IF and Filter, which use the same `conditions` fixedCollection in
 * the pinned tree. Shared deliberately rather than copied: the bucket choice
 * below is where the boolean-equality defect lived (ADR-023), and a second
 * copy of it is a second place for that defect to come back.
 */
function conditionBuckets(
	node: Parameters<Mapper>[0],
	ctx: Parameters<Mapper>[1],
	label: string,
): Record<string, unknown[]> {
	const config = node.config ?? {};
	const conditions = Array.isArray(config.conditions) ? config.conditions : [];
	if (conditions.length === 0) {
		ctx.report(
			'NODE_CONFIGURATION_INVALID',
			`Bước ${label} chưa có điều kiện nào.`,
			node.id,
			'conditions',
		);
	}

	const buckets: Record<string, unknown[]> = {};
	for (const condition of conditions) {
		const operatorKey = asString(condition?.operator, 'equals');
		const mapping = IF_OPERATORS[operatorKey];
		if (!mapping) {
			ctx.report(
				'NODE_CONFIGURATION_INVALID',
				`Phép so sánh '${operatorKey}' chưa được hỗ trợ.`,
				node.id,
				'conditions',
			);
			continue;
		}
		const declaredType = asString(condition?.value_type, 'string');
		// Which of n8n's typed condition buckets this goes in.
		//
		// The operator decides it for the comparisons that only make sense one
		// way -- `gt` in a string bucket compares lexicographically, so "9" is
		// larger than "10" and the answer is quietly wrong. For the equality
		// operators, which n8n offers in every bucket, the *declared* type
		// decides.
		//
		// Getting the second half wrong was silent and total: a `boolean`
		// condition landed in the string bucket, where n8n compared a real
		// `true` against the text "true" and never matched. The step ran, the
		// canvas was green, and the branch simply never fired.
		const equality = operatorKey === 'equals' || operatorKey === 'not_equals';
		const bucket =
			mapping.bucket === 'string' && equality
			&& (declaredType === 'number' || declaredType === 'boolean')
				? (declaredType as 'number' | 'boolean')
				: mapping.bucket;

		buckets[bucket] = buckets[bucket] ?? [];
		buckets[bucket].push({
			value1: condition?.left ?? '',
			operation: mapping.op,
			value2: coerceRight(operatorKey, bucket, condition?.right),
		});
	}

	return buckets;
}

const mapIf: Mapper = (node, ctx) => {
	const config = node.config ?? {};
	return {
		parameters: {
			combineOperation: asString(config.combinator, 'and') === 'or' ? 'any' : 'all',
			conditions: conditionBuckets(node, ctx, 'IF'),
		},
	};
};

// ── filter -> n8n-nodes-base.filter@1 ──────────────────────────────────────
/**
 * Drop the items that do not match, and pass the rest on one output.
 *
 * The same conditions as IF, and a different shape of answer: IF sends every
 * item down one of two branches, Filter sends the matching ones onward and the
 * rest nowhere. Today that is expressed as an IF with an empty false branch,
 * which draws a line to nothing and reads as an unfinished workflow.
 *
 * Note the parameter name: Filter says `combineConditions` with `AND`/`OR`
 * where IF says `combineOperation` with `all`/`any`. Same idea, different
 * spelling, and no error if you use the wrong one -- the node just falls back
 * to its default and quietly ANDs a set of conditions the user meant to OR.
 */
const mapFilter: Mapper = (node, ctx) => {
	const config = node.config ?? {};
	return {
		parameters: {
			combineConditions: asString(config.combinator, 'and') === 'or' ? 'OR' : 'AND',
			conditions: conditionBuckets(node, ctx, 'Filter'),
		},
	};
};

// ── switch -> n8n-nodes-base.switch@2 ──────────────────────────────────────
/**
 * The value the catch-all rule compares against.
 *
 * Deliberately not something a payload would contain. If a workflow really did
 * carry this exact string in the switched field, that item would fall through
 * the "everything else" branch -- stated here because it is the one input that
 * makes the mapping wrong.
 */
const SWITCH_CATCH_ALL_SENTINEL = '__appbi_switch_catch_all__';

const SWITCH_OPERATORS: Record<string, string> = {
	equals: 'equal',
	not_equals: 'notEqual',
	contains: 'contains',
	gt: 'larger',
	lt: 'smaller',
};

const mapSwitch: Mapper = (node, ctx) => {
	const config = node.config ?? {};
	const rules = Array.isArray(config.rules) ? config.rules : [];
	if (rules.length === 0) {
		ctx.report('NODE_CONFIGURATION_INVALID', 'Bước Switch chưa có nhánh nào.', node.id, 'rules');
	}

	// Switch v2 has one `value1` per data type and one `rules` collection. The
	// product models a single value and per-rule types, so the compiler picks
	// the dominant type and reports a graph that mixes them rather than
	// silently comparing a number as a string.
	const declaredTypes = new Set(
		rules.map((rule: any) => asString(rule?.value_type, 'string')),
	);
	if (declaredTypes.size > 1) {
		ctx.report(
			'NODE_CONFIGURATION_INVALID',
			'Các nhánh của Switch phải dùng cùng một kiểu dữ liệu.',
			node.id,
			'rules',
		);
	}
	const dataType = [...declaredTypes][0] ?? 'string';

	const compiled = rules.map((rule: any) => ({
		operation: SWITCH_OPERATORS[asString(rule?.operator, 'equals')] ?? 'equal',
		value2: coerceRight(asString(rule?.operator, 'equals'), dataType, rule?.compare_to),
		outputKey: asString(rule?.output_key),
	}));

	// The product offers an "everything else" branch; Switch v2 does not. Its
	// `fallbackOutput` can only name one of the existing rule outputs, and
	// passing anything else crashes the node inside its own output array.
	//
	// So the fallback compiles to a catch-all rule appended last. Rules are
	// evaluated in order and the first match wins, so a rule that is always
	// true in final position behaves exactly like a fallback. `notEqual`
	// against a sentinel is true for every possible value -- including null and
	// undefined -- whatever the declared data type.
	if (config.fallback === 'EXTRA_OUTPUT') {
		compiled.push({
			operation: 'notEqual',
			value2: SWITCH_CATCH_ALL_SENTINEL,
			outputKey: 'other',
		});
	}

	const parameters: Record<string, unknown> = {
		mode: 'rules',
		dataType,
		value1: config.value ?? '',
		rules: { rules: compiled },
		// -1: an item matching no rule is dropped. With a catch-all appended
		// above there is nothing left for the node's own fallback to do.
		fallbackOutput: -1,
	};

	return { parameters };
};

// ── merge -> n8n-nodes-base.merge@2.1 ──────────────────────────────────────
const mapMerge: Mapper = (node, ctx) => {
	const config = node.config ?? {};
	const mode = asString(config.mode, 'APPEND').toUpperCase();

	if (mode === 'APPEND') {
		return { parameters: { mode: 'append', options: {} } };
	}
	if (mode === 'COMBINE_BY_POSITION') {
		return {
			parameters: {
				mode: 'combine',
				combinationMode: 'mergeByPosition',
				options: {},
			},
		};
	}

	const field = asString(config.match_field);
	if (!field) {
		ctx.report(
			'NODE_CONFIGURATION_INVALID',
			'Ghép theo field khóa cần tên field.',
			node.id,
			'match_field',
		);
	}
	return {
		parameters: {
			mode: 'combine',
			combinationMode: 'mergeByFields',
			mergeByFields: { values: [{ field1: field, field2: field }] },
			joinMode: 'keepEverything',
			outputDataFrom: 'both',
			options: {},
		},
	};
};

export const MAPPERS: Record<string, Mapper> = {
	manual_trigger: mapStart,
	webhook_trigger: mapStart,
	schedule_trigger: mapStart,
	http_request: mapHttpRequest,
	edit_fields: mapEditFields,
	if: mapIf,
	filter: mapFilter,
	switch: mapSwitch,
	merge: mapMerge,
};

export const START_NODE_TYPE = PRODUCT_START_NODE_TYPE;
export const START_NODE_VERSION = PRODUCT_START_NODE_VERSION;
