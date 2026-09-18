'use client';

/**
 * The workflow editor (SRS 14, 35.3).
 *
 * The rules this page exists to honour:
 *
 * * the canvas is local state, the draft is server state, and `revision` is
 *   what keeps them honest — a save that does not match the revision it read is
 *   a conflict, not an overwrite (SRS 14.6);
 * * pressing Run flushes the pending save first, so a run always names a
 *   revision the server knows about (SRS 14.6: never run a graph that only
 *   exists in the browser);
 * * publish and activate are separate actions with separate consequences.
 */

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, ArrowLeft, CheckCircle2, ChevronDown, Eye, History, Loader2,
  Play, Plus, Redo2, Undo2, Upload, X,
} from 'lucide-react';
import { toast } from 'sonner';

import { ExecutionDataPanel } from '@/components/automation/ExecutionDataPanel';
import { NodeConfigPanel } from '@/components/automation/NodeConfigPanel';
import {
  InspectorAside, PaletteRail, rememberPaletteOpen,
} from '@/components/automation/EditorPanels';
import { NodePalette } from '@/components/automation/NodePalette';
import { NodeReadOnlyDetail } from '@/components/automation/NodeReadOnlyDetail';
import { PublishWorkflowDialog } from '@/components/automation/PublishWorkflowDialog';
import {
  DraftChangesBadge, TriggerBadge, WorkflowStatusBadge,
} from '@/components/automation/StatusBadges';
import {
  WorkflowCanvas, inputPortsOf, type CanvasHandle,
} from '@/components/automation/WorkflowCanvas';
import { ApiErrorCard } from '@/components/automation/ErrorRemediationCard';
import { Button, IconButton } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Feedback';
import { Badge } from '@/components/ui/Badge';
import { ApiError, credentialApi, executionApi, nodeApi, workflowApi } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { cn } from '@/lib/utils';
import { useCurrentUser, useWorkspaceId } from '@/hooks/use-current-user';
import { usePermissions } from '@/hooks/use-permissions';
import { useBelowMd, useBelowXl } from '@/hooks/use-media-query';
import type {
  ExecutionDetail, GraphNode, NodeDefinition, WorkflowGraph,
} from '@/lib/types';
import { useI18n } from '@/providers/LanguageProvider';

const AUTOSAVE_DELAY_MS = 1_200;
const UNDO_LIMIT = 50;

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'conflict' | 'error';

function nextNodeId(graph: WorkflowGraph, nodeKey: string): string {
  const prefix = nodeKey.split('_')[0].slice(0, 8) || 'node';
  const taken = new Set((graph.nodes ?? []).map((node) => node.id));
  let index = 1;
  while (taken.has(`${prefix}_${index}`)) index += 1;
  return `${prefix}_${index}`;
}

function uniqueName(graph: WorkflowGraph, desired: string): string {
  const taken = new Set((graph.nodes ?? []).map((node) => node.name));
  if (!taken.has(desired)) return desired;
  let counter = 2;
  while (taken.has(`${desired} ${counter}`)) counter += 1;
  return `${desired} ${counter}`;
}

function defaultConfig(definition: NodeDefinition): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  for (const field of definition.config_schema?.fields ?? []) {
    if (field.default !== undefined) config[field.key] = field.default;
  }
  return config;
}

export default function WorkflowEditorPage() {
  const params = useParams<{ id: string }>();
  const workflowId = params.id;
  const router = useRouter();
  const queryClient = useQueryClient();
  const { t, locale } = useI18n();
  const workspaceId = useWorkspaceId();
  const { can } = usePermissions();
  const belowXl = useBelowXl();
  const belowMd = useBelowMd();
  const { data: user } = useCurrentUser();

  // Editing needs the permission *and* a window it can be done in. Dragging
  // nodes and wiring edges with a thumb on a 390px canvas is not something
  // this product does well; offering it anyway means people find out by
  // losing work. Below `md` the editor is a viewer, and says so.
  const canEdit = can('workflows', 'edit') && !belowMd;
  const editingBlockedByViewport = can('workflows', 'edit') && belowMd;
  const canRun = can('workflows', 'execute');
  // Publishing promotes a draft, which is the outcome of editing -- so it goes
  // where editing goes. Leaving it on a screen that says "you cannot edit
  // here" was the interface contradicting itself in two places at once.
  // Activate/deactivate stays: turning a published workflow on is an
  // operational act, and "view and run" covers it.
  const canPublish = can('workflows', 'publish') && !belowMd;
  const canActivate = can('workflows', 'publish');

  // ── server state ─────────────────────────────────────────────────────────
  const workflow = useQuery({
    queryKey: qk.workflow(workspaceId, workflowId),
    queryFn: () => workflowApi.get(workflowId),
  });
  const draft = useQuery({
    queryKey: qk.workflowDraft(workspaceId, workflowId),
    queryFn: () => workflowApi.draft(workflowId),
  });
  const nodes = useQuery({
    queryKey: qk.nodes(workspaceId),
    queryFn: () => nodeApi.list(),
    staleTime: 5 * 60_000,
  });
  const credentials = useQuery({
    queryKey: qk.credentials(workspaceId),
    queryFn: () => credentialApi.list(),
    staleTime: 60_000,
  });
  const trigger = useQuery({
    queryKey: qk.workflowTrigger(workspaceId, workflowId),
    queryFn: () => workflowApi.trigger(workflowId),
  });

  const definitions = React.useMemo(() => {
    const map: Record<string, NodeDefinition> = {};
    for (const node of nodes.data?.items ?? []) map[node.node_key] = node;
    return map;
  }, [nodes.data]);

  // ── canvas state ─────────────────────────────────────────────────────────
  const [graph, setGraph] = React.useState<WorkflowGraph | null>(null);
  const [revision, setRevision] = React.useState<number | null>(null);
  const [saveState, setSaveState] = React.useState<SaveState>('idle');
  const [selectedNodeId, setSelectedNodeId] = React.useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  // Whether the wide-screen rail is expanded. Reported by `PaletteRail` so the
  // labelled "add step" button can stand in while it is not.
  const [paletteRailOpen, setPaletteRailOpen] = React.useState(false);
  const [publishOpen, setPublishOpen] = React.useState(false);
  // One function, because the pair it replaces is exactly what went wrong the
  // first time: opening the rail without persisting it meant the rail a
  // first-time user opened was shut again on their next visit. A third caller
  // writing one and forgetting the other would reproduce that.
  const openStepPicker = React.useCallback(() => {
    if (belowXl) { setPaletteOpen(true); return; }
    rememberPaletteOpen(true);
    setPaletteRailOpen(true);
  }, [belowXl]);
  // Collapsed until there is something in it. Open, it is 290px of canvas
  // spent on the sentence "press Run to see data" -- which on a 900px window
  // is a third of the editor, before the user has anything to look at. It
  // opens itself when a run produces data (below).
  const [panelCollapsed, setPanelCollapsed] = React.useState(true);
  const [pickerTarget, setPickerTarget] = React.useState<string | null>(null);
  const [name, setName] = React.useState('');

  const undoStack = React.useRef<WorkflowGraph[]>([]);
  const redoStack = React.useRef<WorkflowGraph[]>([]);
  const canvasRef = React.useRef<CanvasHandle | null>(null);
  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingGraph = React.useRef<WorkflowGraph | null>(null);

  // Seed once per draft load. Re-seeding on every refetch would throw away
  // whatever the user has typed since.
  React.useEffect(() => {
    if (!draft.data) return;
    setGraph((current) => current ?? draft.data.graph);
    setRevision((current) => current ?? draft.data.revision);
  }, [draft.data]);

  React.useEffect(() => {
    if (workflow.data) setName((current) => current || workflow.data.name);
  }, [workflow.data]);

  const saveMutation = useMutation({
    mutationFn: async (payload: { graph: WorkflowGraph; revision: number }) =>
      workflowApi.saveDraft(workflowId, payload.graph, payload.revision),
    onSuccess: (result) => {
      setRevision(result.revision);
      setSaveState('saved');
      pendingGraph.current = null;
      // The summary carries `has_changes_since_publish` and the validation
      // badge, so it has to follow a save.
      void queryClient.invalidateQueries({
        queryKey: qk.workflow(workspaceId, workflowId),
      });
      void queryClient.invalidateQueries({
        queryKey: qk.workflowTrigger(workspaceId, workflowId),
      });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'DRAFT_VERSION_CONFLICT') {
        setSaveState('conflict');
        return;
      }
      setSaveState('error');
      toast.error(error instanceof Error ? error.message : String(error));
    },
  });

  const flush = React.useCallback(async () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const pending = pendingGraph.current;
    if (!pending || revision === null) return;
    setSaveState('saving');
    await saveMutation.mutateAsync({ graph: pending, revision });
  }, [revision, saveMutation]);

  const scheduleSave = React.useCallback((next: WorkflowGraph) => {
    pendingGraph.current = next;
    setSaveState('dirty');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void flush(); }, AUTOSAVE_DELAY_MS);
  }, [flush]);

  const applyGraph = React.useCallback((next: WorkflowGraph, options: { undoable?: boolean } = {}) => {
    if (!canEdit) return;
    setGraph((current) => {
      if (current && options.undoable !== false) {
        undoStack.current = [...undoStack.current.slice(-UNDO_LIMIT + 1), current];
        redoStack.current = [];
      }
      return next;
    });
    scheduleSave(next);
  }, [canEdit, scheduleSave]);

  const undo = React.useCallback(() => {
    const previous = undoStack.current.pop();
    if (!previous || !graph) return;
    redoStack.current = [...redoStack.current, graph];
    setGraph(previous);
    scheduleSave(previous);
  }, [graph, scheduleSave]);

  const redo = React.useCallback(() => {
    const next = redoStack.current.pop();
    if (!next || !graph) return;
    undoStack.current = [...undoStack.current, graph];
    setGraph(next);
    scheduleSave(next);
  }, [graph, scheduleSave]);

  // Keyboard: the shortcuts SRS 14.5 requires. Deliberately ignored while the
  // focus is in a text field, or typing "z" in a URL would undo the graph.
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && (
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'
        || target.isContentEditable
      );
      if (typing) return;
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if (meta && (event.key.toLowerCase() === 'y'
        || (event.shiftKey && event.key.toLowerCase() === 'z'))) {
        event.preventDefault();
        redo();
      } else if (meta && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void flush();
      } else if (event.key === 'f' && !meta) {
        canvasRef.current?.fitView();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flush, redo, undo]);

  // Leaving with an unsaved graph is a data-loss moment, so the browser asks.
  React.useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (pendingGraph.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  // ── execution ────────────────────────────────────────────────────────────
  const [executionId, setExecutionId] = React.useState<string | null>(null);

  const execution = useQuery<ExecutionDetail>({
    queryKey: qk.execution(workspaceId, executionId ?? 'none'),
    queryFn: () => executionApi.get(executionId!),
    enabled: Boolean(executionId),
    // Polling, not a socket: V1 is explicit that the browser polls the product
    // API and stops on a terminal state (SRS 36.4).
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (!status) return 1_500;
      return ['QUEUED', 'DISPATCHING', 'RUNNING', 'CANCEL_REQUESTED'].includes(status)
        ? 1_500
        : false;
    },
  });

  const runMutation = useMutation({
    mutationFn: async () => {
      // Flush first: a run must name a revision the server has (SRS 14.6).
      await flush();
      return workflowApi.run(workflowId, { kind: 'DRAFT' });
    },
    onSuccess: (created) => {
      setExecutionId(created.id);
      setPanelCollapsed(false);
      void queryClient.invalidateQueries({ queryKey: qk.executions(workspaceId) });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : String(error));
    },
  });

  const publishMutation = useMutation({
    mutationFn: async (options: { changeNote: string; activate: boolean }) => {
      await flush();
      const published = await workflowApi.publish(workflowId, {
        change_note: options.changeNote || undefined,
      });
      if (options.activate) {
        await workflowApi.activate(workflowId, published.version);
      }
      return published;
    },
    onSuccess: (published) => {
      setPublishOpen(false);
      toast.success(t('publish.success', { version: `v${published.version}` }));
      void queryClient.invalidateQueries({ queryKey: qk.workflow(workspaceId, workflowId) });
      void queryClient.invalidateQueries({
        queryKey: qk.workflowVersions(workspaceId, workflowId),
      });
      void queryClient.invalidateQueries({
        queryKey: qk.workflowTrigger(workspaceId, workflowId),
      });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : String(error), {
        description: error instanceof ApiError ? `trace: ${error.traceId}` : undefined,
      });
    },
  });

  const activateMutation = useMutation({
    mutationFn: (activate: boolean) =>
      activate ? workflowApi.activate(workflowId) : workflowApi.deactivate(workflowId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.workflow(workspaceId, workflowId) });
      void queryClient.invalidateQueries({
        queryKey: qk.workflowTrigger(workspaceId, workflowId),
      });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
  });

  const renameMutation = useMutation({
    mutationFn: (next: string) => workflowApi.update(workflowId, { name: next }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.workflow(workspaceId, workflowId) });
      void queryClient.invalidateQueries({ queryKey: qk.workflows(workspaceId) });
    },
  });

  const rotateSecretMutation = useMutation({
    mutationFn: () => workflowApi.rotateWebhookSecret(workflowId),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({
        queryKey: qk.workflowTrigger(workspaceId, workflowId),
      });
      // Shown once, in a toast that does not auto-dismiss: this is the only
      // moment the value is available.
      toast.success(t('trigger.webhookRotate'), {
        description: result.secret,
        duration: Number.POSITIVE_INFINITY,
      });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
  });

  // ── derived ──────────────────────────────────────────────────────────────
  const validation = workflow.data?.draft.validation ?? draft.data?.validation ?? null;
  const issues = validation?.issues ?? [];
  const errorCount = issues.filter((issue) => issue.severity === 'ERROR').length;
  const warningCount = issues.filter((issue) => issue.severity === 'WARNING').length;

  const runStatuses = React.useMemo(() => {
    const map: Record<string, {
      status: ExecutionDetail['nodes'][number]['status'];
      itemCount: number | null;
      durationMs: number | null;
    }> = {};
    for (const node of execution.data?.nodes ?? []) {
      map[node.node_id] = {
        status: node.status,
        itemCount: node.item_count,
        durationMs: node.duration_ms,
      };
    }
    return map;
  }, [execution.data]);

  const selectedNode = graph?.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const hasTrigger = (graph?.nodes ?? []).some(
    (node) => definitions[node.node_key]?.capability?.is_trigger);

  const addNode = (definition: NodeDefinition) => {
    if (!graph) return;
    const id = nextNodeId(graph, definition.node_key);
    const anchor = selectedNode ?? graph.nodes[graph.nodes.length - 1];
    const node: GraphNode = {
      id,
      node_key: definition.node_key,
      name: uniqueName(graph, definition.display_name),
      position: {
        x: (anchor?.position?.x ?? 100) + 260,
        y: anchor?.position?.y ?? 200,
      },
      config: defaultConfig(definition),
      product_schema_version: definition.product_schema_version,
    };

    // Wire it to whatever was selected, when the shapes allow it. Adding a step
    // almost always means "after this one", and making the user draw the edge
    // by hand every time is friction with no upside.
    const connections = [...(graph.connections ?? [])];
    if (anchor && inputPortsOf(definition).length > 0) {
      const anchorDefinition = definitions[anchor.node_key];
      const anchorOutputs = anchorDefinition?.capability?.output_ports_from === 'rules'
        ? []
        : (anchorDefinition?.capability?.output_ports ?? []).map((port) => String(port.key));
      const sourcePort = anchorOutputs[0];
      const alreadyUsed = sourcePort
        ? connections.some((connection) =>
          connection.from.node_id === anchor.id && connection.from.port === sourcePort)
        : true;
      if (sourcePort && !alreadyUsed) {
        connections.push({
          from: { node_id: anchor.id, port: sourcePort },
          to: { node_id: id, port: inputPortsOf(definition)[0] },
        });
      }
    }

    applyGraph({ nodes: [...graph.nodes, node], connections });
    setSelectedNodeId(id);
    setPaletteOpen(false);
  };

  const changeNode = (next: GraphNode) => {
    if (!graph) return;
    applyGraph({
      ...graph,
      nodes: graph.nodes.map((node) => (node.id === next.id ? next : node)),
    });
  };

  const deleteNode = (nodeId: string) => {
    if (!graph) return;
    applyGraph({
      nodes: graph.nodes.filter((node) => node.id !== nodeId),
      connections: (graph.connections ?? []).filter(
        (connection) =>
          connection.from.node_id !== nodeId && connection.to.node_id !== nodeId),
    });
    if (selectedNodeId === nodeId) setSelectedNodeId(null);
  };

  const duplicateNode = (nodeId: string) => {
    if (!graph) return;
    const source = graph.nodes.find((node) => node.id === nodeId);
    if (!source) return;
    const definition = definitions[source.node_key];
    if (definition?.capability?.is_trigger) return;
    const id = nextNodeId(graph, source.node_key);
    applyGraph({
      ...graph,
      nodes: [...graph.nodes, {
        ...source,
        id,
        name: uniqueName(graph, `${source.name} copy`),
        position: {
          x: (source.position?.x ?? 0) + 40,
          y: (source.position?.y ?? 0) + 60,
        },
        config: JSON.parse(JSON.stringify(source.config ?? {})),
      }],
    });
    setSelectedNodeId(id);
  };

  const insertExpression = (path: string) => {
    if (!pickerTarget || !selectedNode) return;
    // The picker fills the field that asked for it, replacing whatever was
    // there: a half-typed expression is what the user was trying to escape.
    const config = { ...(selectedNode.config ?? {}) };
    config[pickerTarget] = `={{ ${path} }}`;
    changeNode({ ...selectedNode, config });
    setPickerTarget(null);
    toast.success(t('editor.expression'));
  };

  const reloadDraft = async () => {
    pendingGraph.current = null;
    undoStack.current = [];
    redoStack.current = [];
    const fresh = await queryClient.fetchQuery({
      queryKey: qk.workflowDraft(workspaceId, workflowId),
      queryFn: () => workflowApi.draft(workflowId),
      // `fetchQuery` honours the global `staleTime`, so without this the button
      // hands back the same cached draft it already has -- the banner clears,
      // nothing changes, and the next keystroke conflicts again. This is the
      // one place in the product that means "the server's copy, now".
      staleTime: 0,
    });
    setGraph(fresh.graph);
    setRevision(fresh.revision);
    setSaveState('idle');
  };

  if (workflow.isLoading || draft.isLoading || nodes.isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner label={t('common.loading')} />
      </div>
    );
  }
  if (workflow.error) {
    return (
      <div className="p-6">
        <ApiErrorCard error={workflow.error} context={{ workflowId }} />
      </div>
    );
  }
  if (!workflow.data || !graph) return null;

  const summary = workflow.data;
  const triggerDetail = trigger.data ?? summary.trigger_detail ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* ── header ────────────────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[rgb(var(--border-line))] bg-surface-1 px-3 py-2">
        <Link
          href="/workflows"
          className="inline-flex items-center gap-1 rounded px-1 py-1 text-caption text-text-tertiary transition-colors hover:text-text-primary"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t('editor.backToList')}
        </Link>

        <div className="min-w-[180px] max-w-[320px] flex-1">
          <Input
            size="sm"
            value={name}
            disabled={!canEdit}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => {
              const cleaned = name.trim();
              if (cleaned && cleaned !== summary.name) renameMutation.mutate(cleaned);
            }}
            className="border-transparent bg-transparent px-1.5 font-strong hover:border-[rgb(var(--border-line))]"
            aria-label={t('common.name')}
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <WorkflowStatusBadge status={summary.status} />
          {summary.active_version && (
            <Badge variant="outline" size="sm" pill={false}>
              v{summary.active_version}
            </Badge>
          )}
          {/* "Unpublished changes" is a warning about drift between the draft
              and what is live. On a workflow that has never been published
              there is nothing to have drifted from, and colouring a
              three-second-old workflow amber says something is wrong when
              nothing is. */}
          {summary.draft.has_changes_since_publish && summary.published && (
            <DraftChangesBadge label={t('workflows.draftChanges')} />
          )}
          {triggerDetail && (
            <TriggerBadge
              type={triggerDetail.trigger_type}
              enabled={triggerDetail.enabled}
              summary={triggerDetail.schedule?.summary}
            />
          )}
          <SaveIndicator state={saveState} />
        </div>

        {/* `flex-wrap` here as well as on the header.
            The header wrapped, this group did not, so on a 390px viewport the
            five actions overflowed the window and Run -- the one button the
            screen exists for -- was sliced down the middle by the right edge.
            A wrapping group costs a second row on a phone and loses nothing. */}
        <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
          <IconButton
            size="sm" variant="ghost" aria-label={t('editor.undo')}
            onClick={undo} disabled={!canEdit}
          >
            <Undo2 className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton
            size="sm" variant="ghost" aria-label={t('editor.redo')}
            onClick={redo} disabled={!canEdit}
          >
            <Redo2 className="h-3.5 w-3.5" />
          </IconButton>
          <Button
            size="sm" variant="ghost"
            leadingIcon={<History className="h-3.5 w-3.5" />}
            onClick={() => router.push(`/workflows/${workflowId}/versions`)}
            aria-label={t('workflows.versions')}
          >
            {/* Icon only below `sm`. Of the five actions this is the one
                nobody reaches for mid-edit, so its label is the first thing
                to give up when the row has to fit. */}
            <span className="hidden sm:inline">{t('workflows.versions')}</span>
          </Button>
          {canActivate && summary.published && (
            <Button
              size="sm"
              variant="secondary"
              loading={activateMutation.isPending}
              onClick={() => activateMutation.mutate(!triggerDetail?.enabled)}
            >
              {triggerDetail?.enabled ? t('workflows.deactivate') : t('workflows.activate')}
            </Button>
          )}
          {canPublish && (
            <Button
              size="sm"
              variant="secondary"
              leadingIcon={<Upload className="h-3.5 w-3.5" />}
              onClick={() => setPublishOpen(true)}
            >
              {t('workflows.publish')}
            </Button>
          )}
          {canRun && (
            <Button
              size="sm"
              variant="primary"
              leadingIcon={
                runMutation.isPending || execution.data?.status === 'RUNNING'
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <Play className="h-3.5 w-3.5" />
              }
              disabled={runMutation.isPending || errorCount > 0}
              onClick={() => runMutation.mutate()}
              title={errorCount > 0 ? t('editor.validationIssues', { n: errorCount }) : undefined}
            >
              {t('workflows.run')}
            </Button>
          )}
        </div>
      </header>

      {editingBlockedByViewport && (
        <div className="flex items-center gap-2 border-b border-[rgb(var(--border-line))] bg-surface-2 px-3 py-2 text-caption text-text-secondary">
          <Eye className="h-3.5 w-3.5 flex-shrink-0" />
          <span className="min-w-0 flex-1">{t('editor.viewOnlyOnPhone')}</span>
        </div>
      )}

      {/* ── validation strip ──────────────────────────────────────────────── */}
      {(errorCount > 0 || warningCount > 0 || validation?.engine === 'UNAVAILABLE') && (
        <div
          className={cn(
            'flex items-center gap-2 border-b px-3 py-1.5 text-caption',
            errorCount > 0
              ? 'border-danger/25 bg-danger/[0.05] text-danger'
              : 'border-warning/25 bg-warning/[0.06] text-warning',
          )}
        >
          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            {errorCount > 0
              ? issues.find((issue) => issue.severity === 'ERROR')?.message
              : validation?.engine === 'UNAVAILABLE'
                ? t('editor.engineUnavailable')
                : issues.find((issue) => issue.severity === 'WARNING')?.message}
          </span>
          {errorCount + warningCount > 1 && (
            <span className="text-tiny">
              {errorCount > 0
                ? t('editor.validationIssues', { n: errorCount })
                : t('editor.validationWarnings', { n: warningCount })}
            </span>
          )}
        </div>
      )}

      {saveState === 'conflict' && (
        <div className="flex items-center gap-3 border-b border-danger/25 bg-danger/[0.05] px-3 py-2">
          <AlertTriangle className="h-4 w-4 flex-shrink-0 text-danger" />
          <div className="min-w-0 flex-1">
            <p className="text-caption font-emphasis text-text-primary">
              {t('editor.conflictTitle')}
            </p>
            <p className="text-tiny text-text-secondary">{t('editor.conflictBody')}</p>
          </div>
          <Button size="xs" variant="primary" onClick={() => void reloadDraft()}>
            {t('common.reload')}
          </Button>
        </div>
      )}

      {/* ── workspace ─────────────────────────────────────────────────────── */}
      {/* Three columns on a desktop: palette, canvas, inspector. All three are
          visible at once and none of them covers the graph, which is the whole
          reason this stopped being two dialogs over a canvas. Below `xl` there
          is not room for three, so the palette and the inspector fall back to
          sheets -- see the modals at the bottom of this file. */}
      <div className="flex min-h-0 flex-1">
        {canEdit && !belowXl && (
          <PaletteRail
            label={t('editor.palette')}
            expandLabel={t('editor.paletteExpand')}
            collapseLabel={t('editor.paletteCollapse')}
            open={paletteRailOpen}
            onOpenChange={setPaletteRailOpen}
          >
            <NodePalette
              nodes={nodes.data?.items ?? []}
              onPick={addNode}
              hideTriggers={hasTrigger}
              className="h-full"
            />
          </PaletteRail>
        )}

        <div className="relative min-w-0 flex-1">
          <WorkflowCanvas
            graph={graph}
            definitions={definitions}
            runStatuses={runStatuses}
            issues={issues}
            selectedNodeId={selectedNodeId}
            onSelectNode={setSelectedNodeId}
            onGraphChange={applyGraph}
            readOnly={!canEdit}
            canvasRef={canvasRef}
          />

          {/* The one legible way to add a step, wherever the palette is not
              already showing its contents.

              Below `xl` that means the sheet. At `xl` and above it means the
              rail is collapsed -- which is its default, so this used to render
              nothing at all on a wide screen and leave a first-time user with
              an empty canvas, one trigger node, and an unlabelled `+` in the
              corner. The old reasoning ("on a wide screen the palette is
              already on screen") was true only for somebody who had opened it
              before. It is an overlay either way, so the canvas keeps its full
              width and `11-appearance.spec.ts` keeps its guarantee. */}
          {canEdit && (belowXl || !paletteRailOpen) && (
            <div className="absolute left-3 top-3 z-10">
              <Button
                size="sm"
                variant="primary"
                leadingIcon={<Plus className="h-3.5 w-3.5" />}
                onClick={openStepPicker}
              >
                {t('editor.addNode')}
              </Button>
            </div>
          )}
        </div>

        {/* Only while something is selected. Deselecting closes it and the
            canvas takes the width back. */}
        {!belowXl && selectedNode && (
        <InspectorAside
          label={t('editor.inspector')}
          expandLabel={t('editor.inspectorExpand')}
          collapseLabel={t('editor.inspectorCollapse')}
          resizeLabel={t('editor.inspectorResize')}
        >
          <NodeConfigPanel
            node={selectedNode}
            definition={selectedNode ? definitions[selectedNode.node_key] : undefined}
            credentials={credentials.data?.items ?? []}
            issues={issues}
            trigger={triggerDetail}
            readOnly={!canEdit}
            onChangeNode={changeNode}
            onDelete={deleteNode}
            onDuplicate={duplicateNode}
            onRotateSecret={
              triggerDetail?.webhook && canPublish
                ? () => rotateSecretMutation.mutate()
                : undefined
            }
            onRequestPicker={(fieldPath) => {
              setPickerTarget(fieldPath);
              setPanelCollapsed(false);
            }}
            className="flex-1"
          />
        </InspectorAside>
        )}
      </div>

      <ExecutionDataPanel
        execution={execution.data ?? null}
        selectedNodeId={selectedNodeId}
        onSelectNode={setSelectedNodeId}
        collapsed={panelCollapsed}
        onToggleCollapsed={() => setPanelCollapsed((value) => !value)}
        onPickExpression={pickerTarget ? insertExpression : undefined}
        workflowId={workflowId}
      />

      {/* Config panel as a sheet below xl, where a 380px column would leave no
          canvas. Gated on a measured viewport rather than an `xl:hidden`
          wrapper: `Modal` portals into `document.body`, so the class would
          style an empty wrapper and leave the sheet covering the canvas on
          every desktop. */}
      {selectedNode && belowXl && (
        <div>
          <Modal
            open={Boolean(selectedNodeId)}
            onClose={() => setSelectedNodeId(null)}
            title={selectedNode.name}
            size="lg"
          >
            {canEdit ? (
              <NodeConfigPanel
                node={selectedNode}
                definition={definitions[selectedNode.node_key]}
                credentials={credentials.data?.items ?? []}
                issues={issues}
                trigger={triggerDetail}
                readOnly={false}
                onChangeNode={changeNode}
                onDelete={deleteNode}
                onDuplicate={duplicateNode}
              />
            ) : (
              // Facts, not a form with every input greyed out. A disabled
              // field reads as "broken" or "you lack permission", and neither
              // is what a phone means by "open this on a computer to edit".
              <NodeReadOnlyDetail
                node={selectedNode}
                definition={definitions[selectedNode.node_key]}
                credentials={credentials.data?.items ?? []}
                issues={issues}
              />
            )}
          </Modal>
        </div>
      )}

      {/* The palette as a sheet, for the widths that cannot hold the rail.
          Gated on the measured viewport for the same reason as the config
          sheet above: `Modal` portals to `document.body`, so a responsive
          class here would style the wrapper and leave the dialog on screen. */}
      <Modal
        open={paletteOpen && belowXl}
        onClose={() => setPaletteOpen(false)}
        title={t('editor.palette')}
        size="md"
      >
        <div className="h-[420px]">
          <NodePalette
            nodes={nodes.data?.items ?? []}
            onPick={addNode}
            hideTriggers={hasTrigger}
            autoFocus
            className="h-full"
          />
        </div>
      </Modal>

      <PublishWorkflowDialog
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
        onConfirm={(options) => publishMutation.mutate(options)}
        workflow={summary}
        validation={validation}
        loading={publishMutation.isPending}
      />
    </div>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  const { t } = useI18n();
  if (state === 'saving') {
    return (
      <span className="inline-flex items-center gap-1 text-tiny text-text-tertiary">
        <Loader2 className="h-3 w-3 animate-spin" />
        {t('common.saving')}
      </span>
    );
  }
  if (state === 'saved') {
    return (
      <span className="inline-flex items-center gap-1 text-tiny text-success">
        <CheckCircle2 className="h-3 w-3" />
        {t('common.saved')}
      </span>
    );
  }
  if (state === 'dirty') {
    return (
      <span className="inline-flex items-center gap-1 text-tiny text-warning">
        <X className="h-3 w-3" />
        {t('editor.unsaved')}
      </span>
    );
  }
  if (state === 'error') {
    return (
      <span className="inline-flex items-center gap-1 text-tiny text-danger">
        <AlertTriangle className="h-3 w-3" />
        {t('common.errorTitle')}
      </span>
    );
  }
  return null;
}
