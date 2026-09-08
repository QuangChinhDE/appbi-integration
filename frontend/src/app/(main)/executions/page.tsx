'use client';

/**
 * Execution history (SRS 16.4, 35.5).
 *
 * Auto-refreshes only while something is in flight: polling a static list every
 * few seconds is load with no information in it.
 */

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { PlayCircle } from 'lucide-react';

import { ExecutionStatusBadge, TriggerBadge, VersionBadge } from '@/components/automation/StatusBadges';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/Feedback';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Input';
import { ModuleOverview, PageListLayout } from '@/components/layout/PageLayout';
import { executionApi } from '@/lib/api';
import { formatDateTime, formatDuration } from '@/lib/format';
import { qk } from '@/lib/queryKeys';
import { useWorkspaceId } from '@/hooks/use-current-user';
import { useI18n } from '@/providers/LanguageProvider';

const ACTIVE = ['QUEUED', 'DISPATCHING', 'RUNNING', 'CANCEL_REQUESTED'];
const PAGE_SIZE = 50;

export default function ExecutionsPage() {
  const { t, tf, locale } = useI18n();
  const workspaceId = useWorkspaceId();
  const searchParams = useSearchParams();

  const [status, setStatus] = React.useState(searchParams.get('status') ?? '');
  const [kind, setKind] = React.useState('');
  const [offset, setOffset] = React.useState(0);

  const filters = {
    status: status || undefined,
    version_kind: kind || undefined,
    workflow_id: searchParams.get('workflow_id') ?? undefined,
    limit: PAGE_SIZE,
    offset,
  };

  const executions = useQuery({
    queryKey: qk.executions(workspaceId, filters),
    queryFn: () => executionApi.list(filters),
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? [];
      return items.some((row) => ACTIVE.includes(row.status)) ? 3_000 : false;
    },
  });

  const items = executions.data?.items ?? [];
  const page = executions.data?.page;
  const summary = (executions.data?.summary ?? {}) as Record<string, number>;

  return (
    <PageListLayout
      title={t('executions.title')}
      description={t('executions.description')}
      searchable={false}
      overview={
        items.length > 0 ? (
          <ModuleOverview
            stats={[
              { label: t('executions.title'), value: summary.total ?? items.length },
              { label: t('overview.runningNow'), value: summary.running ?? 0, tone: 'default' },
              { label: t('overview.failed24h'), value: summary.failed_24h ?? 0, tone: 'danger' },
            ]}
          />
        ) : undefined
      }
      filters={
        <>
          <Select
            size="sm"
            value={status}
            onChange={(event) => { setStatus(event.target.value); setOffset(0); }}
            aria-label={t('executions.filterStatus')}
          >
            <option value="">{t('executions.filterStatus')}: {t('common.all')}</option>
            {['RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT',
              'ENGINE_INTERRUPTED'].map((option) => (
              <option key={option} value={option}>
                {tf([`execution.${option}`], option)}
              </option>
            ))}
          </Select>
          <Select
            size="sm"
            value={kind}
            onChange={(event) => { setKind(event.target.value); setOffset(0); }}
            aria-label={t('executions.filterKind')}
          >
            <option value="">{t('executions.filterKind')}: {t('common.all')}</option>
            <option value="DRAFT">{t('executions.draftRun')}</option>
            <option value="PUBLISHED">{t('executions.publishedRun')}</option>
          </Select>
        </>
      }
    >
      {executions.isLoading ? (
        <TableSkeleton rows={8} columns={6} />
      ) : executions.error ? (
        <ErrorState
          title={t('common.errorTitle')}
          error={executions.error}
          onRetry={() => void executions.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={PlayCircle}
          title={status || kind ? t('common.noResults') : t('executions.emptyTitle')}
          description={status || kind ? undefined : t('executions.emptyBody')}
        />
      ) : (
        <>
          <div className="overflow-hidden rounded-lg border border-[rgb(var(--border-line))] bg-surface-1">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[rgb(var(--border-line))] text-left">
                  <Th>{t('executions.column.id')}</Th>
                  <Th>{t('executions.column.workflow')}</Th>
                  <Th>{t('common.status')}</Th>
                  <Th>{t('executions.column.trigger')}</Th>
                  <Th>{t('executions.column.started')}</Th>
                  <Th>{t('executions.column.duration')}</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[rgb(var(--border-line))]">
                {items.map((row) => (
                  <tr key={row.id} className="transition-colors hover:bg-surface-2/60">
                    <Td>
                      <Link
                        href={`/executions/${row.id}`}
                        className="font-mono text-caption text-brand hover:underline"
                      >
                        #{row.short_id}
                      </Link>
                    </Td>
                    <Td>
                      <div className="flex min-w-0 items-center gap-1.5">
                        <Link
                          href={`/workflows/${row.workflow_id}`}
                          className="truncate text-caption text-text-primary hover:underline"
                        >
                          {row.workflow_name ?? '—'}
                        </Link>
                        <VersionBadge
                          kind={row.version.kind}
                          number={row.version.number}
                          draftRevision={row.version.draft_revision}
                        />
                      </div>
                    </Td>
                    <Td>
                      <div className="flex flex-col gap-0.5">
                        <ExecutionStatusBadge status={row.status} size="xs" />
                        {row.failed_node_name && (
                          <span className="truncate text-tiny text-text-quaternary">
                            {row.failed_node_name}
                          </span>
                        )}
                      </div>
                    </Td>
                    <Td>
                      <TriggerBadge type={row.trigger_type} />
                    </Td>
                    <Td>
                      <span data-volatile className="text-tiny tabular-nums text-text-tertiary">
                        {formatDateTime(row.started_at ?? row.queued_at, locale)}
                      </span>
                    </Td>
                    <Td>
                      <span data-volatile className="text-tiny tabular-nums text-text-tertiary">
                        {row.duration_ms === null
                          ? '—'
                          : formatDuration(row.duration_ms / 1000)}
                      </span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {page && (page.has_more || offset > 0) && (
            <div className="mt-3 flex items-center justify-between">
              <span className="text-tiny text-text-quaternary">
                {t('common.showing', {
                  n: `${offset + 1}–${offset + items.length}`,
                  total: page.total ?? items.length,
                })}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  size="xs"
                  variant="secondary"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                >
                  {t('common.prevPage')}
                </Button>
                <Button
                  size="xs"
                  variant="secondary"
                  disabled={!page.has_more}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                >
                  {t('common.nextPage')}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </PageListLayout>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return (
    <th className="px-4 py-2 text-tiny font-emphasis uppercase tracking-[0.08em] text-text-quaternary">
      {children}
    </th>
  );
}

function Td({ children }: { children?: React.ReactNode }) {
  return <td className="px-4 py-2.5 align-middle">{children}</td>;
}
