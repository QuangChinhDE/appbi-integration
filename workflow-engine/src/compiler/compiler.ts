/**
 * Product graph -> n8n Workflow (SRS 25).
 *
 * The only place in the system where the two worlds meet. Everything above it
 * speaks product nodes and named ports; everything below it is n8n's object
 * model with node names and output indices.
 *
 * Determinism is a requirement, not a nicety (SRS 25.6): the same graph hash,
 * registry snapshot and compiler version must produce the same compiled output,
 * because that is what makes a regression after an upgrade attributable.
 */

import { createHash } from 'node:crypto';

import { Workflow } from 'n8n-workflow';
import type { IConnections, INode } from 'n8n-workflow';

import {
	COMPILER_VERSION,
	type Diagnostic,
	type ExecutionRequest,
	type ProductGraph,
	type ProductGraphNode,
	type RegistryEntry,
	type RuntimeCredential,
} from '../contracts/engine-dto';
import { nodeTypes } from '../nodes/registry-loader';
import {
	MAPPERS,
	type MapperContext,
	runtimeCredentialData,
} from './node-mappers';

export interface CompileResult {
	ok: boolean;
	diagnostics: Diagnostic[];
	workflow?: Workflow;
	startNodeName?: string;
	compiledHash?: string;
	/** n8n generic auth type -> credential payload, for the credentials helper. */
	credentialData: Map<string, Record<string, unknown>>;
	/** Product node id -> node name, so results can be attributed back. */
	nodeNameById: Map<string, string>;
	nodeKeyByName: Map<string, string>;
	/**
	 * How many output ports the *product* says a node has.
	 *
	 * Needed because some n8n implementations return more branches than they
	 * declare. `Filter` declares one output and returns two -- the items it
	 * kept and the ones it dropped -- and the second is simply never
	 * connected. Reading every branch back would report the discarded items as
	 * output, which is the opposite of what the step did.
	 */
	outputPortsByName: Map<string, number>;
	nodeIdByName: Map<string, string>;
}

/**
 * Port -> output index.
 *
 * The product names its ports and n8n numbers them. Keeping the translation in
 * one function is what stops an IF's false branch being wired to output 0 by a
 * caller that assumed `main` (SRS 25.4).
 */
function outputIndex(
	node: ProductGraphNode,
	entry: RegistryEntry,
	port: string,
): number | null {
	const capability = entry.capability ?? {};

	if (capability.output_ports_from === 'rules') {
		const rules = Array.isArray(node.config?.rules) ? (node.config!.rules as any[]) : [];
		const keys = rules.map((rule) => String(rule?.output_key ?? ''));
		const found = keys.indexOf(port);
		if (found >= 0) return found;
		if (port === 'other' && node.config?.fallback === 'EXTRA_OUTPUT') {
			// The fallback output sits immediately after the rules, which is where
			// Switch v2 puts it when `fallbackOutput` is 'extra'.
			return keys.length;
		}
		return null;
	}

	const declared = (capability.output_ports ?? []).map((p) => String(p.key));
	if (declared.length === 0) return port === 'main' ? 0 : null;
	const index = declared.indexOf(port);
	return index >= 0 ? index : null;
}

function inputIndex(entry: RegistryEntry, port: string): number | null {
	const declared = (entry.capability?.input_ports ?? []).map((p) => String(p.key));
	if (declared.length === 0) return null;
	const index = declared.indexOf(port);
	return index >= 0 ? index : null;
}

/** Node names must be unique: n8n keys its connections and `$node[...]` by name. */
function uniqueName(desired: string, taken: Set<string>, fallback: string): string {
	const base = (desired || fallback).trim() || fallback;
	if (!taken.has(base)) {
		taken.add(base);
		return base;
	}
	let counter = 2;
	while (taken.has(`${base} ${counter}`)) counter += 1;
	const name = `${base} ${counter}`;
	taken.add(name);
	return name;
}

export function compile(request: ExecutionRequest): CompileResult {
	const diagnostics: Diagnostic[] = [];
	const report = (
		code: string,
		message: string,
		nodeId?: string | null,
		field?: string | null,
		severity: 'ERROR' | 'WARNING' = 'ERROR',
	) => {
		diagnostics.push({ code, message, node_id: nodeId ?? null, field: field ?? null, severity });
	};

	const graph: ProductGraph = request.graph ?? { nodes: [], connections: [] };
	const registry = request.registry ?? {};
	const types = nodeTypes();

	const credentials = new Map<string, RuntimeCredential>();
	for (const credential of request.credentials ?? []) {
		credentials.set(credential.credential_id, credential);
	}

	const ctx: MapperContext = {
		credentials,
		report: (code, message, nodeId, field) => report(code, message, nodeId, field),
		egress: {
			maxRedirects: Number(request.egress_policy?.max_redirects ?? 5),
			requestTimeoutSeconds: Number(request.egress_policy?.request_timeout_seconds ?? 60),
		},
	};

	// ── nodes ────────────────────────────────────────────────────────────────
	const taken = new Set<string>();
	const nodeNameById = new Map<string, string>();
	const nodeIdByName = new Map<string, string>();
	const nodeKeyByName = new Map<string, string>();
	const outputPortsByName = new Map<string, number>();
	const compiled: INode[] = [];
	let startNodeName: string | undefined;

	for (const node of graph.nodes ?? []) {
		const entry = registry[node.node_key];
		if (!entry) {
			report(
				'NODE_UNSUPPORTED',
				`Bước '${node.name || node.id}' dùng loại không nằm trong danh sách được phép.`,
				node.id,
			);
			continue;
		}
		if (entry.status === 'DISABLED' || entry.certification === 'BLOCKED') {
			report(
				'NODE_UNSUPPORTED',
				`Loại bước '${node.node_key}' đang bị vô hiệu hóa.`,
				node.id,
			);
			continue;
		}

		const engineType = entry.engine_binding?.engine_node_type;
		const engineVersion = Number(entry.engine_binding?.engine_type_version);
		if (!engineType || !Number.isFinite(engineVersion)) {
			report(
				'NODE_UNSUPPORTED',
				`Loại bước '${node.node_key}' chưa có engine binding.`,
				node.id,
			);
			continue;
		}
		// The second half of the double allowlist (SRS 32.4): the product said
		// this node is allowed, and the engine independently confirms it loaded
		// that exact node version.
		if (!types.isCertified(engineType, engineVersion)) {
			report(
				'NODE_UNSUPPORTED',
				`Runtime chưa chứng nhận '${node.node_key}' ở phiên bản này.`,
				node.id,
			);
			continue;
		}

		const mapper = MAPPERS[node.node_key];
		if (!mapper) {
			report(
				'NODE_UNSUPPORTED',
				`Chưa có bộ chuyển đổi cấu hình cho '${node.node_key}'.`,
				node.id,
			);
			continue;
		}

		const mapped = mapper(node, ctx);
		const name = uniqueName(node.name, taken, node.id);
		nodeNameById.set(node.id, name);
		nodeIdByName.set(name, node.id);
		nodeKeyByName.set(name, node.node_key);
		outputPortsByName.set(
			name,
			Math.max(1, (entry.capability?.output_ports ?? []).length || 1),
		);

		compiled.push({
			// The product node id becomes the n8n node id, so a result can be
			// attributed without a lookup table (SRS 25.2).
			id: node.id,
			name,
			type: engineType,
			typeVersion: engineVersion,
			position: [node.position?.x ?? 0, node.position?.y ?? 0],
			parameters: mapped.parameters,
			disabled: Boolean(node.disabled),
			...(mapped.credentials ? { credentials: mapped.credentials } : {}),
			...(mapped.continueOnFail ? { continueOnFail: true } : {}),
		} as INode);

		if (entry.capability?.is_trigger) {
			if (startNodeName) {
				report('TRIGGER_AMBIGUOUS', 'Workflow chỉ được có một bước bắt đầu.', node.id);
			} else {
				startNodeName = name;
			}
		}
	}

	if (!startNodeName) {
		report('TRIGGER_REQUIRED', 'Workflow cần một bước bắt đầu.', null);
	}

	// ── connections ──────────────────────────────────────────────────────────
	const connections: IConnections = {};
	const nodeById = new Map((graph.nodes ?? []).map((n) => [n.id, n]));

	for (const connection of graph.connections ?? []) {
		const sourceId = String(connection.from?.node_id ?? '');
		const targetId = String(connection.to?.node_id ?? '');
		const sourceName = nodeNameById.get(sourceId);
		const targetName = nodeNameById.get(targetId);
		if (!sourceName || !targetName) {
			// The dangling half was already reported as an unsupported node, or
			// the product's own validation rejected it. Reporting again here would
			// double every message the editor shows.
			continue;
		}

		const sourceNode = nodeById.get(sourceId)!;
		const targetNode = nodeById.get(targetId)!;
		const sourceEntry = registry[sourceNode.node_key]!;
		const targetEntry = registry[targetNode.node_key]!;

		const from = outputIndex(sourceNode, sourceEntry, String(connection.from?.port ?? 'main'));
		if (from === null) {
			report(
				'CONNECTION_PORT_INVALID',
				`Nhánh '${connection.from?.port}' không tồn tại ở bước '${sourceNode.name}'.`,
				sourceId,
			);
			continue;
		}
		const to = inputIndex(targetEntry, String(connection.to?.port ?? 'main')) ?? 0;

		connections[sourceName] = connections[sourceName] ?? { main: [] };
		const main = connections[sourceName].main!;
		while (main.length <= from) main.push([]);
		main[from] = main[from] ?? [];
		main[from]!.push({ node: targetName, type: 'main', index: to });
	}

	const errors = diagnostics.filter((d) => d.severity === 'ERROR');
	if (errors.length > 0) {
		return {
			ok: false,
			diagnostics,
			credentialData: runtimeCredentialData.get(ctx) ?? new Map(),
			nodeNameById,
			nodeKeyByName,
			outputPortsByName,
			nodeIdByName,
		};
	}

	const workflow = new Workflow({
		id: request.execution_id,
		name: `execution-${request.execution_id}`,
		nodes: compiled,
		connections,
		active: false,
		nodeTypes: types,
		settings: {
			// The engine does not save execution data anywhere; the product owns
			// history. These settings exist in n8n's model and are pinned to the
			// values that keep it from trying.
			saveManualExecutions: false,
			saveDataErrorExecution: 'none',
			saveDataSuccessExecution: 'none',
			executionTimeout: request.timeout_seconds ?? 1200,
			// Not cosmetic, and not optional.
			//
			// `WorkflowExecute` reads a node's `requiredInputs` *only* when this
			// is 'v1'; otherwise it treats every input of a multi-input node as
			// required. Merge declares `requiredInputs: 1`, so without this the
			// most ordinary branching shape in the product -- IF, two branches,
			// Merge -- executes the branch the condition did *not* choose, in
			// order to satisfy an input n8n need not have waited for.
			//
			// The result was silent and wrong rather than an error: both
			// branches came back green on the canvas and the merged output
			// carried a phantom record built from empty input. v1 is also the
			// order the n8n application itself uses, so this is the behaviour
			// the pinned node versions were written against.
			executionOrder: 'v1',
		},
	});

	return {
		ok: true,
		diagnostics,
		workflow,
		startNodeName,
		compiledHash: compiledHash(compiled, connections),
		credentialData: runtimeCredentialData.get(ctx) ?? new Map(),
		nodeNameById,
		nodeKeyByName,
		outputPortsByName,
		nodeIdByName,
	};
}

/**
 * Hash of the compiled graph.
 *
 * Node parameters are included; positions are not, because moving a node on the
 * canvas does not change what runs. Stored on the execution so a "same version,
 * different behaviour" report after an upgrade has something to compare.
 */
export function compiledHash(nodes: INode[], connections: IConnections): string {
	const material = {
		compiler: COMPILER_VERSION,
		nodes: [...nodes]
			.map((node) => ({
				id: node.id,
				name: node.name,
				type: node.type,
				typeVersion: node.typeVersion,
				parameters: node.parameters,
				disabled: node.disabled ?? false,
				// Credential *ids* only. The payload is per-run and must not change
				// the hash of a graph that is otherwise identical.
				credentials: Object.entries(node.credentials ?? {}).map(([key, value]) => [
					key,
					(value as any)?.id ?? null,
				]),
			}))
			.sort((a, b) => String(a.id).localeCompare(String(b.id))),
		connections,
	};
	return createHash('sha256')
		.update(JSON.stringify(material))
		.digest('hex');
}
