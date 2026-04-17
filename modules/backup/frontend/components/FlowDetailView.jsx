import React from 'react'
import {
  ArrowLeft, Globe, Cloud, Clock, FolderKanban, Pencil, RefreshCw, Play, Square, Trash2,
  Inbox, Building2, Headphones, CheckCircle, Info, Loader2,
} from 'lucide-react'
import AppModalShell from '@packages/ui/src/components/common/AppModalShell'
import { Tag, Alert, SpinCenter, Empty } from '@packages/ui/src/components/common/ui'
import { APPS, APP_META, formatDateTime } from '../constants'

const runStatusColors = { completed: '#16a34a', failed: '#dc2626', running: '#2563eb', pending: '#d97706' }
const runStatusLabels = { completed: 'Completed', failed: 'Failed', running: 'Running', pending: 'Pending' }
const runStatusBg = { completed: '#f0fdf4', failed: '#fef2f2', running: '#eff6ff', pending: '#fffbeb' }

const appIcons = {
  request:  <Inbox className="w-4 h-4" />,
  workflow: <FolderKanban className="w-4 h-4" />,
  wework:   <Building2 className="w-4 h-4" />,
  service:  <Headphones className="w-4 h-4" />,
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
  if (run?.status === 'pending') return 'Queued to start'
  if (run?.status === 'running') return 'Backup is running'
  if (run?.status === 'failed') return run?.error_message || 'Backup failed'
  return 'Completed'
}

function getHistoryRunSummary(run) {
  const details = run?.execution_details || {}
  if (details.app === 'service') {
    return `${details.completed_services || 0}/${details.total_services || 0} services, ${details.total_tickets || 0} tickets, ${details.attachments_downloaded || 0} attachments`
  }
  if (details.app === 'request') {
    return `${details.completed_groups || 0}/${details.total_groups || 0} groups, ${details.total_requests || 0} requests`
  }
  if (details.app === 'workflow') {
    return `${details.completed_workflows || 0}/${details.total_workflows || 0} workflows, ${details.completed_jobs || 0}/${details.total_jobs || 0} jobs`
  }
  if (details.app === 'wework') {
    return `${details.completed_projects || 0}/${details.total_projects || 0} projects, ${details.completed_tasks || 0}/${details.total_tasks || 0} tasks`
  }
  return details.structure_path || 'No execution summary yet'
}

function getDestinationIdentityLabel(auth = {}) {
  return auth.service_account_email || auth.client_email || auth.email || null
}

function renderServiceArchiveNotice(appId, destinationType) {
  if (appId !== 'service' || destinationType !== 'gdrive') return null
  return (
    <Alert
      type="info"
      message="Re-run will move old folder to Trash"
      description="Each time a new Service backup runs, the old Base Service folder will be moved to Google Drive Trash before re-creating."
    />
  )
}

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
          <button
            onClick={onDelete}
            className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-2.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50"
          >
            <Trash2 className="h-4 w-4" /> Delete flow
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          onClick={onRefresh}
          disabled={loadingFlowDetails}
          className="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loadingFlowDetails ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Refresh
        </button>
        {canEdit && (
          <button
            onClick={onEdit}
            className="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            <Pencil className="h-4 w-4" /> Edit
          </button>
        )}
        {canEdit && hasActiveRun && (
          <button
            onClick={onStop}
            disabled={isStopping}
            className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Square className="h-4 w-4" /> {isStopping ? 'Stopping…' : 'Stop current run'}
          </button>
        )}
        {canEdit && (
          <button
            disabled={runDisabled}
            onClick={onRun}
            title={runBlockedReason || (hasActiveRun ? 'A backup is already running for this flow' : !supportsRun ? 'This app type does not support running' : !isPublished ? 'Must publish flow first' : undefined)}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Play className="h-4 w-4" /> Run backup now
          </button>
        )}
      </div>
    </div>
  )

  return (
    <AppModalShell
      variant="page"
      onClose={onBack}
      leadingAction={(
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to list</span>
        </button>
      )}
      title={detailsFlow?.name || detailsFlowRecord?.name || 'Backup flow detail'}
      description={(
        <div className="flex flex-wrap items-center gap-2 text-sm text-gray-500">
          <span>{source.app_name || source.app || 'Unknown source'}</span>
          {(destination.name || destination.type) && <span>• {destination.name || destination.type}</span>}
          {detailsFlow?.last_run_at && <span>• Last run {formatDateTime(detailsFlow.last_run_at)}</span>}
        </div>
      )}
      icon={React.cloneElement(icon, { className: 'h-5 w-5' })}
      iconClassName="bg-gray-50 text-gray-700"
      bodyClassName="px-6 py-6 lg:px-8 xl:px-10"
      footer={footer}
    >
      {loadingFlowDetails ? (
        <div className="flex items-center justify-center py-20"><SpinCenter text="Loading…" /></div>
      ) : (
        <div className="flex flex-col gap-5">
            {/* Overview card */}
            <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
              {/* Hero header */}
              <div className="px-6 pt-5 pb-4 border-b border-gray-100"
                style={{ background: `linear-gradient(135deg, ${meta.color}08 0%, white 70%)` }}>
                <div className="flex items-start gap-4 flex-wrap">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
                      style={{ backgroundColor: `${meta.color}1a`, color: meta.color }}>
                      <span className="scale-150">{icon}</span>
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <h2 className="text-lg font-bold text-gray-900 leading-tight">
                          {detailsFlow?.name || <span className="italic text-gray-400">Untitled draft</span>}
                        </h2>
                        {isDraft
                          ? <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-700">Draft</span>
                          : <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-cyan-100 text-cyan-700">Ready</span>}
                        {isPublished
                          ? <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-green-100 text-green-700">Published</span>
                          : <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-gray-100 text-gray-500">Unpublished</span>}
                        {detailsFlow?.backup_type && (
                          <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-purple-100 text-purple-700">
                            {{ structured: 'Structured', unstructured: 'Files & Attachments', all: 'Complete' }[detailsFlow.backup_type] || detailsFlow.backup_type}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-500">
                        <span style={{ color: meta.color }} className="font-medium">{source.app_name || source.app || '—'}</span>
                        {source.domain && <span className="ml-2 text-gray-400 font-mono text-xs">· {source.domain}</span>}
                      </p>
                    </div>
                  </div>
                </div>

                {runBlockedReason && (
                  <div className="mt-3 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
                    <Info className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-700 leading-relaxed">{runBlockedReason}</p>
                  </div>
                )}
              </div>

              {/* Config grid */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-0 divide-x divide-y divide-gray-100">
                {/* Source */}
                <div className="px-5 py-4">
                  <div className="flex items-center gap-1.5 mb-3">
                    <Globe className="w-3.5 h-3.5 text-orange-500" />
                    <span className="text-[10px] font-bold text-orange-600 uppercase tracking-wider">Data Source</span>
                  </div>
                  <div className="space-y-2">
                    <div><div className="text-[10px] text-gray-400 mb-0.5">App</div><div className="text-sm font-semibold" style={{ color: meta.color }}>{source.app_name || source.app || '—'}</div></div>
                    <div><div className="text-[10px] text-gray-400 mb-0.5">Domain</div><div className="text-xs font-mono text-gray-700 break-all">{source.domain || '—'}</div></div>
                    <div>
                      <div className="text-[10px] text-gray-400 mb-1">Backup Data</div>
                      <div className="flex flex-wrap gap-1">
                        {detailObjects.length > 0
                          ? detailObjects.map(o => <span key={o} className="px-1.5 py-0.5 rounded text-[11px] font-semibold bg-blue-100 text-blue-700">{o}</span>)
                          : <span className="text-xs text-gray-400">—</span>}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Destination */}
                <div className="px-5 py-4">
                  <div className="flex items-center gap-1.5 mb-3">
                    <Cloud className="w-3.5 h-3.5 text-blue-500" />
                    <span className="text-[10px] font-bold text-blue-600 uppercase tracking-wider">Storage</span>
                  </div>
                  <div className="space-y-2">
                    <div><div className="text-[10px] text-gray-400 mb-0.5">Backup Type</div>
                      <div className="text-sm font-semibold text-gray-800">
                        {{ structured: 'Structured', unstructured: 'Files & Attachments', all: 'Complete' }[detailsFlow?.backup_type] || detailsFlow?.backup_type || '—'}
                      </div>
                    </div>
                    <div><div className="text-[10px] text-gray-400 mb-0.5">Destination</div><div className="text-sm text-gray-700">{destination.name || destination.type || '—'}</div></div>
                    <div><div className="text-[10px] text-gray-400 mb-0.5">Account</div><div className="text-xs text-gray-700 break-all">{getDestinationIdentityLabel(auth) || '—'}</div></div>
                    <div><div className="text-[10px] text-gray-400 mb-0.5">Folder</div><div className="text-xs text-gray-700">{auth.folder_name || auth.folder_id || <span className="text-gray-400">My Drive (default)</span>}</div></div>
                  </div>
                </div>

                {/* Schedule */}
                <div className="px-5 py-4">
                  <div className="flex items-center gap-1.5 mb-3">
                    <Clock className="w-3.5 h-3.5 text-purple-500" />
                    <span className="text-[10px] font-bold text-purple-600 uppercase tracking-wider">Schedule</span>
                  </div>
                  <div className="space-y-2">
                    <div><div className="text-[10px] text-gray-400 mb-0.5">Type</div><div className="text-sm font-semibold text-gray-800">{schedule.type || <span className="text-gray-400 font-normal text-xs">Manual</span>}</div></div>
                    {schedule.type && (
                      <div><div className="text-[10px] text-gray-400 mb-0.5">Time</div><div className="text-sm text-gray-700">{schedule.time || '—'}</div></div>
                    )}
                    <div>
                      <div className="text-[10px] text-gray-400 mb-1">Status</div>
                      {schedule.enabled === false
                        ? <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-gray-100 text-gray-500">Disabled</span>
                        : <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-green-100 text-green-700">Enabled</span>}
                    </div>
                  </div>
                </div>

                {/* Meta */}
                <div className="px-5 py-4">
                  <div className="flex items-center gap-1.5 mb-3">
                    <FolderKanban className="w-3.5 h-3.5 text-gray-400" />
                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Info</span>
                  </div>
                  <div className="space-y-2">
                    <div><div className="text-[10px] text-gray-400 mb-0.5">Created</div><div className="text-xs text-gray-700">{formatDateTime(detailsFlow?.created_at) || '—'}</div></div>
                    <div><div className="text-[10px] text-gray-400 mb-0.5">Updated</div><div className="text-xs text-gray-700">{formatDateTime(detailsFlow?.updated_at) || '—'}</div></div>
                    {detailsFlow?.last_run_at && (
                      <div><div className="text-[10px] text-gray-400 mb-0.5">Last Run</div><div className="text-xs text-gray-700">{formatDateTime(detailsFlow.last_run_at)}</div></div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Run history */}
            <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-gray-900">Run History</h3>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {detailsRuns.length > 0 ? `${detailsRuns.length} most recent runs` : 'No runs yet'}
                    {detailsFlow?.last_run_at && <span className="ml-2">· Last: {formatDateTime(detailsFlow.last_run_at)}</span>}
                  </p>
                </div>
                {renderServiceArchiveNotice(detailsFlowRecord?.app || source.app, destination.type)}
              </div>

              {detailsRuns.length === 0 ? (
                <div className="py-16"><Empty description="No runs have been recorded yet" /></div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {detailsRuns.map((run, idx) => {
                    const pct = getHistoryRunProgressPercent(run)
                    const isLatest = idx === 0
                    const statusColor = runStatusColors[run.status] || '#64748b'
                    const statusBgColor = runStatusBg[run.status] || '#f9fafb'
                    return (
                      <div key={run.id}
                        className="px-6 py-4 hover:bg-gray-50/70 transition-colors flex items-start gap-4"
                        style={isLatest ? { borderLeft: `3px solid ${statusColor}` } : { borderLeft: '3px solid transparent' }}>
                        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5" style={{ background: statusBgColor }}>
                          {run.status === 'completed' && <CheckCircle style={{ width: 18, height: 18, color: '#16a34a' }} />}
                          {run.status === 'failed' && <Info style={{ width: 18, height: 18, color: '#dc2626' }} />}
                          {run.status === 'running' && <Loader2 style={{ width: 18, height: 18, color: '#2563eb' }} className="animate-spin" />}
                          {run.status === 'pending' && <Clock style={{ width: 18, height: 18, color: '#d97706' }} />}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1.5">
                            <span className="text-sm font-semibold" style={{ color: statusColor }}>
                              {runStatusLabels[run.status] || run.status}
                            </span>
                            {isLatest && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-600 uppercase">Latest</span>}
                            <span className="text-xs text-gray-400">{formatDateTime(run.started_at)}</span>
                            {run.completed_at && <span className="text-xs text-gray-400">→ {formatDateTime(run.completed_at)}</span>}
                          </div>

                          <div className="flex items-center gap-3 mb-1.5">
                            <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div className="h-full rounded-full transition-all duration-500"
                                style={{ width: `${pct}%`, background: run.status === 'failed' ? '#ef4444' : run.status === 'running' ? '#3b82f6' : '#22c55e' }} />
                            </div>
                            <span className="text-xs font-semibold shrink-0 w-8 text-right" style={{ color: statusColor }}>{pct}%</span>
                          </div>

                          <div className="flex flex-wrap gap-x-4 text-xs">
                            <span className="font-medium text-gray-600">{getHistoryRunStepLabel(run)}</span>
                            {getHistoryRunSummary(run) && <span className="text-gray-400">{getHistoryRunSummary(run)}</span>}
                          </div>

                          {run.error_message && (
                            <div className="mt-2 flex items-start gap-1.5 bg-red-50 rounded-lg px-3 py-2">
                              <Info style={{ width: 13, height: 13, color: '#f87171', flexShrink: 0, marginTop: 1 }} />
                              <span className="text-xs text-red-600 leading-relaxed">{run.error_message}</span>
                            </div>
                          )}
                        </div>

                        <div className="shrink-0 text-right space-y-1">
                          <div className="text-[11px] text-gray-400">{run.triggered_by || 'manual'}</div>
                          <div className="text-[10px] text-gray-300">#{run.id}</div>
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
