'use client';

/**
 * Status presentation, in one place (SRS appendix B).
 *
 * Every badge pairs its colour with a word, and the run-state badges carry an
 * icon too. Status must never be conveyed by colour alone (SRS 40) — and
 * centralising the mapping is also what stops one screen calling a cancelled
 * run "failed" while another calls it "stopped".
 */

import * as React from 'react';
import {
  AlertTriangle, Ban, CheckCircle2, Clock, FileEdit, Globe, Loader2,
  MousePointerClick, Pause, PlugZap, TimerOff, XCircle,
} from 'lucide-react';

import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';
import type {
  Certification, ExecutionStatus, NodeRunStatus, TriggerType, WorkflowStatus,
} from '@/lib/types';
import { useI18n } from '@/providers/LanguageProvider';

const EXECUTION_TONE: Record<ExecutionStatus, BadgeVariant> = {
  QUEUED: 'neutral',
  DISPATCHING: 'info',
  RUNNING: 'info',
  SUCCEEDED: 'success',
  FAILED: 'danger',
  CANCEL_REQUESTED: 'warning',
  CANCELLED: 'neutral',
  TIMED_OUT: 'warning',
  FAILED_TO_START: 'danger',
  ENGINE_INTERRUPTED: 'danger',
};

const EXECUTION_ICON: Record<ExecutionStatus, React.ReactNode> = {
  QUEUED: <Clock className="h-3 w-3" />,
  DISPATCHING: <Loader2 className="h-3 w-3 animate-spin" />,
  RUNNING: <Loader2 className="h-3 w-3 animate-spin" />,
  SUCCEEDED: <CheckCircle2 className="h-3 w-3" />,
  FAILED: <XCircle className="h-3 w-3" />,
  CANCEL_REQUESTED: <Ban className="h-3 w-3" />,
  CANCELLED: <Ban className="h-3 w-3" />,
  TIMED_OUT: <TimerOff className="h-3 w-3" />,
  FAILED_TO_START: <XCircle className="h-3 w-3" />,
  ENGINE_INTERRUPTED: <PlugZap className="h-3 w-3" />,
};

export function ExecutionStatusBadge({
  status, size = 'sm',
}: {
  status: ExecutionStatus;
  size?: 'xs' | 'sm' | 'md';
}) {
  const { tf } = useI18n();
  return (
    <Badge variant={EXECUTION_TONE[status] ?? 'neutral'} size={size}>
      {EXECUTION_ICON[status]}
      {tf([`execution.${status}`], status)}
    </Badge>
  );
}

const NODE_TONE: Record<NodeRunStatus, BadgeVariant> = {
  PENDING: 'neutral',
  RUNNING: 'info',
  SUCCEEDED: 'success',
  FAILED: 'danger',
  SKIPPED: 'subtle',
};

export function NodeStatusBadge({ status }: { status: NodeRunStatus }) {
  const { tf } = useI18n();
  return (
    <Badge variant={NODE_TONE[status] ?? 'neutral'} size="xs">
      {tf([`node.${status}`], status)}
    </Badge>
  );
}

export function WorkflowStatusBadge({ status }: { status: WorkflowStatus }) {
  const { tf } = useI18n();
  const tone: BadgeVariant =
    status === 'ACTIVE' ? 'success' : status === 'DELETED' ? 'danger' : 'neutral';
  return (
    <Badge variant={tone} size="sm" dot>
      {tf([`status.${status}`], status)}
    </Badge>
  );
}

const HEALTH_TONE: Record<string, BadgeVariant> = {
  HEALTHY: 'success',
  RUNNING: 'info',
  WARNING: 'warning',
  ACTION_REQUIRED: 'danger',
  FAILED: 'danger',
  INACTIVE: 'neutral',
  DRAFT_ONLY: 'subtle',
  NEVER_RUN: 'subtle',
};

export function HealthBadge({
  level, label, title,
}: {
  level: string;
  label: string;
  title?: string;
}) {
  return (
    <Badge variant={HEALTH_TONE[level] ?? 'neutral'} size="sm" dot title={title}>
      {label}
    </Badge>
  );
}

const TRIGGER_ICON: Record<TriggerType, React.ReactNode> = {
  MANUAL: <MousePointerClick className="h-3 w-3" />,
  WEBHOOK: <Globe className="h-3 w-3" />,
  SCHEDULE: <Clock className="h-3 w-3" />,
};

export function TriggerBadge({
  type, enabled, summary,
}: {
  type: TriggerType;
  enabled?: boolean;
  summary?: string;
}) {
  const { tf } = useI18n();
  return (
    <Badge
      variant={enabled === false ? 'neutral' : 'brand'}
      size="sm"
      title={summary}
    >
      {TRIGGER_ICON[type]}
      {tf([`trigger.${type}`], type)}
      {enabled === false && <Pause className="h-3 w-3 opacity-70" />}
    </Badge>
  );
}

const CERTIFICATION_TONE: Record<Certification, BadgeVariant> = {
  SUPPORTED: 'success',
  BETA: 'warning',
  HIDDEN: 'subtle',
  BLOCKED: 'danger',
};

export function CertificationBadge({ certification }: { certification: Certification }) {
  const { tf } = useI18n();
  // SUPPORTED is the norm for the V1 set, so it is deliberately quiet: a badge
  // on every row of a table carries no information.
  if (certification === 'SUPPORTED') {
    return (
      <span className="text-tiny text-text-tertiary">
        {tf([`certification.${certification}`], certification)}
      </span>
    );
  }
  return (
    <Badge variant={CERTIFICATION_TONE[certification]} size="xs">
      {tf([`certification.${certification}`], certification)}
    </Badge>
  );
}

export function VersionBadge({
  kind, number, draftRevision,
}: {
  kind: 'DRAFT' | 'PUBLISHED';
  number?: number | null;
  draftRevision?: number | null;
}) {
  if (kind === 'PUBLISHED') {
    return (
      <Badge variant="outline" size="xs" pill={false}>
        v{number ?? '?'}
      </Badge>
    );
  }
  return (
    <Badge variant="subtle" size="xs" pill={false}
      title={draftRevision ? `revision ${draftRevision}` : undefined}>
      <FileEdit className="h-3 w-3" />
      draft
    </Badge>
  );
}

export function DraftChangesBadge({ label }: { label: string }) {
  return (
    <Badge variant="warning" size="xs">
      <AlertTriangle className="h-3 w-3" />
      {label}
    </Badge>
  );
}

/** A small monospace hash, for a graph or compiled hash. */
export function HashChip({ value, className }: { value: string; className?: string }) {
  if (!value) return null;
  return (
    <span
      title={value}
      className={cn(
        'inline-flex rounded-sm bg-surface-2 px-1.5 py-0.5 font-mono text-tiny text-text-tertiary',
        className,
      )}
    >
      {value.slice(0, 8)}
    </span>
  );
}
