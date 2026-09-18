'use client';

/**
 * Credentials (SRS 12, 35.7).
 *
 * The whole screen is built around one rule: a secret goes in and never comes
 * back out. The form for an existing credential shows a masked hint and an
 * empty input, and an empty input means "leave it alone" — a form that could
 * erase a stored secret by being submitted would be a footgun.
 */

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, KeyRound, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Field, FieldHelp, Input, Label, Select } from '@/components/ui/Input';
import { Menu } from '@/components/ui/Menu';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/Feedback';
import { PageListLayout } from '@/components/layout/PageLayout';
import { ApiError, credentialApi } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { qk } from '@/lib/queryKeys';
import { useWorkspaceId } from '@/hooks/use-current-user';
import { usePermissions } from '@/hooks/use-permissions';
import type { Credential, CredentialTypeSpec } from '@/lib/types';
import { useI18n } from '@/providers/LanguageProvider';

export default function CredentialsPage() {
  const { t, locale } = useI18n();
  const workspaceId = useWorkspaceId();
  const queryClient = useQueryClient();
  const { can } = usePermissions();

  const [search, setSearch] = React.useState('');
  const [editing, setEditing] = React.useState<Credential | 'new' | null>(null);
  const [pendingDelete, setPendingDelete] = React.useState<Credential | null>(null);

  const credentials = useQuery({
    queryKey: qk.credentials(workspaceId, { q: search }),
    queryFn: () => credentialApi.list({ q: search || undefined }),
  });
  const types = useQuery({
    queryKey: qk.credentialTypes(),
    queryFn: credentialApi.types,
    staleTime: 10 * 60_000,
  });

  const remove = useMutation({
    mutationFn: (id: string) => credentialApi.remove(id),
    onSuccess: () => {
      setPendingDelete(null);
      void queryClient.invalidateQueries({ queryKey: qk.credentials(workspaceId) });
    },
    onError: (error) => {
      // A 409 carries the list of workflows that depend on it, which is the
      // only useful answer to "why can I not delete this".
      if (error instanceof ApiError && error.constraints?.length) {
        toast.error(error.message, {
          description: error.constraints.map((item) => item.name).join(', '),
        });
        return;
      }
      toast.error(error instanceof Error ? error.message : String(error));
    },
  });

  const items = credentials.data?.items ?? [];

  const createButton = can('credentials', 'create') ? (
    <Button
      variant="primary"
      size="sm"
      leadingIcon={<Plus className="h-3.5 w-3.5" />}
      onClick={() => setEditing('new')}
    >
      {t('credentials.new')}
    </Button>
  ) : null;

  return (
    <PageListLayout
      title={t('credentials.title')}
      description={t('credentials.description')}
      searchValue={search}
      onSearchChange={setSearch}
      action={createButton}
    >
      {credentials.isLoading ? (
        <TableSkeleton rows={4} columns={4} />
      ) : credentials.error ? (
        <ErrorState
          title={t('common.errorTitle')}
          error={credentials.error}
          onRetry={() => void credentials.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title={search ? t('common.noResults') : t('credentials.emptyTitle')}
          description={search
            ? undefined
            : t(createButton ? 'credentials.emptyBody' : 'credentials.emptyBodyReadOnly')}
          action={search ? undefined : createButton}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-[rgb(var(--border-line))] bg-surface-1">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[rgb(var(--border-line))] text-left">
                <Th>{t('common.name')}</Th>
                <Th>{t('credentials.column.type')}</Th>
                <Th>{t('common.status')}</Th>
                <Th>{t('credentials.column.lastTest')}</Th>
                <Th className="w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[rgb(var(--border-line))]">
              {items.map((credential) => (
                <tr key={credential.id} className="transition-colors hover:bg-surface-2/60">
                  <Td>
                    <button
                      type="button"
                      onClick={() => setEditing(credential)}
                      className="block min-w-0 text-left"
                    >
                      <span className="block truncate text-caption font-emphasis text-text-primary">
                        {credential.name}
                      </span>
                      <span className="block font-mono text-tiny text-text-quaternary">
                        {credential.secret.masked_hint ?? t('credentials.secretMissing')}
                      </span>
                    </button>
                  </Td>
                  <Td>
                    <span className="text-caption text-text-secondary">
                      {types.data?.items.find(
                        (spec) => spec.key === credential.credential_type)?.display_name
                        ?? credential.credential_type}
                    </span>
                  </Td>
                  <Td>
                    {credential.status === 'ACTIVE' ? (
                      <Badge variant="success" size="xs" dot>
                        {t('credentials.secretConfigured')}
                      </Badge>
                    ) : (
                      <Badge variant="danger" size="xs">
                        <AlertTriangle className="h-3 w-3" />
                        {t('credentials.statusInvalid')}
                      </Badge>
                    )}
                  </Td>
                  <Td>
                    <span className="text-tiny text-text-tertiary">
                      {credential.last_test_at
                        ? formatDateTime(credential.last_test_at, locale)
                        : t('common.never')}
                    </span>
                  </Td>
                  <Td>
                    <Menu
                      label={t('common.actions')}
                      items={[
                        ...(can('credentials', 'edit') ? [{
                          id: 'edit',
                          label: t('common.edit'),
                          onSelect: () => setEditing(credential),
                        }] : []),
                        ...(can('credentials', 'delete') ? [{
                          id: 'delete',
                          label: t('common.delete'),
                          icon: <Trash2 className="h-3.5 w-3.5" />,
                          destructive: true,
                          onSelect: () => setPendingDelete(credential),
                        }] : []),
                      ]}
                    />
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <CredentialDialog
          credential={editing === 'new' ? null : editing}
          types={types.data?.items ?? []}
          onClose={() => setEditing(null)}
        />
      )}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && remove.mutate(pendingDelete.id)}
        title={t('credentials.deleteTitle')}
        message={t('credentials.deleteBody')}
        confirmLabel={t('common.delete')}
        destructive
        loading={remove.isPending}
      />
    </PageListLayout>
  );
}

function CredentialDialog({
  credential, types, onClose,
}: {
  credential: Credential | null;
  types: CredentialTypeSpec[];
  onClose: () => void;
}) {
  const { t } = useI18n();
  const workspaceId = useWorkspaceId();
  const queryClient = useQueryClient();

  const [name, setName] = React.useState(credential?.name ?? '');
  const [type, setType] = React.useState(
    credential?.credential_type ?? types[0]?.key ?? 'BEARER');
  const [values, setValues] = React.useState<Record<string, string>>({});

  const spec = types.find((item) => item.key === type);

  const save = useMutation({
    mutationFn: () => {
      // Only fields the user actually typed are sent. An omitted secret means
      // unchanged on the server (SRS 12.4), which is what lets this same form
      // edit a credential whose value it cannot display.
      const data: Record<string, string> = {};
      for (const [key, value] of Object.entries(values)) {
        if (value.trim()) data[key] = value;
      }
      return credential
        ? credentialApi.update(credential.id, { name: name.trim(), data })
        : credentialApi.create({ name: name.trim(), credential_type: type, data });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.credentials(workspaceId) });
      onClose();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={credential ? credential.name : t('credentials.new')}
      size="md"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            loading={save.isPending}
            disabled={!name.trim()}
            onClick={() => save.mutate()}
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <Field>
          <Label required>{t('common.name')}</Label>
          <Input size="sm" value={name} onChange={(event) => setName(event.target.value)} />
        </Field>

        <Field>
          <Label required>{t('common.type')}</Label>
          <Select
            size="sm"
            value={type}
            // The type is fixed once created: changing it would leave the stored
            // secret shaped for a different kind of authentication.
            disabled={Boolean(credential)}
            onChange={(event) => { setType(event.target.value); setValues({}); }}
          >
            {types.map((item) => (
              <option key={item.key} value={item.key}>{item.display_name}</option>
            ))}
          </Select>
        </Field>

        {(spec?.config_schema.fields ?? []).map((field) => {
          const isSecret = field.type === 'secret'
            || (spec?.secret_fields ?? []).includes(field.key);
          const stored = credential?.public_metadata?.[field.key];
          return (
            <Field key={field.key}>
              <Label required={field.required && !credential}>{field.label}</Label>
              <Input
                size="sm"
                type={isSecret ? 'password' : 'text'}
                autoComplete="off"
                value={values[field.key] ?? (isSecret ? '' : stored ?? '')}
                placeholder={
                  isSecret && credential?.secret.configured
                    ? credential.secret.masked_hint ?? '••••••••'
                    : field.default !== undefined ? String(field.default) : undefined
                }
                onChange={(event) =>
                  setValues((current) => ({ ...current, [field.key]: event.target.value }))}
              />
              {isSecret && credential && <FieldHelp>{t('credentials.secretHelp')}</FieldHelp>}
            </Field>
          );
        })}

        {credential?.used_by && credential.used_by.length > 0 && (
          <div className="rounded-md border border-[rgb(var(--border-line))] bg-surface-2/50 p-2.5">
            <p className="text-tiny font-emphasis uppercase tracking-[0.08em] text-text-quaternary">
              {t('credentials.column.usedBy')}
            </p>
            <ul className="mt-1 space-y-0.5">
              {credential.used_by.map((use) => (
                <li key={`${use.type}-${use.id}`} className="text-tiny text-text-secondary">
                  {use.name}
                  {use.blocking && (
                    <span className="ml-1 text-warning">· {t('credentials.inUse')}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th
      className={`px-4 py-2 text-tiny font-emphasis uppercase tracking-[0.08em] text-text-quaternary ${className ?? ''}`}
    >
      {children}
    </th>
  );
}

function Td({ children }: { children?: React.ReactNode }) {
  return <td className="px-4 py-2.5 align-middle">{children}</td>;
}
