/**
 * Product API client.
 *
 * The FE never calls the engine — everything goes through `/api/v1`
 * (guardrail 1). Errors always arrive in the normalized envelope, so `ApiError`
 * carries the remediation action a screen turns into its primary CTA.
 */

import type {
  AlertRule, AppNotification, AuditEvent, CompatibilityReport, Credential,
  CredentialTypeSpec, CurrentUser, DraftResponse, EngineStatus, ExecutionDetail,
  ExecutionSummary, LogLine, Member, MonitoringResponse, NodeDefinition,
  NodePayload, Overview, Paginated, SaveDraftResponse, TriggerDetail,
  ValidationState, WorkflowGraph, WorkflowSummary, WorkflowVersionDetail,
  WorkflowVersionSummary, WorkspaceSettings,
} from './types';

const BASE = '/api/v1';

export interface ErrorEnvelope {
  code: string;
  message: string;
  category: string;
  trace_id: string;
  remediation?: { action: string; resource_id?: string };
  technical_message?: string;
  constraints?: { type: string; id: string; name: string }[];
  details?: Record<string, unknown>;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly category: string;
  readonly traceId: string;
  readonly remediation?: { action: string; resource_id?: string };
  readonly technicalMessage?: string;
  readonly constraints?: { type: string; id: string; name: string }[];
  readonly details?: Record<string, unknown>;

  constructor(status: number, envelope: ErrorEnvelope) {
    super(envelope.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = envelope.code;
    this.category = envelope.category;
    this.traceId = envelope.trace_id;
    this.remediation = envelope.remediation;
    this.technicalMessage = envelope.technical_message;
    this.constraints = envelope.constraints;
    this.details = envelope.details;
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

function withQuery(path: string, query?: Query): string {
  if (!query) return `${BASE}${path}`;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${BASE}${path}?${qs}` : `${BASE}${path}`;
}

async function request<T>(
  method: string,
  path: string,
  options: { body?: unknown; query?: Query; headers?: Record<string, string> } = {},
): Promise<T> {
  const response = await fetch(withQuery(path, options.query), {
    method,
    credentials: 'include',
    headers: {
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    cache: 'no-store',
  });

  if (response.status === 204) return undefined as T;

  const text = await response.text();

  // Not every failure arrives as an envelope. A proxy, a load balancer or a
  // crashed worker answers with plain text, and parsing that unguarded threw a
  // raw `SyntaxError: Unexpected token 'I'` into the login form -- a stack
  // trace where a message belonged (guardrail 16).
  let payload: unknown = null;
  let parseFailed = false;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      parseFailed = true;
    }
  }

  if (!response.ok) {
    const envelope: ErrorEnvelope =
      (payload as { error?: ErrorEnvelope } | null)?.error ?? {
        code: parseFailed ? 'UPSTREAM_ERROR' : 'NETWORK_ERROR',
        message: parseFailed
          ? 'Máy chủ trả về phản hồi không hợp lệ. Vui lòng thử lại.'
          : 'Không kết nối được tới server.',
        category: 'UNKNOWN',
        trace_id: response.headers.get('X-Trace-Id') ?? '',
        technical_message: parseFailed ? text.slice(0, 200) : undefined,
      };
    throw new ApiError(response.status, envelope);
  }

  if (parseFailed) {
    // A 2xx that is not JSON is a broken contract, and treating it as data
    // would push the failure into a screen that cannot explain it.
    throw new ApiError(response.status, {
      code: 'UPSTREAM_ERROR',
      message: 'Máy chủ trả về phản hồi không hợp lệ.',
      category: 'UNKNOWN',
      trace_id: response.headers.get('X-Trace-Id') ?? '',
      technical_message: text.slice(0, 200),
    });
  }
  return payload as T;
}

const get = <T>(path: string, query?: Query) => request<T>('GET', path, { query });
const post = <T>(path: string, body?: unknown, extra?: {
  query?: Query; headers?: Record<string, string>;
}) => request<T>('POST', path, { body, ...extra });
const patch = <T>(path: string, body?: unknown) => request<T>('PATCH', path, { body });
const put = <T>(path: string, body?: unknown) => request<T>('PUT', path, { body });
const del = <T>(path: string) => request<T>('DELETE', path);

// ── auth ───────────────────────────────────────────────────────────────────
export const authApi = {
  login: (email: string, password: string) =>
    post<CurrentUser>('/auth/login', { email, password }),
  logout: () => post<{ ok: boolean }>('/auth/logout'),
  me: () => get<CurrentUser>('/auth/me'),
  // Returns a fresh session: changing the password revokes every token issued
  // before it, including the caller's own.
  changePassword: (currentPassword: string, newPassword: string) =>
    post<CurrentUser>('/auth/change-password', {
      current_password: currentPassword, new_password: newPassword,
    }),
  switchWorkspace: (workspaceId: string) =>
    post<CurrentUser>(`/auth/switch-workspace/${workspaceId}`),
};

// ── workflows ──────────────────────────────────────────────────────────────
export const workflowApi = {
  list: (query?: Query) => get<Paginated<WorkflowSummary>>('/workflows', query),
  get: (id: string) => get<WorkflowSummary>(`/workflows/${id}`),
  create: (body: { name: string; description?: string; trigger_node_key?: string }) =>
    post<WorkflowSummary>('/workflows', body),
  update: (id: string, body: { name?: string; description?: string }) =>
    patch<WorkflowSummary>(`/workflows/${id}`, body),
  remove: (id: string) => del<void>(`/workflows/${id}`),
  duplicate: (id: string) => post<WorkflowSummary>(`/workflows/${id}/duplicate`),

  draft: (id: string) => get<DraftResponse>(`/workflows/${id}/draft`),
  saveDraft: (id: string, graph: WorkflowGraph, expectedRevision: number) =>
    put<SaveDraftResponse>(`/workflows/${id}/draft`, {
      graph, expected_revision: expectedRevision,
    }),
  validate: (id: string, withEngine = true) =>
    post<ValidationState>(`/workflows/${id}/validate`, undefined, {
      query: { with_engine: withEngine },
    }),

  versions: (id: string) =>
    get<{ items: WorkflowVersionSummary[] }>(`/workflows/${id}/versions`),
  version: (id: string, number: number) =>
    get<WorkflowVersionDetail>(`/workflows/${id}/versions/${number}`),
  publish: (id: string, body: { expected_revision?: number; change_note?: string }) =>
    post<{ id: string; version: number; graph_hash: string; published_at: string }>(
      `/workflows/${id}/publish`, body),
  activate: (id: string, versionNumber?: number) =>
    post<WorkflowSummary>(`/workflows/${id}/activate`, {
      version_number: versionNumber ?? null,
    }),
  deactivate: (id: string) => post<WorkflowSummary>(`/workflows/${id}/deactivate`),

  trigger: (id: string) => get<TriggerDetail>(`/workflows/${id}/trigger`),
  rotateWebhookSecret: (id: string) =>
    post<{ secret: string; signature_header: string; timestamp_header: string; note: string }>(
      `/workflows/${id}/trigger/rotate-secret`),

  run: (id: string, body: { kind: 'DRAFT' | 'PUBLISHED'; payload?: unknown }) =>
    post<ExecutionSummary>(`/workflows/${id}/executions`, body),
};

// ── executions ─────────────────────────────────────────────────────────────
export const executionApi = {
  list: (query?: Query) => get<Paginated<ExecutionSummary>>('/executions', query),
  get: (id: string) => get<ExecutionDetail>(`/executions/${id}`),
  nodeOutput: (id: string, nodeId: string) =>
    get<NodePayload>(`/executions/${id}/nodes/${nodeId}/output`),
  nodeInput: (id: string, nodeId: string) =>
    get<NodePayload>(`/executions/${id}/nodes/${nodeId}/input`),
  logs: (id: string, cursor = 0) =>
    get<Paginated<LogLine>>(`/executions/${id}/logs`, { cursor }),
  cancel: (id: string) => post<ExecutionSummary>(`/executions/${id}/cancel`),
  retry: (id: string) => post<ExecutionSummary>(`/executions/${id}/retry`),
};

// ── credentials ────────────────────────────────────────────────────────────
export const credentialApi = {
  types: () => get<{ items: CredentialTypeSpec[] }>('/credentials/types'),
  list: (query?: Query) => get<{ items: Credential[] }>('/credentials', query),
  get: (id: string) => get<Credential>(`/credentials/${id}`),
  create: (body: {
    name: string; credential_type: string; data: Record<string, unknown>;
  }) => post<Credential>('/credentials', body),
  update: (id: string, body: { name?: string; data?: Record<string, unknown> }) =>
    patch<Credential>(`/credentials/${id}`, body),
  test: (id: string, url?: string) =>
    post<Credential>(`/credentials/${id}/test`, { url: url ?? null }),
  remove: (id: string) => del<void>(`/credentials/${id}`),
};

// ── node library ───────────────────────────────────────────────────────────
export const nodeApi = {
  list: (query?: Query) => get<{ items: NodeDefinition[] }>('/nodes', query),
  get: (nodeKey: string) => get<NodeDefinition>(`/nodes/${nodeKey}`),
};

// ── ops ────────────────────────────────────────────────────────────────────
export const opsApi = {
  overview: () => get<Overview>('/overview'),
  monitoring: () => get<MonitoringResponse>('/monitoring'),
  engineStatus: () => get<EngineStatus>('/engine/status'),
  compatibility: () => get<CompatibilityReport>('/engine/compatibility'),

  alertRules: () => get<{ items: AlertRule[] }>('/alert-rules'),
  upsertAlertRule: (body: {
    event_type: string; workflow_id?: string | null; threshold?: number;
    cooldown_seconds?: number; enabled?: boolean;
  }) => put<AlertRule>('/alert-rules', body),
  deleteAlertRule: (id: string) => del<void>(`/alert-rules/${id}`),

  notifications: (query?: Query) =>
    get<Paginated<AppNotification>>('/notifications', query),
  unreadCount: () => get<{ count: number }>('/notifications/unread-count'),
  acknowledge: (id: string) => post<{ ok: boolean }>(`/notifications/${id}/acknowledge`),
  acknowledgeAll: () =>
    post<{ ok: boolean; count: number }>('/notifications/acknowledge-all'),

  audit: (query?: Query) => get<Paginated<AuditEvent>>('/audit', query),
};

// ── workspace ──────────────────────────────────────────────────────────────
export const workspaceApi = {
  settings: () => get<WorkspaceSettings>('/workspace/settings'),
  updateSettings: (body: Partial<WorkspaceSettings>) =>
    patch<WorkspaceSettings>('/workspace/settings', body),
  members: () => get<{ items: Member[] }>('/workspace/members'),
  invite: (body: {
    email: string; full_name: string; role: string; password: string;
  }) => post<Member>('/workspace/members', body),
  updateRole: (membershipId: string, role: string) =>
    patch<Member>(`/workspace/members/${membershipId}`, { role }),
  removeMember: (membershipId: string) =>
    del<void>(`/workspace/members/${membershipId}`),
};
