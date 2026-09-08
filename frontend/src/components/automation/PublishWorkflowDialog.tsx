'use client';

/**
 * The publish dialog (SRS 35.4).
 *
 * It exists to make one thing unmissable: publishing freezes a version, and
 * activating is a separate decision. The checkbox defaults to off — the product
 * does not activate on publish (SRS 35.4), and a dialog that silently pushed a
 * new version into production would make "publish to check it compiles"
 * dangerous.
 */

import * as React from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Field, Checkbox, FieldHelp, Label, Textarea } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import type { ValidationState, WorkflowSummary } from '@/lib/types';
import { useI18n } from '@/providers/LanguageProvider';

export function PublishWorkflowDialog({
  open, onClose, onConfirm, workflow, validation, loading,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (options: { changeNote: string; activate: boolean }) => void;
  workflow: WorkflowSummary | undefined;
  validation: ValidationState | null | undefined;
  loading?: boolean;
}) {
  const { t } = useI18n();
  const [changeNote, setChangeNote] = React.useState('');
  const [activate, setActivate] = React.useState(false);

  const nextVersion = (workflow?.published?.version ?? 0) + 1;
  const errors = (validation?.issues ?? []).filter((issue) => issue.severity === 'ERROR');
  const warnings = (validation?.issues ?? []).filter((issue) => issue.severity === 'WARNING');
  const blocked = errors.length > 0 || validation?.engine === 'UNAVAILABLE';

  React.useEffect(() => {
    if (open) {
      setChangeNote('');
      // Reset each time: an activate choice from a previous publish must not
      // silently carry into the next one.
      setActivate(false);
    }
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('publish.title')}
      description={t('publish.body', { version: `v${nextVersion}` })}
      size="md"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={loading}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            loading={loading}
            disabled={blocked}
            onClick={() => onConfirm({ changeNote, activate })}
          >
            {t('publish.confirm')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-[rgb(var(--border-line))] bg-surface-2/40 p-3">
          {errors.length > 0 ? (
            <div className="space-y-1.5">
              <p className="inline-flex items-center gap-1.5 text-caption font-emphasis text-danger">
                <AlertTriangle className="h-3.5 w-3.5" />
                {t('editor.validationIssues', { n: errors.length })}
              </p>
              <ul className="space-y-1">
                {errors.slice(0, 6).map((issue, index) => (
                  <li key={index} className="text-tiny leading-relaxed text-text-secondary">
                    · {issue.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : validation?.engine === 'UNAVAILABLE' ? (
            <p className="inline-flex items-center gap-1.5 text-caption text-warning">
              <AlertTriangle className="h-3.5 w-3.5" />
              {t('editor.engineUnavailable')}
            </p>
          ) : (
            <p className="inline-flex items-center gap-1.5 text-caption text-success">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {t('editor.validationOk')}
              {warnings.length > 0 && (
                <Badge variant="warning" size="xs">
                  {t('editor.validationWarnings', { n: warnings.length })}
                </Badge>
              )}
            </p>
          )}
        </div>

        <Field>
          <Label hint={t('common.optional')}>{t('publish.changeNote')}</Label>
          <Textarea
            rows={2}
            value={changeNote}
            onChange={(event) => setChangeNote(event.target.value)}
            placeholder={t('publish.changeNotePlaceholder')}
          />
        </Field>

        <div>
          <Checkbox
            checked={activate}
            onChange={setActivate}
            label={t('publish.activateAfter')}
          />
          <FieldHelp>{t('publish.activateHelp')}</FieldHelp>
          {activate && workflow?.trigger && workflow.trigger.type !== 'MANUAL' && (
            <p className="mt-1.5 text-tiny text-text-secondary">
              {t('publish.triggerImpact')}
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}
