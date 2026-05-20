import React from 'react'
import {
  ArrowLeft,
  Building2,
  CheckCircle,
  Cloud,
  Clock,
  Eye,
  FolderKanban,
  Globe,
  Headphones,
  Inbox,
  Info,
  Loader2,
  Pencil,
  Play,
  RefreshCw,
  Share2,
  Square,
  Trash2,
} from 'lucide-react'

import AppModalShell from '@packages/ui/src/components/common/AppModalShell'
import { Alert, Badge, Button, Empty, IconButton, SpinCenter } from '@packages/ui/src/components/common/ui'
import { getAccessMeta, getResourcePermissions } from '@modules/identity/frontend/lib/resourcePermissions'

import { APPS, APP_META, formatDateTime, getBackupDestinationLabel } from '../constants'
import { getBackupRunSummary, isBackupRunActive, supportsBackupFlowRun } from '../runSupport'


const RUN_STATUS_VARIANT = {
  completed: 'success',
  failed: 'danger',
  running: 'info',
  pending: 'warning',
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

const APP_ICONS = {
  base_request: <Inbox className="w-4 h-4" />,
  base_workflow: <FolderKanban className="w-4 h-4" />,
  base_wework: <Building2 className="w-4 h-4" />,
  base_service: <Headphones className="w-4 h-4" />,
}

const BACKUP_TYPE_LABEL = {
  structured: 'Structured',
  unstructured: 'Files & Attachments',
  all: 'Complete',
}


function formatShortDateTime(value) {
  if (!value) return '-'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return String(value)
  return parsed.toLocaleString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}


function getRunActivityTime(run) {
  return run?.completed_at || run?.started_at || null
}


function formatDurationLabel(startedAt, completedAt, status) {
  const started = new Date(startedAt || '')
  if (Number.isNaN(started.getTime())) return '-'

  const ended = completedAt ? new Date(completedAt) : null
  if (completedAt && ended && Number.isNaN(ended.getTime())) return '-'
  if (!ended) return status === 'running' ? 'In progress' : '-'

  const diffMs = Math.max(0, ended.getTime() - started.getTime())
  const totalSeconds = Math.floor(diffMs / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}


function getHistoryRunStepLabel(run) {
  if (run?.execution_details?.step_label) return run.execution_details.step_label
  if (run?.status === 'pending') return 'Queued'
  if (run?.status === 'running') return 'Running'
  if (run?.status === 'failed') return run?.error_message || 'Failed'
  return 'Completed'
}


function getHistoryRunSummary(run) {
  return getBackupRunSummary(run)
}


function getRunLatestLogLine(run) {
  if (!run?.logs) return ''
  const lines = String(run.logs)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  return lines.at(-1) || ''
}


function getRunUploadedFiles(run) {
  return Array.isArray(run?.execution_details?.uploaded_files) ? run.execution_details.uploaded_files : []
}


function getRunModeLabel(run) {
  const rawMode = run?.execution_details?.mode
  if (!rawMode) return null
  return String(rawMode)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}


function getRunFailureSummary(run) {
  const summary = run?.execution_details?.failure_summary
  return summary && typeof summary === 'object' ? summary : null
}


function hasRetryableFailures(run) {
  const summary = getRunFailureSummary(run)
  if (!summary) return false
  return Number(summary.failed_job_count || 0) > 0 || Number(summary.failed_workflow_count || 0) > 0
}


function getLogEntryStage(message) {
  const normalized = String(message || '').toLowerCase()
  if (!normalized) return { label: 'System', tone: 'neutral' }
  if (/(prepare|destination|folder|upload|uploaded|write|writing|manifest|archive|archived|drive|sheet|excel|json|artifact|file)/.test(normalized)) {
    return { label: 'Destination', tone: 'info' }
  }
  if (/(load|loading|fetch|processing|found|extract|reading|scan|source|record|entity|object|item|page|detail|list)/.test(normalized)) {
    return { label: 'Source', tone: 'brand' }
  }
  if (/(completed|failed|interrupted|error|warning|stopped|cancelled)/.test(normalized)) {
    return { label: 'Status', tone: 'warning' }
  }
  return { label: 'System', tone: 'neutral' }
}


function parseRunLogEntries(logs) {
  if (!logs) return []
  return String(logs)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const timestampMatch = line.match(/^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]\s*(.*)$/)
      const levelMatch = line.match(/^\[([A-Z_]+)\]\s*(.*)$/)

      if (timestampMatch) {
        const message = timestampMatch[2] || ''
        return {
          id: `${index}-${line}`,
          time: timestampMatch[1],
          level: null,
          message,
          ...getLogEntryStage(message),
        }
      }

      if (levelMatch) {
        const level = levelMatch[1]
        const message = levelMatch[2] || ''
        const stage = level === 'FAILED'
          ? { label: 'Status', tone: 'danger' }
          : level === 'COMPLETED'
            ? { label: 'Status', tone: 'success' }
            : level === 'RUNNING'
              ? { label: 'System', tone: 'info' }
              : level === 'INTERRUPTED'
                ? { label: 'Status', tone: 'warning' }
                : getLogEntryStage(message)

        return {
          id: `${index}-${line}`,
          time: null,
          level,
          message,
          ...stage,
        }
      }

      return {
        id: `${index}-${line}`,
        time: null,
        level: null,
        message: line,
        ...getLogEntryStage(line),
      }
    })
}


function RunDetailStat({ label, value, helper }) {
  return (
    <div className="rounded-xl border border-[rgb(var(--border-line))] bg-surface-1 px-4 py-3">
      <div className="text-micro font-emphasis uppercase tracking-[0.14em] text-text-quaternary">{label}</div>
      <div className="mt-1 text-small font-strong leading-6 text-text-primary">{value}</div>
      {helper && <div className="mt-1 text-caption text-text-tertiary">{helper}</div>}
    </div>
  )
}


function RunLogDetailModal({ run, appId, onClose }) {
  const entries = React.useMemo(() => parseRunLogEntries(run?.logs), [run?.logs])
  const uploadedFiles = React.useMemo(() => getRunUploadedFiles(run), [run])
  const summary = React.useMemo(() => getBackupRunSummary(run, appId), [appId, run])
  const modeLabel = getRunModeLabel(run)
  const latestLine = getRunLatestLogLine(run)
  const failureSummary = React.useMemo(() => getRunFailureSummary(run), [run])

  return (
    <AppModalShell
      onClose={onClose}
      title={`Run ${RUN_STATUS_LABEL[run?.status] || run?.status || ''}`}
      description={(
        <div className="flex flex-wrap items-center gap-2 text-caption text-text-tertiary">
          <span>{formatDateTime(run?.started_at)}</span>
          <span>· {formatDurationLabel(run?.started_at, run?.completed_at, run?.status)}</span>
          {modeLabel && <span>· {modeLabel}</span>}
          {run?.triggered_by && <span>· {run.triggered_by}</span>}
        </div>
      )}
      icon={<Eye className="h-5 w-5" />}
      iconClassName="bg-brand/10 text-brand"
      maxWidthClass="max-w-6xl"
      panelClassName="max-h-[88vh]"
      bodyClassName="p-0"
    >
      <div className="grid min-h-0 gap-0 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.9fr)]">
        <div className="min-h-0 border-b border-[rgb(var(--border-line))] p-5 lg:border-b-0 lg:border-r">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <RunDetailStat label="Status" value={RUN_STATUS_LABEL[run?.status] || run?.status || '-'} />
            <RunDetailStat label="Started" value={formatShortDateTime(run?.started_at)} />
            <RunDetailStat label="Finished" value={formatShortDateTime(run?.completed_at)} helper={!run?.completed_at ? 'Still running or pending' : undefined} />
            <RunDetailStat label="Duration" value={formatDurationLabel(run?.started_at, run?.completed_at, run?.status)} />
          </div>

          <div className="mt-5 rounded-xl border border-[rgb(var(--border-line))] bg-surface-1">
            <div className="border-b border-[rgb(var(--border-line))] px-4 py-3">
              <h3 className="text-h3 font-strong text-text-primary">Process log</h3>
              <p className="mt-1 text-caption text-text-quaternary">Readable event stream for source extraction and destination writing.</p>
            </div>
            {entries.length === 0 ? (
              <div className="px-4 py-8 text-center text-caption text-text-quaternary">No log events captured for this run yet.</div>
            ) : (
              <div className="max-h-[48vh] space-y-2 overflow-y-auto px-4 py-4">
                {entries.map((entry) => (
                  <div key={entry.id} className="rounded-xl border border-[rgb(var(--border-line))] bg-surface-2/60 px-3 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={entry.tone} size="xs">{entry.label}</Badge>
                      {entry.level && <Badge variant="neutral" size="xs">{entry.level}</Badge>}
                      {entry.time && <span className="text-micro text-text-quaternary">{entry.time}</span>}
                    </div>
                    <div className="mt-2 text-small leading-6 text-text-secondary">{entry.message || '-'}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="min-h-0 bg-surface-2/30 p-5">
          <div className="space-y-4">
            <div className="rounded-xl border border-[rgb(var(--border-line))] bg-surface-1 p-4">
              <h3 className="text-h3 font-strong text-text-primary">Run summary</h3>
              <div className="mt-3 space-y-2 text-caption leading-6 text-text-tertiary">
                {summary && <div><span className="font-emphasis text-text-secondary">Summary:</span> {summary}</div>}
                {modeLabel && <div><span className="font-emphasis text-text-secondary">Mode:</span> {modeLabel}</div>}
                <div><span className="font-emphasis text-text-secondary">Uploaded files:</span> {uploadedFiles.length}</div>
                {Number(failureSummary?.failed_workflow_count || 0) > 0 && (
                  <div className="text-warning"><span className="font-emphasis">Failed workflows:</span> {failureSummary.failed_workflow_count}</div>
                )}
                {Number(failureSummary?.failed_job_count || 0) > 0 && (
                  <div className="text-danger"><span className="font-emphasis">Failed jobs:</span> {failureSummary.failed_job_count}</div>
                )}
                {run?.execution_details?.retry_source_run_id && (
                  <div><span className="font-emphasis text-text-secondary">Retry source run:</span> #{String(run.execution_details.retry_source_run_id).slice(0, 8)}</div>
                )}
                {latestLine && <div><span className="font-emphasis text-text-secondary">Latest event:</span> {latestLine}</div>}
                {run?.error_message && <div className="text-danger"><span className="font-emphasis">Error:</span> {run.error_message}</div>}
              </div>
            </div>

            <div className="rounded-xl border border-[rgb(var(--border-line))] bg-surface-1">
              <div className="border-b border-[rgb(var(--border-line))] px-4 py-3">
                <h3 className="text-h3 font-strong text-text-primary">Output artifacts</h3>
                <p className="mt-1 text-caption text-text-quaternary">Files written to the destination in this run.</p>
              </div>
              {uploadedFiles.length === 0 ? (
                <div className="px-4 py-6 text-caption text-text-quaternary">No uploaded artifact metadata recorded.</div>
              ) : (
                <div className="max-h-[24vh] overflow-y-auto px-4 py-3">
                  <div className="space-y-2">
                    {uploadedFiles.slice(0, 40).map((file, index) => (
                      <div key={`${file.file_id || file.path || index}-${index}`} className="rounded-lg border border-[rgb(var(--border-line))] bg-surface-2/60 px-3 py-2">
                        <div className="text-small leading-6 text-text-primary">{file.path || file.filename || file.file_id || `Artifact ${index + 1}`}</div>
                        <div className="mt-1 text-micro text-text-quaternary">
                          {file.file_id ? `File ID: ${file.file_id}` : 'No file id recorded'}
                        </div>
                      </div>
                    ))}
                    {uploadedFiles.length > 40 && (
                      <div className="text-caption text-text-quaternary">Showing 40 of {uploadedFiles.length} artifacts.</div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-xl border border-[rgb(var(--border-line))] bg-surface-1">
              <div className="border-b border-[rgb(var(--border-line))] px-4 py-3">
                <h3 className="text-h3 font-strong text-text-primary">Raw logs</h3>
              </div>
              <div className="max-h-[24vh] overflow-y-auto px-4 py-3">
                <pre className="whitespace-pre-wrap break-words rounded-lg bg-surface-2/70 p-3 font-mono text-label leading-6 text-text-secondary">
                  {run?.logs || 'No raw logs captured for this run.'}
                </pre>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppModalShell>
  )
}


function getDestinationIdentityLabel(auth = {}) {
  return auth.service_account_email || auth.client_email || auth.email || null
}


function ServiceArchiveNotice({ appId, destinationType }) {
  if (appId !== 'base_service' || destinationType !== 'gdrive') return null
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
    <div className="mb-1 text-micro font-emphasis uppercase tracking-[0.14em] text-text-quaternary">{label}</div>
    <div className="text-small leading-6 text-text-secondary">{children}</div>
  </div>
)


const ConfigColumn = ({ icon: Icon, label, children }) => (
  <div className="px-5 py-5">
    <div className="mb-3 flex items-center gap-1.5 text-text-tertiary">
      <Icon className="h-3.5 w-3.5" />
      <span className="text-label font-strong uppercase tracking-[0.14em]">{label}</span>
    </div>
    <div className="space-y-3">{children}</div>
  </div>
)


function FlowDetailView({
  detailsFlow,
  detailsRuns,
  detailsFlowId,
  detailsFlowRecord,
  loadingFlowDetails,
  onBack,
  onEdit,
  onRefresh,
  onRun,
  onRetryFailed,
  onStop,
  onDelete,
  onShare,
  stoppingFlowId,
  canConfigure,
  configurationBlockedMessage,
}) {
  const [inspectedRunId, setInspectedRunId] = React.useState(null)
  const inspectedRun = React.useMemo(
    () => detailsRuns.find((run) => String(run.id) === String(inspectedRunId)) || null,
    [detailsRuns, inspectedRunId],
  )

  React.useEffect(() => {
    setInspectedRunId(null)
  }, [detailsFlowId])

  const source = detailsFlow?.source || {}
  const destination = detailsFlow?.destination || {}
  const sourceAppId = source.app_id || source.app
  const destinationType = destination.app_id || destination.type
  const sourceDomain = source.preview?.domain || source.domain
  const destinationIdentity = destination.preview?.display_name || destination.preview?.email || getDestinationIdentityLabel(destination.auth || {})
  const destinationFolder = destination.preview?.folder_name || destination.preview?.drive_name || null
  const schedule = detailsFlow?.schedule || {}
  const structure = detailsFlow?.structure || {}
  const meta = APP_META[sourceAppId] || { color: '#64748b' }
  const icon = APP_ICONS[sourceAppId] || <Cloud className="w-4 h-4" />
  const appConfig = APPS[sourceAppId] || {}
  const objectLabels = appConfig.objectLabels || {}
  const detailObjects = Array.isArray(structure.objects) ? structure.objects.map((id) => objectLabels[id] || id) : []
  const supportsRun = supportsBackupFlowRun(detailsFlowRecord?.app || sourceAppId)
  const isPublished = detailsFlowRecord?.is_published === 1 || detailsFlow?.is_published === 1
  const runBlockedReason = detailsFlow?.run_blocked_reason || detailsFlowRecord?.run_blocked_reason
  const isDraft = detailsFlow?.is_draft === 1
  const resourcePermission = detailsFlow?.user_permission || detailsFlowRecord?.user_permission || 'none'
  const resourcePerms = getResourcePermissions(resourcePermission)
  const accessMeta = getAccessMeta(resourcePermission)
  const hasActiveRun = detailsRuns.some((run) => isBackupRunActive(run.status))
    || isBackupRunActive(detailsFlow?.last_run_status || detailsFlowRecord?.last_run_status)
  const latestFinishedRun = detailsRuns.find((run) => !isBackupRunActive(run.status)) || null
  const latestFailedRun = latestFinishedRun && String(latestFinishedRun.status || '').toLowerCase() === 'failed'
    ? latestFinishedRun
    : null
  const latestRetryableRun = latestFinishedRun && hasRetryableFailures(latestFinishedRun)
    ? latestFinishedRun
    : null
  const latestFailureSummary = latestRetryableRun ? getRunFailureSummary(latestRetryableRun) : null
  const latestFreshRunMessage = latestFailedRun && !latestRetryableRun
    ? (latestFailedRun.error_message || 'Latest run failed before a retry candidate list was recorded. Use Run again to start a fresh run.')
    : null
  const runDisabled = !supportsRun || !isPublished || Boolean(runBlockedReason) || hasActiveRun
  const retryDisabled = runDisabled || !latestRetryableRun
  const isStopping = stoppingFlowId === (detailsFlowId || detailsFlowRecord?.id)

  const footer = (
    <div className="flex w-full items-center justify-between gap-3">
      <div>
        {resourcePerms.canDelete && (
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
        {resourcePerms.canShare && (
          <Button variant="secondary" size="md" onClick={onShare} leadingIcon={<Share2 className="h-4 w-4" />}>
            Share
          </Button>
        )}
        {resourcePerms.canEdit && (
          <Button
            variant="secondary"
            size="md"
            onClick={onEdit}
            disabled={!canConfigure}
            title={!canConfigure ? configurationBlockedMessage || 'Apps view required to edit' : 'Edit'}
            leadingIcon={<Pencil className="h-4 w-4" />}
          >
            Edit
          </Button>
        )}
        {resourcePerms.canEdit && hasActiveRun && (
          <Button variant="danger" size="md" onClick={onStop} disabled={isStopping} leadingIcon={<Square className="h-4 w-4" />}>
            {isStopping ? 'Stopping...' : 'Stop run'}
          </Button>
        )}
        {resourcePerms.canEdit && latestRetryableRun && (
          <Button
            variant="secondary"
            size="md"
            disabled={retryDisabled}
            onClick={onRetryFailed}
            title={
              runBlockedReason
              || (hasActiveRun
                ? 'A backup is already running'
                : !supportsRun
                  ? 'Run is not configured for this app'
                  : !isPublished
                    ? 'Publish the flow first'
                    : 'Retry only the workflow/job items that failed in the latest finished run')
            }
            leadingIcon={<RefreshCw className="h-4 w-4" />}
          >
            Retry failed only
          </Button>
        )}
        {resourcePerms.canEdit && (
          <Button
            variant="primary"
            size="md"
            disabled={runDisabled}
            onClick={onRun}
            title={
              runBlockedReason
              || (hasActiveRun
                ? 'A backup is already running'
                : !supportsRun
                  ? 'Run is not configured for this app'
                  : !isPublished
                    ? 'Publish the flow first'
                    : undefined)
            }
            leadingIcon={<Play className="h-4 w-4" />}
          >
            {latestFailedRun && !hasActiveRun ? 'Run again' : 'Run now'}
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
          <span>{source.app_name || sourceAppId || 'Unknown source'}</span>
          {(destination.name || destination.app_name || destinationType) && <span>· {destination.name || destination.app_name || destinationType}</span>}
          {detailsFlow?.last_run_at && <span>· Last run {formatDateTime(detailsFlow.last_run_at)}</span>}
        </div>
      )}
      icon={React.cloneElement(icon, { className: 'h-5 w-5' })}
      iconClassName="bg-surface-2 text-text-secondary"
      bodyClassName="px-4 py-6 sm:px-6 xl:px-8"
      footer={footer}
    >
      {loadingFlowDetails ? (
        <div className="flex items-center justify-center py-20"><SpinCenter text="Loading..." /></div>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="overflow-hidden rounded-xl border border-[rgb(var(--border-line))] bg-surface-1">
            <div className="border-b border-[rgb(var(--border-line))] bg-surface-2/40 px-6 pt-5 pb-4">
              <div className="flex flex-wrap items-start gap-4">
                <div
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl"
                  style={{ backgroundColor: `${meta.color}1a`, color: meta.color }}
                >
                  <span className="scale-150">{icon}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <h2 className="text-h3 font-strong leading-tight text-text-primary">
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
                    <Badge variant={accessMeta.tone} size="sm">
                      {accessMeta.label}
                    </Badge>
                    {detailsFlow?.owner_email && (
                      <Badge variant="neutral" size="sm">
                        {detailsFlow.owner_email}
                      </Badge>
                    )}
                  </div>
                  <p className="text-small leading-6 text-text-tertiary">
                    <span className="font-emphasis" style={{ color: meta.color }}>{source.app_name || sourceAppId || '-'}</span>
                    {sourceDomain && <span className="ml-2 font-mono text-label text-text-quaternary">· {sourceDomain}</span>}
                  </p>
                </div>
              </div>

              {runBlockedReason && (
                <div className="mt-3">
                  <Alert type="warning" message="Run blocked" description={runBlockedReason} />
                </div>
              )}

              {latestFailureSummary && (
                <div className="mt-3">
                  <Alert
                    type="warning"
                    message="Latest run has retryable gaps"
                    description={[
                      Number(latestFailureSummary.failed_workflow_count || 0) > 0
                        ? `${latestFailureSummary.failed_workflow_count} workflow issue(s)`
                        : null,
                      Number(latestFailureSummary.failed_job_count || 0) > 0
                        ? `${latestFailureSummary.failed_job_count} job issue(s)`
                        : null,
                      'Use Retry failed only to rerun just the recorded failures into a dedicated retry branch.',
                    ].filter(Boolean).join(' · ')}
                  />
                </div>
              )}

              {latestFreshRunMessage && (
                <div className="mt-3">
                  <Alert
                    type="info"
                    message="Latest failed run needs a fresh restart"
                    description={`${latestFreshRunMessage} Use Run again to start a new full run.`}
                  />
                </div>
              )}

              {resourcePerms.canEdit && !canConfigure && configurationBlockedMessage && (
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
                  <span className="font-strong" style={{ color: meta.color }}>{source.app_name || sourceAppId || '-'}</span>
                </ConfigField>
                <ConfigField label="Domain">
                  <span className="break-all font-mono text-label">{sourceDomain || '-'}</span>
                </ConfigField>
                <div>
                  <div className="mb-1 text-micro font-emphasis uppercase tracking-[0.14em] text-text-quaternary">Objects</div>
                  <div className="flex flex-wrap gap-1">
                    {detailObjects.length > 0
                      ? detailObjects.map((item) => <Badge key={item} variant="brand" size="xs">{item}</Badge>)
                      : <span className="text-caption text-text-quaternary">-</span>}
                  </div>
                </div>
              </ConfigColumn>

              <ConfigColumn icon={Cloud} label="Storage">
                <ConfigField label="Backup type">
                  <span className="font-strong text-text-primary">
                    {BACKUP_TYPE_LABEL[detailsFlow?.backup_type] || detailsFlow?.backup_type || '-'}
                  </span>
                </ConfigField>
                <ConfigField label="Destination">{destination.name || destination.app_name || getBackupDestinationLabel(destinationType) || '-'}</ConfigField>
                <ConfigField label="Account">
                  <span className="break-all text-caption">{destinationIdentity || '-'}</span>
                </ConfigField>
                <ConfigField label="Folder">
                  <span className="text-caption">{destinationFolder || <span className="text-text-quaternary">My Drive (default)</span>}</span>
                </ConfigField>
              </ConfigColumn>

              <ConfigColumn icon={Clock} label="Schedule">
                <ConfigField label="Type">
                  <span className="font-strong text-text-primary">{schedule.type || <span className="font-normal text-caption text-text-quaternary">Manual</span>}</span>
                </ConfigField>
                {schedule.type && <ConfigField label="Time">{schedule.time || '-'}</ConfigField>}
                <div>
                  <div className="mb-1 text-micro font-emphasis uppercase tracking-[0.14em] text-text-quaternary">Status</div>
                  <Badge variant={schedule.enabled === false ? 'neutral' : 'success'} size="sm">
                    {schedule.enabled === false ? 'Disabled' : 'Enabled'}
                  </Badge>
                </div>
              </ConfigColumn>

              <ConfigColumn icon={FolderKanban} label="Info">
                <ConfigField label="Created">
                  <span className="text-caption">{formatDateTime(detailsFlow?.created_at) || '-'}</span>
                </ConfigField>
                <ConfigField label="Updated">
                  <span className="text-caption">{formatDateTime(detailsFlow?.updated_at) || '-'}</span>
                </ConfigField>
                {detailsFlow?.last_run_at && (
                  <ConfigField label="Last run">
                    <span className="text-caption">{formatDateTime(detailsFlow.last_run_at)}</span>
                  </ConfigField>
                )}
              </ConfigColumn>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-[rgb(var(--border-line))] bg-surface-1">
            <div className="flex items-center justify-between border-b border-[rgb(var(--border-line))] px-6 py-4">
              <div>
                <h3 className="text-h3 font-strong text-text-primary">Run history</h3>
                <p className="mt-1 text-caption text-text-quaternary">
                  {detailsRuns.length > 0 ? `${detailsRuns.length} recent runs` : 'No runs yet'}
                  {detailsFlow?.last_run_at && <span className="ml-2">· Last: {formatDateTime(detailsFlow.last_run_at)}</span>}
                  {hasActiveRun && <span className="ml-2 text-info">· Auto-refreshing every 4s while this run is active</span>}
                </p>
              </div>
              <ServiceArchiveNotice appId={detailsFlowRecord?.app || sourceAppId} destinationType={destinationType} />
            </div>

            {detailsRuns.length === 0 ? (
              <div className="py-16"><Empty description="No runs recorded" /></div>
            ) : (
              <div className="app-list-table-wrap">
                <table className="app-list-table divide-y divide-[rgb(var(--border-line))]">
                  <thead className="bg-surface-2">
                    <tr>
                      <th className="app-list-header w-[15%]">Run</th>
                      <th className="app-list-header w-[18%]">Started</th>
                      <th className="app-list-header w-[12%]">Duration</th>
                      <th className="app-list-header w-[22%]">Summary</th>
                      <th className="app-list-header w-[25%]">Latest event</th>
                      <th className="app-list-header w-[96px] text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[rgb(var(--border-line))] bg-surface-1">
                    {detailsRuns.map((run, index) => {
                      const isLatest = index === 0
                      const variant = RUN_STATUS_VARIANT[run.status] || 'neutral'
                      const StatusIcon = RUN_STATUS_ICON[run.status] || Info
                      const iconSpin = run.status === 'running' ? 'animate-spin' : ''
                      const latestEvent = getRunLatestLogLine(run) || run.error_message || 'No log events captured yet'
                      const summary = getBackupRunSummary(run, detailsFlowRecord?.app || sourceAppId)
                      const modeLabel = getRunModeLabel(run)
                      const uploadedFiles = getRunUploadedFiles(run)
                      const failureSummary = getRunFailureSummary(run)
                      const failedWorkflowCount = Number(failureSummary?.failed_workflow_count || 0)
                      const failedJobCount = Number(failureSummary?.failed_job_count || 0)

                      return (
                        <tr key={run.id} className="hover:bg-surface-2/70">
                          <td className="app-list-cell">
                            <div className="flex items-center gap-2">
                              <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-2 ${RUN_STATUS_ICON_COLOR[run.status] || 'text-text-tertiary'}`}>
                                <StatusIcon className={`h-3.5 w-3.5 ${iconSpin}`} />
                              </div>
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <Badge variant={variant} size="sm">{RUN_STATUS_LABEL[run.status] || run.status}</Badge>
                                  {isLatest && <Badge variant="brand" size="xs">Latest</Badge>}
                                </div>
                                <div className="mt-1 text-micro text-text-quaternary">#{String(run.id).split('-')[0]}</div>
                              </div>
                            </div>
                          </td>
                          <td className="app-list-cell whitespace-nowrap text-caption text-text-secondary">
                            <div>{formatShortDateTime(run.started_at)}</div>
                            {run.completed_at && (
                              <div className="mt-1 text-caption text-text-quaternary">Done {formatShortDateTime(getRunActivityTime(run))}</div>
                            )}
                          </td>
                          <td className="app-list-cell whitespace-nowrap text-caption text-text-secondary">
                            {formatDurationLabel(run.started_at, run.completed_at, run.status)}
                          </td>
                          <td className="app-list-cell">
                            <div className="text-small font-emphasis leading-6 text-text-primary">{getHistoryRunStepLabel(run)}</div>
                            {summary && <div className="mt-0.5 text-caption text-text-tertiary">{summary}</div>}
                            <div className="mt-2 flex flex-wrap gap-1">
                              {modeLabel && <Badge variant="neutral" size="xs">{modeLabel}</Badge>}
                              {uploadedFiles.length > 0 && <Badge variant="info" size="xs">{uploadedFiles.length} files</Badge>}
                              {failedWorkflowCount > 0 && <Badge variant="warning" size="xs">{failedWorkflowCount} workflows lỗi</Badge>}
                              {failedJobCount > 0 && <Badge variant="danger" size="xs">{failedJobCount} jobs lỗi</Badge>}
                              {run.triggered_by && <Badge variant="outline" size="xs">{run.triggered_by}</Badge>}
                            </div>
                          </td>
                          <td className="app-list-cell max-w-[420px]">
                            <div className="app-list-text-sub text-caption leading-5 text-text-tertiary">{latestEvent}</div>
                          </td>
                          <td className="app-list-cell-tight text-right">
                            <IconButton
                              aria-label="Inspect run logs"
                              variant="ghost"
                              size="xs"
                              onClick={() => setInspectedRunId(run.id)}
                              title="Inspect run"
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </IconButton>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {inspectedRun && <RunLogDetailModal run={inspectedRun} appId={detailsFlowRecord?.app || sourceAppId} onClose={() => setInspectedRunId(null)} />}
    </AppModalShell>
  )
}

export default FlowDetailView
