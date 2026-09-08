'use client';

/**
 * Members and roles (SRS 4.2, 35).
 *
 * The role column is the whole screen. It is presented as one plain-language
 * level per person plus a flag on the powers that touch production or payloads
 * — printing nine action names per member is a wall of chips nobody reads.
 */

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Field, FieldHelp, Input, Label, Select } from '@/components/ui/Input';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/Feedback';
import { SettingsTabs } from '@/components/layout/SettingsTabs';
import { Card, DetailBody } from '@/components/layout/PageLayout';
import { ApiError, workspaceApi } from '@/lib/api';
import { formatRelative } from '@/lib/format';
import { qk } from '@/lib/queryKeys';
import { useWorkspaceId } from '@/hooks/use-current-user';
import { usePermissions } from '@/hooks/use-permissions';
import type { Member } from '@/lib/types';
import { useI18n } from '@/providers/LanguageProvider';

const ROLES = [
  'OWNER', 'AUTOMATION_ADMIN', 'AUTOMATION_BUILDER', 'OPERATOR', 'ANALYST', 'AUDITOR',
];

export default function AccessSettingsPage() {
  const { t, tf, locale } = useI18n();
  const workspaceId = useWorkspaceId();
  const queryClient = useQueryClient();
  const { can } = usePermissions();

  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [pendingRemove, setPendingRemove] = React.useState<Member | null>(null);

  const members = useQuery({
    queryKey: qk.members(workspaceId),
    queryFn: workspaceApi.members,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: qk.members(workspaceId) });
  };

  const updateRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: string }) =>
      workspaceApi.updateRole(id, role),
    onSuccess: invalidate,
    onError: (error) => {
      // The last-owner guard is the one refusal worth explaining: without it a
      // workspace can be left with nobody who can administer it.
      toast.error(error instanceof Error ? error.message : String(error), {
        description: error instanceof ApiError && error.code === 'LAST_OWNER'
          ? t('remediation.ASSIGN_ANOTHER_OWNER')
          : undefined,
      });
      invalidate();
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => workspaceApi.removeMember(id),
    onSuccess: () => {
      setPendingRemove(null);
      invalidate();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
  });

  const items = members.data?.items ?? [];

  return (
    <>
      <div className="border-b border-[rgb(var(--border-line))] bg-surface-1 px-4 pt-5 sm:px-6 xl:px-8">
        <h1 className="text-h3 font-strong text-text-primary">{t('settings.title')}</h1>
        <div className="mt-3">
          <SettingsTabs />
        </div>
      </div>

      <DetailBody>
        <Card
          title={t('settings.members')}
          padded={false}
          action={can('members', 'create') ? (
            <Button
              size="xs"
              variant="secondary"
              leadingIcon={<Plus className="h-3 w-3" />}
              onClick={() => setInviteOpen(true)}
            >
              {t('settings.invite')}
            </Button>
          ) : undefined}
        >
          {members.isLoading ? (
            <div className="p-4"><TableSkeleton rows={4} columns={4} /></div>
          ) : members.error ? (
            <div className="p-4">
              <ErrorState
                title={t('common.errorTitle')}
                error={members.error}
                onRetry={() => void members.refetch()}
              />
            </div>
          ) : items.length === 0 ? (
            <div className="p-4">
              <EmptyState icon={UserPlus} title={t('common.none')} compact />
            </div>
          ) : (
            <ul className="divide-y divide-[rgb(var(--border-line))]">
              {items.map((member) => (
                <li key={member.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-[200px] flex-1">
                    <p className="truncate text-caption font-emphasis text-text-primary">
                      {member.full_name}
                    </p>
                    <p className="truncate text-tiny text-text-tertiary">{member.email}</p>
                  </div>

                  <span className="text-tiny text-text-quaternary">
                    {member.last_login_at
                      ? formatRelative(member.last_login_at, locale)
                      : t('common.never')}
                  </span>

                  {!member.is_active && (
                    <Badge variant="neutral" size="xs">{t('status.INACTIVE')}</Badge>
                  )}

                  {can('members', 'edit') ? (
                    <Select
                      size="sm"
                      className="w-[200px]"
                      value={member.role}
                      onChange={(event) =>
                        updateRole.mutate({ id: member.id, role: event.target.value })}
                      aria-label={t('settings.role')}
                    >
                      {ROLES.map((role) => (
                        <option key={role} value={role}>
                          {tf([`role.${role}`], role)}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Badge variant="outline" size="sm">
                      {tf([`role.${member.role}`], member.role)}
                    </Badge>
                  )}

                  {can('members', 'delete') && (
                    <Button
                      size="xs"
                      variant="ghost"
                      className="text-danger hover:text-danger"
                      leadingIcon={<Trash2 className="h-3 w-3" />}
                      onClick={() => setPendingRemove(member)}
                    >
                      {t('common.remove')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </DetailBody>

      {inviteOpen && <InviteDialog onClose={() => setInviteOpen(false)} />}

      <ConfirmDialog
        open={Boolean(pendingRemove)}
        onClose={() => setPendingRemove(null)}
        onConfirm={() => pendingRemove && remove.mutate(pendingRemove.id)}
        title={t('settings.removeMember')}
        message={pendingRemove?.email ?? ''}
        confirmLabel={t('common.remove')}
        destructive
        loading={remove.isPending}
      />
    </>
  );
}

function InviteDialog({ onClose }: { onClose: () => void }) {
  const { t, tf } = useI18n();
  const workspaceId = useWorkspaceId();
  const queryClient = useQueryClient();

  const [email, setEmail] = React.useState('');
  const [fullName, setFullName] = React.useState('');
  const [role, setRole] = React.useState('AUTOMATION_BUILDER');
  const [password, setPassword] = React.useState('');

  const invite = useMutation({
    mutationFn: () => workspaceApi.invite({
      email: email.trim(),
      full_name: fullName.trim(),
      role,
      password,
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.members(workspaceId) });
      onClose();
    },
    onError: (error) => {
      const problems = error instanceof ApiError
        ? (error.details?.problems as string[] | undefined)
        : undefined;
      toast.error(error instanceof Error ? error.message : String(error), {
        description: problems?.join(' '),
      });
    },
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={t('settings.invite')}
      size="sm"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            size="sm"
            loading={invite.isPending}
            disabled={!email.trim() || !fullName.trim() || password.length < 12}
            onClick={() => invite.mutate()}
          >
            {t('settings.invite')}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <Field>
          <Label required>{t('auth.email')}</Label>
          <Input
            size="sm"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
        <Field>
          <Label required>{t('common.name')}</Label>
          <Input
            size="sm"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
          />
        </Field>
        <Field>
          <Label required>{t('settings.role')}</Label>
          <Select size="sm" value={role} onChange={(event) => setRole(event.target.value)}>
            {ROLES.map((option) => (
              <option key={option} value={option}>{tf([`role.${option}`], option)}</option>
            ))}
          </Select>
        </Field>
        <Field>
          <Label required>{t('settings.initialPassword')}</Label>
          <Input
            size="sm"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <FieldHelp>{t('settings.initialPasswordHelp')}</FieldHelp>
        </Field>
      </div>
    </Modal>
  );
}
