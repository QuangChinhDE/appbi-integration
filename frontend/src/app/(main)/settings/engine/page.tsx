'use client';

/**
 * Engine and compatibility (SRS 35.9, 62).
 *
 * The one screen that admits an engine exists — and even here it shows versions
 * and certification, never an address (SRS 61). The drift section is the point:
 * a node the catalogue offers that the runtime cannot compile is a workflow
 * somebody will build and then fail to publish.
 */

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';

import { CertificationBadge } from '@/components/automation/StatusBadges';
import { Badge } from '@/components/ui/Badge';
import { ErrorState, Spinner } from '@/components/ui/Feedback';
import { SettingsTabs } from '@/components/layout/SettingsTabs';
import { Card, DetailBody } from '@/components/layout/PageLayout';
import { opsApi } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { useWorkspaceId } from '@/hooks/use-current-user';
import { usePermissions } from '@/hooks/use-permissions';
import { useI18n } from '@/providers/LanguageProvider';

export default function EngineSettingsPage() {
  const { t } = useI18n();
  const workspaceId = useWorkspaceId();
  const { isPlatformAdmin } = usePermissions();

  const status = useQuery({
    queryKey: qk.engine(workspaceId),
    queryFn: opsApi.engineStatus,
    refetchInterval: 30_000,
  });
  const compatibility = useQuery({
    queryKey: qk.compatibility(workspaceId),
    queryFn: opsApi.compatibility,
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
        <div className="max-w-4xl space-y-4">
          <Card title={t('engine.status')}>
            {status.isLoading ? (
              <Spinner label={t('common.loading')} />
            ) : status.error ? (
              <ErrorState
                title={t('common.errorTitle')}
                error={status.error}
                onRetry={() => void status.refetch()}
                compact
              />
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  {status.data?.operational ? (
                    <Badge variant="success" size="sm" dot>
                      <CheckCircle2 className="h-3 w-3" />
                      {status.data.status}
                    </Badge>
                  ) : (
                    <Badge variant="danger" size="sm" dot>
                      <XCircle className="h-3 w-3" />
                      {status.data?.status ?? 'OFFLINE'}
                    </Badge>
                  )}
                  {status.data?.latency_ms !== null && status.data?.latency_ms !== undefined && (
                    <span className="text-tiny tabular-nums text-text-quaternary">
                      {status.data.latency_ms}ms
                    </span>
                  )}
                </div>

                {status.data?.message && (
                  <p className="text-caption text-text-secondary">{status.data.message}</p>
                )}

                <dl className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
                  <Row label={t('engine.productVersion')} value={status.data?.product_version} />
                  <Row label={t('engine.version')} value={status.data?.engine_version} />
                  <Row
                    label={t('engine.contract')}
                    value={status.data?.adapter_contract_version}
                  />
                  <Row label={t('engine.compiler')} value={status.data?.compiler_version} />
                </dl>

                {isPlatformAdmin && (status.data?.loaded_nodes.length ?? 0) > 0 && (
                  <div>
                    <p className="text-tiny uppercase tracking-[0.08em] text-text-quaternary">
                      {t('engine.loadedNodes')}
                    </p>
                    <ul className="mt-1 flex flex-wrap gap-1">
                      {status.data!.loaded_nodes.map((node) => (
                        <li
                          key={node}
                          className="rounded-sm bg-surface-2 px-1.5 py-0.5 font-mono text-tiny text-text-tertiary"
                        >
                          {node}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </Card>

          {compatibility.data && (
            <>
              <Card title={t('engine.features')}>
                <ul className="flex flex-wrap gap-1.5">
                  {Object.entries(compatibility.data.engine.features).map(([key, on]) => (
                    <li key={key}>
                      {/* A capability that is off is stated, not hidden: these
                          are documented V1 decisions, not omissions. */}
                      <Badge variant={on ? 'success' : 'neutral'} size="xs">
                        {key}: {on ? 'on' : 'off'}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </Card>

              <Card title={t('engine.driftTitle')}>
                {compatibility.data.drift.product_only.length === 0
                  && compatibility.data.drift.engine_only.length === 0 ? (
                    <p className="inline-flex items-center gap-1.5 text-caption text-success">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {t('engine.driftNone')}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {compatibility.data.drift.product_only.length > 0 && (
                        <div>
                          <p className="inline-flex items-center gap-1.5 text-caption font-emphasis text-danger">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            {t('engine.productOnly')}
                          </p>
                          <p className="mt-0.5 font-mono text-tiny text-text-secondary">
                            {compatibility.data.drift.product_only.join(', ')}
                          </p>
                        </div>
                      )}
                      {compatibility.data.drift.engine_only.length > 0 && (
                        <div>
                          <p className="text-caption font-emphasis text-text-secondary">
                            {t('engine.engineOnly')}
                          </p>
                          <p className="mt-0.5 font-mono text-tiny text-text-tertiary">
                            {compatibility.data.drift.engine_only.join(', ')}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
              </Card>

              <Card title={t('engine.compatibility')} padded={false}>
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[rgb(var(--border-line))] text-left">
                      <Th>{t('common.name')}</Th>
                      <Th>{t('nodes.column.certification')}</Th>
                      <Th>{t('common.status')}</Th>
                      {isPlatformAdmin && <Th>engine binding</Th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[rgb(var(--border-line))]">
                    {compatibility.data.nodes.map((node) => (
                      <tr key={node.node_key}>
                        <Td>
                          <span className="text-caption text-text-primary">
                            {node.display_name}
                          </span>
                          <span className="ml-1.5 font-mono text-tiny text-text-quaternary">
                            {node.node_key}
                          </span>
                        </Td>
                        <Td><CertificationBadge certification={node.certification} /></Td>
                        <Td>
                          {node.engine_supported ? (
                            <Badge variant="success" size="xs">OK</Badge>
                          ) : (
                            <Badge variant="danger" size="xs">
                              <AlertTriangle className="h-3 w-3" />
                              {t('engine.productOnly')}
                            </Badge>
                          )}
                        </Td>
                        {isPlatformAdmin && (
                          <Td>
                            <span className="font-mono text-tiny text-text-tertiary">
                              {node.engine_binding
                                ? `${node.engine_binding.engine_node_type}@${node.engine_binding.engine_type_version}`
                                : '—'}
                            </span>
                          </Td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </>
          )}
        </div>
      </DetailBody>
    </>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-tiny text-text-quaternary">{label}</dt>
      <dd className="font-mono text-tiny text-text-secondary">{value ?? '—'}</dd>
    </div>
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
