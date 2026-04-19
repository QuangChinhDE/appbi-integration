import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, ArrowRight, Check,
  Clock, Edit2, Loader2, Pause, Play, Trash2,
  AlertTriangle, Calendar, BarChart3, Settings,
} from 'lucide-react'

import api from '@shared/api/client'
import { getAppMeta } from '@modules/apps/frontend/constants'
import {
  PIPELINE_STATUS_TAG, RUN_STATUS_TAG,
} from '@modules/pipeline/frontend/constants'
import AppLayout from '@packages/ui/src/components/layout/AppLayout'
import { Button, message } from '@packages/ui/src/components/common/ui'


const TABS = [
  { key: 'overview', label: 'Overview', icon: BarChart3 },
  { key: 'config', label: 'Configuration', icon: Settings },
  { key: 'runs', label: 'Run History', icon: Clock },
  { key: 'schedule', label: 'Schedule', icon: Calendar },
]


function Badge({ color, children }) {
  const colorClasses = {
    success:    'bg-emerald-500/10 text-emerald-500',
    warning:    'bg-amber-500/10 text-amber-500',
    error:      'bg-red-500/10 text-red-500',
    neutral:    'bg-gray-400/10 text-gray-400',
    gold:       'bg-amber-400/10 text-amber-400',
    processing: 'bg-blue-500/10 text-blue-500',
  }
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-tiny font-emphasis ${colorClasses[color] || colorClasses.neutral}`}>
      {children}
    </span>
  )
}

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString()
}


// ── Tab: Overview ────────────────────────────────────────────────────────────

function TabOverview({ pipeline, runs }) {
  const sourceMeta = getAppMeta(pipeline.source_connector_key)
  const destMeta = getAppMeta(pipeline.dest_connector_key)
  const statusTag = PIPELINE_STATUS_TAG[pipeline.status] || PIPELINE_STATUS_TAG.draft

  return (
    <div className="space-y-6">
      {/* Status banner */}
      <div className="flex items-center justify-between rounded-lg border border-[rgb(var(--border-line))] bg-surface-2 px-5 py-4">
        <div className="flex items-center gap-3">
          <Badge color={statusTag.color}>{statusTag.label}</Badge>
          <span className="text-caption text-text-tertiary">Created {formatDate(pipeline.created_at)}</span>
        </div>
        <span className="text-caption text-text-tertiary">Updated {formatDate(pipeline.updated_at)}</span>
      </div>

      {/* Flow visualization */}
      <div className="flex items-center justify-center gap-4 rounded-lg border border-[rgb(var(--border-line))] bg-surface-2 px-6 py-8">
        <div className="flex flex-col items-center gap-2 rounded-lg border border-[rgb(var(--border-line))] bg-surface-1 p-4">
          {sourceMeta?.icon && (
            <div className="flex h-10 w-10 items-center justify-center rounded-lg" style={{ backgroundColor: sourceMeta.color + '18', color: sourceMeta.color }}>
              {sourceMeta.icon}
            </div>
          )}
          <div className="text-caption font-emphasis text-text-primary">{sourceMeta?.title || pipeline.source_connector_key}</div>
          <div className="text-tiny text-text-tertiary">{pipeline.source_streams?.length || 0} stream(s)</div>
        </div>

        <div className="flex items-center gap-1 text-text-quaternary">
          <div className="h-px w-12 bg-[rgb(var(--border-line))]" />
          <ArrowRight className="h-4 w-4" />
          <div className="h-px w-12 bg-[rgb(var(--border-line))]" />
        </div>

        <div className="flex flex-col items-center gap-2 rounded-lg border border-[rgb(var(--border-line))] bg-surface-1 p-4">
          {destMeta?.icon && (
            <div className="flex h-10 w-10 items-center justify-center rounded-lg" style={{ backgroundColor: destMeta.color + '18', color: destMeta.color }}>
              {destMeta.icon}
            </div>
          )}
          <div className="text-caption font-emphasis text-text-primary">{destMeta?.title || pipeline.dest_connector_key}</div>
          <div className="text-tiny text-text-tertiary">{pipeline.dest_stream_key}</div>
        </div>
      </div>

      {/* Quick stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-[rgb(var(--border-line))] bg-surface-2 px-4 py-3">
          <div className="text-tiny text-text-quaternary">Write Mode</div>
          <div className="mt-1 text-caption font-emphasis text-text-primary capitalize">{pipeline.write_mode}</div>
        </div>
        <div className="rounded-lg border border-[rgb(var(--border-line))] bg-surface-2 px-4 py-3">
          <div className="text-tiny text-text-quaternary">Schedule</div>
          <div className="mt-1 text-caption font-emphasis text-text-primary capitalize">{pipeline.schedule?.type || 'Manual'}</div>
        </div>
        <div className="rounded-lg border border-[rgb(var(--border-line))] bg-surface-2 px-4 py-3">
          <div className="text-tiny text-text-quaternary">Last Run</div>
          <div className="mt-1 text-caption font-emphasis text-text-primary">{formatDate(pipeline.last_run_at)}</div>
        </div>
      </div>

      {/* Recent runs */}
      {runs && runs.length > 0 && (
        <div>
          <h3 className="mb-3 text-caption font-emphasis text-text-primary">Recent Runs</h3>
          <div className="overflow-hidden rounded-lg border border-[rgb(var(--border-line))]">
            <table className="min-w-full divide-y divide-[rgb(var(--border-line))]">
              <thead className="bg-surface-2">
                <tr>
                  <th className="px-4 py-2 text-left text-tiny font-emphasis uppercase text-text-quaternary">Status</th>
                  <th className="px-4 py-2 text-left text-tiny font-emphasis uppercase text-text-quaternary">Started</th>
                  <th className="px-4 py-2 text-left text-tiny font-emphasis uppercase text-text-quaternary">Records</th>
                  <th className="px-4 py-2 text-left text-tiny font-emphasis uppercase text-text-quaternary">Triggered By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[rgb(var(--border-line))]">
                {runs.slice(0, 5).map((run) => {
                  const tag = RUN_STATUS_TAG[run.status] || RUN_STATUS_TAG.pending
                  return (
                    <tr key={run.id} className="hover:bg-surface-2">
                      <td className="px-4 py-2"><Badge color={tag.color}>{tag.label}</Badge></td>
                      <td className="px-4 py-2 text-caption text-text-tertiary">{formatDate(run.started_at)}</td>
                      <td className="px-4 py-2 text-caption text-text-tertiary">{run.records_read ?? '—'} → {run.records_written ?? '—'}</td>
                      <td className="px-4 py-2 text-caption text-text-tertiary">{run.triggered_by}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}


// ── Tab: Configuration ───────────────────────────────────────────────────────

function TabConfig({ pipeline }) {
  const sections = [
    { label: 'Source Connector', value: pipeline.source_connector_key },
    { label: 'Source Credential', value: pipeline.source_credential_id || '—' },
    { label: 'Source Streams', value: (pipeline.source_streams || []).join(', ') || '—' },
    { label: 'Destination Connector', value: pipeline.dest_connector_key },
    { label: 'Destination Credential', value: pipeline.dest_credential_id || '—' },
    { label: 'Target Stream', value: pipeline.dest_stream_key },
    { label: 'Write Mode', value: pipeline.write_mode },
  ]

  return (
    <div className="space-y-4">
      <div className="divide-y divide-[rgb(var(--border-line))] rounded-lg border border-[rgb(var(--border-line))]">
        {sections.map((s) => (
          <div key={s.label} className="flex items-center justify-between px-4 py-3">
            <span className="text-caption text-text-tertiary">{s.label}</span>
            <span className="text-caption font-emphasis text-text-primary">{s.value}</span>
          </div>
        ))}
      </div>

      {pipeline.field_mapping && Object.keys(pipeline.field_mapping).length > 0 && (
        <div>
          <h3 className="mb-2 text-caption font-emphasis text-text-primary">Field Mapping</h3>
          <div className="overflow-hidden rounded-lg border border-[rgb(var(--border-line))]">
            <table className="min-w-full divide-y divide-[rgb(var(--border-line))]">
              <thead className="bg-surface-2">
                <tr>
                  <th className="px-4 py-2 text-left text-tiny font-emphasis uppercase text-text-quaternary">Source</th>
                  <th className="px-4 py-2 text-left text-tiny font-emphasis uppercase text-text-quaternary">→ Destination</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[rgb(var(--border-line))]">
                {Object.entries(pipeline.field_mapping).map(([src, dest]) => (
                  <tr key={src} className="hover:bg-surface-2">
                    <td className="px-4 py-2 text-caption text-text-primary">{src}</td>
                    <td className="px-4 py-2 text-caption text-text-primary">{dest || src}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}


// ── Tab: Run History ─────────────────────────────────────────────────────────

function TabRuns({ runs, loading }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-text-tertiary" />
      </div>
    )
  }

  if (!runs || runs.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[rgb(var(--border-line))] bg-surface-2 px-6 py-12 text-center">
        <Clock className="mx-auto h-8 w-8 text-text-quaternary" />
        <p className="mt-2 text-caption text-text-tertiary">No runs yet. Trigger a manual run to see results here.</p>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-lg border border-[rgb(var(--border-line))]">
      <table className="min-w-full divide-y divide-[rgb(var(--border-line))]">
        <thead className="bg-surface-2">
          <tr>
            <th className="px-4 py-2 text-left text-tiny font-emphasis uppercase text-text-quaternary">Status</th>
            <th className="px-4 py-2 text-left text-tiny font-emphasis uppercase text-text-quaternary">Started</th>
            <th className="px-4 py-2 text-left text-tiny font-emphasis uppercase text-text-quaternary">Completed</th>
            <th className="px-4 py-2 text-left text-tiny font-emphasis uppercase text-text-quaternary">Read</th>
            <th className="px-4 py-2 text-left text-tiny font-emphasis uppercase text-text-quaternary">Written</th>
            <th className="px-4 py-2 text-left text-tiny font-emphasis uppercase text-text-quaternary">Errors</th>
            <th className="px-4 py-2 text-left text-tiny font-emphasis uppercase text-text-quaternary">Triggered By</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[rgb(var(--border-line))]">
          {runs.map((run) => {
            const tag = RUN_STATUS_TAG[run.status] || RUN_STATUS_TAG.pending
            return (
              <tr key={run.id} className="hover:bg-surface-2">
                <td className="px-4 py-2"><Badge color={tag.color}>{tag.label}</Badge></td>
                <td className="px-4 py-2 text-caption text-text-tertiary">{formatDate(run.started_at)}</td>
                <td className="px-4 py-2 text-caption text-text-tertiary">{formatDate(run.completed_at)}</td>
                <td className="px-4 py-2 text-caption text-text-primary">{run.records_read ?? '—'}</td>
                <td className="px-4 py-2 text-caption text-text-primary">{run.records_written ?? '—'}</td>
                <td className="px-4 py-2 text-caption">
                  {run.error_count > 0
                    ? <span className="text-red-400">{run.error_count}</span>
                    : <span className="text-text-quaternary">0</span>}
                </td>
                <td className="px-4 py-2 text-caption text-text-tertiary">{run.triggered_by}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}


// ── Tab: Schedule ────────────────────────────────────────────────────────────

function TabSchedule({ pipeline }) {
  const schedule = pipeline.schedule || { type: 'manual' }

  return (
    <div className="space-y-4">
      <div className="divide-y divide-[rgb(var(--border-line))] rounded-lg border border-[rgb(var(--border-line))]">
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-caption text-text-tertiary">Type</span>
          <span className="text-caption font-emphasis text-text-primary capitalize">{schedule.type}</span>
        </div>
        {schedule.type === 'interval' && (
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-caption text-text-tertiary">Interval</span>
            <span className="text-caption font-emphasis text-text-primary">Every {schedule.interval_hours || 24} hour(s)</span>
          </div>
        )}
        {schedule.type === 'cron' && (
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-caption text-text-tertiary">Cron Expression</span>
            <code className="rounded bg-surface-3 px-2 py-0.5 text-tiny text-text-primary">{schedule.cron || '—'}</code>
          </div>
        )}
      </div>
    </div>
  )
}


// ── Main ─────────────────────────────────────────────────────────────────────

export default function PipelineManagePage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [pipeline, setPipeline] = useState(null)
  const [runs, setRuns] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('overview')
  const [actionLoading, setActionLoading] = useState(false)

  const fetchPipeline = useCallback(async () => {
    try {
      const [pRes, rRes] = await Promise.all([
        api.get(`/api/pipeline/pipelines/${id}`),
        api.get(`/api/pipeline/pipelines/${id}/runs`),
      ])
      setPipeline(pRes.data)
      setRuns(Array.isArray(rRes.data) ? rRes.data : [])
    } catch {
      message.error('Failed to load pipeline')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { fetchPipeline() }, [fetchPipeline])

  const handleStatusChange = useCallback(async (newStatus) => {
    setActionLoading(true)
    try {
      const { data } = await api.put(`/api/pipeline/pipelines/${id}`, { status: newStatus })
      setPipeline(data)
      message.success(`Pipeline ${newStatus}`)
    } catch {
      message.error('Failed to update status')
    } finally {
      setActionLoading(false)
    }
  }, [id])

  const handleDelete = useCallback(async () => {
    if (!window.confirm('Are you sure you want to delete this pipeline?')) return
    setActionLoading(true)
    try {
      await api.delete(`/api/pipeline/pipelines/${id}`)
      message.success('Pipeline deleted')
      navigate('/pipeline')
    } catch {
      message.error('Failed to delete pipeline')
    } finally {
      setActionLoading(false)
    }
  }, [id, navigate])

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-32">
          <Loader2 className="h-6 w-6 animate-spin text-text-tertiary" />
        </div>
      </AppLayout>
    )
  }

  if (!pipeline) {
    return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center py-32">
          <AlertTriangle className="h-8 w-8 text-amber-400" />
          <p className="mt-3 text-caption text-text-tertiary">Pipeline not found.</p>
          <Button variant="ghost" size="sm" className="mt-4" onClick={() => navigate('/pipeline')}>
            <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back
          </Button>
        </div>
      </AppLayout>
    )
  }

  const statusTag = PIPELINE_STATUS_TAG[pipeline.status] || PIPELINE_STATUS_TAG.draft

  return (
    <AppLayout>
      <div className="mx-auto w-full max-w-5xl px-6 py-8">
        {/* Header */}
        <div className="mb-6 flex items-start justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigate('/pipeline')}
              className="flex items-center gap-1 text-tiny text-text-tertiary hover:text-text-primary"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-heading font-emphasis text-text-primary">{pipeline.name}</h1>
                <Badge color={statusTag.color}>{statusTag.label}</Badge>
              </div>
              {pipeline.description && (
                <p className="mt-1 text-caption text-text-tertiary">{pipeline.description}</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {pipeline.status === 'draft' && (
              <Button size="sm" onClick={() => handleStatusChange('active')} disabled={actionLoading}>
                <Play className="mr-1 h-3.5 w-3.5" /> Activate
              </Button>
            )}
            {pipeline.status === 'active' && (
              <Button variant="ghost" size="sm" onClick={() => handleStatusChange('paused')} disabled={actionLoading}>
                <Pause className="mr-1 h-3.5 w-3.5" /> Pause
              </Button>
            )}
            {pipeline.status === 'paused' && (
              <Button size="sm" onClick={() => handleStatusChange('active')} disabled={actionLoading}>
                <Play className="mr-1 h-3.5 w-3.5" /> Resume
              </Button>
            )}
            <Button variant="danger" size="sm" onClick={handleDelete} disabled={actionLoading}>
              <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <div className="mb-6 flex gap-1 rounded-lg border border-[rgb(var(--border-line))] bg-surface-2 p-1">
          {TABS.map((tab) => {
            const Icon = tab.icon
            const isActive = activeTab === tab.key
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-caption transition-colors ${
                  isActive
                    ? 'bg-surface-1 font-emphasis text-text-primary shadow-sm'
                    : 'text-text-tertiary hover:text-text-secondary'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            )
          })}
        </div>

        {/* Tab content */}
        {activeTab === 'overview' && <TabOverview pipeline={pipeline} runs={runs} />}
        {activeTab === 'config' && <TabConfig pipeline={pipeline} />}
        {activeTab === 'runs' && <TabRuns runs={runs} loading={loading} />}
        {activeTab === 'schedule' && <TabSchedule pipeline={pipeline} />}
      </div>
    </AppLayout>
  )
}
