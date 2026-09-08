/**
 * Query key convention (SRS 36.1).
 *
 * Every key is workspace-scoped so a workspace switch can evict an entire
 * tenant's cache in one call — the alternative is the previous tenant's rows
 * flashing on screen after a switch, which is a data-leak-shaped bug even when
 * the server would have refused the next request.
 *
 * A filtered list drops the filter segment when there is no filter, so
 * `qk.credentials(ws)` is a real prefix of `qk.credentials(ws, { q: 'x' })`.
 * Appending `undefined` instead would make the two keys siblings rather than
 * ancestor and descendant, and `invalidateQueries` -- which matches on prefix
 * -- would quietly match nothing: a created credential that never appears in
 * the list until the page is reloaded.
 */

/** Append the filter segment only when there is one. */
function withFilters<const T extends readonly unknown[]>(
  base: T, filters?: unknown,
): readonly unknown[] {
  return filters === undefined ? base : [...base, filters];
}

export const qk = {
  me: () => ['me'] as const,
  workspace: (ws: string) => ['workspace', ws] as const,
  settings: (ws: string) => ['workspace', ws, 'settings'] as const,
  members: (ws: string) => ['workspace', ws, 'members'] as const,

  workflows: (ws: string, filters?: unknown) =>
    withFilters(['workspace', ws, 'workflows'] as const, filters),
  workflow: (ws: string, id: string) => ['workspace', ws, 'workflow', id] as const,
  // The draft is its own key: the editor refetches it on conflict without
  // invalidating the summary the list page is showing.
  workflowDraft: (ws: string, id: string) =>
    ['workspace', ws, 'workflow', id, 'draft'] as const,
  workflowVersions: (ws: string, id: string) =>
    ['workspace', ws, 'workflow', id, 'versions'] as const,
  workflowVersion: (ws: string, id: string, version: number) =>
    ['workspace', ws, 'workflow', id, 'version', version] as const,
  workflowTrigger: (ws: string, id: string) =>
    ['workspace', ws, 'workflow', id, 'trigger'] as const,

  executions: (ws: string, filters?: unknown) =>
    withFilters(['workspace', ws, 'executions'] as const, filters),
  execution: (ws: string, id: string) => ['workspace', ws, 'execution', id] as const,
  executionNodePayload: (ws: string, id: string, nodeId: string, dir: string) =>
    ['workspace', ws, 'execution', id, 'payload', nodeId, dir] as const,
  executionLogs: (ws: string, id: string) =>
    ['workspace', ws, 'execution', id, 'logs'] as const,

  credentials: (ws: string, filters?: unknown) =>
    withFilters(['workspace', ws, 'credentials'] as const, filters),
  credential: (ws: string, id: string) => ['workspace', ws, 'credential', id] as const,
  // Not workspace-scoped: the credential type registry is a product constant.
  credentialTypes: () => ['credential-types'] as const,

  nodes: (ws: string, filters?: unknown) =>
    withFilters(['workspace', ws, 'nodes'] as const, filters),
  node: (ws: string, key: string) => ['workspace', ws, 'node', key] as const,

  overview: (ws: string) => ['workspace', ws, 'overview'] as const,
  monitoring: (ws: string) => ['workspace', ws, 'monitoring'] as const,
  engine: (ws: string) => ['workspace', ws, 'engine'] as const,
  compatibility: (ws: string) => ['workspace', ws, 'compatibility'] as const,
  alertRules: (ws: string) => ['workspace', ws, 'alert-rules'] as const,
  notifications: (ws: string, filters?: unknown) =>
    withFilters(['workspace', ws, 'notifications'] as const, filters),
  unread: (ws: string) => ['workspace', ws, 'unread'] as const,
  audit: (ws: string, filters?: unknown) =>
    withFilters(['workspace', ws, 'audit'] as const, filters),
};
