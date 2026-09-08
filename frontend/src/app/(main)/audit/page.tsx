'use client';

/**
 * Audit log (SRS 20).
 *
 * Append-only, and shown as such: no edit, no delete, no bulk action. The
 * before/after summaries are already sanitized server-side — nothing on this
 * screen can reveal a secret, because nothing that could was ever written.
 */

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { ScrollText } from 'lucide-react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Input';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/Feedback';
import { PageListLayout } from '@/components/layout/PageLayout';
import { opsApi } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { qk } from '@/lib/queryKeys';
import { useWorkspaceId } from '@/hooks/use-current-user';
import { useI18n } from '@/providers/LanguageProvider';

const RESOURCE_TYPES = ['WORKFLOW', 'EXECUTION', 'CREDENTIAL', 'MEMBER', 'WORKSPACE', 'NODE'];
const PAGE_SIZE = 50;

export default function AuditPage() {
  const { t, locale } = useI18n();
  const workspaceId = useWorkspaceId();
  const [resourceType, setResourceType] = React.useState('');
  const [offset, setOffset] = React.useState(0);

  const filters = {
    resource_type: resourceType || undefined,
    limit: PAGE_SIZE,
    offset,
  };
  const audit = useQuery({
    queryKey: qk.audit(workspaceId, filters),
    queryFn: () => opsApi.audit(filters),
  });

  const items = audit.data?.items ?? [];
  const page = audit.data?.page;

  return (
    <PageListLayout
      title={t('audit.title')}
      description={t('audit.description')}
      searchable={false}
      filters={
        <Select
          size="sm"
          value={resourceType}
          onChange={(event) => { setResourceType(event.target.value); setOffset(0); }}
          aria-label={t('audit.column.resource')}
        >
          <option value="">{t('audit.column.resource')}: {t('common.all')}</option>
          {RESOURCE_TYPES.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </Select>
      }
    >
      {audit.isLoading ? (
        <TableSkeleton rows={8} columns={5} />
      ) : audit.error ? (
        <ErrorState
          title={t('common.errorTitle')}
          error={audit.error}
          onRetry={() => void audit.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState icon={ScrollText} title={t('audit.emptyTitle')} />
      ) : (
        <>
          <div className="overflow-hidden rounded-lg border border-[rgb(var(--border-line))] bg-surface-1">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[rgb(var(--border-line))] text-left">
                  <Th>{t('audit.column.action')}</Th>
                  <Th>{t('audit.column.resource')}</Th>
                  <Th>{t('audit.column.actor')}</Th>
                  <Th>{t('audit.column.result')}</Th>
                  <Th>{t('common.created')}</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[rgb(var(--border-line))]">
                {items.map((event) => (
                  <tr key={event.id} className="align-top">
                    <Td>
                      <span className="font-mono text-tiny text-text-primary">
                        {event.action}
                      </span>
                      {(event.after_summary || event.before_summary) && (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-tiny text-text-quaternary hover:text-text-secondary">
                            {t('common.detail')}
                          </summary>
                          <pre className="mt-1 max-w-[420px] overflow-x-auto rounded-md bg-surface-2 p-2 font-mono text-tiny leading-relaxed text-text-tertiary">
                            {JSON.stringify(
                              {
                                before: event.before_summary ?? undefined,
                                after: event.after_summary ?? undefined,
                              },
                              null,
                              2,
                            )}
                          </pre>
                        </details>
                      )}
                    </Td>
                    <Td>
                      <span className="block text-caption text-text-secondary">
                        {event.resource_label ?? event.resource_type}
                      </span>
                      <span className="text-tiny text-text-quaternary">
                        {event.resource_type}
                      </span>
                    </Td>
                    <Td>
                      <span className="block text-caption text-text-secondary">
                        {event.actor_label ?? event.actor_type}
                      </span>
                      {event.ip_address && (
                        <span className="font-mono text-tiny text-text-quaternary">
                          {event.ip_address}
                        </span>
                      )}
                    </Td>
                    <Td>
                      <Badge
                        variant={event.result === 'SUCCESS' ? 'success' : 'danger'}
                        size="xs"
                      >
                        {event.result}
                      </Badge>
                    </Td>
                    <Td>
                      <span className="whitespace-nowrap text-tiny tabular-nums text-text-tertiary">
                        {formatDateTime(event.created_at, locale)}
                      </span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {page && (page.has_more || offset > 0) && (
            <div className="mt-3 flex items-center justify-between">
              <span className="text-tiny text-text-quaternary">
                {t('common.showing', {
                  n: `${offset + 1}–${offset + items.length}`,
                  total: page.total ?? items.length,
                })}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  size="xs"
                  variant="secondary"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                >
                  {t('common.prevPage')}
                </Button>
                <Button
                  size="xs"
                  variant="secondary"
                  disabled={!page.has_more}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                >
                  {t('common.nextPage')}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </PageListLayout>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return (
    <th className="px-4 py-2 text-tiny font-emphasis uppercase tracking-[0.08em] text-text-quaternary">
      {children}
    </th>
  );
}

function Td({ children }: { children?: React.ReactNode }) {
  return <td className="px-4 py-2.5">{children}</td>;
}
