/**
 * Test helpers: product-shaped graphs and a registry snapshot.
 *
 * The registry here mirrors `backend/app/resources/node_registry.json`. It is
 * duplicated rather than imported so that a change to the product's catalogue
 * has to be made deliberately on both sides — the contract tests exist to
 * notice drift, and a shared fixture would hide exactly the drift they are for.
 */

import { createServer, type Server, type ServerResponse } from 'node:http';

import type {
	ExecutionRequest,
	ProductGraph,
	RegistrySnapshot,
} from '../src/contracts/engine-dto';
import { statusOf } from '../src/runtime/execution-manager';

export const REGISTRY: RegistrySnapshot = {
	manual_trigger: {
		node_key: 'manual_trigger',
		engine_binding: { engine_node_type: 'appbi.start', engine_type_version: 1 },
		capability: { input_ports: [], output_ports: [{ key: 'main' }], is_trigger: true },
		certification: 'SUPPORTED',
		status: 'ACTIVE',
	},
	webhook_trigger: {
		node_key: 'webhook_trigger',
		engine_binding: { engine_node_type: 'appbi.start', engine_type_version: 1 },
		capability: {
			input_ports: [],
			output_ports: [{ key: 'main' }],
			is_trigger: true,
			trigger_type: 'WEBHOOK',
		},
		certification: 'SUPPORTED',
		status: 'ACTIVE',
	},
	http_request: {
		node_key: 'http_request',
		engine_binding: { engine_node_type: 'n8n-nodes-base.httpRequest', engine_type_version: 4.1 },
		capability: { input_ports: [{ key: 'main' }], output_ports: [{ key: 'main' }] },
		certification: 'SUPPORTED',
		status: 'ACTIVE',
	},
	edit_fields: {
		node_key: 'edit_fields',
		engine_binding: { engine_node_type: 'n8n-nodes-base.set', engine_type_version: 3.2 },
		capability: { input_ports: [{ key: 'main' }], output_ports: [{ key: 'main' }] },
		certification: 'SUPPORTED',
		status: 'ACTIVE',
	},
	if: {
		node_key: 'if',
		engine_binding: { engine_node_type: 'n8n-nodes-base.if', engine_type_version: 1 },
		capability: {
			input_ports: [{ key: 'main' }],
			output_ports: [{ key: 'true' }, { key: 'false' }],
		},
		certification: 'SUPPORTED',
		status: 'ACTIVE',
	},
	filter: {
		node_key: 'filter',
		engine_binding: { engine_node_type: 'n8n-nodes-base.filter', engine_type_version: 1 },
		capability: {
			input_ports: [{ key: 'main' }],
			// One output, unlike IF. Items that do not match stop here.
			output_ports: [{ key: 'main' }],
		},
		certification: 'SUPPORTED',
		status: 'ACTIVE',
	},
	switch: {
		node_key: 'switch',
		engine_binding: { engine_node_type: 'n8n-nodes-base.switch', engine_type_version: 2 },
		capability: {
			input_ports: [{ key: 'main' }],
			output_ports: [],
			output_ports_from: 'rules',
		},
		certification: 'SUPPORTED',
		status: 'ACTIVE',
	},
	merge: {
		node_key: 'merge',
		engine_binding: { engine_node_type: 'n8n-nodes-base.merge', engine_type_version: 2.1 },
		capability: {
			input_ports: [{ key: 'input_1' }, { key: 'input_2' }],
			output_ports: [{ key: 'main' }],
		},
		certification: 'SUPPORTED',
		status: 'ACTIVE',
	},
	/** Present in the registry but switched off, for the rejection test. */
	disabled_node: {
		node_key: 'disabled_node',
		engine_binding: { engine_node_type: 'n8n-nodes-base.set', engine_type_version: 3.2 },
		capability: { input_ports: [{ key: 'main' }], output_ports: [{ key: 'main' }] },
		certification: 'SUPPORTED',
		status: 'DISABLED',
	},
	/** A node whose binding names a version the runtime did not certify. */
	uncertified_version: {
		node_key: 'uncertified_version',
		engine_binding: { engine_node_type: 'n8n-nodes-base.set', engine_type_version: 2 },
		capability: { input_ports: [{ key: 'main' }], output_ports: [{ key: 'main' }] },
		certification: 'SUPPORTED',
		status: 'ACTIVE',
	},
};

export function node(
	id: string,
	nodeKey: string,
	name: string,
	config: Record<string, unknown> = {},
) {
	return { id, node_key: nodeKey, name, config, position: { x: 0, y: 0 } };
}

export function link(from: string, to: string, fromPort = 'main', toPort = 'main') {
	return { from: { node_id: from, port: fromPort }, to: { node_id: to, port: toPort } };
}

let counter = 0;

export function request(
	graph: ProductGraph,
	overrides: Partial<ExecutionRequest> = {},
): ExecutionRequest {
	counter += 1;
	return {
		execution_id: `test_exec_${counter}`,
		workspace_ref: 'ws_test',
		graph,
		registry: REGISTRY,
		start_payload: [{ hello: 'world' }],
		credentials: [],
		trace_id: `trc_test_${counter}`,
		timeout_seconds: 30,
		// Tests talk to a loopback HTTP server, which the deployment policy
		// blocks by default. Allowing it here is also the test that the
		// per-request policy is actually read.
		egress_policy: { allow_private_networks: true, max_redirects: 3 },
		...overrides,
	};
}

/** Poll until the run reaches a terminal state, the way the product's worker does. */
export async function waitForTerminal(ref: string, timeoutMs = 20_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const status = statusOf(ref);
		if (status && status.status !== 'RUNNING') return status;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error(`execution ${ref} did not finish within ${timeoutMs}ms`);
}

export function outputOf(status: { node_results: any[] }, nodeName: string) {
	const result = status.node_results.find((r) => r.node_name === nodeName);
	return (result?.output_preview?.items ?? []) as Record<string, unknown>[];
}

export function statusOfNode(status: { node_results: any[] }, nodeName: string) {
	return status.node_results.find((r) => r.node_name === nodeName)?.status;
}

/** A tiny HTTP server so the HTTP Request tests exercise a real request. */
export interface TestEndpoint {
	url: string;
	close: () => Promise<void>;
	requests: { method: string; path: string; headers: Record<string, string>; body: string }[];
}

export async function startTestEndpoint(
	handler?: (
		request: { method: string; path: string; headers: Record<string, string>; body: string },
		respond: (status: number, body: unknown, headers?: Record<string, string>) => void,
	) => void,
): Promise<TestEndpoint> {
	const seen: TestEndpoint['requests'] = [];
	const server: Server = createServer((incoming, outgoing) => {
		const chunks: Buffer[] = [];
		incoming.on('data', (chunk) => chunks.push(chunk));
		incoming.on('end', () => {
			const record = {
				method: incoming.method ?? 'GET',
				path: incoming.url ?? '/',
				headers: incoming.headers as Record<string, string>,
				body: Buffer.concat(chunks).toString('utf8'),
			};
			seen.push(record);

			const respond = (status: number, body: unknown, headers: Record<string, string> = {}) => {
				outgoing.writeHead(status, { 'content-type': 'application/json', ...headers });
				outgoing.end(typeof body === 'string' ? body : JSON.stringify(body));
			};

			if (handler) handler(record, respond);
			else respond(200, { ok: true, echo: record.body ? JSON.parse(record.body || '{}') : null });
		});
	});

	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const address = server.address();
	const port = typeof address === 'object' && address ? address.port : 0;

	return {
		url: `http://127.0.0.1:${port}`,
		requests: seen,
		close: () => new Promise<void>((resolve) => server.close(() => resolve())),
	};
}

/**
 * A server the test writes the response to itself.
 *
 * `startTestEndpoint` always sets `content-type: application/json`, which is
 * the right default and makes two real shapes untestable: a 204 that announces
 * no content-type at all, and a body whose type contradicts its content. Those
 * are exactly the cases Wave 0A found defects in.
 */
export async function startRawEndpoint(
	write: (response: ServerResponse) => void,
): Promise<TestEndpoint> {
	const seen: TestEndpoint['requests'] = [];
	const server: Server = createServer((incoming, outgoing) => {
		seen.push({
			method: incoming.method ?? 'GET',
			path: incoming.url ?? '/',
			headers: incoming.headers as Record<string, string>,
			body: '',
		});
		write(outgoing);
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const address = server.address();
	const port = typeof address === 'object' && address ? address.port : 0;
	return {
		url: `http://127.0.0.1:${port}`,
		requests: seen,
		close: () => new Promise<void>((resolve) => server.close(() => resolve())),
	};
}
