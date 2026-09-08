'use client';

/**
 * The workflow canvas (SRS 14).
 *
 * Built on @xyflow/react, deliberately not on a copy of n8n's editor: the node
 * card, the ports and the status overlay are the product's own, drawn with
 * AppBI tokens (guardrail 20).
 *
 * The product graph is the source of truth. This component translates it to
 * flow nodes/edges for rendering and translates interactions back — it never
 * keeps a second version of the graph, because two representations of the same
 * thing is how a canvas and a saved draft drift apart.
 */

import * as React from 'react';
import {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react';
import { AlertTriangle, CheckCircle2, Loader2, XCircle } from 'lucide-react';

import { NodeIcon } from './NodeIcon';
import { useBelowMd } from '@/hooks/use-media-query';
import { cn } from '@/lib/utils';
import type {
  GraphConnection, GraphNode, NodeDefinition, NodeRunStatus, WorkflowGraph,
} from '@/lib/types';

import '@xyflow/react/dist/style.css';

type FlowNode = Node<CanvasNodeData>;

export interface CanvasNodeData extends Record<string, unknown> {
  node: GraphNode;
  definition: NodeDefinition | undefined;
  runStatus?: NodeRunStatus;
  itemCount?: number | null;
  durationMs?: number | null;
  hasError: boolean;
  hasWarning: boolean;
  outputPorts: string[];
  inputPorts: string[];
}

/**
 * The ports a node offers, given its configuration.
 *
 * Switch is why this is a function: its branches are named by the user, so its
 * handles only exist once its rules do (SRS 14.4).
 */
export function outputPortsOf(
  node: GraphNode,
  definition: NodeDefinition | undefined,
): string[] {
  const capability = definition?.capability;
  if (!capability) return ['main'];
  if (capability.output_ports_from === 'rules') {
    const rules = Array.isArray(node.config?.rules)
      ? (node.config.rules as { output_key?: string }[])
      : [];
    const keys = rules
      .map((rule) => String(rule?.output_key ?? '').trim())
      .filter(Boolean);
    if (node.config?.fallback === 'EXTRA_OUTPUT') keys.push('other');
    return keys;
  }
  return (capability.output_ports ?? []).map((port) => String(port.key));
}

export function inputPortsOf(definition: NodeDefinition | undefined): string[] {
  return (definition?.capability?.input_ports ?? []).map((port) => String(port.key));
}

const RUN_TONE: Record<NodeRunStatus, string> = {
  PENDING: 'border-[rgb(var(--border-strong))]',
  RUNNING: 'border-info shadow-[0_0_0_3px_rgb(37_99_235/0.15)]',
  SUCCEEDED: 'border-success/60',
  FAILED: 'border-danger shadow-[0_0_0_3px_rgb(220_38_38/0.12)]',
  SKIPPED: 'border-dashed border-[rgb(var(--border-strong))] opacity-60',
};

/**
 * The status stripe down the left edge of the card.
 *
 * A tinted hairline at 60% opacity is legible when you are looking for it and
 * invisible when you are scanning a graph of eight nodes for the one that
 * failed -- which is the only time the colour matters. Four pixels of solid
 * colour reads at a glance and at a distance, and it survives being the same
 * hue as the selection border, because selection is a ring and this is an
 * edge.
 *
 * Skipped is deliberately grey rather than a colour: a branch the condition
 * did not choose is not a warning, and drawing it in amber taught people to
 * treat a correct decision as a problem.
 */
const RUN_STRIPE: Record<NodeRunStatus, string> = {
  PENDING: 'bg-[rgb(var(--border-strong))]',
  RUNNING: 'bg-info',
  SUCCEEDED: 'bg-success',
  FAILED: 'bg-danger',
  SKIPPED: 'bg-[rgb(var(--border-strong))]',
};

const RUN_ICON: Record<NodeRunStatus, React.ReactNode> = {
  PENDING: null,
  RUNNING: <Loader2 className="h-3 w-3 animate-spin text-info" />,
  SUCCEEDED: <CheckCircle2 className="h-3 w-3 text-success" />,
  FAILED: <XCircle className="h-3 w-3 text-danger" />,
  SKIPPED: null,
};

/**
 * How far `fitView` may zoom *in*.
 *
 * Without a ceiling, a one-node workflow -- which is every workflow for its
 * first thirty seconds -- fits by scaling that node to fill the canvas, and a
 * 212px card renders half a metre wide. Capping at 1 means fit-to-view only
 * ever zooms out, which is what the control is for.
 */
const FIT_MAX_ZOOM = 1;

/**
 * How far `fitView` may zoom *out* on its own.
 *
 * A CSS transform scales text with everything else, so a 12px label renders at
 * 9px once the canvas has fitted a graph at 0.75. The 12px floor is a rule
 * about the interface; the canvas is a zoomable surface, like a map, and the
 * two need different answers.
 *
 * * **On a phone** the fit stops at 1. There is no comfortable zoom control
 *   under a thumb, the editor here is a viewer, and a graph auto-shrunk to
 *   0.72 with 9px labels is the defect this exists to prevent. A graph too
 *   wide for the screen is panned instead.
 * * **On a desktop** it may go to 0.5. Opening a six-step workflow and seeing
 *   three of them, because the fit was forbidden from zooming out, is worse
 *   than small labels the user can undo with one click of `+`. Below that the
 *   graph is a diagram rather than something to read, and fitting further
 *   helps nobody.
 *
 * Either way `minZoom` on the canvas stays 0.2: somebody who deliberately
 * zooms out to see the shape of a large graph has asked for small text.
 */
const FIT_MIN_ZOOM_PHONE = 1;
const FIT_MIN_ZOOM_DESKTOP = 0.5;

/**
 * The zoom a *selected* step is brought to.
 *
 * Fitting the whole graph is the right answer for "what is this workflow";
 * it is the wrong one for "I am working on this step", and the editor was
 * giving the first answer to both. Opening the inspector re-fitted six nodes
 * to 0.5 and left the step being configured too small to see.
 *
 * So selecting a step centres it at a size it can be read at, and the whole
 * graph stays reachable through the minimap and by panning. The floor is what
 * matters -- 0.85 keeps a 12px label above 10px, and one zoom step gets it to
 * 100% -- while the ceiling stops a single node filling the canvas.
 */
const FOCUS_MIN_ZOOM = 0.85;
const FOCUS_MAX_ZOOM = 1;

/**
 * Branch labels, for the nodes that have more than one way out.
 *
 * The port ids are `true` / `false` / `other`, which are the compiler's names
 * for them and were being printed straight onto the canvas at 10px. A person
 * reading a Vietnamese interface should not have to know that the false branch
 * of an IF is spelled `false`.
 *
 * Single-output nodes get no label at all: one unlabelled dot on a long chain
 * is quieter and there is nothing to disambiguate.
 */
const PORT_LABEL: Record<string, { text: string; tone: string }> = {
  true: { text: 'Đúng', tone: 'text-success bg-success/10' },
  false: { text: 'Sai', tone: 'text-danger bg-danger/10' },
  other: { text: 'Còn lại', tone: 'text-text-tertiary bg-surface-2' },
};

function WorkflowNodeCard({ data, selected }: NodeProps) {
  const payload = data as CanvasNodeData;
  const { node, definition, runStatus } = payload;
  const operation = summariseConfig(node, definition);

  return (
    <div
      // The run outcome as data, not only as a border colour. A colour is the
      // right thing for a person to read and the wrong thing for anything else
      // to depend on -- and a skipped branch that merely looks pending is the
      // sort of regression only an assertion catches.
      data-node-name={node.name}
      data-run-status={runStatus ?? 'NONE'}
      className={cn(
        // Narrower on a phone. 212px is 54% of a 390px screen, so two of them
        // and an edge cannot fit and the fit-to-view used to shrink the text
        // to make them. A compact card and a zoom floor of 1 are the same fix
        // approached from both ends.
        'relative w-[164px] overflow-hidden rounded-lg border bg-surface-1 sm:w-[212px]',
        'shadow-linear transition-shadow',
        selected
          ? 'border-brand shadow-focus-brand'
          : runStatus
            ? RUN_TONE[runStatus]
            : payload.hasError
              ? 'border-danger/60'
              : 'border-[rgb(var(--border-strong))]',
      )}
    >
      {/* The status stripe. Inside `overflow-hidden` so it follows the corner
          radius instead of squaring off the left edge. */}
      {(runStatus || payload.hasError) && (
        <span
          aria-hidden
          className={cn(
            'absolute left-0 top-0 h-full w-1',
            runStatus ? RUN_STRIPE[runStatus] : 'bg-danger',
          )}
        />
      )}
      {/* Inputs on the left. A node with no input port (a trigger) shows none,
          which is how the canvas says "nothing can come before this". */}
      {payload.inputPorts.map((port, index) => (
        <Handle
          key={`in-${port}`}
          id={port}
          type="target"
          position={Position.Left}
          style={{
            top: 24 + index * 18,
            width: 9,
            height: 9,
            background: 'rgb(var(--surface-1))',
            border: '2px solid rgb(var(--text-quaternary))',
          }}
        />
      ))}

      {/* `py-2` rather than `p-2.5`, and the stripe's width added to the left
          inset: the metadata line is 12px now instead of 10px, so the card
          grew, and the padding is where that is given back. */}
      <div className="flex items-start gap-2 py-2 pl-3 pr-2.5">
        <NodeIcon icon={definition?.icon} category={definition?.category} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-caption font-emphasis leading-tight text-text-primary">
            {node.name}
          </p>
          <p className="truncate text-tiny leading-tight text-text-tertiary">
            {operation ?? definition?.display_name ?? node.node_key}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          {runStatus && RUN_ICON[runStatus]}
          {payload.hasError && !runStatus && (
            <AlertTriangle className="h-3 w-3 text-danger" />
          )}
          {payload.hasWarning && !payload.hasError && !runStatus && (
            <AlertTriangle className="h-3 w-3 text-warning" />
          )}
        </div>
      </div>

      {(payload.itemCount !== undefined && payload.itemCount !== null) && (
        <div className="flex items-center justify-between border-t border-[rgb(var(--border-line))] py-0.5 pl-3 pr-2.5">
          <span className="text-tiny text-text-tertiary">
            {payload.itemCount} item
          </span>
          {payload.durationMs !== undefined && payload.durationMs !== null && (
            <span className="text-tiny tabular-nums text-text-tertiary">
              {payload.durationMs}ms
            </span>
          )}
        </div>
      )}

      {/* Outputs on the right, labelled when there is more than one. A single
          unlabelled dot is quieter and reads better on a long chain. */}
      {payload.outputPorts.map((port, index) => {
        const many = payload.outputPorts.length > 1;
        const top = many ? 22 + index * 22 : 24;
        const label = PORT_LABEL[port];
        return (
          <React.Fragment key={`out-${port}`}>
            {many && (
              <span
                data-port={port}
                className={cn(
                  'pointer-events-none absolute right-2 rounded-sm px-1',
                  'text-tiny font-emphasis leading-snug',
                  label?.tone ?? 'text-text-tertiary bg-surface-2',
                )}
                style={{ top: top - 9 }}
              >
                {label?.text ?? port}
              </span>
            )}
            <Handle
              id={port}
              type="source"
              position={Position.Right}
              style={{
                top,
                width: 9,
                height: 9,
                background: 'rgb(var(--brand))',
                border: '2px solid rgb(var(--surface-1))',
              }}
            />
          </React.Fragment>
        );
      })}
    </div>
  );
}

/** A one-line hint of what the node is configured to do. */
function summariseConfig(
  node: GraphNode,
  definition: NodeDefinition | undefined,
): string | null {
  const config = node.config ?? {};
  switch (node.node_key) {
    case 'http_request': {
      const method = String(config.method ?? 'GET');
      const url = String(config.url ?? '');
      if (!url) return method;
      const shown = url.replace(/^=/, '');
      return `${method} ${shown.length > 26 ? `${shown.slice(0, 26)}…` : shown}`;
    }
    case 'edit_fields': {
      const count = Array.isArray(config.assignments) ? config.assignments.length : 0;
      return count ? `${count} field` : definition?.display_name ?? null;
    }
    case 'if': {
      const count = Array.isArray(config.conditions) ? config.conditions.length : 0;
      return count ? `${count} điều kiện` : definition?.display_name ?? null;
    }
    case 'switch': {
      const count = Array.isArray(config.rules) ? config.rules.length : 0;
      return count ? `${count} nhánh` : definition?.display_name ?? null;
    }
    case 'merge':
      return String(config.mode ?? 'APPEND');
    case 'schedule_trigger':
      return String(config.schedule_type ?? 'INTERVAL');
    case 'webhook_trigger':
      return String(config.method ?? 'POST');
    default:
      return definition?.display_name ?? null;
  }
}

const NODE_TYPES = { product: WorkflowNodeCard };

function edgeId(connection: GraphConnection): string {
  return `${connection.from.node_id}:${connection.from.port}->${connection.to.node_id}:${connection.to.port}`;
}

export interface CanvasHandle {
  fitView: () => void;
}

function CanvasInner({
  graph, definitions, runStatuses, issues, selectedNodeId,
  onSelectNode, onGraphChange, onNodeDoubleClick, readOnly, canvasRef,
}: {
  graph: WorkflowGraph;
  definitions: Record<string, NodeDefinition>;
  runStatuses?: Record<string, { status: NodeRunStatus; itemCount: number | null; durationMs: number | null }>;
  issues?: { node_id: string | null; severity: string }[];
  selectedNodeId?: string | null;
  onSelectNode?: (nodeId: string | null) => void;
  onGraphChange?: (graph: WorkflowGraph) => void;
  onNodeDoubleClick?: (nodeId: string) => void;
  readOnly?: boolean;
  canvasRef?: React.MutableRefObject<CanvasHandle | null>;
}) {
  const flow = useReactFlow();
  const belowMd = useBelowMd();

  /**
   * Whether the person has moved the canvas themselves.
   *
   * Once they have, the product stops re-framing it. Re-fitting a view
   * somebody deliberately panned to is the most irritating thing a canvas can
   * do, so this is the line between "the layout changed under you, here is the
   * graph again" and "stop moving my screen".
   */
  const moved = React.useRef(false);

  /**
   * Re-fit when the canvas changes size, until the user takes over.
   *
   * Opening the inspector takes ~380px off the canvas, and the fit that ran at
   * `onInit` was computed against the wider one -- so selecting a step left
   * half the graph behind the panel. A `ResizeObserver` rather than a
   * dependency on the panel's state: the canvas does not know why it got
   * narrower, and this way a collapsing sidebar or a resized window is handled
   * by the same three lines.
   */
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return undefined;

    let frame = 0;
    const observer = new ResizeObserver(() => {
      if (moved.current) return;
      // Coalesced into one frame: a resize fires many times during a drag, and
      // fitting on each one is both wasteful and visibly jittery.
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { reframe(); });
    });
    observer.observe(element);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow, belowMd, selectedNodeId]);

  /**
   * Frame the canvas for whatever the person is doing.
   *
   * With a step selected, that step, at a size it can be read at. With
   * nothing selected, the whole graph. The distinction is the whole fix: the
   * canvas used to answer both with "fit everything", so opening the
   * inspector on a six-step workflow shrank the step being configured to 0.5.
   */
  const reframe = React.useCallback(() => {
    const focused = selectedNodeId
      ? flow.getNodes().find((item) => item.id === selectedNodeId)
      : undefined;

    if (focused) {
      void flow.fitView({
        nodes: [{ id: focused.id }],
        // Generous padding, so the neighbours either side stay in frame --
        // centring one card in an empty field loses the context that makes a
        // canvas worth having.
        padding: 1.6,
        minZoom: FOCUS_MIN_ZOOM,
        maxZoom: FOCUS_MAX_ZOOM,
        duration: 200,
      });
      return;
    }

    void flow.fitView({
      padding: 0.2,
      maxZoom: FIT_MAX_ZOOM,
      minZoom: belowMd ? FIT_MIN_ZOOM_PHONE : FIT_MIN_ZOOM_DESKTOP,
    });
  }, [belowMd, flow, selectedNodeId]);

  // Selecting a step reframes on it, unless the person has taken the canvas
  // over themselves.
  React.useEffect(() => {
    if (moved.current || !selectedNodeId) return;
    reframe();
  }, [reframe, selectedNodeId]);

  const errorNodes = React.useMemo(
    () => new Set((issues ?? [])
      .filter((issue) => issue.severity === 'ERROR' && issue.node_id)
      .map((issue) => issue.node_id as string)),
    [issues],
  );
  const warningNodes = React.useMemo(
    () => new Set((issues ?? [])
      .filter((issue) => issue.severity === 'WARNING' && issue.node_id)
      .map((issue) => issue.node_id as string)),
    [issues],
  );

  const flowNodes: FlowNode[] = React.useMemo(
    () => (graph.nodes ?? []).map((node) => {
      const definition = definitions[node.node_key];
      const run = runStatuses?.[node.id];
      return {
        id: node.id,
        type: 'product',
        position: { x: node.position?.x ?? 0, y: node.position?.y ?? 0 },
        selected: node.id === selectedNodeId,
        data: {
          node,
          definition,
          runStatus: run?.status,
          itemCount: run?.itemCount ?? undefined,
          durationMs: run?.durationMs ?? undefined,
          hasError: errorNodes.has(node.id),
          hasWarning: warningNodes.has(node.id),
          outputPorts: outputPortsOf(node, definition),
          inputPorts: inputPortsOf(definition),
        },
      };
    }),
    [graph.nodes, definitions, runStatuses, selectedNodeId, errorNodes, warningNodes],
  );

  const flowEdges: Edge[] = React.useMemo(
    () => (graph.connections ?? []).map((connection) => ({
      id: edgeId(connection),
      source: connection.from.node_id,
      sourceHandle: connection.from.port,
      target: connection.to.node_id,
      targetHandle: connection.to.port,
      type: 'smoothstep',
      animated: false,
      style: {
        stroke: connection.from.port === 'false'
          ? 'rgb(var(--danger) / 0.55)'
          : connection.from.port === 'true'
            ? 'rgb(var(--success) / 0.55)'
            : 'rgb(var(--text-quaternary) / 0.65)',
        strokeWidth: 1.5,
      },
    })),
    [graph.connections],
  );

  const [nodes, setNodes, onNodesChangeInternal] = useNodesState(flowNodes);
  const [edges, setEdges, onEdgesChangeInternal] = useEdgesState(flowEdges);

  // The graph prop is authoritative. Re-seeding on every change keeps the
  // canvas from becoming a second source of truth that has to be reconciled.
  React.useEffect(() => { setNodes(flowNodes); }, [flowNodes, setNodes]);
  React.useEffect(() => { setEdges(flowEdges); }, [flowEdges, setEdges]);

  React.useEffect(() => {
    if (canvasRef) {
      canvasRef.current = {
        fitView: () => flow.fitView({ padding: 0.2, duration: 200, maxZoom: FIT_MAX_ZOOM }),
      };
    }
  }, [canvasRef, flow]);

  const commitPositions = React.useCallback((changes: NodeChange<FlowNode>[]) => {
    const moved = changes.filter(
      (change): change is NodeChange<FlowNode> & {
        type: 'position'; id: string; position?: { x: number; y: number }; dragging?: boolean;
      } => change.type === 'position' && 'dragging' in change && change.dragging === false,
    );
    if (moved.length === 0 || !onGraphChange) return;

    // Committed on drag end, not on every mouse move: autosave is debounced
    // downstream, and streaming a position change per frame would make the
    // undo stack useless.
    const positions = new Map(
      moved.map((change) => [change.id, change.position]),
    );
    onGraphChange({
      ...graph,
      nodes: (graph.nodes ?? []).map((node) => {
        const next = positions.get(node.id);
        return next ? { ...node, position: { x: Math.round(next.x), y: Math.round(next.y) } } : node;
      }),
    });
  }, [graph, onGraphChange]);

  const handleNodesChange = React.useCallback((changes: NodeChange<FlowNode>[]) => {
    onNodesChangeInternal(changes);
    if (readOnly) return;
    commitPositions(changes);

    const removed = changes
      .filter((change): change is NodeChange<FlowNode> & { type: 'remove'; id: string } =>
        change.type === 'remove')
      .map((change) => change.id);
    if (removed.length > 0 && onGraphChange) {
      onGraphChange({
        nodes: (graph.nodes ?? []).filter((node) => !removed.includes(node.id)),
        connections: (graph.connections ?? []).filter(
          (connection) =>
            !removed.includes(connection.from.node_id)
            && !removed.includes(connection.to.node_id),
        ),
      });
    }
  }, [commitPositions, graph, onGraphChange, onNodesChangeInternal, readOnly]);

  const handleEdgesChange = React.useCallback((changes: EdgeChange[]) => {
    onEdgesChangeInternal(changes);
    if (readOnly || !onGraphChange) return;
    const removed = changes
      .filter((change): change is EdgeChange & { type: 'remove'; id: string } =>
        change.type === 'remove')
      .map((change) => change.id);
    if (removed.length === 0) return;
    onGraphChange({
      ...graph,
      connections: (graph.connections ?? []).filter(
        (connection) => !removed.includes(edgeId(connection))),
    });
  }, [graph, onEdgesChangeInternal, onGraphChange, readOnly]);

  /**
   * Whether a proposed connection is allowed.
   *
   * Checked here as well as on the server: the canvas should refuse to draw an
   * edge the backend would reject, rather than letting the user find out at
   * save time (SRS 14.4).
   */
  const isValidConnection = React.useCallback((connection: Connection | Edge) => {
    const source = (graph.nodes ?? []).find((node) => node.id === connection.source);
    const target = (graph.nodes ?? []).find((node) => node.id === connection.target);
    if (!source || !target || source.id === target.id) return false;

    const outputs = outputPortsOf(source, definitions[source.node_key]);
    const inputs = inputPortsOf(definitions[target.node_key]);
    if (inputs.length === 0) return false;
    if (connection.sourceHandle && !outputs.includes(connection.sourceHandle)) return false;
    if (connection.targetHandle && !inputs.includes(connection.targetHandle)) return false;

    // A cycle would run forever: V1 has no loop node and no iteration limit.
    const adjacency = new Map<string, string[]>();
    for (const edge of graph.connections ?? []) {
      const list = adjacency.get(edge.from.node_id) ?? [];
      list.push(edge.to.node_id);
      adjacency.set(edge.from.node_id, list);
    }
    const seen = new Set<string>();
    const stack = [connection.target as string];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (current === connection.source) return false;
      if (seen.has(current)) continue;
      seen.add(current);
      stack.push(...(adjacency.get(current) ?? []));
    }
    return true;
  }, [definitions, graph]);

  const onConnect = React.useCallback((connection: Connection) => {
    if (readOnly || !onGraphChange) return;
    if (!isValidConnection(connection)) return;
    const next: GraphConnection = {
      from: {
        node_id: connection.source as string,
        port: connection.sourceHandle ?? 'main',
      },
      to: {
        node_id: connection.target as string,
        port: connection.targetHandle ?? 'main',
      },
    };
    const exists = (graph.connections ?? []).some(
      (existing) => edgeId(existing) === edgeId(next));
    if (exists) return;
    setEdges((current) => addEdge(connection, current));
    onGraphChange({ ...graph, connections: [...(graph.connections ?? []), next] });
  }, [graph, isValidConnection, onGraphChange, readOnly, setEdges]);

  return (
    <ReactFlow
      // `ReactFlow` forwards its ref to the wrapper div, which is what the
      // ResizeObserver above watches.
      ref={containerRef}
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      onNodesChange={handleNodesChange}
      onEdgesChange={handleEdgesChange}
      onConnect={onConnect}
      isValidConnection={isValidConnection}
      onNodeClick={(_event, node) => onSelectNode?.(node.id)}
      onNodeDoubleClick={(_event, node) => onNodeDoubleClick?.(node.id)}
      onPaneClick={() => onSelectNode?.(null)}
      // A pan or a zoom the person started. `onMoveStart` fires for those and
      // not for a programmatic `fitView`, which is exactly the distinction
      // needed here.
      onMoveStart={(event) => { if (event) moved.current = true; }}
      // Fit on first paint so a saved workflow opens framed rather than at
      // whatever viewport the last one left behind.
      onInit={(instance) => {
        void instance.fitView({
          padding: 0.2,
          maxZoom: FIT_MAX_ZOOM,
          minZoom: belowMd ? FIT_MIN_ZOOM_PHONE : FIT_MIN_ZOOM_DESKTOP,
        });
      }}
      nodesDraggable={!readOnly}
      nodesConnectable={!readOnly}
      elementsSelectable
      deleteKeyCode={readOnly ? null : ['Backspace', 'Delete']}
      multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
      selectionOnDrag
      panOnScroll
      minZoom={0.2}
      maxZoom={2}
      proOptions={{ hideAttribution: false }}
      className="bg-surface-0"
    >
      <Background
        variant={BackgroundVariant.Dots}
        gap={16}
        size={1}
        color="rgb(var(--text-quaternary) / 0.28)"
      />
      <Controls
        showInteractive={false}
        className="!border !border-[rgb(var(--border-line))] !bg-surface-1 !shadow-linear"
      />
      {/* The whole graph, always, at a size that costs nothing.
          Selecting a step now zooms *to* it rather than fitting everything, so
          something has to keep answering "where am I in this workflow" -- and
          a minimap answers it without taking the canvas back. Hidden on a
          phone, where 140px of a 390px screen is not a fair trade and the
          canvas is a viewer anyway. */}
      {!belowMd && graph.nodes.length > 2 && (
        <MiniMap
          pannable
          zoomable
          ariaLabel={null}
          className="!border !border-[rgb(var(--border-line))] !bg-surface-1 !shadow-linear"
          maskColor="rgb(var(--surface-0) / 0.6)"
          nodeColor={(item) => (item.id === selectedNodeId
            ? 'rgb(var(--brand))'
            : 'rgb(var(--text-quaternary))')}
          style={{ width: 140, height: 92 }}
        />
      )}
    </ReactFlow>
  );
}

export function WorkflowCanvas(props: React.ComponentProps<typeof CanvasInner>) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
