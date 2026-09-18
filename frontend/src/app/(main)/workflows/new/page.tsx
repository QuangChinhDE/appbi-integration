'use client';

/**
 * Create a workflow (SRS 6.2 `/workflows/new`).
 *
 * Two decisions and nothing else: what to call it, and what starts it. The
 * trigger is asked here rather than left to the canvas because it is the one
 * choice that changes the shape of everything after it — and because a new
 * workflow arrives with its trigger already on the canvas (SRS 17.2).
 */

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { NodeIcon } from '@/components/automation/NodeIcon';
import { Button } from '@/components/ui/Button';
import { Input, Label, Textarea } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Feedback';
import { DetailBody, DetailHeader } from '@/components/layout/PageLayout';
import { nodeApi, workflowApi } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { cn } from '@/lib/utils';
import { useWorkspaceId } from '@/hooks/use-current-user';
import { useI18n } from '@/providers/LanguageProvider';

export default function NewWorkflowPage() {
  const { t } = useI18n();
  const router = useRouter();
  const workspaceId = useWorkspaceId();
  const queryClient = useQueryClient();

  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [triggerKey, setTriggerKey] = React.useState('manual_trigger');

  const nodes = useQuery({
    queryKey: qk.nodes(workspaceId, { category: 'TRIGGER' }),
    queryFn: () => nodeApi.list({ category: 'TRIGGER' }),
    staleTime: 5 * 60_000,
  });

  const create = useMutation({
    mutationFn: () => workflowApi.create({
      name: name.trim(),
      description: description.trim() || undefined,
      trigger_node_key: triggerKey,
    }),
    onSuccess: (workflow) => {
      // Two things read this key and both were wrong without it, for the whole
      // 15s `staleTime`: the list a user goes back to would not contain the
      // workflow they just made, and the sidebar's first-run probe -- which
      // folds the advanced modules away until a workspace has one workflow --
      // would keep them folded (it queries `qk.workflows(ws, {probe})`, and the
      // unfiltered key is a true prefix of it, by design in `queryKeys.ts`).
      void queryClient.invalidateQueries({ queryKey: qk.workflows(workspaceId) });
      router.replace(`/workflows/${workflow.id}`);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
  });

  const triggers = nodes.data?.items ?? [];

  return (
    <>
      <DetailHeader
        backHref="/workflows"
        backLabel={t('workflows.title')}
        title={t('workflows.newTitle')}
      />
      <DetailBody>
        <form
          className="max-w-2xl space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim()) create.mutate();
          }}
        >
          <div>
            <Label htmlFor="name" required>{t('common.name')}</Label>
            <Input
              id="name"
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('workflows.namePlaceholder')}
            />
          </div>

          <div>
            <Label htmlFor="description" hint={t('common.optional')}>
              {t('common.description')}
            </Label>
            <Textarea
              id="description"
              rows={2}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          <div>
            <Label required>{t('workflows.triggerChoice')}</Label>
            {nodes.isLoading ? (
              <Spinner label={t('common.loading')} />
            ) : (
              /* A label cannot point at a set of buttons, so the group carries
                 the name itself -- otherwise the choice is announced as three
                 unrelated buttons with no idea what they are choosing. */
              <div
                role="group"
                aria-label={t('workflows.triggerChoice')}
                className="grid gap-2 sm:grid-cols-3"
              >
                {triggers.map((node) => (
                  <button
                    key={node.node_key}
                    type="button"
                    onClick={() => setTriggerKey(node.node_key)}
                    aria-pressed={triggerKey === node.node_key}
                    className={cn(
                      'rounded-lg border p-3 text-left transition-colors',
                      triggerKey === node.node_key
                        ? 'border-brand bg-brand-soft/50'
                        : 'border-[rgb(var(--border-line))] bg-surface-1 hover:bg-surface-2',
                    )}
                  >
                    <NodeIcon icon={node.icon} category={node.category} size="sm" />
                    <p className="mt-2 text-caption font-emphasis text-text-primary">
                      {node.display_name}
                    </p>
                    <p className="mt-0.5 text-tiny leading-relaxed text-text-tertiary">
                      {node.description}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Button
              type="submit"
              variant="primary"
              loading={create.isPending}
              disabled={!name.trim()}
            >
              {t('common.create')}
            </Button>
            <Link href="/workflows">
              <Button variant="ghost">{t('common.cancel')}</Button>
            </Link>
          </div>
        </form>
      </DetailBody>
    </>
  );
}
