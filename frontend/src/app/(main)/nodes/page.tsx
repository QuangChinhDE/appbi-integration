'use client';

/**
 * Node library (SRS 11.5, 35.8).
 *
 * What this workspace may build with, and nothing about how it runs: no engine
 * node type, no `typeVersion`. That is the point of a product-owned catalogue
 * (guardrail 9) — the same screen would be correct if the runtime changed.
 */

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Blocks } from 'lucide-react';

import { NodeIcon } from '@/components/automation/NodeIcon';
import { CertificationBadge } from '@/components/automation/StatusBadges';
import { Badge } from '@/components/ui/Badge';
import { Select } from '@/components/ui/Input';
import { EmptyState, ErrorState, CardSkeleton } from '@/components/ui/Feedback';
import { PageListLayout } from '@/components/layout/PageLayout';
import { nodeApi } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { useWorkspaceId } from '@/hooks/use-current-user';
import type { NodeCategory } from '@/lib/types';
import { useI18n } from '@/providers/LanguageProvider';

const CATEGORIES: NodeCategory[] = ['TRIGGER', 'ACTION', 'LOGIC', 'DATA', 'APP'];

export default function NodesPage() {
  const { t, tf } = useI18n();
  const workspaceId = useWorkspaceId();
  const [search, setSearch] = React.useState('');
  const [category, setCategory] = React.useState('');

  const filters = { q: search || undefined, category: category || undefined };
  const nodes = useQuery({
    queryKey: qk.nodes(workspaceId, filters),
    queryFn: () => nodeApi.list(filters),
    staleTime: 5 * 60_000,
  });

  const items = nodes.data?.items ?? [];

  return (
    <PageListLayout
      title={t('nodes.title')}
      description={t('nodes.description')}
      searchValue={search}
      onSearchChange={setSearch}
      filters={
        <Select
          size="sm"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          aria-label={t('nodes.filterCategory')}
        >
          <option value="">{t('nodes.filterCategory')}: {t('common.all')}</option>
          {CATEGORIES.map((option) => (
            <option key={option} value={option}>
              {tf([`category.${option}`], option)}
            </option>
          ))}
        </Select>
      }
    >
      {nodes.isLoading ? (
        <CardSkeleton count={6} />
      ) : nodes.error ? (
        <ErrorState
          title={t('common.errorTitle')}
          error={nodes.error}
          onRetry={() => void nodes.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState icon={Blocks} title={t('common.noResults')} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((node) => (
            <article
              key={node.node_key}
              className="rounded-lg border border-[rgb(var(--border-line))] bg-surface-1 p-3.5"
            >
              <div className="flex items-start gap-2.5">
                <NodeIcon icon={node.icon} category={node.category} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <h2 className="truncate text-caption font-strong text-text-primary">
                      {node.display_name}
                    </h2>
                    <CertificationBadge certification={node.certification} />
                    {node.status === 'DEPRECATED' && (
                      <Badge variant="warning" size="xs">DEPRECATED</Badge>
                    )}
                  </div>
                  <p className="mt-1 text-tiny leading-relaxed text-text-tertiary">
                    {node.description}
                  </p>
                </div>
              </div>

              <dl className="mt-3 space-y-1 border-t border-[rgb(var(--border-line))] pt-2.5">
                <Row
                  label={t('nodes.column.category')}
                  value={tf([`category.${node.category}`], node.category)}
                />
                <Row
                  label={t('nodes.column.credential')}
                  value={
                    node.credential_types.length > 0
                      ? node.credential_types.join(', ')
                      : t('nodes.noCredential')
                  }
                />
                {/* The product schema version, not the engine's node version:
                    what changes the form the user fills in. */}
                <Row label="schema" value={`v${node.product_schema_version}`} />
              </dl>

              {node.known_issues && (
                <p className="mt-2 rounded-md bg-warning/10 px-2 py-1.5 text-tiny leading-relaxed text-warning">
                  {node.known_issues}
                </p>
              )}
            </article>
          ))}
        </div>
      )}
    </PageListLayout>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-tiny text-text-quaternary">{label}</dt>
      <dd className="min-w-0 truncate text-tiny text-text-secondary">{value}</dd>
    </div>
  );
}
