import React from 'react'
import {
  ArrowLeft, ArrowRight, CheckCircle, Clock, Database,
  FolderKanban, Globe, Info, Loader2,
  Pause, Pencil, Play, RefreshCw, Square, Trash2, Workflow,
} from 'lucide-react'

import AppModalShell from '@packages/ui/src/components/common/AppModalShell'
import { Badge, Button, Empty, Progress, SpinCenter } from '@packages/ui/src/components/common/ui'
import { getAppMeta } from '@modules/apps/frontend/constants'
import {
  PIPELINE_STATUS_VARIANT, PIPELINE_STATUS_LABEL,
  RUN_STATUS_VARIANT, RUN_STATUS_LABEL, RUN_STATUS_PROGRESS,
  formatDateTime,
} from '../constants'


const RUN_STATUS_ICON = {
  completed: CheckCircle,
  failed: Info,
  running: Loader2,
  pending: Clock,
}

const RUN_STATUS_ICON_COLOR = {
  completed: 'text-success',
  failed: 'text-danger',
  running: 'text-info',
  pending: 'text-warning',
}

const WRITE_MODE_LABEL = {
  append: 'Append',
  replace: 'Replace',
  upsert: 'Upsert',
}


const ConfigField = ({ label, children }) => (
  <div>
    <div className="mb-0.5 text-[10px] font-emphasis uppercase tracking-wider text-text-quaternary">{label}</div>
    <div className="text-caption text-text-secondary">{children}</div>
  </div>
)

const ConfigColumn = ({ icon: Icon, label, children }) => (
  <div className="px-5 py-4">
    <div className="mb-3 flex items-center gap-1.5 text-text-tertiary">
      <Icon className="h-3.5 w-3.5" />
      <span className="text-tiny font-strong uppercase tracking-wider">{label}</span>
    </div>
    <div className="space-y-2">{children}</div>
  </div>
)


function PipelineDetailView({
  detailsPipeline,
  detailsRuns,
  detailsRecord,
  loadingDetails,
  onBack,
  onRefresh,
  onDelete,
  onStatusChange,
  onRun,
  onStop,
}) {
  const pipeline = detailsPipeline
  const sourceMeta = getAppMeta(pipeline?.source_connector_key)
  const destMeta = getAppMeta(pipeline?.dest_connector_key)
  const statusVariant = PIPELINE_STATUS_VARIANT[pipeline?.status] || 'neutral'
  const statusLabel = PIPELINE_STATUS_LABEL[pipeline?.status] || pipeline?.status || 'Unknown'
  const latestRun = detailsRuns?.[0]
  const hasRunningRun = detailsRuns?.some((r) => r.status === 'pending' || r.status === 'running')
  const canRun = Boolean(onRun) && !hasRunningRun && (pipeline?.status === 'draft' || pipeline?.status === 'active' || pipeline?.status === 'paused')
  const canStop = Boolean(onStop) && hasRunningRun

  // Auto-refresh while a run is in-flight so the UI streams log updates.
  React.useEffect(() => {
    if (!hasRunningRun || typeof onRefresh !== 'function') return undefined
    const timer = setInterval(() => { onRefresh() }, 3000)
    return () => clearInterval(timer)
  }, [hasRunningRun, onRefresh])

  const footer = (
    <div className="flex w-full items-center justify-between gap-3">
      <div>
        <Button variant="ghost" size="md" leadingIcon={<Trash2 className="h-4 w-4" />} onClick={onDelete} className="text-danger hover:bg-danger/10">
          Delete pipeline
        </Button>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          variant="secondary"
          size="md"
          onClick={onRefresh}
          disabled={loadingDetails}
          leadingIcon={loadingDetails ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        >
          Refresh
        </Button>
        {canRun && (
          <Button variant="primary" size="md" onClick={onRun} leadingIcon={<Play className="h-4 w-4" />}>
            Run now
          </Button>
        )}
        {canStop && (
          <Button variant="secondary" size="md" onClick={onStop} leadingIcon={<Square className="h-4 w-4" />} className="text-danger">
            Stop run
          </Button>
        )}
        {pipeline?.status === 'draft' && (
          <Button variant="primary" size="md" onClick={() => onStatusChange('active')} leadingIcon={<Play className="h-4 w-4" />}>
            Activate
          </Button>
        )}
        {pipeline?.status === 'active' && (
          <Button variant="secondary" size="md" onClick={() => onStatusChange('paused')} leadingIcon={<Pause className="h-4 w-4" />}>
            Pause
          </Button>
        )}
        {pipeline?.status === 'paused' && (
          <Button variant="primary" size="md" onClick={() => onStatusChange('active')} leadingIcon={<Play className="h-4 w-4" />}>
            Resume
          </Button>
        )}
      </div>
    </div>
  )

  return (
    <AppModalShell
      variant="page"
      onClose={onBack}
      leadingAction={(
        <Button variant="ghost" size="sm" onClick={onBack} leadingIcon={<ArrowLeft className="h-4 w-4" />}>
          Back
        </Button>
      )}
      title={pipeline?.name || detailsRecord?.name || 'Pipeline'}
      description={(
        <div className="flex flex-wrap items-center gap-2 text-caption text-text-tertiary">
          <span>{sourceMeta?.title || pipeline?.source_connector_key || '—'}</span>
          <ArrowRight className="h-3 w-3" />
          <span>{destMeta?.title || pipeline?.dest_connector_key || '—'}</span>
          {pipeline?.last_run_at && <span>· Last run {formatDateTime(pipeline.last_run_at)}</span>}
        </div>
      )}
      icon={<Workflow className="h-5 w-5" />}
      iconClassName="bg-surface-2 text-text-secondary"
      bodyClassName="px-4 py-6 sm:px-6 xl:px-8"
      footer={footer}
    >
      {loadingDetails ? (
        <div className="flex items-center justify-center py-20"><SpinCenter text="Loading..." /></div>
      ) : (
        <div className="flex flex-col gap-5">
          {/* ── Config overview card ── */}
          <div className="overflow-hidden rounded-xl border border-[rgb(var(--border-line))] bg-surface-1">
            <div className="border-b border-[rgb(var(--border-line))] bg-surface-2/40 px-6 pt-5 pb-4">
              <div className="flex flex-wrap items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
                  <Workflow className="h-6 w-6" />
                </div>
                <div className="min-w-0">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <h2 className="text-small font-strong leading-tight text-text-primary">
                      {pipeline?.name || <span className="italic text-text-quaternary">Untitled pipeline</span>}
                    </h2>
                    <Badge variant={statusVariant} size="sm">{statusLabel}</Badge>
                    <Badge variant="neutral" size="sm">{(pipeline?.bindings || []).length} binding(s)</Badge>
                    <Badge variant="neutral" size="sm">{pipeline?.schedule?.type || 'Manual'}</Badge>
                  </div>
                  <p className="text-caption text-text-tertiary">
                    <span className="font-emphasis" style={{ color: sourceMeta?.color || 'inherit' }}>{sourceMeta?.title || pipeline?.source_connector_key}</span>
                    <span className="mx-2 text-text-quaternary">→</span>
                    <span className="font-emphasis" style={{ color: destMeta?.color || 'inherit' }}>{destMeta?.title || pipeline?.dest_connector_key}</span>
                  </p>
                  {pipeline?.description && (
                    <p className="mt-1 text-tiny text-text-tertiary">{pipeline.description}</p>
                  )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 divide-x divide-y divide-[rgb(var(--border-line))] lg:grid-cols-4">
              <ConfigColumn icon={Globe} label="Source">
                <ConfigField label="App">
                  <span className="font-strong" style={{ color: sourceMeta?.color || 'inherit' }}>{sourceMeta?.title || pipeline?.source_connector_key || '-'}</span>
                </ConfigField>
                <ConfigField label="Credential">
                  <span className="break-all font-mono text-tiny">{pipeline?.source_credential_id || '-'}</span>
                </ConfigField>
                <ConfigField label="Bindings">
                  <span className="font-strong text-text-primary">{(pipeline?.bindings || []).length}</span>
                </ConfigField>
              </ConfigColumn>

              <ConfigColumn icon={Database} label="Destination">
                <ConfigField label="App">
                  <span className="font-strong" style={{ color: destMeta?.color || 'inherit' }}>{destMeta?.title || pipeline?.dest_connector_key || '-'}</span>
                </ConfigField>
                <ConfigField label="Credential">
                  <span className="break-all font-mono text-tiny">{pipeline?.dest_credential_id || '-'}</span>
                </ConfigField>
                <ConfigField label="Bindings">
                  <span className="font-strong text-text-primary">{(pipeline?.bindings || []).length}</span>
                </ConfigField>
              </ConfigColumn>

              <ConfigColumn icon={Clock} label="Schedule">
                <ConfigField label="Type">
                  <span className="font-strong text-text-primary capitalize">{pipeline?.schedule?.type || 'Manual'}</span>
                </ConfigField>
                {pipeline?.schedule?.type === 'interval' && (
                  <ConfigField label="Interval">Every {pipeline.schedule.interval_hours || 24} hour(s)</ConfigField>
                )}
                {pipeline?.schedule?.type === 'cron' && (
                  <ConfigField label="Cron">
                    <code className="rounded bg-surface-2 px-1 py-0.5 text-tiny">{pipeline.schedule.cron || '-'}</code>
                  </ConfigField>
                )}
                <div>
                  <div className="mb-1 text-[10px] font-emphasis uppercase tracking-wider text-text-quaternary">Status</div>
                  <Badge variant={statusVariant} size="sm">{statusLabel}</Badge>
                </div>
              </ConfigColumn>

              <ConfigColumn icon={FolderKanban} label="Info">
                <ConfigField label="Created">
                  <span className="text-tiny">{formatDateTime(pipeline?.created_at) || '-'}</span>
                </ConfigField>
                <ConfigField label="Updated">
                  <span className="text-tiny">{formatDateTime(pipeline?.updated_at) || '-'}</span>
                </ConfigField>
                {pipeline?.last_run_at && (
                  <ConfigField label="Last run">
                    <span className="text-tiny">{formatDateTime(pipeline.last_run_at)}</span>
                  </ConfigField>
                )}
              </ConfigColumn>
            </div>
          </div>

          {/* ── Bindings card ── */}
          {(pipeline?.bindings || []).length > 0 && (
            <div className="overflow-hidden rounded-xl border border-[rgb(var(--border-line))] bg-surface-1">
              <div className="border-b border-[rgb(var(--border-line))] px-6 py-4">
                <h3 className="text-caption font-strong text-text-primary">Stream bindings</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-[rgb(var(--border-line))]">
                  <thead className="bg-surface-2">
                    <tr>
                      <th className="px-6 py-3 text-left text-tiny font-emphasis uppercase tracking-[0.14em] text-text-quaternary">Source stream</th>
                      <th className="px-6 py-3 text-left text-tiny font-emphasis uppercase tracking-[0.14em] text-text-quaternary">Destination stream</th>
                      <th className="px-6 py-3 text-left text-tiny font-emphasis uppercase tracking-[0.14em] text-text-quaternary">Write mode</th>
                      <th className="px-6 py-3 text-left text-tiny font-emphasis uppercase tracking-[0.14em] text-text-quaternary">Field mapping</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[rgb(var(--border-line))]">
                    {pipeline.bindings.map((b, i) => (
                      <tr key={i} className="hover:bg-surface-2/70">
                        <td className="px-6 py-2 text-caption text-text-primary font-mono text-tiny">{b.source_stream_key}</td>
                        <td className="px-6 py-2 text-caption text-text-primary font-mono text-tiny">{b.dest_stream_key}</td>
                        <td className="px-6 py-2 text-caption text-text-tertiary">{WRITE_MODE_LABEL[b.write_mode] || b.write_mode}</td>
                        <td className="px-6 py-2 text-caption text-text-tertiary">
                          {b.field_mapping && Object.keys(b.field_mapping).length > 0
                            ? `${Object.keys(b.field_mapping).length} field(s)`
                            : 'auto'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Run history card ── */}
          <div className="overflow-hidden rounded-xl border border-[rgb(var(--border-line))] bg-surface-1">
            <div className="flex items-center justify-between border-b border-[rgb(var(--border-line))] px-6 py-4">
              <div>
                <h3 className="text-caption font-strong text-text-primary">Run history</h3>
                <p className="mt-0.5 text-tiny text-text-quaternary">
                  {detailsRuns.length > 0 ? `${detailsRuns.length} recent runs` : 'No runs yet'}
                  {pipeline?.last_run_at && <span className="ml-2">· Last: {formatDateTime(pipeline.last_run_at)}</span>}
                </p>
              </div>
            </div>

            {detailsRuns.length === 0 ? (
              <div className="py-16"><Empty description="No runs recorded" /></div>
            ) : (
              <div className="divide-y divide-[rgb(var(--border-line))]">
                {detailsRuns.map((run, index) => {
                  const isLatest = index === 0
                  const variant = RUN_STATUS_VARIANT[run.status] || 'neutral'
                  const StatusIcon = RUN_STATUS_ICON[run.status] || Info
                  const iconSpin = run.status === 'running' ? 'animate-spin' : ''
                  const percent = run.status === 'completed' || run.status === 'failed' ? 100 : run.status === 'running' ? 50 : 0

                  return (
                    <div
                      key={run.id}
                      className={`flex items-start gap-4 px-6 py-4 transition-colors hover:bg-surface-2/70 ${
                        isLatest ? 'border-l-2 border-l-brand' : 'border-l-2 border-l-transparent'
                      }`}
                    >
                      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-2 ${RUN_STATUS_ICON_COLOR[run.status] || 'text-text-tertiary'}`}>
                        <StatusIcon className={`h-4 w-4 ${iconSpin}`} />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="mb-1.5 flex flex-wrap items-center gap-2">
                          <Badge variant={variant} size="sm" dot>
                            {RUN_STATUS_LABEL[run.status] || run.status}
                          </Badge>
                          {isLatest && <Badge variant="brand" size="xs">Latest</Badge>}
                          <span className="text-tiny text-text-quaternary">{formatDateTime(run.started_at)}</span>
                          {run.completed_at && <span className="text-tiny text-text-quaternary">to {formatDateTime(run.completed_at)}</span>}
                        </div>

                        <div className="mb-1.5 flex items-center gap-3">
                          <div className="flex-1">
                            <Progress percent={percent} status={RUN_STATUS_PROGRESS[run.status] || 'normal'} size="small" />
                          </div>
                          <span className="w-8 shrink-0 text-right text-tiny font-strong text-text-secondary">{percent}%</span>
                        </div>

                        <div className="flex flex-wrap gap-x-4 text-tiny">
                          {run.records_read != null && (
                            <span className="text-text-secondary">{run.records_read} read</span>
                          )}
                          {run.records_written != null && (
                            <span className="text-text-secondary">{run.records_written} written</span>
                          )}
                          {run.error_count > 0 && (
                            <span className="text-danger">{run.error_count} error(s)</span>
                          )}
                        </div>

                        {run.error_message && (
                          <div className="mt-2 flex items-start gap-1.5 rounded-md bg-danger/10 px-3 py-2">
                            <Info className="mt-0.5 h-3 w-3 shrink-0 text-danger" />
                            <span className="text-tiny leading-relaxed text-danger">{run.error_message}</span>
                          </div>
                        )}

                        {isLatest && run.logs && (
                          <details className="mt-2 rounded-md bg-surface-2 px-3 py-2" open={run.status === 'running'}>
                            <summary className="cursor-pointer text-tiny font-emphasis text-text-tertiary">View logs</summary>
                            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-tiny leading-relaxed text-text-secondary">{run.logs}</pre>
                          </details>
                        )}
                      </div>

                      <div className="shrink-0 space-y-1 text-right">
                        <div className="text-tiny text-text-quaternary">{run.triggered_by || 'manual'}</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </AppModalShell>
  )
}

export default PipelineDetailView
