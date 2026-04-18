import React from 'react'
import {
  ArrowLeft, Globe, Cloud, Clock, FolderKanban, Pencil, RefreshCw, Play, Square, Trash2,
  Inbox, Building2, Headphones, CheckCircle, Info, Loader2,
} from 'lucide-react'
import AppModalShell from '@packages/ui/src/components/common/AppModalShell'
import { Alert, Badge, Button, Empty, Progress, SpinCenter } from '@packages/ui/src/components/common/ui'
import { APPS, APP_META, formatDateTime } from '../constants'

const RUN_STATUS_VARIANT = {
  completed: 'success',
  failed: 'danger',
  running: 'info',
  pending: 'warning',
}

const RUN_STATUS_PROGRESS = {
  completed: 'success',
  failed: 'exception',
  running: 'active',
  pending: 'normal',
}

const RUN_STATUS_LABEL = {
  completed: 'Completed',
  failed: 'Failed',
  running: 'Running',
  pending: 'Pending',
}

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

const appIcons = {
  request:  <Inbox className="w-4 h-4" />,
  workflow: <FolderKanban className="w-4 h-4" />,
  wework:   <Building2 className="w-4 h-4" />,
  service:  <Headphones className="w-4 h-4" />,
}

const BACKUP_TYPE_LABEL = {
  structured: 'Structured',
  unstructured: 'Files & Attachments',
  all: 'Complete',
}

function getHistoryRunProgressPercent(run) {
  const value = run?.execution_details?.progress_percent
  if (typeof value === 'number') return Math.max(0, Math.min(100, Math.round(value)))
  if (run?.status === 'completed' || run?.status === 'failed') return 100
  if (run?.status === 'running') return 15
  return 0
}

function getHistoryRunStepLabel(run) {
  if (run?.execution_details?.step_label) return run.execution_details.step_label
  if (run?.status === 'pending') return 'Queued'
  if (run?.status === 'running') return 'Running'
  if (run?.status === 'failed') return run?.error_message || 'Failed'
  return 'Completed'
}

function getHistoryRunSummary(run) {
  const d = run?.execution_details || {}
  if (d.app === 'service') return `${d.completed_services || 0}/${d.total_services || 0} services · ${d.total_tickets || 0} tickets · ${d.attachments_downloaded || 0} attachments`
  if (d.app === 'request') return `${d.completed_groups || 0}/${d.total_groups || 0} groups · ${d.total_requests || 0} requests`
  if (d.app === 'workflow') return `${d.completed_workflows || 0}/${d.total_workflows || 0} workflows · ${d.completed_jobs || 0}/${d.total_jobs || 0} jobs`
  if (d.app === 'wework') return `${d.completed_projects || 0}/${d.total_projects || 0} projects · ${d.completed_tasks || 0}/${d.total_tasks || 0} tasks`
  return d.structure_path || ''
}

function getDestinationIdentityLabel(auth = {}) {
  return auth.service_account_email || auth.client_email || auth.email || null
}

function ServiceArchiveNotice({ appId, destinationType }) {
  if (appId !== 'service' || destinationType !== 'gdrive') return null
  return (
    <Alert
      type="info"
      message="Old folder moves to Trash on re-run"
      description="Previous Service backup folder is trashed before the next run."
    />
  )
}

const ConfigField = ({ label, children }) => (
  <div>
    <div className="text-[10px] text-text-quaternary mb-0.5 uppercase tracking-wider font-emphasis">{label}</div>
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

const FlowDetailView = ({
  detailsFlow,
  detailsRuns,
  detailsFlowId,
  detailsFlowRecord,
  loadingFlowDetails,
  onBack,
  onEdit,
  onRefresh,
  onRun,
  onStop,
  onDelete,
  stoppingFlowId,
  canEdit,
  canConfigure,
  configurationBlockedMessage,
}) => {
  const source = detailsFlow?.source || {}
  const destination = detailsFlow?.destination || {}
  const auth = destination.auth || {}
  const schedule = detailsFlow?.schedule || {}
  const structure = detailsFlow?.structure || {}
  const meta = APP_META[source.app] || { color: '#64748b' }
  const icon = appIcons[source.app] || <Cloud className="w-4 h-4" />
  const appConfig = APPS[source.app] || {}
  const objectLabels = appConfig.objectLabels || {}
  const detailObjects = Array.isArray(structure.objects) ? structure.objects.map(id => objectLabels[id] || id) : []
  const supportsRun = ['request', 'service', 'workflow', 'wework'].includes(detailsFlowRecord?.app || source.app)
  const isPublished = detailsFlowRecord?.is_published === 1 || detailsFlow?.is_published === 1
  const runBlockedReason = detailsFlowRecord?.run_blocked_reason
  const isDraft = detailsFlow?.is_draft === 1
  const hasActiveRun = detailsRuns.some(run => ['pending', 'running'].includes(run.status))
    || ['pending', 'running'].includes(detailsFlow?.last_run_status || detailsFlowRecord?.last_run_status)
  const runDisabled = !supportsRun || !isPublished || Boolean(runBlockedReason) || hasActiveRun
  const isStopping = stoppingFlowId === (detailsFlowId || detailsFlowRecord?.id)

  const footer = (
    <div className="flex w-full items-center justify-between gap-3">
      <div>
        {canEdit && (
          <Button variant="ghost" size="md" leadingIcon={<Trash2 className="h-4 w-4" />} onClick={onDelete} className="text-danger hover:bg-danger/10">
            Delete flow
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          variant="secondary"
          size="md"
          onClick={onRefresh}
          disabled={loadingFlowDetails}
          leadingIcon={loadingFlowDetails ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        >
          Refresh
        </Button>
        {canConfigure && (
          <Button variant="secondary" size="md" onClick={onEdit} leadingIcon={<Pencil className="h-4 w-4" />}>
            Edit
          </Button>
        )}
        {canEdit && hasActiveRun && (
          <Button variant="danger" size="md" onClick={onStop} disabled={isStopping} leadingIcon={<Square className="h-4 w-4" />}>
            {isStopping ? 'Stopping…' : 'Stop run'}
          </Button>
        )}
        {canEdit && (
          <Button
            variant="primary"
            size="md"
            disabled={runDisabled}
            onClick={onRun}
            title={runBlockedReason || (hasActiveRun ? 'A backup is already running' : !supportsRun ? 'App type does not support run' : !isPublished ? 'Publish the flow first' : undefined)}
            leadingIcon={<Play className="h-4 w-4" />}
          >
            Run now
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
      title={detailsFlow?.name || detailsFlowRecord?.name || 'Backup flow'}
      description={(
        <div className="flex flex-wrap items-center gap-2 text-caption text-text-tertiary">
          <span>{source.app_name || source.app || 'Unknown source'}</span>
          {(destination.name || destination.type) && <span>· {destination.name || destination.type}</span>}
          {detailsFlow?.last_run_at && <span>· Last run {formatDateTime(detailsFlow.last_run_at)}</span>}
        </div>
      )}
      icon={React.cloneElement(icon, { className: 'h-5 w-5' })}
      iconClassName="bg-surface-2 text-text-secondary"
      bodyClassName="px-6 py-6 lg:px-8 xl:px-10"
      footer={footer}
    >
      {loadingFlowDetails ? (
        <div className="flex items-center justify-center py-20"><SpinCenter text="Loading…" /></div>
      ) : (
        <div className="flex flex-col gap-5">
          {/* Overview card */}
          <div className="overflow-hidden rounded-xl border border-[rgb(var(--border-line))] bg-surface-1">
            <div className="border-b border-[rgb(var(--border-line))] bg-surface-2/40 px-6 pt-5 pb-4">
              <div className="flex flex-wrap items-start gap-4">
                <div
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl"
                  style={{ backgroundColor: `${meta.color}1a`, color: meta.color }}
                >
                  <span className="scale-150">{icon}</span>
                </div>
                <div className="min-w-0">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <h2 className="text-small font-strong leading-tight text-text-primary">
                      {detailsFlow?.name || <span className="italic text-text-quaternary">Untitled draft</span>}
                    </h2>
                    <Badge variant={isDraft ? 'warning' : 'info'} size="sm">
                      {isDraft ? 'Draft' : 'Ready'}
                    </Badge>
                    <Badge variant={isPublished ? 'success' : 'neutral'} size="sm">
                      {isPublished ? 'Published' : 'Unpublished'}
                    </Badge>
                    {detailsFlow?.backup_type && (
                      <Badge variant="brand" size="sm">
                        {BACKUP_TYPE_LABEL[detailsFlow.backup_type] || detailsFlow.backup_type}
                      </Badge>
                    )}
                  </div>
                  <p className="text-caption text-text-tertiary">
                    <span className="font-emphasis" style={{ color: meta.color }}>{source.app_name || source.app || '—'}</span>
                    {source.domain && <span className="ml-2 font-mono text-tiny text-text-quaternary">· {source.domain}</span>}
                  </p>
                </div>
              </div>

              {runBlockedReason && (
                <div className="mt-3">
                  <Alert type="warning" message="Run blocked" description={runBlockedReason} />
                </div>
              )}

              {canEdit && !canConfigure && configurationBlockedMessage && (
                <div className="mt-3">
                  <Alert
                    type="warning"
                    message="Apps view required to edit"
                    description={configurationBlockedMessage}
                  />
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 divide-x divide-y divide-[rgb(var(--border-line))] lg:grid-cols-4">
              <ConfigColumn icon={Globe} label="Data source">
                <ConfigField label="App">
                  <span className="font-strong" style={{ color: meta.color }}>{source.app_name || source.app || '—'}</span>
                </ConfigField>
                <ConfigField label="Domain">
                  <span className="break-all font-mono text-tiny">{source.domain || '—'}</span>
                </ConfigField>
                <div>
                  <div className="text-[10px] text-text-quaternary mb-1 uppercase tracking-wider font-emphasis">Objects</div>
                  <div className="flex flex-wrap gap-1">
                    {detailObjects.length > 0
                      ? detailObjects.map(o => <Badge key={o} variant="brand" size="xs">{o}</Badge>)
                      : <span className="text-tiny text-text-quaternary">—</span>}
                  </div>
                </div>
              </ConfigColumn>

              <ConfigColumn icon={Cloud} label="Storage">
                <ConfigField label="Backup type">
                  <span className="font-strong text-text-primary">
                    {BACKUP_TYPE_LABEL[detailsFlow?.backup_type] || detailsFlow?.backup_type || '—'}
                  </span>
                </ConfigField>
                <ConfigField label="Destination">{destination.name || destination.type || '—'}</ConfigField>
                <ConfigField label="Account">
                  <span className="break-all text-tiny">{getDestinationIdentityLabel(auth) || '—'}</span>
                </ConfigField>
                <ConfigField label="Folder">
                  <span className="text-tiny">{auth.folder_name || auth.folder_id || <span className="text-text-quaternary">My Drive (default)</span>}</span>
                </ConfigField>
              </ConfigColumn>

              <ConfigColumn icon={Clock} label="Schedule">
                <ConfigField label="Type">
                  <span className="font-strong text-text-primary">{schedule.type || <span className="font-normal text-tiny text-text-quaternary">Manual</span>}</span>
                </ConfigField>
                {schedule.type && <ConfigField label="Time">{schedule.time || '—'}</ConfigField>}
                <div>
                  <div className="text-[10px] text-text-quaternary mb-1 uppercase tracking-wider font-emphasis">Status</div>
                  <Badge variant={schedule.enabled === false ? 'neutral' : 'success'} size="sm">
                    {schedule.enabled === false ? 'Disabled' : 'Enabled'}
                  </Badge>
                </div>
              </ConfigColumn>

              <ConfigColumn icon={FolderKanban} label="Info">
                <ConfigField label="Created">
                  <span className="text-tiny">{formatDateTime(detailsFlow?.created_at) || '—'}</span>
                </ConfigField>
                <ConfigField label="Updated">
                  <span className="text-tiny">{formatDateTime(detailsFlow?.updated_at) || '—'}</span>
                </ConfigField>
                {detailsFlow?.last_run_at && (
                  <ConfigField label="Last run">
                    <span className="text-tiny">{formatDateTime(detailsFlow.last_run_at)}</span>
                  </ConfigField>
                )}
              </ConfigColumn>
            </div>
          </div>

          {/* Run history */}
          <div className="overflow-hidden rounded-xl border border-[rgb(var(--border-line))] bg-surface-1">
            <div className="flex items-center justify-between border-b border-[rgb(var(--border-line))] px-6 py-4">
              <div>
                <h3 className="text-caption font-strong text-text-primary">Run history</h3>
                <p className="mt-0.5 text-tiny text-text-quaternary">
                  {detailsRuns.length > 0 ? `${detailsRuns.length} recent runs` : 'No runs yet'}
                  {detailsFlow?.last_run_at && <span className="ml-2">· Last: {formatDateTime(detailsFlow.last_run_at)}</span>}
                </p>
              </div>
              <ServiceArchiveNotice appId={detailsFlowRecord?.app || source.app} destinationType={destination.type} />
            </div>

            {detailsRuns.length === 0 ? (
              <div className="py-16"><Empty description="No runs recorded" /></div>
            ) : (
              <div className="divide-y divide-[rgb(var(--border-line))]">
                {detailsRuns.map((run, idx) => {
                  const pct = getHistoryRunProgressPercent(run)
                  const isLatest = idx === 0
                  const variant = RUN_STATUS_VARIANT[run.status] || 'neutral'
                  const StatusIcon = RUN_STATUS_ICON[run.status] || Info
                  const iconSpin = run.status === 'running' ? 'animate-spin' : ''
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
                          {run.completed_at && <span className="text-tiny text-text-quaternary">→ {formatDateTime(run.completed_at)}</span>}
                        </div>

                        <div className="mb-1.5 flex items-center gap-3">
                          <div className="flex-1">
                            <Progress
                              percent={pct}
                              status={RUN_STATUS_PROGRESS[run.status] || 'normal'}
                              size="small"
                            />
                          </div>
                          <span className="w-8 shrink-0 text-right text-tiny font-strong text-text-secondary">{pct}%</span>
                        </div>

                        <div className="flex flex-wrap gap-x-4 text-tiny">
                          <span className="font-emphasis text-text-secondary">{getHistoryRunStepLabel(run)}</span>
                          {getHistoryRunSummary(run) && <span className="text-text-quaternary">{getHistoryRunSummary(run)}</span>}
                        </div>

                        {run.error_message && (
                          <div className="mt-2 flex items-start gap-1.5 rounded-md bg-danger/10 px-3 py-2">
                            <Info className="mt-0.5 h-3 w-3 shrink-0 text-danger" />
                            <span className="text-tiny leading-relaxed text-danger">{run.error_message}</span>
                          </div>
                        )}
                      </div>

                      <div className="shrink-0 space-y-1 text-right">
                        <div className="text-tiny text-text-quaternary">{run.triggered_by || 'manual'}</div>
                        <div className="text-[10px] text-text-quaternary">#{run.id}</div>
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

export default FlowDetailView
