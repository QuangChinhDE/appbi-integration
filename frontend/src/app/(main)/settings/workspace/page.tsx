'use client';

/**
 * Workspace settings (SRS 10.3).
 *
 * The timezone is the one that matters: schedules are computed in it, so
 * changing it changes when every scheduled workflow in this workspace fires.
 * The field says so rather than leaving the user to discover it.
 */

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { Button } from '@/components/ui/Button';
import { Field, FieldHelp, Input, Label, Select } from '@/components/ui/Input';
import { ErrorState, Spinner } from '@/components/ui/Feedback';
import { SettingsTabs } from '@/components/layout/SettingsTabs';
import { Card, DetailBody } from '@/components/layout/PageLayout';
import { workspaceApi } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { qk } from '@/lib/queryKeys';
import { useWorkspaceId } from '@/hooks/use-current-user';
import { usePermissions } from '@/hooks/use-permissions';
import { useI18n } from '@/providers/LanguageProvider';

const TIMEZONES = [
  'Asia/Bangkok', 'Asia/Ho_Chi_Minh', 'Asia/Singapore', 'Asia/Tokyo',
  'Asia/Kolkata', 'Europe/London', 'Europe/Berlin', 'America/New_York',
  'America/Los_Angeles', 'UTC',
];

export default function WorkspaceSettingsPage() {
  const { t, locale } = useI18n();
  const workspaceId = useWorkspaceId();
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const editable = can('settings', 'edit');

  const settings = useQuery({
    queryKey: qk.settings(workspaceId),
    queryFn: workspaceApi.settings,
  });

  const [name, setName] = React.useState('');
  const [timezone, setTimezone] = React.useState('');
  const [concurrency, setConcurrency] = React.useState<number | ''>('');

  React.useEffect(() => {
    if (!settings.data) return;
    setName((current) => current || settings.data.name);
    setTimezone((current) => current || settings.data.timezone);
    setConcurrency((current) =>
      current === '' ? settings.data.max_concurrent_executions : current);
  }, [settings.data]);

  const save = useMutation({
    mutationFn: () => workspaceApi.updateSettings({
      name: name.trim(),
      timezone,
      max_concurrent_executions: concurrency === '' ? undefined : Number(concurrency),
    }),
    onSuccess: () => {
      toast.success(t('common.saved'));
      void queryClient.invalidateQueries({ queryKey: qk.settings(workspaceId) });
      void queryClient.invalidateQueries({ queryKey: qk.me() });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
  });

  return (
    <>
      <div className="border-b border-[rgb(var(--border-line))] bg-surface-1 px-4 pt-5 sm:px-6 xl:px-8">
        <h1 className="text-h3 font-strong text-text-primary">{t('settings.title')}</h1>
        <div className="mt-3">
          <SettingsTabs />
        </div>
      </div>

      <DetailBody>
        {settings.isLoading ? (
          <Spinner label={t('common.loading')} />
        ) : settings.error ? (
          <ErrorState
            title={t('common.errorTitle')}
            error={settings.error}
            onRetry={() => void settings.refetch()}
          />
        ) : (
          <Card title={t('settings.workspace')} className="max-w-2xl">
            <div className="space-y-4">
              <Field>
                <Label required>{t('settings.workspaceName')}</Label>
                <Input
                  size="sm"
                  value={name}
                  disabled={!editable}
                  onChange={(event) => setName(event.target.value)}
                />
              </Field>

              <Field>
                <Label required>{t('settings.workspaceTimezone')}</Label>
                <Select
                  size="sm"
                  value={timezone}
                  disabled={!editable}
                  onChange={(event) => setTimezone(event.target.value)}
                >
                  {[...new Set([timezone, ...TIMEZONES])].filter(Boolean).map((zone) => (
                    <option key={zone} value={zone}>{zone}</option>
                  ))}
                </Select>
                <FieldHelp>{t('settings.workspaceTimezoneHelp')}</FieldHelp>
              </Field>

              <Field>
                <Label>{t('settings.concurrency')}</Label>
                <Input
                  size="sm"
                  type="number"
                  min={1}
                  max={100}
                  value={concurrency}
                  disabled={!editable}
                  onChange={(event) =>
                    setConcurrency(event.target.value === '' ? '' : Number(event.target.value))}
                />
                <FieldHelp>
                  {/* The per-workflow ceiling is separate and always 1 in V1:
                      two runs of one automation overlapping is almost never
                      wanted (SRS 30.3). */}
                  {locale === 'vi'
                    ? 'Giới hạn cho toàn workspace. Mỗi workflow vẫn chỉ chạy một lần tại một thời điểm.'
                    : 'A workspace-wide ceiling. Each workflow still runs one at a time.'}
                </FieldHelp>
              </Field>

              <div className="flex items-center justify-between border-t border-[rgb(var(--border-line))] pt-3">
                <span className="text-tiny text-text-quaternary">
                  {t('common.created')}: {formatDateTime(settings.data?.created_at, locale)}
                </span>
                {editable && (
                  <Button
                    variant="primary"
                    size="sm"
                    loading={save.isPending}
                    onClick={() => save.mutate()}
                  >
                    {t('common.save')}
                  </Button>
                )}
              </div>
            </div>
          </Card>
        )}
      </DetailBody>
    </>
  );
}
