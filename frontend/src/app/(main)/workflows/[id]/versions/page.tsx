'use client';

/**
 * Version history (SRS 69).
 *
 * The screen where rollback happens: activating an older version is one click
 * and does not create a new one. The graph hash is shown because two versions
 * with the same hash do the same thing — useful when somebody publishes twice
 * by accident.
 */

import * as React from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, History } from 'lucide-react';
import { toast } from 'sonner';

import { HashChip } from '@/components/automation/StatusBadges';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/Feedback';
import { DetailBody, DetailHeader } from '@/components/layout/PageLayout';
import { workflowApi } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { qk } from '@/lib/queryKeys';
import { useWorkspaceId } from '@/hooks/use-current-user';
import { usePermissions } from '@/hooks/use-permissions';
import { useI18n } from '@/providers/LanguageProvider';

export default function WorkflowVersionsPage() {
  const params = useParams<{ id: string }>();
  const workflowId = params.id;
  const { t, locale } = useI18n();
  const workspaceId = useWorkspaceId();
  const queryClient = useQueryClient();
  const { can } = usePermissions();

  const workflow = useQuery({
    queryKey: qk.workflow(workspaceId, workflowId),
    queryFn: () => workflowApi.get(workflowId),
  });
  const versions = useQuery({
    queryKey: qk.workflowVersions(workspaceId, workflowId),
    queryFn: () => workflowApi.versions(workflowId),
  });

  const activate = useMutation({
    mutationFn: (version: number) => workflowApi.activate(workflowId, version),
    onSuccess: (_result, version) => {
      toast.success(`v${version}`);
      void queryClient.invalidateQueries({ queryKey: qk.workflow(workspaceId, workflowId) });
      void queryClient.invalidateQueries({
        queryKey: qk.workflowVersions(workspaceId, workflowId),
      });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
  });

  const items = versions.data?.items ?? [];

  return (
    <>
      <DetailHeader
        backHref={`/workflows/${workflowId}`}
        backLabel={workflow.data?.name ?? t('workflows.title')}
        title={t('workflows.versions')}
        badgesInline
        badges={
          workflow.data?.active_version ? (
            <Badge variant="success" size="sm" dot>
              v{workflow.data.active_version}
            </Badge>
          ) : undefined
        }
      />
      <DetailBody>
        {versions.isLoading ? (
          <TableSkeleton rows={4} columns={4} />
        ) : versions.error ? (
          <ErrorState
            title={t('common.errorTitle')}
            error={versions.error}
            onRetry={() => void versions.refetch()}
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon={History}
            title={t('workflows.emptyTitle')}
            description={t('publish.body', { version: 'v1' })}
          />
        ) : (
          <div className="overflow-hidden rounded-lg border border-[rgb(var(--border-line))] bg-surface-1">
            <ul className="divide-y divide-[rgb(var(--border-line))]">
              {items.map((version) => (
                <li key={version.id} className="flex items-start gap-3 px-4 py-3">
                  <span className="mt-0.5 inline-flex h-7 min-w-[38px] items-center justify-center rounded-md bg-surface-2 px-2 text-caption font-strong tabular-nums text-text-primary">
                    v{version.version}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {version.is_active && (
                        <Badge variant="success" size="xs">
                          <CheckCircle2 className="h-3 w-3" />
                          {t('status.ACTIVE')}
                        </Badge>
                      )}
                      {version.is_latest && !version.is_active && (
                        <Badge variant="neutral" size="xs">
                          {t('workflows.column.published')}
                        </Badge>
                      )}
                      <HashChip value={version.graph_hash} />
                    </div>
                    {version.change_note && (
                      <p className="mt-1 text-caption leading-relaxed text-text-secondary">
                        {version.change_note}
                      </p>
                    )}
                    <p className="mt-0.5 text-tiny text-text-quaternary">
                      {formatDateTime(version.published_at, locale)}
                      {` · compiler ${version.compiler_version}`}
                    </p>
                  </div>
                  {can('workflows', 'publish') && !version.is_active && (
                    <Button
                      size="xs"
                      variant="secondary"
                      loading={activate.isPending && activate.variables === version.version}
                      onClick={() => activate.mutate(version.version)}
                    >
                      {t('workflows.activate')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </DetailBody>
    </>
  );
}
