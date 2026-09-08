'use client';

/**
 * The right-hand configuration panel (SRS 7.3).
 *
 * One node at a time: its name, its form, and — for a trigger — the facts a
 * person needs to actually use it (the webhook URL, the next three fire times).
 * Those live here rather than on a separate settings page because they are what
 * the user is checking while they configure the trigger.
 */

import * as React from 'react';
import { Copy, ExternalLink, KeyRound, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { DynamicNodeForm } from './DynamicNodeForm';
import { NodeIcon } from './NodeIcon';
import { Button, IconButton } from '@/components/ui/Button';
import { Field, Input, Label } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import type {
  Credential, GraphNode, NodeDefinition, TriggerDetail, ValidationIssue,
} from '@/lib/types';
import { useI18n } from '@/providers/LanguageProvider';

export function NodeConfigPanel({
  node, definition, credentials, issues, trigger, readOnly,
  onChangeNode, onDelete, onDuplicate, onRotateSecret, onRequestPicker, className,
}: {
  node: GraphNode | null;
  definition: NodeDefinition | undefined;
  credentials: Credential[];
  issues: ValidationIssue[];
  trigger?: TriggerDetail | null;
  readOnly?: boolean;
  onChangeNode: (node: GraphNode) => void;
  onDelete: (nodeId: string) => void;
  onDuplicate: (nodeId: string) => void;
  onRotateSecret?: () => void;
  onRequestPicker?: (fieldPath: string) => void;
  className?: string;
}) {
  const { t, locale } = useI18n();

  if (!node) {
    return (
      <div className={cn('flex items-center justify-center p-6', className)}>
        <p className="max-w-[220px] text-center text-caption leading-relaxed text-text-tertiary">
          {t('editor.noSelection')}
        </p>
      </div>
    );
  }

  const nodeIssues = issues.filter((issue) => issue.node_id === node.id);
  const fields = definition?.config_schema?.fields ?? [];
  const isTrigger = Boolean(definition?.capability?.is_trigger);

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div className="flex items-start gap-2 border-b border-[rgb(var(--border-line))] px-3.5 py-3">
        <NodeIcon icon={definition?.icon} category={definition?.category} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-caption font-strong text-text-primary">
            {definition?.display_name ?? node.node_key}
          </p>
          <p className="truncate text-tiny text-text-tertiary">
            {definition?.description}
          </p>
        </div>
        {!readOnly && (
          <div className="flex items-center gap-0.5">
            <IconButton
              size="xs"
              variant="ghost"
              aria-label={t('editor.duplicateNode')}
              onClick={() => onDuplicate(node.id)}
              disabled={isTrigger}
              title={isTrigger ? undefined : t('editor.duplicateNode')}
            >
              <Copy className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton
              size="xs"
              variant="ghost"
              aria-label={t('editor.deleteNode')}
              onClick={() => onDelete(node.id)}
              className="text-danger hover:text-danger"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </IconButton>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3.5 py-3.5">
        <Field>
          <Label required>{t('editor.nodeName')}</Label>
          <Input
            size="sm"
            value={node.name}
            disabled={readOnly}
            onChange={(event) => onChangeNode({ ...node, name: event.target.value })}
            invalid={nodeIssues.some((issue) => issue.code.startsWith('NODE_NAME'))}
          />
          {/* Not cosmetic: expressions address other nodes by name
              (`$node["Get customer"]`), so a rename changes what other steps
              refer to. */}
          <p className="mt-1 text-tiny leading-relaxed text-text-quaternary">
            {locale === 'vi'
              ? 'Biểu thức tham chiếu bước theo tên, nên đổi tên sẽ ảnh hưởng các bước dùng tên này.'
              : 'Expressions reference steps by name, so renaming affects steps that point here.'}
          </p>
        </Field>

        {fields.length > 0 ? (
          <DynamicNodeForm
            fields={fields}
            config={node.config ?? {}}
            onChange={(config) => onChangeNode({ ...node, config })}
            credentials={credentials}
            issues={nodeIssues}
            onRequestPicker={readOnly ? undefined : onRequestPicker}
          />
        ) : (
          <p className="text-caption text-text-tertiary">
            {t('common.none')}
          </p>
        )}

        {isTrigger && trigger && (
          <TriggerFacts trigger={trigger} onRotateSecret={onRotateSecret} />
        )}
      </div>
    </div>
  );
}

function TriggerFacts({
  trigger, onRotateSecret,
}: {
  trigger: TriggerDetail;
  onRotateSecret?: () => void;
}) {
  const { t, locale } = useI18n();

  // A manual trigger has no webhook and no schedule, so this panel had
  // nothing to put in its box -- and drew the box anyway. An empty bordered
  // rectangle under "Advanced" reads as a field that failed to load, which is
  // a worse thing to show than nothing at all.
  if (!trigger.webhook && !trigger.schedule) return null;

  return (
    <div className="space-y-3 rounded-lg border border-[rgb(var(--border-line))] bg-surface-2/40 p-3">
      {trigger.webhook && (
        <div className="space-y-1.5">
          <Label>{t('trigger.webhookUrl')}</Label>
          <div className="flex items-center gap-1.5">
            <code className="min-w-0 flex-1 truncate rounded-md bg-surface-1 px-2 py-1.5 font-mono text-tiny text-text-secondary">
              {trigger.webhook.url}
            </code>
            <IconButton
              size="xs"
              variant="ghost"
              aria-label={t('common.copy')}
              onClick={() => {
                void navigator.clipboard?.writeText(trigger.webhook!.url);
                toast.success(t('common.copied'));
              }}
            >
              <Copy className="h-3.5 w-3.5" />
            </IconButton>
          </div>
          <p className="text-tiny leading-relaxed text-text-quaternary">
            {t('trigger.webhookUrlHelp')}
          </p>

          <div className="flex items-center justify-between pt-1">
            <span className="inline-flex items-center gap-1.5 text-tiny text-text-tertiary">
              <KeyRound className="h-3 w-3" />
              {t('trigger.webhookSecret')}
              {trigger.webhook.secret_configured ? (
                <Badge variant="success" size="xs">
                  {t('trigger.webhookSecretConfigured')}
                </Badge>
              ) : (
                <Badge variant="neutral" size="xs">{t('common.none')}</Badge>
              )}
            </span>
            {onRotateSecret && (
              <Button
                size="xs"
                variant="ghost"
                leadingIcon={<RefreshCw className="h-3 w-3" />}
                onClick={onRotateSecret}
              >
                {t('trigger.webhookRotate')}
              </Button>
            )}
          </div>
          <p className="text-tiny leading-relaxed text-text-quaternary">
            {locale === 'vi'
              ? `Ký HMAC-SHA256 trên "timestamp.body" và gửi qua ${trigger.webhook.signature_header}.`
              : `Sign HMAC-SHA256 over "timestamp.body" and send it in ${trigger.webhook.signature_header}.`}
          </p>
        </div>
      )}

      {trigger.schedule && (
        <div className="space-y-1.5">
          <Label>{t('trigger.nextRuns')}</Label>
          <p className="text-caption text-text-secondary">{trigger.schedule.summary}</p>
          {trigger.enabled ? (
            <ul className="space-y-0.5">
              {trigger.schedule.next_runs.map((moment) => (
                <li key={moment} className="text-tiny tabular-nums text-text-tertiary">
                  {formatDateTime(moment, locale)}
                </li>
              ))}
            </ul>
          ) : (
            // The times are computed either way, but presenting them as if the
            // workflow will run would be a lie while the trigger is off.
            <p className="inline-flex items-center gap-1 text-tiny text-warning">
              <ExternalLink className="h-3 w-3" />
              {t('trigger.notActivated')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
