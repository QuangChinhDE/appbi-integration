/**
 * The engine's internal contract (SRS 24).
 *
 * Every shape crossing the boundary is here, and every one of them is in
 * *product* vocabulary. Nothing in this file mentions `IRun`,
 * `INodeExecutionData` or an n8n node type: those live behind the compiler and
 * the normalizer, which is what makes an n8n upgrade a change to two directories
 * rather than to the whole product.
 *
 * Mirrors `backend/app/engine/dto.py`. When one side changes, the contract
 * tests in `tests/contract` are what catch the other side not having.
 */

export const CONTRACT_VERSION = '1';
export const COMPILER_VERSION = '1';

/** Product execution states the engine is allowed to report (SRS 16.1). */
export type ProductExecutionStatus =
	| 'RUNNING'
	| 'SUCCEEDED'
	| 'FAILED'
	| 'CANCELLED'
	| 'TIMED_OUT';

/** Per-node states (SRS 16.6). */
export type ProductNodeStatus = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED';

export interface ProductGraphNode {
	id: string;
	node_key: string;
	name: string;
	position?: { x: number; y: number };
	config?: Record<string, unknown>;
	product_schema_version?: number;
	disabled?: boolean;
}

export interface ProductConnection {
	from: { node_id: string; port: string };
	to: { node_id: string; port: string };
}

export interface ProductGraph {
	nodes: ProductGraphNode[];
	connections: ProductConnection[];
}

/**
 * The registry snapshot travelling with each request.
 *
 * Sent per request rather than configured in the engine so that editing the
 * catalogue cannot retroactively change how an already-published version
 * compiles (SRS 25.1).
 */
export interface RegistryEntry {
	node_key: string;
	engine_binding: {
		engine?: string;
		engine_node_type: string;
		engine_type_version: number;
		adapter_version?: string;
	};
	capability?: {
		input_ports?: { key: string; label?: string }[];
		output_ports?: { key: string; label?: string }[];
		output_ports_from?: string;
		is_trigger?: boolean;
		trigger_type?: string;
		credential_types?: string[];
	};
	product_schema_version?: number;
	certification?: string;
	status?: string;
}

export type RegistrySnapshot = Record<string, RegistryEntry>;

export interface RuntimeCredential {
	credential_id: string;
	credential_type: string;
	/** Plaintext, for the lifetime of one execution. Never logged, never stored. */
	data: Record<string, unknown>;
}

/** HTTP egress policy the engine enforces for this run (SRS 32.2). */
export interface EgressPolicy {
	allow_private_networks?: boolean;
	allowed_hosts?: string[];
	blocked_hosts?: string[];
	max_redirects?: number;
	max_response_bytes?: number;
	request_timeout_seconds?: number;
}

export interface ExecutionRequest {
	execution_id: string;
	workspace_ref: string;
	graph: ProductGraph;
	registry: RegistrySnapshot;
	start_payload: unknown;
	credentials?: RuntimeCredential[];
	trace_id?: string;
	idempotency_key?: string | null;
	timeout_seconds?: number;
	egress_policy?: EgressPolicy;
}

export interface Diagnostic {
	code: string;
	message: string;
	node_id?: string | null;
	field?: string | null;
	severity: 'ERROR' | 'WARNING';
}

export interface ValidationResponse {
	ok: boolean;
	diagnostics: Diagnostic[];
	compiled_hash?: string;
	compiler_version: string;
}

export interface NodeResultDto {
	node_id: string;
	node_name: string;
	status: ProductNodeStatus;
	execution_index: number;
	started_at?: string | null;
	ended_at?: string | null;
	duration_ms?: number | null;
	item_count?: number | null;
	input_preview?: { items: unknown[]; item_count: number; note?: string } | null;
	output_preview?: { items: unknown[]; item_count: number; note?: string } | null;
	truncated: boolean;
	error?: {
		code: string;
		category: string;
		message: string;
		technical_message?: string;
	} | null;
	branch_metadata: Record<string, unknown>;
}

export interface LogLineDto {
	at: string;
	level: 'INFO' | 'WARN' | 'ERROR';
	message: string;
	node_name?: string | null;
}

export interface ExecutionStatusDto {
	ref: string;
	execution_id: string;
	status: ProductExecutionStatus;
	started_at?: string | null;
	ended_at?: string | null;
	duration_ms?: number | null;
	error_code?: string | null;
	error_category?: string | null;
	error_message?: string | null;
	failed_node_name?: string | null;
	node_results: NodeResultDto[];
	logs: LogLineDto[];
	output_summary: Record<string, unknown>;
	/** Admin-only diagnostics. The product never serialises this to a browser. */
	technical: Record<string, unknown>;
}

export interface HealthDto {
	status: 'HEALTHY' | 'DEGRADED' | 'OFFLINE';
	contract_version: string;
	compiler_version: string;
	engine_version: string;
	loaded_nodes: string[];
	active_executions: number;
	message?: string;
}

export interface CapabilitiesDto {
	contract_version: string;
	compiler_version: string;
	engine_version: string;
	supported_node_keys: string[];
	features: Record<string, boolean>;
}

/** Error envelope, in the product's own error vocabulary (SRS 23.2). */
export interface EngineErrorEnvelope {
	error: {
		code: string;
		message: string;
		category: string;
		technical_message?: string;
	};
}
