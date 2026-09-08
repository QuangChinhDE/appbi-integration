'use client';

/**
 * Overview (SRS 18.1, 35.1).
 *
 * Renders entirely from the product database, so it stays useful during an
 * engine outage.
 *
 * It used to open with six bordered tiles of equal weight, four of which
 * usually read zero, and then three cards that were present whether or not
 * they had anything in them -- so the one run that had failed sat in the same
 * visual register as five zeroes and an empty "nothing is running" box. There
 * was no answer to "is anything wrong", only six numbers to work it out from.
 *
 * Now: what needs attention, said in words, at the top and only when there is
 * some. Then the figures as one quiet strip rather than six boxes. Then only
 * the lists that have rows in them.
 */

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle, CheckCircle2, Clock, KeyRound, Plus, Zap,
} from 'lucide-react';

import { ExecutionStatusBadge } from '@/components/automation/StatusBadges';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, CardSkeleton } from '@/components/ui/Feedback';
import { Card, PageListLayout } from '@/components/layout/PageLayout';
import { opsApi, workflowApi } from '@/lib/api';
import { formatDateTime, formatDuration, formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';
import { qk } from '@/lib/queryKeys';
import { useWorkspaceId } from '@/hooks/use-current-user';
import { usePermissions } from '@/hooks/use-permissions';
import { useI18n } from '@/providers/LanguageProvider';

export default function OverviewPage() {
  const { t, locale } = useI18n();
  const workspaceId = useWorkspaceId();
  const { can } = usePermissions();

  const overview = useQuery({
    queryKey: qk.overview(workspaceId),
    queryFn: opsApi.overview,
    refetchInterval: 30_000,
  });

  // The list endpoint already orders by `updated_at desc`, so "recently
  // worked on" needs no new endpoint -- just the first page of five.
  const recent = useQuery({
    queryKey: qk.workflows(workspaceId, { recent: 5 }),
    queryFn: () => workflowApi.list({ page_size: 5 }),
  });

  if (overview.isLoading) {
    return (
      <PageListLayout title={t('overview.title')} searchable={false}>
        <CardSkeleton count={4} />
      </PageListLayout>
    );
  }
  if (overview.error) {
    return (
      <PageListLayout title={t('overview.title')} searchable={false}>
        <ErrorState
          title={t('common.errorTitle')}
          error={overview.error}
          onRetry={() => void overview.refetch()}
        />
      </PageListLayout>
    );
  }

  const data = overview.data!;
  const stats = data.stats;
  const empty = stats.total_workflows === 0;

  return (
    <PageListLayout
      title={t('overview.title')}
      description={t('overview.description')}
      searchable={false}
      action={can('workflows', 'create') ? (
        <Link href="/workflows/new">
          <Button variant="primary" size="sm" leadingIcon={<Plus className="h-3.5 w-3.5" />}>
            {t('workflows.new')}
          </Button>
        </Link>
      ) : undefined}
    >
      {empty ? (
        <EmptyState
          icon={Zap}
          title={t('overview.emptyTitle')}
          description={t('overview.emptyBody')}
          action={can('workflows', 'create') ? (
            <Link href="/workflows/new">
              <Button variant="primary" size="sm">{t('workflows.new')}</Button>
            </Link>
          ) : undefined}
        />
      ) : (
        <div className="space-y-5">
          {/* ── what needs attention ───────────────────────────────────────
              In words, not as numbers to be interpreted. A person opening
              this page is asking one question, and six tiles answered a
              different one. */}
          <AttentionBand
            failed={stats.failed_24h}
            credentials={stats.credentials_needing_attention}
            running={stats.running_now}
          />

          {/* ── the figures ───────────────────────────────────────────────
              One strip, no borders. The same five numbers, given the weight
              they actually carry: context you glance at, not the subject of
              the page. */}
          <dl className="flex flex-wrap items-baseline gap-x-8 gap-y-3">
            <Figure label={t('overview.totalWorkflows')} value={stats.total_workflows} />
            <Figure label={t('overview.activeWorkflows')} value={stats.active_workflows} />
            <Figure label={t('overview.runningNow')} value={stats.running_now} />
            <Figure
              label={t('overview.successRate')}
              // Null is not zero: "no runs yet" and "everything failed" must
              // not look the same.
              value={stats.success_rate_7d === null ? '—' : `${stats.success_rate_7d}%`}
              tone={
                stats.success_rate_7d === null ? 'default'
                  : stats.success_rate_7d >= 95 ? 'success'
                    : stats.success_rate_7d >= 80 ? 'warning' : 'danger'
              }
            />
          </dl>

          {/* `items-start`: a grid stretches its children to the tallest row by
              default, so a failures card with one row grew to match an eight-row
              list beside it and showed 300px of empty card. */}
          <div className="grid items-start gap-4 lg:grid-cols-2">
            {/* Rendered only when there is something in it. A card whose only
                content is the word "none" is a card that teaches people to
                stop reading the page. */}
            {data.recent_failures.length > 0 && (
              <Card
                title={t('overview.recentFailures')}
                action={
                  <Link
                    href="/executions?status=FAILED"
                    className="text-tiny text-brand hover:underline"
                  >
                    {t('common.viewAll')}
                  </Link>
                }
                padded={false}
              >
                <ul className="divide-y divide-[rgb(var(--border-line))]">
                  {data.recent_failures.map((row) => (
                    <li key={row.execution_id}>
                      <Link
                        href={`/executions/${row.execution_id}`}
                        className="flex items-center gap-2.5 px-4 py-2.5 transition-colors hover:bg-surface-2"
                      >
                        <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 text-danger" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-caption font-emphasis text-text-primary">
                            {row.workflow_name ?? '—'}
                          </span>
                          <span className="block truncate text-tiny text-text-tertiary">
                            {row.failed_node_name
                              ? `${row.failed_node_name} · ${row.error_code ?? ''}`
                              : row.error_code ?? ''}
                          </span>
                        </span>
                        <span data-volatile className="shrink-0 text-tiny text-text-quaternary">
                          {formatRelative(row.ended_at, locale)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            {data.running.length > 0 && (
              <Card title={t('overview.running')} padded={false}>
                <ul className="divide-y divide-[rgb(var(--border-line))]">
                  {data.running.map((row) => (
                    <li key={row.execution_id}>
                      <Link
                        href={`/executions/${row.execution_id}`}
                        className="flex items-center gap-2.5 px-4 py-2.5 transition-colors hover:bg-surface-2"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-caption font-emphasis text-text-primary">
                            {row.workflow_name ?? '—'}
                          </span>
                          <span className="block text-tiny text-text-tertiary">
                            #{row.short_id}
                          </span>
                        </span>
                        <ExecutionStatusBadge status={row.status} size="xs" />
                        <span data-volatile className="shrink-0 text-tiny tabular-nums text-text-quaternary">
                          {row.started_at
                            ? formatDuration(
                              (Date.now() - new Date(row.started_at).getTime()) / 1000)
                            : '—'}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            {/* What you were last working on -- the thing an operator is
                usually here to get back to, and which the page did not offer
                at all. It replaces the box that said "nothing is running". */}
            {(recent.data?.items?.length ?? 0) > 0 && (
              <Card
                title={t('overview.recentWorkflows')}
                action={
                  <Link href="/workflows" className="text-tiny text-brand hover:underline">
                    {t('common.viewAll')}
                  </Link>
                }
                padded={false}
              >
                <ul className="divide-y divide-[rgb(var(--border-line))]">
                  {recent.data!.items.map((row) => (
                    <li key={row.id}>
                      <Link
                        href={`/workflows/${row.id}`}
                        className="flex items-center gap-2.5 px-4 py-2.5 transition-colors hover:bg-surface-2"
                      >
                        <span className="min-w-0 flex-1 truncate text-caption font-emphasis text-text-primary">
                          {row.name}
                        </span>
                        <span data-volatile className="shrink-0 text-tiny text-text-quaternary">
                          {formatRelative(row.updated_at, locale)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>

          {data.upcoming_schedules.length > 0 && (
            <Card title={t('overview.upcoming')} padded={false}>
              <ul className="divide-y divide-[rgb(var(--border-line))]">
                {data.upcoming_schedules.map((row) => (
                  <li key={`${row.workflow_id}-${row.next_run_at}`}>
                    <Link
                      href={`/workflows/${row.workflow_id}`}
                      className="flex items-center gap-2.5 px-4 py-2.5 transition-colors hover:bg-surface-2"
                    >
                      <Clock className="h-3.5 w-3.5 flex-shrink-0 text-text-tertiary" />
                      <span className="min-w-0 flex-1 truncate text-caption text-text-primary">
                        {row.workflow_name ?? '—'}
                      </span>
                      <span data-volatile className="shrink-0 text-tiny tabular-nums text-text-tertiary">
                        {formatDateTime(row.next_run_at, locale)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}
    </PageListLayout>
  );
}

/**
 * One number from the strip.
 *
 * A `<dl>` of label/value pairs rather than a grid of cards: these are
 * captions on the page, not the page. The label sits under the number and at
 * sentence case, because six lines of 10px uppercase letter-spaced text across
 * the top of a screen is the visual signature of a dashboard nobody reads.
 */
function Figure({
  label, value, tone = 'default',
}: {
  label: string;
  value: React.ReactNode;
  tone?: 'default' | 'success' | 'warning' | 'danger';
}) {
  const tones = {
    default: 'text-text-primary',
    success: 'text-success',
    warning: 'text-warning',
    danger: 'text-danger',
  } as const;
  return (
    <div>
      <dd
        // Marked so a test can assert every figure carries a number without
        // depending on the element or the utility classes -- this used to be a
        // `<p className="tabular-nums">` inside a bordered tile, and a test
        // pinned to that selector went quiet the moment the tiles went away.
        data-figure=""
        className={cn('text-h3 font-emphasis tabular-nums leading-none', tones[tone])}
      >
        {value}
      </dd>
      <dt className="mt-1 text-tiny text-text-tertiary">{label}</dt>
    </div>
  );
}

/**
 * What needs a person, said as a sentence.
 *
 * Only the things somebody has to act on. A run in progress is not one of
 * them -- it is in the figures strip, and putting it here alongside a failure
 * would be the same flattening this band exists to undo.
 *
 * When there is nothing, it says so in one quiet line -- and names the window
 * it is talking about. "Nothing needs your attention" printed directly above a
 * list headed "Recent failures" with a row in it is two true statements that
 * read as a contradiction: the band counts the last 24 hours and the list does
 * not. Saying "no incidents in the last 24 hours" costs four words and stops
 * the page arguing with itself.
 */
function AttentionBand({
  failed, credentials, running,
}: {
  failed: number;
  credentials: number;
  running: number;
}) {
  const { t } = useI18n();
  const items: { href: string; text: string; icon: React.ReactNode }[] = [];

  if (failed > 0) {
    items.push({
      href: '/executions?status=FAILED',
      text: t('overview.attentionFailed', { n: failed }),
      icon: <AlertTriangle className="h-4 w-4 flex-shrink-0 text-danger" />,
    });
  }
  if (credentials > 0) {
    items.push({
      href: '/credentials',
      text: t('overview.attentionCredentials', { n: credentials }),
      icon: <KeyRound className="h-4 w-4 flex-shrink-0 text-warning" />,
    });
  }

  if (items.length === 0) {
    return (
      <p className="flex items-center gap-2 text-caption text-text-tertiary">
        <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-success" />
        {running > 0
          ? t('overview.attentionNoneRunning', { n: running })
          : t('overview.attentionNone')}
      </p>
    );
  }

  return (
    <div className="divide-y divide-danger/15 overflow-hidden rounded-lg border border-danger/25 bg-danger/[0.04]">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className="flex items-center gap-2.5 px-4 py-3 transition-colors hover:bg-danger/[0.07]"
        >
          {item.icon}
          <span className="min-w-0 flex-1 text-small text-text-primary">{item.text}</span>
          <span className="shrink-0 text-tiny text-brand">{t('common.viewAll')}</span>
        </Link>
      ))}
    </div>
  );
}
