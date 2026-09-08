/**
 * Product API types.
 *
 * These mirror what the BFF returns and nothing else. There is no n8n type in
 * this file and there must never be one — the FE does not know that the engine
 * is n8n, only that a workflow has nodes with product keys (guardrail 1, 9).
 */

export type PermissionMap = Record<string, string[]>;

export interface WorkspaceSummary {
  id: string;
  name: string;
  slug: string;
  timezone?: string;
}

export interface CurrentUser {
  id: string;
  email: string;
  full_name: string;
  locale: string;
  is_platform_admin: boolean;
  password_change_required: boolean;
  workspace: WorkspaceSummary | null;
  workspaces: WorkspaceSummary[];
  role: string;
  permissions: PermissionMap;
}

// ── node registry ──────────────────────────────────────────────────────────
export type NodeCategory = 'TRIGGER' | 'ACTION' | 'LOGIC' | 'DATA' | 'APP';
export type Certification = 'SUPPORTED' | 'BETA' | 'HIDDEN' | 'BLOCKED';

export interface FieldOption {
  value: string;
  label: string;
}

/** One row of a node's configuration form (SRS 54). */
export interface FieldSpec {
  key: string;
  label: string;
  type:
    | 'string' | 'number' | 'boolean' | 'enum' | 'json' | 'collection'
    | 'credential' | 'time' | 'timezone'
    // Only ever appears in a credential type's own schema. A node config never
    // holds a secret -- it references a credential by id (SRS 22.3).
    | 'secret';
  required?: boolean;
  advanced?: boolean;
  default?: unknown;
  description?: string;
  placeholder?: string;
  options?: FieldOption[];
  min?: number;
  max?: number;
  /** Shown only while another field holds a particular value. */
  condition?: { field: string; equals: unknown };
  expression_supported?: boolean;
  credential_types?: string[];
  item_fields?: FieldSpec[];
  min_items?: number;
  max_items?: number;
}

export interface PortSpec {
  key: string;
  label?: string;
}

export interface NodeCapability {
  input_ports?: PortSpec[];
  output_ports?: PortSpec[];
  /** Switch: its branches are named by the user, so its ports follow its rules. */
  output_ports_from?: 'rules';
  supports_expression?: boolean;
  credential_types?: string[];
  is_trigger?: boolean;
  trigger_type?: 'MANUAL' | 'WEBHOOK' | 'SCHEDULE';
}

export interface NodeDefinition {
  node_key: string;
  display_name: string;
  category: NodeCategory;
  description: string | null;
  icon: string | null;
  certification: Certification;
  status: 'ACTIVE' | 'DISABLED' | 'DEPRECATED';
  product_schema_version: number;
  config_schema: { fields?: FieldSpec[] };
  capability: NodeCapability;
  credential_types: string[];
  security_profile: Record<string, unknown>;
  docs_ref: string | null;
  spec_hash: string;
  last_certified_at: string | null;
  known_issues: string | null;
}

// ── workflow graph ─────────────────────────────────────────────────────────
export interface GraphNode {
  id: string;
  node_key: string;
  name: string;
  position: { x: number; y: number };
  config: Record<string, unknown>;
  product_schema_version?: number;
  disabled?: boolean;
}

export interface GraphConnection {
  from: { node_id: string; port: string };
  to: { node_id: string; port: string };
}

export interface WorkflowGraph {
  nodes: GraphNode[];
  connections: GraphConnection[];
}

export interface ValidationIssue {
  code: string;
  message: string;
  node_id: string | null;
  field: string | null;
  severity: 'ERROR' | 'WARNING';
}

export interface ValidationState {
  ok: boolean;
  issues: ValidationIssue[];
  engine?: 'OK' | 'INVALID' | 'UNAVAILABLE' | 'SKIPPED';
  trigger_node_id?: string | null;
  trigger_node_key?: string | null;
}

export interface DraftResponse {
  workflow_id: string;
  name: string;
  revision: number;
  graph: WorkflowGraph;
  graph_hash: string;
  product_schema_version: number;
  validation: ValidationState | null;
  updated_at: string;
}

export interface SaveDraftResponse {
  workflow_id: string;
  revision: number;
  graph_hash: string;
  validation: ValidationState;
  updated_at: string;
}

// ── workflow ───────────────────────────────────────────────────────────────
export type WorkflowStatus = 'ACTIVE' | 'INACTIVE' | 'DELETED';
export type TriggerType = 'MANUAL' | 'WEBHOOK' | 'SCHEDULE';

export interface HealthBlock {
  level: string;
  code: string | null;
  label: string;
  message?: string;
}

export interface ExecutionRef {
  id: string;
  short_id: string;
  status: ExecutionStatus;
  started_at: string | null;
  ended_at: string | null;
  duration_ms: number | null;
  failed_node_name: string | null;
}

export interface WorkflowSummary {
  id: string;
  name: string;
  description: string | null;
  status: WorkflowStatus;
  draft: {
    revision: number;
    graph_hash: string;
    has_changes_since_publish: boolean;
    updated_at: string | null;
    validation: ValidationState | null;
  };
  published: { version: number; published_at: string } | null;
  active_version: number | null;
  trigger: {
    type: TriggerType;
    enabled: boolean;
    summary: string;
    next_run_at: string | null;
  } | null;
  last_execution: ExecutionRef | null;
  health: HealthBlock;
  available_actions: string[];
  created_at: string;
  updated_at: string;
  trigger_detail?: TriggerDetail;
}

export interface TriggerDetail {
  id: string;
  trigger_type: TriggerType;
  enabled: boolean;
  config: Record<string, unknown>;
  overlap_policy: string;
  next_run_at: string | null;
  last_fired_at: string | null;
  active_version_id: string | null;
  webhook?: {
    url: string;
    method: string;
    auth_mode: string;
    secret_configured: boolean;
    signature_header: string;
    timestamp_header: string;
  };
  schedule?: { summary: string; next_runs: string[] };
}

export interface WorkflowVersionSummary {
  id: string;
  version: number;
  graph_hash: string;
  published_at: string;
  published_by: string | null;
  change_note: string | null;
  compiler_version: string;
  is_active: boolean;
  is_latest: boolean;
}

export interface WorkflowVersionDetail {
  id: string;
  version: number;
  graph: WorkflowGraph;
  graph_hash: string;
  published_at: string;
  change_note: string | null;
  is_active: boolean;
}

// ── executions ─────────────────────────────────────────────────────────────
export type ExecutionStatus =
  | 'QUEUED' | 'DISPATCHING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED'
  | 'CANCEL_REQUESTED' | 'CANCELLED' | 'TIMED_OUT' | 'FAILED_TO_START'
  | 'ENGINE_INTERRUPTED';

export type NodeRunStatus = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED';

export interface ExecutionSummary {
  id: string;
  short_id: string;
  workflow_id: string;
  workflow_name: string | null;
  version: { kind: 'DRAFT' | 'PUBLISHED'; number: number | null; draft_revision: number | null };
  status: ExecutionStatus;
  trigger_type: TriggerType;
  queued_at: string;
  started_at: string | null;
  ended_at: string | null;
  duration_ms: number | null;
  error_code: string | null;
  error_category: string | null;
  error_summary: string | null;
  failed_node_name: string | null;
  retry_of_execution_id: string | null;
  actions: { can_cancel: boolean; can_retry: boolean };
  trace_id: string;
}

export interface NodeRunResult {
  node_id: string;
  node_key: string;
  node_name: string;
  status: NodeRunStatus;
  execution_index: number;
  started_at: string | null;
  ended_at: string | null;
  duration_ms: number | null;
  item_count: number | null;
  truncated: boolean;
  error: {
    code?: string;
    category?: string;
    message?: string;
    technical_message?: string;
  } | null;
  branch_metadata: Record<string, unknown>;
  has_payload: boolean;
}

export interface ExecutionDetail extends ExecutionSummary {
  nodes: NodeRunResult[];
  graph: WorkflowGraph;
  input_metadata: Record<string, unknown>;
  output_summary: Record<string, unknown>;
  payload_access: boolean;
  technical?: Record<string, unknown>;
}

export interface NodePayload {
  node_id: string;
  node_name: string;
  direction: 'input' | 'output';
  preview: { items: unknown[]; item_count: number; note?: string };
  truncated: boolean;
}

export interface LogLine {
  sequence: number;
  at: string;
  level: string;
  node_name: string | null;
  message: string;
}

// ── credentials ────────────────────────────────────────────────────────────
export interface CredentialTypeSpec {
  key: string;
  display_name: string;
  secret_fields: string[];
  public_fields: string[];
  config_schema: { fields: FieldSpec[] };
  certification: Certification;
}

export interface Credential {
  id: string;
  name: string;
  credential_type: string;
  status: 'ACTIVE' | 'INVALID' | 'REVOKED' | 'DELETED';
  public_metadata: Record<string, string>;
  secret: { configured: boolean; masked_hint: string | null; rotated_at: string | null };
  last_test_at: string | null;
  last_test_ok: boolean | null;
  last_test_message: string | null;
  created_at: string;
  updated_at: string;
  used_by?: { type: string; id: string; name: string; blocking: boolean }[];
}

// ── ops ────────────────────────────────────────────────────────────────────
export interface Overview {
  stats: {
    total_workflows: number;
    active_workflows: number;
    draft_only: number;
    running_now: number;
    failed_24h: number;
    success_rate_7d: number | null;
    credentials_needing_attention: number;
    unread_alerts: number;
  };
  recent_failures: {
    execution_id: string;
    short_id: string;
    workflow_id: string;
    workflow_name: string | null;
    status: ExecutionStatus;
    error_code: string | null;
    failed_node_name: string | null;
    ended_at: string | null;
  }[];
  running: {
    execution_id: string;
    short_id: string;
    workflow_id: string;
    workflow_name: string | null;
    status: ExecutionStatus;
    started_at: string | null;
    queued_at: string;
  }[];
  upcoming_schedules: {
    workflow_id: string;
    workflow_name: string | null;
    next_run_at: string;
  }[];
}

export interface MonitoringResponse {
  window_days: number;
  success_rate_7d: number | null;
  duration_ms: { p50: number | null; p95: number | null; count: number };
  queue_wait_ms: { p50: number | null; p95: number | null };
  failures_by_category: { category: string; count: number }[];
  failing_nodes: { node_key: string; node_name: string; count: number }[];
  runs_by_trigger: Record<string, number>;
  schedules_late: number;
}

export interface EngineStatus {
  operational: boolean;
  status: string;
  message: string | null;
  engine_version: string | null;
  adapter_contract_version: string | null;
  compiler_version: string | null;
  product_version: string;
  latency_ms: number | null;
  loaded_nodes: string[];
}

export interface CompatibilityReport {
  product_version: string;
  engine: {
    reachable: boolean;
    engine_version: string | null;
    contract_version: string | null;
    compiler_version: string | null;
    features: Record<string, boolean>;
  };
  nodes: {
    node_key: string;
    display_name: string;
    certification: Certification;
    status: string;
    engine_supported: boolean;
    engine_binding: Record<string, unknown> | null;
  }[];
  drift: { product_only: string[]; engine_only: string[] };
}

export interface AlertRule {
  id: string;
  event_type: string;
  workflow_id: string | null;
  threshold: number;
  channel: string;
  cooldown_seconds: number;
  enabled: boolean;
}

export interface AppNotification {
  id: string;
  event_type: string;
  severity: string;
  title: string;
  body: string | null;
  workflow_id: string | null;
  execution_id: string | null;
  status: 'UNREAD' | 'READ' | 'ACKNOWLEDGED';
  remediation: { action: string; resource_id?: string } | null;
  created_at: string;
}

export interface AuditEvent {
  id: string;
  action: string;
  actor_type: string;
  actor_label: string | null;
  resource_type: string;
  resource_id: string | null;
  resource_label: string | null;
  result: string;
  before_summary: Record<string, unknown> | null;
  after_summary: Record<string, unknown> | null;
  trace_id: string;
  ip_address: string | null;
  created_at: string;
}

export interface Member {
  id: string;
  user_id: string;
  email: string;
  full_name: string;
  role: string;
  is_active: boolean;
  last_login_at: string | null;
  created_at?: string;
}

export interface WorkspaceSettings {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  status: string;
  max_concurrent_executions: number;
  created_at: string;
}

export interface PageInfo {
  total?: number;
  limit: number;
  offset: number;
  has_more: boolean;
  next_cursor?: number;
}

export interface Paginated<T> {
  items: T[];
  page: PageInfo;
  summary?: Record<string, unknown>;
}

/**
 * The counters above the workflow list.
 *
 * Typed rather than left as `Record<string, number>`, which is how the strip
 * came to read `summary.failed` while the API returned `needs_attention`:
 * an index signature makes every key valid, so the counter silently rendered
 * `undefined ?? 0` and showed zero failures next to a run that had just
 * failed. A named shape is what makes that a compile error.
 */
export interface WorkflowListSummary {
  total: number;
  active: number;
  /** Live workflows whose last run failed, or whose credential is gone. */
  needs_attention: number;
  draft_only: number;
}
