'use client';

import { useCallback } from 'react';

import { useCurrentUser } from './use-current-user';
import type { PermissionMap } from '@/lib/types';

export type Module =
  | 'workflows' | 'credentials' | 'executions' | 'nodes' | 'monitoring'
  | 'alerts' | 'audit' | 'members' | 'settings';

export type Action =
  | 'view' | 'create' | 'edit' | 'delete' | 'admin'
  // Split out of the obvious four because they are the decisions people get
  // wrong: reading the payloads, running a workflow, freezing a version, and
  // attaching a credential to a step.
  | 'view_data' | 'execute' | 'publish' | 'use';

/** Ordered least to most authority; the first match wins in a summary. */
const LEVELS: ReadonlyArray<{ level: string; actions: Action[] }> = [
  { level: 'full', actions: ['admin'] },
  { level: 'manage', actions: ['publish', 'create', 'delete'] },
  { level: 'edit', actions: ['edit'] },
  { level: 'operate', actions: ['execute'] },
  { level: 'view', actions: ['view'] },
];

/** The powers worth flagging separately from a level. */
export const SENSITIVE_ACTIONS: Action[] = ['view_data', 'publish', 'use'];

/**
 * One plain-language level per module, plus any sensitive powers.
 *
 * Printing nine action names for each of nine modules is eighty chips nobody
 * reads. A person checking their own access wants one phrase per area and a
 * flag on the parts that touch real data or production.
 */
export function summarisePermissions(actions: string[] = []): {
  level: string;
  flags: Action[];
} {
  const held = new Set(actions);
  const level = LEVELS.find((entry) => entry.actions.some((a) => held.has(a)))?.level ?? 'none';
  // "Full access" already implies the sensitive powers; repeating them on every
  // row of an owner's list carries no information.
  const flags = level === 'full' ? [] : SENSITIVE_ACTIONS.filter((a) => held.has(a));
  return { level, flags };
}

export function hasPermission(
  permissions: PermissionMap | undefined,
  module: Module,
  action: Action,
): boolean {
  return Boolean(permissions?.[module]?.includes(action));
}

/**
 * FE gating is UX only — the backend re-checks every call (SRS 4.2 rule).
 * Hiding a button the user cannot use just keeps the screen honest.
 */
export function usePermissions() {
  const { data } = useCurrentUser();
  const permissions = data?.permissions;

  const can = useCallback(
    (module: Module, action: Action) => hasPermission(permissions, module, action),
    [permissions],
  );

  return {
    permissions,
    can,
    role: data?.role ?? null,
    isPlatformAdmin: Boolean(data?.is_platform_admin),
  };
}
