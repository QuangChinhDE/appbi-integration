'use client';

/**
 * Workflow list (SRS 13.1, 35.2).
 *
 * The columns are chosen to answer "is this thing working" without opening it:
 * lifecycle status, which version production is running, whether the draft has
 * moved on, and how the last run went. `available_actions` comes from the
 * backend, so the row never offers an action the server would refuse (SRS 80).
 */

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Play, Plus, Trash2, Workflow as WorkflowIcon } from 'lucide-react';
import { toast } from 'sonner';

import {
  DraftChangesBadge, HealthBadge, TriggerBadge, WorkflowStatusBadge,
} from '@/components/automation/StatusBadges';
import { ExecutionStatusBadge } from '@/components/automation/StatusBadges';
import { Button } from '@/components/ui/Button';
import { Menu } from '@/components/ui/Menu';
import { ConfirmDialog } from '@/components/ui/Modal';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/Feedback';
import { Select } from '@/components/ui/Input';
import { ModuleOverview, PageListLayout } from '@/components/layout/PageLayout';
import { workflowApi } from '@/lib/api';
import { formatRelative } from '@/lib/format';
import { qk } from '@/lib/queryKeys';
import { useWorkspaceId } from '@/hooks/use-current-user';
import { usePermissions } from '@/hooks/use-permissions';
import type { WorkflowListSummary, WorkflowSummary } from '@/lib/types';
import { useI18n } from '@/providers/LanguageProvider';

export default function WorkflowsPage() {
  const { t, tf, locale } = useI18n();
  const router = useRouter();
  const queryClient = useQueryClient();
  const workspaceId = useWorkspaceId();
  const { can } = usePermissions();

  const [search, setSearch] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [trigger, setTrigger] = React.useState('');
  const [pendingDelete, setPendingDelete] = React.useState<WorkflowSummary | null>(null);

  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const filters = { q: debounced || undefined, status: status || undefined, trigger: trigger || undefined };
  const workflows = useQuery({
    queryKey: qk.workflows(workspaceId, filters),
    queryFn: () => workflowApi.list(filters),
    refetchInterval: 20_000,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: qk.workflows(workspaceId) });
  };

  const run = useMutation({
    mutationFn: (workflow: WorkflowSummary) =>
      workflowApi.run(workflow.id, {
        // A published version if there is one, the draft otherwise. Running the
        // draft of a live workflow from a list row would be a surprising thing
        // for a one-click action to do.
        kind: workflow.published ? 'PUBLISHED' : 'DRAFT',
      }),
    onSuccess: (execution) => {
      toast.success(`#${execution.short_id}`);
      router.push(`/executions/${execution.id}`);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
  });

  const duplicate = useMutation({
    mutationFn: (id: string) => workflowApi.duplicate(id),
    onSuccess: (copy) => {
      invalidate();
      router.push(`/workflows/${copy.id}`);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
  });

  const activate = useMutation({
    mutationFn: ({ id, activate: on }: { id: string; activate: boolean }) =>
      on ? workflowApi.activate(id) : workflowApi.deactivate(id),
    onSuccess: invalidate,
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => workflowApi.remove(id),
    onSuccess: () => {
      setPendingDelete(null);
      invalidate();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
  });

  const items = workflows.data?.items ?? [];
  const summary = (workflows.data?.summary ?? {}) as Partial<WorkflowListSummary>;

  const createButton = can('workflows', 'create') ? (
    <Link href="/workflows/new">
      <Button variant="primary" size="sm" leadingIcon={<Plus className="h-3.5 w-3.5" />}>
        {t('workflows.new')}
      </Button>
    </Link>
  ) : null;

  return (
    <PageListLayout
      title={t('workflows.title')}
      description={t('workflows.description')}
      searchValue={search}
      onSearchChange={setSearch}
      searchPlaceholder={t('common.search')}
      action={createButton}
      overview={
        items.length > 0 ? (
          <ModuleOverview
            stats={[
              { label: t('workflows.title'), value: summary.total ?? items.length },
              { label: t('overview.activeWorkflows'), value: summary.active ?? 0, tone: 'success' },
              { label: t('workflows.needsAttention'),
                value: summary.needs_attention ?? 0, tone: 'danger' },
              { label: t('overview.draftOnly'), value: summary.draft_only ?? 0 },
            ]}
          />
        ) : undefined
      }
      filters={
        <>
          <Select
            size="sm"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            aria-label={t('workflows.filterStatus')}
          >
            <option value="">{t('workflows.filterStatus')}: {t('common.all')}</option>
            <option value="ACTIVE">{tf(['status.ACTIVE'], 'ACTIVE')}</option>
            <option value="INACTIVE">{tf(['status.INACTIVE'], 'INACTIVE')}</option>
          </Select>
          <Select
            size="sm"
            value={trigger}
            onChange={(event) => setTrigger(event.target.value)}
            aria-label={t('workflows.filterTrigger')}
          >
            <option value="">{t('workflows.filterTrigger')}: {t('common.all')}</option>
            <option value="MANUAL">{tf(['trigger.MANUAL'], 'MANUAL')}</option>
            <option value="WEBHOOK">{tf(['trigger.WEBHOOK'], 'WEBHOOK')}</option>
            <option value="SCHEDULE">{tf(['trigger.SCHEDULE'], 'SCHEDULE')}</option>
          </Select>
        </>
      }
    >
      {workflows.isLoading ? (
        <TableSkeleton rows={6} columns={6} />
      ) : workflows.error ? (
        <ErrorState
          title={t('common.errorTitle')}
          error={workflows.error}
          onRetry={() => void workflows.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={WorkflowIcon}
          title={debounced || status || trigger
            ? t('common.noResults')
            : t('workflows.emptyTitle')}
          description={debounced || status || trigger ? undefined : t('workflows.emptyBody')}
          action={debounced || status || trigger ? undefined : createButton}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-[rgb(var(--border-line))] bg-surface-1">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[rgb(var(--border-line))] text-left">
                <Th>{t('workflows.column.workflow')}</Th>
                <Th>{t('common.status')}</Th>
                <Th>{t('workflows.column.trigger')}</Th>
                <Th>{t('workflows.column.published')}</Th>
                <Th>{t('workflows.column.lastRun')}</Th>
                <Th className="w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[rgb(var(--border-line))]">
              {items.map((workflow) => (
                <tr key={workflow.id} className="group transition-colors hover:bg-surface-2/60">
                  <Td>
                    <Link href={`/workflows/${workflow.id}`} className="block min-w-0">
                      <span className="block truncate text-caption font-emphasis text-text-primary">
                        {workflow.name}
                      </span>
                      {workflow.description && (
                        <span className="block truncate text-tiny text-text-tertiary">
                          {workflow.description}
                        </span>
                      )}
                    </Link>
                  </Td>
                  <Td>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <HealthBadge
                        level={workflow.health.level}
                        label={workflow.health.label}
                        title={workflow.health.message}
                      />
                      {workflow.draft.has_changes_since_publish
                        && workflow.published && (
                        <DraftChangesBadge label={t('workflows.draftChanges')} />
                      )}
                    </div>
                  </Td>
                  <Td>
                    {workflow.trigger ? (
                      <TriggerBadge
                        type={workflow.trigger.type}
                        enabled={workflow.trigger.enabled}
                        summary={workflow.trigger.summary}
                      />
                    ) : (
                      <span className="text-tiny text-text-quaternary">—</span>
                    )}
                  </Td>
                  <Td>
                    {workflow.published ? (
                      <span className="text-caption tabular-nums text-text-secondary">
                        v{workflow.published.version}
                        {workflow.active_version === workflow.published.version && (
                          <span className="ml-1 text-tiny text-success">
                            · {t('status.ACTIVE').toLowerCase()}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-tiny text-text-quaternary">—</span>
                    )}
                  </Td>
                  <Td>
                    {workflow.last_execution ? (
                      <Link
                        href={`/executions/${workflow.last_execution.id}`}
                        className="inline-flex items-center gap-1.5"
                      >
                        <ExecutionStatusBadge
                          status={workflow.last_execution.status}
                          size="xs"
                        />
                        <span className="text-tiny text-text-quaternary">
                          {formatRelative(
                            workflow.last_execution.ended_at
                            ?? workflow.last_execution.started_at, locale)}
                        </span>
                      </Link>
                    ) : (
                      <span className="text-tiny text-text-quaternary">
                        {t('common.never')}
                      </span>
                    )}
                  </Td>
                  <Td>
                    <Menu
                      label={t('common.actions')}
                      items={[
                        ...(workflow.available_actions.includes('RUN_DRAFT') ? [{
                          id: 'run',
                          label: workflow.published
                            ? t('workflows.runPublished')
                            : t('workflows.runDraft'),
                          icon: <Play className="h-3.5 w-3.5" />,
                          onSelect: () => run.mutate(workflow),
                        }] : []),
                        ...(workflow.available_actions.includes('ACTIVATE') ? [{
                          id: 'activate',
                          label: t('workflows.activate'),
                          onSelect: () => activate.mutate({ id: workflow.id, activate: true }),
                        }] : []),
                        ...(workflow.available_actions.includes('DEACTIVATE') ? [{
                          id: 'deactivate',
                          label: t('workflows.deactivate'),
                          onSelect: () => activate.mutate({ id: workflow.id, activate: false }),
                        }] : []),
                        ...(workflow.available_actions.includes('DUPLICATE') ? [{
                          id: 'duplicate',
                          label: t('workflows.duplicate'),
                          icon: <Copy className="h-3.5 w-3.5" />,
                          onSelect: () => duplicate.mutate(workflow.id),
                        }] : []),
                        ...(workflow.available_actions.includes('DELETE') ? [{
                          id: 'delete',
                          label: t('common.delete'),
                          icon: <Trash2 className="h-3.5 w-3.5" />,
                          destructive: true,
                          onSelect: () => setPendingDelete(workflow),
                        }] : []),
                      ]}
                    />
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && remove.mutate(pendingDelete.id)}
        title={t('workflows.deleteTitle')}
        message={t('workflows.deleteBody')}
        confirmLabel={t('common.delete')}
        destructive
        loading={remove.isPending}
      />
    </PageListLayout>
  );
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th
      className={`px-4 py-2 text-tiny font-emphasis uppercase tracking-[0.08em] text-text-quaternary ${className ?? ''}`}
    >
      {children}
    </th>
  );
}

function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-2.5 align-middle ${className ?? ''}`}>{children}</td>;
}
