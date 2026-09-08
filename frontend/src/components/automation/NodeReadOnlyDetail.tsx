'use client';

/**
 * What a step is configured to do, as text.
 *
 * The phone used to open the ordinary configuration form with every input
 * `disabled`. That is a worse answer than not opening anything: greyed-out
 * fields read as "broken" or "you lack permission" rather than "this screen
 * does not edit", the values are harder to read inside disabled inputs than
 * as plain text, and the form is three times taller than the facts it holds.
 *
 * So on a phone a step shows its configuration and its problems, and nothing
 * suggests it can be changed.
 */

import * as React from 'react';
import { AlertTriangle } from 'lucide-react';

import { NodeIcon } from './NodeIcon';
import { cn } from '@/lib/utils';
import type { Credential, GraphNode, NodeDefinition } from '@/lib/types';
import { useI18n } from '@/providers/LanguageProvider';

/** A configured value, rendered for reading rather than for editing. */
function formatValue(
  spec: { key: string; type: string; options?: { value: string; label: string }[] },
  value: unknown,
  credentials: Credential[],
  none: string,
): string {
  if (value === undefined || value === null || value === '') return none;

  switch (spec.type) {
    case 'enum':
      // The label, not the wire value: somebody reading a step should see
      // "Không gửi body", not "NONE".
      return spec.options?.find((option) => option.value === value)?.label
        ?? String(value);
    case 'boolean':
      return value ? '✓' : '—';
    case 'credential': {
      // The credential's name. Never its contents -- this panel is read-only,
      // not privileged (ADR-016).
      const match = credentials.find((row) => row.id === value);
      return match ? match.name : String(value);
    }
    case 'collection':
      return Array.isArray(value)
        ? `${value.length}`
        : String(Object.keys(value as object).length);
    case 'json':
      return JSON.stringify(value);
    default: {
      const text = String(value);
      // An expression is worth showing as written; a very long URL is not
      // worth showing in full on a 390px screen.
      return text.length > 160 ? `${text.slice(0, 160)}…` : text;
    }
  }
}

export function NodeReadOnlyDetail({
  node, definition, credentials, issues, className,
}: {
  node: GraphNode;
  definition: NodeDefinition | undefined;
  credentials: Credential[];
  issues?: { node_id: string | null; severity: string; message: string }[];
  className?: string;
}) {
  const { t } = useI18n();
  const none = t('common.none');

  const fields = definition?.config_schema?.fields ?? [];
  const problems = (issues ?? []).filter((issue) => issue.node_id === node.id);

  return (
    <div className={cn('space-y-4', className)}>
      <div className="flex items-start gap-2.5">
        <NodeIcon icon={definition?.icon} category={definition?.category} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="text-small font-emphasis text-text-primary">{node.name}</p>
          <p className="text-caption text-text-tertiary">
            {definition?.display_name ?? node.node_key}
          </p>
        </div>
      </div>

      {definition?.description && (
        <p className="text-caption leading-relaxed text-text-secondary">
          {definition.description}
        </p>
      )}

      {problems.length > 0 && (
        <ul className="space-y-1.5 rounded-lg border border-danger/25 bg-danger/[0.04] p-3">
          {problems.map((issue) => (
            <li key={issue.message} className="flex items-start gap-2 text-caption text-text-primary">
              <AlertTriangle
                className={cn('mt-0.5 h-3.5 w-3.5 flex-shrink-0',
                  issue.severity === 'ERROR' ? 'text-danger' : 'text-warning')}
              />
              <span className="min-w-0 flex-1">{issue.message}</span>
            </li>
          ))}
        </ul>
      )}

      {fields.length === 0 ? (
        <p className="text-caption text-text-tertiary">{none}</p>
      ) : (
        <dl className="divide-y divide-[rgb(var(--border-line))]">
          {fields.map((spec) => (
            <div key={spec.key} className="flex items-baseline justify-between gap-4 py-2">
              <dt className="shrink-0 text-tiny text-text-tertiary">{spec.label}</dt>
              <dd className="min-w-0 flex-1 break-words text-right text-caption text-text-primary">
                {formatValue(spec, (node.config ?? {})[spec.key], credentials, none)}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
