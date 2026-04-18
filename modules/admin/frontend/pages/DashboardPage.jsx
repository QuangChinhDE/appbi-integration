import React, { useEffect, useState } from 'react'
import dayjs from 'dayjs'
import {
  Activity,
  CheckCircle2,
  Clock,
  CloudCog,
  LayoutDashboard,
  Loader2,
} from 'lucide-react'
import api from '@shared/api/client'
import AppLayout from '@packages/ui/src/components/layout/AppLayout'
import PageListLayout from '@packages/ui/src/components/common/PageListLayout'
import ModuleOverview from '@packages/ui/src/components/common/ModuleOverview'
import {
  Badge,
  Card,
  Empty,
  Progress,
  Spinner,
} from '@packages/ui/src/components/common/ui'

const REFRESH_INTERVAL_MS = 5000

const STATUS_VARIANT = {
  completed: 'success',
  pending: 'warning',
  running: 'info',
  failed: 'danger',
}

const PROGRESS_STATUS = {
  completed: 'success',
  pending: 'normal',
  running: 'active',
  failed: 'exception',
}

const STAT_ICON = {
  configuredApps: CloudCog,
  completedFlows: CheckCircle2,
  pendingFlows: Clock,
  runningFlows: Activity,
}

const getRunProgressPercent = (run) => {
  const value = run?.execution_details?.progress_percent
  if (typeof value === 'number') return Math.max(0, Math.min(100, Math.round(value)))
  if (run?.status === 'completed' || run?.status === 'failed') return 100
  if (run?.status === 'running') return 15
  return 0
}

const getRunStepLabel = (run) => {
  if (run?.execution_details?.step_label) return run.execution_details.step_label
  if (run?.status === 'pending') return 'Queued'
  if (run?.status === 'running') return run?.latest_log_line || 'Running'
  if (run?.status === 'failed') return run?.error_message || 'Failed'
  return run?.latest_log_line || 'Completed'
}

const getRunStructurePath = (run) =>
  run?.execution_details?.structure_path || '—'

const getRunSummary = (run) => {
  const d = run?.execution_details || {}
  if (d.app === 'service') {
    return `${d.completed_services || 0}/${d.total_services || 0} services · ${d.total_tickets || 0} tickets · ${d.attachments_downloaded || 0} attachments`
  }
  if (d.app === 'request') {
    return `${d.completed_groups || 0}/${d.total_groups || 0} groups · ${d.total_requests || 0} requests`
  }
  if (run?.status === 'failed') return run?.error_message || 'Failed'
  return run?.latest_log_line || '—'
}

const StatCard = ({ label, value, icon: Icon, loading }) => (
  <div className="rounded-xl border border-[rgb(var(--border-line))] bg-surface-1 p-4">
    <div className="flex items-center justify-between">
      <p className="text-tiny uppercase tracking-[0.14em] text-text-quaternary font-emphasis">{label}</p>
      <Icon className="h-4 w-4 text-text-quaternary" />
    </div>
    <div className="mt-2.5 text-xl font-strong text-text-primary">
      {loading ? <Loader2 className="h-5 w-5 animate-spin text-text-tertiary" /> : value}
    </div>
  </div>
)

const ActiveRunCard = ({ run }) => {
  const status = run.status || 'pending'
  return (
    <Card elevation="flat" className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-small font-strong text-text-primary truncate">
            {run.flow_name || 'Unnamed flow'}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge variant="info" size="sm">{run.app_name || run.app || 'Unknown'}</Badge>
            <Badge variant={STATUS_VARIANT[status] || 'neutral'} size="sm" dot>
              {status}
            </Badge>
            <span className="text-caption text-text-tertiary">
              Started {dayjs(run.started_at).format('DD/MM HH:mm:ss')}
            </span>
          </div>
        </div>
        <div className="min-w-[240px] flex-1">
          <Progress
            percent={getRunProgressPercent(run)}
            status={PROGRESS_STATUS[status] || 'normal'}
          />
        </div>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-3">
        {[
          ['Current step', getRunStepLabel(run)],
          ['Structure', getRunStructurePath(run)],
          ['Scope', getRunSummary(run)],
        ].map(([label, value]) => (
          <div key={label}>
            <p className="text-tiny uppercase tracking-[0.14em] text-text-quaternary font-emphasis">{label}</p>
            <p className="mt-1 text-caption text-text-primary font-emphasis truncate">{value}</p>
          </div>
        ))}
      </div>
    </Card>
  )
}

const RecentRunsTable = ({ rows }) => {
  if (rows.length === 0) return <Empty description="No backup runs yet" />
  return (
    <div className="overflow-hidden rounded-lg border border-[rgb(var(--border-line))] bg-surface-1">
      <table className="w-full text-caption">
        <thead className="bg-surface-2 text-text-tertiary">
          <tr>
            {['Flow', 'Started', 'Status', 'Step', 'Structure', 'Progress'].map((h) => (
              <th key={h} className="px-3 py-2 text-left font-emphasis">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-linear">
          {rows.map((row) => {
            const status = row.status || 'pending'
            return (
              <tr key={row.run_id} className="hover:bg-surface-2/60">
                <td className="px-3 py-2">
                  <div className="font-emphasis text-text-primary truncate">{row.flow_name || 'Unnamed flow'}</div>
                  <div className="text-tiny text-text-tertiary">{row.app_name || row.app || 'Unknown'}</div>
                </td>
                <td className="px-3 py-2 text-text-secondary whitespace-nowrap">
                  {dayjs(row.started_at).format('DD/MM HH:mm:ss')}
                </td>
                <td className="px-3 py-2">
                  <Badge variant={STATUS_VARIANT[status] || 'neutral'} size="sm" dot>
                    {status}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-text-primary">{getRunStepLabel(row)}</td>
                <td className="px-3 py-2 text-text-secondary">{getRunStructurePath(row)}</td>
                <td className="px-3 py-2 w-[220px]">
                  <Progress
                    percent={getRunProgressPercent(row)}
                    status={PROGRESS_STATUS[status] || 'normal'}
                    size="small"
                  />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

const DashboardPage = () => {
  const [activeRuns, setActiveRuns] = useState([])
  const [recentRuns, setRecentRuns] = useState([])
  const [stats, setStats] = useState({
    configuredApps: 0,
    completedFlows: 0,
    pendingFlows: 0,
    runningFlows: 0,
  })
  const [loading, setLoading] = useState(false)
  const [lastUpdated, setLastUpdated] = useState(null)

  useEffect(() => {
    let active = true
    const load = async () => {
      if (active) setLoading(true)
      try {
        const { data } = await api.get(`/api/backup-flows/dashboard`, {
          params: { recent_limit: 8, active_limit: 6 },
        })
        if (!active) return
        setStats({
          configuredApps: data.configured_apps || 0,
          completedFlows: data.completed_flows || 0,
          pendingFlows: data.pending_flows || 0,
          runningFlows: data.running_flows || 0,
        })
        setActiveRuns(data.active_runs || [])
        setRecentRuns(data.recent_runs || [])
        setLastUpdated(dayjs())
      } catch (error) {
        if (!active) return
        console.error('Failed to load dashboard data', error)
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    const id = window.setInterval(load, REFRESH_INTERVAL_MS)
    return () => { active = false; window.clearInterval(id) }
  }, [])

  return (
    <AppLayout>
      <PageListLayout
        title="Dashboard"
        description="Live backup flow activity and structure progress."
        overview={(
          <ModuleOverview
            icon={LayoutDashboard}
            title="Operations overview"
            description="Auto-refreshes every 5 seconds."
            badges={['Live', 'Auto-refresh']}
            stats={[
              { label: 'Configured apps', value: stats.configuredApps, helper: 'Across all sources.' },
              { label: 'Completed', value: stats.completedFlows, helper: 'Finished flows.' },
              { label: 'Running', value: stats.runningFlows, helper: 'In progress now.' },
            ]}
          />
        )}
        searchable={false}
        viewToggle={false}
        toolbarExtra={() => (
          <span className="text-caption text-text-tertiary">
            {lastUpdated ? `Updated ${lastUpdated.format('HH:mm:ss')}` : 'Loading…'}
          </span>
        )}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Configured apps" value={stats.configuredApps} icon={STAT_ICON.configuredApps} loading={loading} />
          <StatCard label="Completed" value={stats.completedFlows} icon={STAT_ICON.completedFlows} loading={loading} />
          <StatCard label="Pending" value={stats.pendingFlows} icon={STAT_ICON.pendingFlows} loading={loading} />
          <StatCard label="Running" value={stats.runningFlows} icon={STAT_ICON.runningFlows} loading={loading} />
        </div>

        <section className="mt-6">
          <h2 className="mb-3 text-small font-strong text-text-primary">Active flows</h2>
          {loading && activeRuns.length === 0 ? (
            <div className="flex justify-center py-8"><Spinner /></div>
          ) : activeRuns.length === 0 ? (
            <Empty description="No flows running" />
          ) : (
            <div className="flex flex-col gap-2.5">
              {activeRuns.map((run) => <ActiveRunCard key={run.run_id} run={run} />)}
            </div>
          )}
        </section>

        <section className="mt-6">
          <h2 className="mb-3 text-small font-strong text-text-primary">Recent history</h2>
          <RecentRunsTable rows={recentRuns} />
        </section>
      </PageListLayout>
    </AppLayout>
  )
}

export default DashboardPage
