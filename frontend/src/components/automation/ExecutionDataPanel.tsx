'use client';

/**
 * The bottom execution panel (SRS 7.3).
 *
 * Shows one node's run at a time: what came out, what went wrong, and the log
 * lines around it. Collapsible, because on a wide graph the canvas is what the
 * user is working in and this panel is what they consult.
 *
 * Payload access is a separate permission from seeing that a run happened
 * (SRS 4.2), so when the backend says `payload_access: false` the panel says
 * why rather than showing an empty box.
 */

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, EyeOff } from 'lucide-react';

import { ErrorRemediationCard, resolveRemediation } from './ErrorRemediationCard';
import { JsonTreeViewer } from './JsonTreeViewer';
import { ExecutionStatusBadge, NodeStatusBadge } from './StatusBadges';
import { Button, IconButton } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Feedback';
import { executionApi } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { qk } from '@/lib/queryKeys';
import { useBelowMd } from '@/hooks/use-media-query';
import { cn } from '@/lib/utils';
import { useWorkspaceId } from '@/hooks/use-current-user';
import type { ExecutionDetail } from '@/lib/types';
import { useI18n } from '@/providers/LanguageProvider';

/**
 * `steps` exists only on a narrow screen.
 *
 * Wide, the step list is a 228px column beside the data. At 390px that column
 * took more than half the width and left ~160px for the JSON -- the thing the
 * screen is for. So on a phone the list becomes the first tab and each pane
 * gets the whole width.
 */
type Tab = 'steps' | 'output' | 'input' | 'error' | 'logs';

export function ExecutionDataPanel({
  execution, selectedNodeId, onSelectNode, collapsed, onToggleCollapsed,
  onPickExpression, workflowId, fill = false,
}: {
  execution: ExecutionDetail | null;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Present when a field is waiting for a data-picker choice. */
  onPickExpression?: (path: string) => void;
  workflowId?: string;
  /**
   * Take the height that is left rather than a fixed 290px.
   *
   * In the editor the canvas above needs that space and this must not grow.
   * On the execution detail page nothing else wants it: the header and four
   * meta tiles are short, so a fixed panel left five hundred pixels of empty
   * screen between them and the data -- which is the one thing that page is
   * for.
   */
  fill?: boolean;
}) {
  const { t, locale } = useI18n();
  const workspaceId = useWorkspaceId();
  const belowMd = useBelowMd();
  const [tab, setTab] = React.useState<Tab>('output');

  // Opening a run on a phone with nothing selected: the list is the only
  // useful first screen, and 'output' would show "pick a step".
  React.useEffect(() => {
    if (belowMd && !selectedNodeId) setTab('steps');
  }, [belowMd, selectedNodeId]);

  const nodeResult = execution?.nodes.find((node) => node.node_id === selectedNodeId)
    ?? execution?.nodes.find((node) => node.status === 'FAILED')
    ?? execution?.nodes[0];

  // A failed step opens on its error.
  //
  // The panel used to open on Output, which for a step that failed is empty --
  // so the one screen whose entire purpose is "what went wrong" answered
  // "Không có", and the reader had to guess that the answer was behind another
  // tab. Tracked by node id so moving between steps re-decides, and so a
  // deliberate click on another tab is not overridden on the next render.
  const decidedFor = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!nodeResult || decidedFor.current === nodeResult.node_id) return;
    decidedFor.current = nodeResult.node_id;
    setTab(nodeResult.status === 'FAILED' ? 'error' : 'output');
  }, [nodeResult]);

  const payloadEnabled = Boolean(
    execution && nodeResult && execution.payload_access
    && (tab === 'output' || tab === 'input'),
  );

  const payload = useQuery({
    queryKey: qk.executionNodePayload(
      workspaceId, execution?.id ?? 'none', nodeResult?.node_id ?? 'none', tab),
    queryFn: () =>
      tab === 'input'
        ? executionApi.nodeInput(execution!.id, nodeResult!.node_id)
        : executionApi.nodeOutput(execution!.id, nodeResult!.node_id),
    enabled: payloadEnabled,
    staleTime: 30_000,
  });

  const logs = useQuery({
    queryKey: qk.executionLogs(workspaceId, execution?.id ?? 'none'),
    queryFn: () => executionApi.logs(execution!.id),
    enabled: Boolean(execution) && tab === 'logs',
    staleTime: 15_000,
  });

  if (collapsed) {
    return (
      <div className="flex h-9 shrink-0 items-center justify-between border-t border-[rgb(var(--border-line))] bg-surface-1 px-3">
        <span className="inline-flex items-center gap-2 text-caption text-text-tertiary">
          {t('editor.runPanel')}
          {execution && <ExecutionStatusBadge status={execution.status} size="xs" />}
        </span>
        <IconButton
          size="xs"
          variant="ghost"
          aria-label={t('common.expand')}
          onClick={onToggleCollapsed}
        >
          <ChevronUp className="h-3.5 w-3.5" />
        </IconButton>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex flex-col border-t border-[rgb(var(--border-line))] bg-surface-1',
        fill ? 'min-h-[290px] flex-1' : 'h-[290px] shrink-0',
      )}
    >
      <div className="flex h-9 items-center justify-between gap-3 border-b border-[rgb(var(--border-line))] px-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-caption font-strong text-text-primary">
            {t('editor.runPanel')}
          </span>
          {execution && (
            <>
              <ExecutionStatusBadge status={execution.status} size="xs" />
              <span className="truncate text-tiny text-text-quaternary">
                #{execution.short_id} · {formatDateTime(execution.queued_at, locale)}
              </span>
            </>
          )}
        </div>
        <IconButton
          size="xs"
          variant="ghost"
          aria-label={t('common.collapse')}
          onClick={onToggleCollapsed}
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </IconButton>
      </div>

      {!execution ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="max-w-sm text-center text-caption text-text-tertiary">
            {t('editor.runPanelEmpty')}
          </p>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          {/* Node timeline. Clicking a row also selects it on the canvas, so the
              two views never disagree about what is being inspected.
              A fixed column beside the data when there is room; the first tab,
              full width, when there is not. */}
          <ul
            className={cn(
              'overflow-y-auto py-1',
              belowMd
                ? cn('w-full', tab === 'steps' ? 'block' : 'hidden')
                : 'w-[228px] shrink-0 border-r border-[rgb(var(--border-line))]',
            )}
          >
            {execution.nodes.map((node) => (
              <li key={`${node.node_id}-${node.execution_index}`}>
                <button
                  type="button"
                  onClick={() => {
                    onSelectNode(node.node_id);
                    // On a phone, picking a step is a request to see its data
                    // -- staying on the list would mean two taps for one
                    // intention.
                    if (belowMd) setTab('output');
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors',
                    node.node_id === nodeResult?.node_id
                      ? 'bg-surface-2'
                      : 'hover:bg-surface-2/60',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-caption text-text-primary">
                      {node.node_name}
                    </span>
                    <span className="block text-tiny tabular-nums text-text-quaternary">
                      {node.duration_ms !== null ? `${node.duration_ms}ms` : '—'}
                      {node.item_count !== null ? ` · ${node.item_count} item` : ''}
                    </span>
                  </span>
                  <NodeStatusBadge status={node.status} />
                </button>
              </li>
            ))}
          </ul>

          <div
            className={cn(
              'flex min-w-0 flex-1 flex-col p-2.5',
              belowMd && tab === 'steps' && 'hidden',
            )}
          >
            <div className="mb-2 flex items-center gap-1 overflow-x-auto">
              {((belowMd
                ? ['steps', 'output', 'input', 'error', 'logs']
                : ['output', 'input', 'error', 'logs']) as Tab[]).map((option) => (
                <Button
                  key={option}
                  size="xs"
                  variant={tab === option ? 'subtle' : 'ghost'}
                  onClick={() => setTab(option)}
                >
                  {t(`editor.${option}`)}
                </Button>
              ))}
              {onPickExpression && (
                <span className="ml-auto text-tiny text-brand">
                  {t('editor.dataPickerHelp')}
                </span>
              )}
            </div>

            <div className="min-h-0 flex-1">
              {tab === 'error' ? (
                nodeResult?.error ? (
                  <ErrorRemediationCard
                    code={nodeResult.error.code}
                    message={nodeResult.error.message ?? ''}
                    category={nodeResult.error.category}
                    technicalMessage={nodeResult.error.technical_message}
                    traceId={execution.trace_id}
                    /* The server says what to do about a code; this reads that
                       answer rather than recomputing one. It used to hardcode
                       `NODE_AUTHENTICATION_FAILED -> UPDATE_CREDENTIAL`, which
                       meant the run panel -- where a user actually meets a
                       failed run -- offered a next step for one code out of
                       twenty-three, and a network failure or a timeout was a
                       dead end (Wave 0C, D-W0-10). */
                    remediation={resolveRemediation(
                      nodeResult.error.remediation?.action,
                      { workflowId, executionId: execution.id },
                    )}
                  />
                ) : (
                  <p className="p-2 text-caption text-text-tertiary">{t('common.none')}</p>
                )
              ) : tab === 'logs' ? (
                logs.isLoading ? (
                  <Spinner label={t('common.loading')} />
                ) : (
                  <div className="h-full overflow-auto rounded-md border border-[rgb(var(--border-line))] bg-surface-1 p-2">
                    {(logs.data?.items ?? []).map((line) => (
                      <p
                        key={line.sequence}
                        className={cn(
                          'font-mono text-tiny leading-relaxed',
                          line.level === 'ERROR' ? 'text-danger' : 'text-text-secondary',
                        )}
                      >
                        <span className="text-text-quaternary">
                          {formatDateTime(line.at, locale)}
                        </span>{' '}
                        {line.message}
                      </p>
                    ))}
                    {(logs.data?.items ?? []).length === 0 && (
                      <p className="text-caption text-text-tertiary">{t('common.none')}</p>
                    )}
                  </div>
                )
              ) : !execution.payload_access ? (
                <div className="flex h-full items-center justify-center">
                  <p className="inline-flex max-w-sm items-start gap-2 text-caption leading-relaxed text-text-tertiary">
                    <EyeOff className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                    {t('executions.noPayloadAccess')}
                  </p>
                </div>
              ) : payload.isLoading ? (
                <Spinner label={t('common.loading')} />
              ) : (
                <JsonTreeViewer
                  items={payload.data?.preview.items ?? []}
                  rootPath={
                    // A picked path is inserted as an expression. Referencing the
                    // node by name is what makes it valid from anywhere in the
                    // graph, not just the next step.
                    onPickExpression && nodeResult
                      ? `$node["${nodeResult.node_name}"].json`
                      : '$json'
                  }
                  onPick={onPickExpression}
                  emptyLabel={t('common.none')}
                  className="h-full"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
