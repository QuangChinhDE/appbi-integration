'use client';

/**
 * Alerts (SRS 19).
 *
 * Two tabs because they answer different questions: the feed is "what happened",
 * the rules are "what should reach me". The cooldown is editable on the rule
 * screen because muting is the alternative when it is wrong — a rule that
 * floods gets turned off, and then it protects nothing.
 */

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Bell, Check } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Field, Input, Label, Toggle } from '@/components/ui/Input';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/Feedback';
import { Tabs } from '@/components/ui/Tabs';
import { Card, PageListLayout } from '@/components/layout/PageLayout';
import { opsApi } from '@/lib/api';
import { formatRelative } from '@/lib/format';
import { qk } from '@/lib/queryKeys';
import { useWorkspaceId } from '@/hooks/use-current-user';
import { usePermissions } from '@/hooks/use-permissions';
import { useUrlTab } from '@/hooks/use-url-tab';
import { useI18n } from '@/providers/LanguageProvider';

const EVENT_TYPES = [
  'EXECUTION_FAILED',
  'CONSECUTIVE_FAILURES',
  'CREDENTIAL_INVALID',
  'SCHEDULE_MISSED',
  'ENGINE_DEGRADED',
];

export default function AlertsPage() {
  const { t } = useI18n();
  const { tab, setTab } = useUrlTab(['feed', 'rules'] as const, 'feed');

  return (
    <PageListLayout
      title={t('alerts.title')}
      description={t('alerts.description')}
      searchable={false}
    >
      <Tabs
        items={[
          { id: 'feed', label: t('alerts.tabFeed') },
          { id: 'rules', label: t('alerts.tabRules') },
        ]}
        value={tab}
        onChange={(next) => setTab(next as 'feed' | 'rules')}
      />
      <div className="mt-3.5">
        {tab === 'feed' ? <Feed /> : <Rules />}
      </div>
    </PageListLayout>
  );
}

function Feed() {
  const { t, locale } = useI18n();
  const workspaceId = useWorkspaceId();
  const queryClient = useQueryClient();
  const { can } = usePermissions();

  const notifications = useQuery({
    queryKey: qk.notifications(workspaceId),
    queryFn: () => opsApi.notifications({ limit: 50 }),
    refetchInterval: 30_000,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: qk.notifications(workspaceId) });
    void queryClient.invalidateQueries({ queryKey: qk.unread(workspaceId) });
  };

  const acknowledge = useMutation({
    mutationFn: (id: string) => opsApi.acknowledge(id),
    onSuccess: invalidate,
  });
  const acknowledgeAll = useMutation({
    mutationFn: () => opsApi.acknowledgeAll(),
    onSuccess: invalidate,
  });

  const items = notifications.data?.items ?? [];
  const unread = items.filter((item) => item.status === 'UNREAD');

  if (notifications.isLoading) return <TableSkeleton rows={5} columns={3} />;
  if (notifications.error) {
    return (
      <ErrorState
        title={t('common.errorTitle')}
        error={notifications.error}
        onRetry={() => void notifications.refetch()}
      />
    );
  }
  if (items.length === 0) {
    return (
      <EmptyState
        icon={Bell}
        title={t('alerts.emptyTitle')}
        description={t('alerts.emptyBody')}
      />
    );
  }

  return (
    <div className="space-y-3">
      {unread.length > 0 && can('alerts', 'execute') && (
        <div className="flex justify-end">
          <Button
            size="xs"
            variant="secondary"
            leadingIcon={<Check className="h-3 w-3" />}
            loading={acknowledgeAll.isPending}
            onClick={() => acknowledgeAll.mutate()}
          >
            {t('alerts.acknowledgeAll')}
          </Button>
        </div>
      )}

      <ul className="space-y-2">
        {items.map((notification) => (
          <li
            key={notification.id}
            className={`rounded-lg border p-3 ${
              notification.status === 'UNREAD'
                ? 'border-danger/25 bg-danger/[0.04]'
                : 'border-[rgb(var(--border-line))] bg-surface-1'
            }`}
          >
            <div className="flex items-start gap-2.5">
              <AlertTriangle
                className={`mt-0.5 h-4 w-4 flex-shrink-0 ${
                  notification.severity === 'CRITICAL' ? 'text-danger' : 'text-warning'
                }`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="text-caption font-emphasis text-text-primary">
                    {notification.title}
                  </p>
                  <Badge variant="subtle" size="xs">{notification.event_type}</Badge>
                </div>
                {notification.body && (
                  <p className="mt-0.5 text-caption leading-relaxed text-text-secondary">
                    {notification.body}
                  </p>
                )}
                <div className="mt-1.5 flex flex-wrap items-center gap-3">
                  <span className="text-tiny text-text-quaternary">
                    {formatRelative(notification.created_at, locale)}
                  </span>
                  {notification.execution_id && (
                    <Link
                      href={`/executions/${notification.execution_id}`}
                      className="text-tiny text-brand hover:underline"
                    >
                      {t('remediation.VIEW_EXECUTION')}
                    </Link>
                  )}
                  {notification.workflow_id && (
                    <Link
                      href={`/workflows/${notification.workflow_id}`}
                      className="text-tiny text-brand hover:underline"
                    >
                      {t('remediation.OPEN_WORKFLOW')}
                    </Link>
                  )}
                </div>
              </div>
              {notification.status === 'UNREAD' && can('alerts', 'execute') && (
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => acknowledge.mutate(notification.id)}
                >
                  {t('alerts.acknowledge')}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Rules() {
  const { t } = useI18n();
  const workspaceId = useWorkspaceId();
  const queryClient = useQueryClient();
  const { can } = usePermissions();

  const rules = useQuery({
    queryKey: qk.alertRules(workspaceId),
    queryFn: opsApi.alertRules,
  });

  const upsert = useMutation({
    mutationFn: (body: {
      event_type: string; threshold?: number; cooldown_seconds?: number; enabled?: boolean;
    }) => opsApi.upsertAlertRule(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.alertRules(workspaceId) });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
  });

  if (rules.isLoading) return <TableSkeleton rows={4} columns={4} />;
  if (rules.error) {
    return (
      <ErrorState
        title={t('common.errorTitle')}
        error={rules.error}
        onRetry={() => void rules.refetch()}
      />
    );
  }

  const existing = new Map((rules.data?.items ?? []).map((rule) => [rule.event_type, rule]));

  return (
    <Card description={t('alerts.ruleHelp')} padded={false}>
      <ul className="divide-y divide-[rgb(var(--border-line))]">
        {EVENT_TYPES.map((eventType) => {
          const rule = existing.get(eventType);
          const counting = eventType === 'CONSECUTIVE_FAILURES';
          return (
            <li key={eventType} className="flex flex-wrap items-end gap-4 px-4 py-3">
              <div className="min-w-[220px] flex-1">
                <p className="text-caption font-emphasis text-text-primary">{eventType}</p>
                {/* An event with no rule still alerts when it is one of the
                    always-on kinds; saying so avoids the impression that
                    nothing is watching. */}
                {!rule && (
                  <p className="mt-0.5 text-tiny text-text-quaternary">
                    {['EXECUTION_FAILED', 'CREDENTIAL_INVALID'].includes(eventType)
                      ? t('alerts.enabled')
                      : t('common.none')}
                  </p>
                )}
              </div>

              {counting && (
                <Field className="w-[110px]">
                  <Label>{t('alerts.threshold')}</Label>
                  <Input
                    size="sm"
                    type="number"
                    min={1}
                    defaultValue={rule?.threshold ?? 3}
                    disabled={!can('alerts', 'edit')}
                    onBlur={(event) => upsert.mutate({
                      event_type: eventType,
                      threshold: Number(event.target.value),
                      cooldown_seconds: rule?.cooldown_seconds ?? 900,
                      enabled: rule?.enabled ?? true,
                    })}
                  />
                </Field>
              )}

              <Field className="w-[130px]">
                <Label>{t('alerts.cooldown')}</Label>
                <Input
                  size="sm"
                  type="number"
                  min={60}
                  step={60}
                  defaultValue={rule?.cooldown_seconds ?? 900}
                  disabled={!can('alerts', 'edit')}
                  onBlur={(event) => upsert.mutate({
                    event_type: eventType,
                    threshold: rule?.threshold ?? (counting ? 3 : 1),
                    cooldown_seconds: Number(event.target.value),
                    enabled: rule?.enabled ?? true,
                  })}
                />
              </Field>

              <Toggle
                checked={rule?.enabled ?? false}
                label={t('alerts.enabled')}
                hideLabel
                disabled={!can('alerts', 'edit')}
                onChange={(enabled) => upsert.mutate({
                  event_type: eventType,
                  threshold: rule?.threshold ?? (counting ? 3 : 1),
                  cooldown_seconds: rule?.cooldown_seconds ?? 900,
                  enabled,
                })}
              />
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
