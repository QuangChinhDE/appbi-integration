'use client';

/**
 * Monitoring (SRS 18.2).
 *
 * Numbers an operator can act on, not a chart wall. Each panel answers one
 * question: is it slow, is the queue backing up, what is failing, and is
 * anything late.
 */

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Radar } from 'lucide-react';

import { EmptyState, ErrorState, CardSkeleton } from '@/components/ui/Feedback';
import { Card, PageListLayout, StatTile } from '@/components/layout/PageLayout';
import { opsApi } from '@/lib/api';
import { formatDuration } from '@/lib/format';
import { qk } from '@/lib/queryKeys';
import { useWorkspaceId } from '@/hooks/use-current-user';
import { useI18n } from '@/providers/LanguageProvider';

export default function MonitoringPage() {
  const { t, tf } = useI18n();
  const workspaceId = useWorkspaceId();

  const monitoring = useQuery({
    queryKey: qk.monitoring(workspaceId),
    queryFn: opsApi.monitoring,
    refetchInterval: 60_000,
  });

  if (monitoring.isLoading) {
    return (
      <PageListLayout title={t('monitoring.title')} searchable={false}>
        <CardSkeleton count={4} />
      </PageListLayout>
    );
  }
  if (monitoring.error) {
    return (
      <PageListLayout title={t('monitoring.title')} searchable={false}>
        <ErrorState
          title={t('common.errorTitle')}
          error={monitoring.error}
          onRetry={() => void monitoring.refetch()}
        />
      </PageListLayout>
    );
  }

  const data = monitoring.data!;
  const noData = data.duration_ms.count === 0;

  return (
    <PageListLayout
      title={t('monitoring.title')}
      description={t('monitoring.description')}
      searchable={false}
    >
      {noData ? (
        <EmptyState icon={Radar} title={t('monitoring.noData')} />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <StatTile
              label={t('overview.successRate')}
              value={data.success_rate_7d === null ? '—' : `${data.success_rate_7d}%`}
              tone={
                data.success_rate_7d === null ? 'default'
                  : data.success_rate_7d >= 95 ? 'success'
                    : data.success_rate_7d >= 80 ? 'warning' : 'danger'
              }
            />
            <StatTile
              label={t('monitoring.durationP50')}
              value={data.duration_ms.p50 === null
                ? '—'
                : formatDuration(data.duration_ms.p50 / 1000)}
            />
            <StatTile
              label={t('monitoring.durationP95')}
              value={data.duration_ms.p95 === null
                ? '—'
                : formatDuration(data.duration_ms.p95 / 1000)}
            />
            <StatTile
              label={t('monitoring.queueP95')}
              value={data.queue_wait_ms.p95 === null ? '—' : `${data.queue_wait_ms.p95}ms`}
              // The SLO is a p95 dispatch lag under 10s (SRS 42); past that the
              // queue is the problem, not the workflows.
              tone={
                data.queue_wait_ms.p95 !== null && data.queue_wait_ms.p95 > 10_000
                  ? 'warning' : 'default'
              }
            />
            <StatTile
              label={t('monitoring.schedulesLate')}
              value={data.schedules_late}
              tone={data.schedules_late > 0 ? 'danger' : 'default'}
            />
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <Card title={t('monitoring.byCategory')} padded={false}>
              {data.failures_by_category.length === 0 ? (
                <p className="px-4 py-6 text-center text-caption text-text-tertiary">
                  {t('common.none')}
                </p>
              ) : (
                <BarList
                  rows={data.failures_by_category.map((row) => ({
                    label: row.category,
                    value: row.count,
                  }))}
                />
              )}
            </Card>

            <Card title={t('monitoring.failingNodes')} padded={false}>
              {data.failing_nodes.length === 0 ? (
                <p className="px-4 py-6 text-center text-caption text-text-tertiary">
                  {t('common.none')}
                </p>
              ) : (
                <BarList
                  rows={data.failing_nodes.map((row) => ({
                    label: row.node_name || row.node_key,
                    value: row.count,
                  }))}
                />
              )}
            </Card>
          </div>

          <Card title={t('monitoring.byTrigger')} padded={false}>
            <BarList
              rows={Object.entries(data.runs_by_trigger).map(([key, value]) => ({
                label: tf([`trigger.${key}`], key),
                value,
              }))}
            />
          </Card>
        </div>
      )}
    </PageListLayout>
  );
}

/**
 * A horizontal bar list.
 *
 * Deliberately not a chart library: these are five to ten labelled counts, and
 * a bar whose width is a share of the largest value reads faster than a plotted
 * axis at this size.
 */
function BarList({ rows }: { rows: { label: string; value: number }[] }) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <ul className="divide-y divide-[rgb(var(--border-line))]">
      {rows.map((row) => (
        <li key={row.label} className="px-4 py-2">
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-caption text-text-secondary">
              {row.label}
            </span>
            <span className="text-caption font-emphasis tabular-nums text-text-primary">
              {row.value}
            </span>
          </div>
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-brand/60"
              style={{ width: `${Math.round((row.value / max) * 100)}%` }}
              aria-hidden
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
