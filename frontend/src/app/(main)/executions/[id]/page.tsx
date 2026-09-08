'use client';

/**
 * Execution detail (SRS 16.5, 35.6).
 *
 * Answers, in order: what happened, which exact version ran, which step broke,
 * and what to do about it. The node timeline and payload viewer are the same
 * components the editor uses, so a run looks the same wherever it is inspected.
 */

import * as React from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Copy, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';

import { ExecutionDataPanel } from '@/components/automation/ExecutionDataPanel';
import { ErrorRemediationCard, resolveRemediation } from '@/components/automation/ErrorRemediationCard';
import {
  ExecutionStatusBadge, TriggerBadge, VersionBadge,
} from '@/components/automation/StatusBadges';
import { Button } from '@/components/ui/Button';
import { Spinner, ErrorState } from '@/components/ui/Feedback';
import { Card, DetailBody, DetailHeader } from '@/components/layout/PageLayout';
import { Disclosure } from '@/components/ui/Disclosure';
import { executionApi } from '@/lib/api';
import { formatDateTime, formatDuration } from '@/lib/format';
import { qk } from '@/lib/queryKeys';
import { useWorkspaceId } from '@/hooks/use-current-user';
import { usePermissions } from '@/hooks/use-permissions';
import { useI18n } from '@/providers/LanguageProvider';

const ACTIVE = ['QUEUED', 'DISPATCHING', 'RUNNING', 'CANCEL_REQUESTED'];

export default function ExecutionDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const executionId = params.id;
  const { t, locale } = useI18n();
  const workspaceId = useWorkspaceId();
  const queryClient = useQueryClient();
  const { can, isPlatformAdmin } = usePermissions();

  const [selectedNodeId, setSelectedNodeId] = React.useState<string | null>(null);

  const execution = useQuery({
    queryKey: qk.execution(workspaceId, executionId),
    queryFn: () => executionApi.get(executionId),
    refetchInterval: (query) =>
      ACTIVE.includes(query.state.data?.status ?? '') ? 2_000 : false,
  });

  const cancel = useMutation({
    mutationFn: () => executionApi.cancel(executionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.execution(workspaceId, executionId) });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
  });

  const retry = useMutation({
    mutationFn: () => executionApi.retry(executionId),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: qk.executions(workspaceId) });
      // Go to the run that was just started. Pressing "Run again" and staying
      // on the old, finished execution -- with a toast naming an id you then
      // have to go and find -- is the product answering a request by
      // describing what it did instead of doing it.
      router.push(`/executions/${created.id}`);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
  });

  if (execution.isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner label={t('common.loading')} />
      </div>
    );
  }
  if (execution.error || !execution.data) {
    return (
      <DetailBody>
        <ErrorState
          title={t('common.errorTitle')}
          error={execution.error}
          onRetry={() => void execution.refetch()}
        />
      </DetailBody>
    );
  }

  const detail = execution.data;
  const supportBlock = [
    `execution: ${detail.short_id}`,
    `workflow: ${detail.workflow_name ?? detail.workflow_id}`,
    detail.version.kind === 'PUBLISHED'
      ? `version: v${detail.version.number}`
      : `draft revision: ${detail.version.draft_revision}`,
    detail.error_code ? `code: ${detail.error_code}` : null,
    `trace: ${detail.trace_id}`,
  ].filter(Boolean).join('\n');

  return (
    <>
      <DetailHeader
        backHref="/executions"
        backLabel={t('executions.title')}
        // Marked volatile: the id is different on every run, and a visual
        // baseline of this page would otherwise fail on the id alone.
        title={
          // Monospace, so six characters always occupy the same width. In a
          // proportional face `#Q7CZ89` and `#NSMYJU` differ by a few pixels,
          // which at 390px was enough to wrap a badge onto a second line and
          // move the entire page down by 30px between runs.
          <span data-volatile className="font-mono">{`#${detail.short_id}`}</span>
        }
        badgesInline
        badges={
          <>
            <ExecutionStatusBadge status={detail.status} />
            <VersionBadge
              kind={detail.version.kind}
              number={detail.version.number}
              draftRevision={detail.version.draft_revision}
            />
            <TriggerBadge type={detail.trigger_type} />
          </>
        }
        subtitle={
          <Link
            href={`/workflows/${detail.workflow_id}`}
            className="text-caption text-brand hover:underline"
          >
            {detail.workflow_name ?? detail.workflow_id}
          </Link>
        }
        actions={
          <>
            <Button
              size="sm"
              variant="ghost"
              leadingIcon={<Copy className="h-3.5 w-3.5" />}
              onClick={() => {
                void navigator.clipboard?.writeText(supportBlock);
                toast.success(t('common.copied'));
              }}
            >
              {t('common.copyId')}
            </Button>
            {can('executions', 'execute') && detail.actions.can_cancel && (
              <Button
                size="sm"
                variant="secondary"
                leadingIcon={<Ban className="h-3.5 w-3.5" />}
                loading={cancel.isPending}
                onClick={() => cancel.mutate()}
              >
                {t('executions.cancel')}
              </Button>
            )}
            {can('executions', 'execute') && detail.actions.can_retry && (
              <Button
                size="sm"
                variant="primary"
                leadingIcon={<RotateCcw className="h-3.5 w-3.5" />}
                loading={retry.isPending}
                onClick={() => retry.mutate()}
              >
                {t('executions.retry')}
              </Button>
            )}
          </>
        }
      />

      <DetailBody fit>
        <div className="space-y-4">
          {detail.error_code && (
            <ErrorRemediationCard
              code={detail.error_code}
              message={detail.error_summary ?? ''}
              category={detail.error_category}
              traceId={detail.trace_id}
              remediation={resolveRemediation(
                detail.error_code === 'NODE_AUTHENTICATION_FAILED'
                  ? 'UPDATE_CREDENTIAL'
                  : detail.error_code === 'ENGINE_INTERRUPTED'
                    ? 'RETRY_EXECUTION'
                    : undefined,
                { workflowId: detail.workflow_id, executionId: detail.id },
                { onRetry: () => retry.mutate() },
              )}
              title={detail.failed_node_name ?? undefined}
            />
          )}

          {/* Two columns even on a phone: four stacked tiles pushed the run data,
              which is the point of the page, most of a screen down. */}
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <Fact volatile label={t('executions.column.started')}
              value={formatDateTime(detail.started_at ?? detail.queued_at, locale)} />
            <Fact volatile label={t('common.duration')}
              value={detail.duration_ms === null
                ? '—'
                : formatDuration(detail.duration_ms / 1000)} />
            <Fact label={t('executions.column.version')}
              value={detail.version.kind === 'PUBLISHED'
                ? `v${detail.version.number}`
                : `draft r${detail.version.draft_revision}`} />
            <Fact
              label={t('executions.retryOf')}
              value={detail.retry_of_execution_id ? (
                <Link
                  href={`/executions/${detail.retry_of_execution_id}`}
                  className="text-brand hover:underline"
                >
                  {t('common.detail')}
                </Link>
              ) : '—'}
            />
          </div>

          {isPlatformAdmin && detail.technical && (
            // Collapsed. Trace ids, hashes and adapter versions are for the
            // one conversation in fifty that becomes a support ticket; on a
            // phone this block was most of the screen, above the run data
            // somebody actually opened the page for.
            <Card padded={false}>
              <Disclosure
                label={t('common.technicalDetails')}
                className="px-3.5 py-3"
              >
              <dl className="grid gap-x-6 gap-y-1.5 pt-2 sm:grid-cols-2">
                {Object.entries(detail.technical).map(([key, value]) => (
                  <div key={key} className="flex items-baseline justify-between gap-3">
                    <dt className="text-tiny text-text-quaternary">{key}</dt>
                    {/* Trace ids and compiled hashes differ on every run.
                        The key stays visible so a row that disappears still
                        shows up in a baseline; only the value is covered. */}
                    <dd
                      data-volatile
                      className="min-w-0 truncate font-mono text-tiny text-text-secondary"
                    >
                      {String(value)}
                    </dd>
                  </div>
                ))}
              </dl>
              </Disclosure>
            </Card>
          )}
        </div>
      </DetailBody>

      {/* The same panel as the editor: one implementation of "inspect a run". */}
      <ExecutionDataPanel
        fill
        execution={detail}
        selectedNodeId={selectedNodeId}
        onSelectNode={setSelectedNodeId}
        collapsed={false}
        onToggleCollapsed={() => {}}
        workflowId={detail.workflow_id}
      />
    </>
  );
}

function Fact({
  label, value, volatile: isVolatile = false,
}: {
  label: string;
  value: React.ReactNode;
  /**
   * The value changes between runs -- a timestamp, a duration.
   *
   * Marks the value for masking in the visual baselines. The label is stable
   * and stays visible, so a fact that disappears entirely still shows up as a
   * difference; only the number under it is covered.
   */
  volatile?: boolean;
}) {
  return (
    <div className="rounded-lg border border-[rgb(var(--border-line))] bg-surface-1 px-3.5 py-2.5">
      <p className="text-tiny uppercase tracking-[0.08em] text-text-quaternary">{label}</p>
      <p
        data-volatile={isVolatile ? '' : undefined}
        className="mt-0.5 text-caption text-text-primary"
      >
        {value}
      </p>
    </div>
  );
}
