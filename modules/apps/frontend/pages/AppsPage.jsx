import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Database, Plus, Search, Settings, Shield } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import api from '@shared/api/client'
import { APPS, DESTINATION_OPTIONS } from '@modules/backup/frontend/constants'
import ModuleOverview from '@packages/ui/src/components/common/ModuleOverview'
import PageListLayout from '@packages/ui/src/components/common/PageListLayout'
import { Alert, message } from '@packages/ui/src/components/common/ui'
import AppLayout from '@packages/ui/src/components/layout/AppLayout'
import { hasPermission } from '@modules/identity/frontend/lib/permissions'
import { useAuthStore } from '@modules/identity/frontend/store/authStore'


const EMPTY_OVERVIEW = {
  connection_count: 0,
  connected_app_count: 0,
  storage_count: 0,
  storage_type_count: 0,
  connected_app_ids: [],
  storage_types: [],
  connections_by_app: {},
  storage_profiles_by_type: {},
}

const GOOGLE_DRIVE_OPTION = DESTINATION_OPTIONS.find((option) => option.id === 'gdrive')
const GOOGLE_SHEETS_OPTION = DESTINATION_OPTIONS.find((option) => option.id === 'gsheets')

const APP_DIRECTORY = [
  {
    id: 'request',
    title: APPS.request.name,
    description: 'Save the Request domain and token once here, then let Backup or Automation decide later how they read request data.',
    keywords: ['request', 'group', 'ticket'],
    icon: APPS.request.icon,
    color: APPS.request.color,
    bg: APPS.request.bg,
    countKey: 'request',
    countLabel: 'saved connections',
    connectPath: '/apps/connections?app=request&create=1',
    managePath: '/apps/connections?app=request',
  },
  {
    id: 'service',
    title: APPS.service.name,
    description: 'Create the Service connection once here so later modules can choose backup scope, services, and execution logic on top of it.',
    keywords: ['service', 'ticket', 'helpdesk'],
    icon: APPS.service.icon,
    color: APPS.service.color,
    bg: APPS.service.bg,
    countKey: 'service',
    countLabel: 'saved connections',
    connectPath: '/apps/connections?app=service&create=1',
    managePath: '/apps/connections?app=service',
  },
  {
    id: 'workflow',
    title: APPS.workflow.name,
    description: 'Connect Workflow once, then let the other modules decide which workflows, jobs, or execution rules they need to use.',
    keywords: ['workflow', 'job', 'process'],
    icon: APPS.workflow.icon,
    color: APPS.workflow.color,
    bg: APPS.workflow.bg,
    countKey: 'workflow',
    countLabel: 'saved connections',
    connectPath: '/apps/connections?app=workflow&create=1',
    managePath: '/apps/connections?app=workflow',
  },
  {
    id: 'wework',
    title: APPS.wework.name,
    description: 'Register WeWork here first, then keep project, task, and flow-specific logic inside the modules that actually consume that connection.',
    keywords: ['wework', 'project', 'task'],
    icon: APPS.wework.icon,
    color: APPS.wework.color,
    bg: APPS.wework.bg,
    countKey: 'wework',
    countLabel: 'saved connections',
    connectPath: '/apps/connections?app=wework&create=1',
    managePath: '/apps/connections?app=wework',
  },
  {
    id: 'gdrive',
    title: GOOGLE_DRIVE_OPTION?.title || 'Google Drive',
    description: 'Prepare reusable Google Drive targets here first, then let Backup or Automation decide when files should be written into them.',
    keywords: ['google', 'drive', 'folder'],
    icon: GOOGLE_DRIVE_OPTION?.icon,
    color: GOOGLE_DRIVE_OPTION?.color || '#1a73e8',
    bg: '#eff6ff',
    countKey: 'gdrive',
    countLabel: 'saved profiles',
    connectPath: '/apps/storage?type=gdrive&create=1',
    managePath: '/apps/storage?type=gdrive',
  },
  {
    id: 'gsheets',
    title: GOOGLE_SHEETS_OPTION?.title || 'Google Sheets',
    description: 'Prepare reusable Google Sheets targets here first, then let the consuming modules decide what data they export there later.',
    keywords: ['google', 'sheets', 'spreadsheet'],
    icon: GOOGLE_SHEETS_OPTION?.icon,
    color: GOOGLE_SHEETS_OPTION?.color || '#0f9d58',
    bg: '#f0fdf4',
    countKey: 'gsheets',
    countLabel: 'saved profiles',
    connectPath: '/apps/storage?type=gsheets&create=1',
    managePath: '/apps/storage?type=gsheets',
  },
]

const APP_TABS = [
  {
    key: 'available',
    label: 'Available Apps',
    description: 'All apps that this workspace currently supports for future use.',
  },
  {
    key: 'connected',
    label: 'Connected Apps',
    description: 'Only apps that already have at least one saved connection or storage profile.',
  },
]

const DEFAULT_APP_TAB = 'available'
const APP_TAB_KEYS = new Set(APP_TABS.map((tab) => tab.key))

function normalizeAppTab(tabKey) {
  if (tabKey && APP_TAB_KEYS.has(tabKey)) {
    return tabKey
  }
  return DEFAULT_APP_TAB
}


function AppsPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const directoryRef = useRef(null)
  const permissions = useAuthStore((state) => state.permissions)
  const canManageApps = hasPermission(permissions, 'apps', 'edit')
  const canManageSettings = hasPermission(permissions, 'settings', 'full')
  const [overview, setOverview] = useState(EMPTY_OVERVIEW)
  const [loading, setLoading] = useState(true)
  const activeTab = normalizeAppTab(searchParams.get('tab'))

  const getConnectionCount = (entry) => {
    if (entry.countLabel === 'saved profiles') {
      return overview.storage_profiles_by_type?.[entry.countKey] || 0
    }
    return overview.connections_by_app?.[entry.countKey] || 0
  }

  const connectedAppCount = useMemo(
    () => APP_DIRECTORY.filter((entry) => getConnectionCount(entry) > 0).length,
    [overview],
  )

  const handleTabChange = (tabKey) => {
    const nextParams = new URLSearchParams(searchParams)

    if (tabKey === DEFAULT_APP_TAB) {
      nextParams.delete('tab')
    } else {
      nextParams.set('tab', tabKey)
    }

    setSearchParams(nextParams)
  }

  useEffect(() => {
    const requestedTab = searchParams.get('tab')
    if (requestedTab && !APP_TAB_KEYS.has(requestedTab)) {
      const nextParams = new URLSearchParams(searchParams)
      nextParams.delete('tab')
      setSearchParams(nextParams, { replace: true })
    }
  }, [searchParams, setSearchParams])

  useEffect(() => {
    let cancelled = false

    const loadOverview = async () => {
      setLoading(true)
      try {
        const res = await api.get('/api/apps/overview')
        if (!cancelled) {
          setOverview({ ...EMPTY_OVERVIEW, ...(res.data || {}) })
        }
      } catch {
        if (!cancelled) {
          setOverview(EMPTY_OVERVIEW)
          message.error('Failed to load Apps overview')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void loadOverview()

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <AppLayout>
      <PageListLayout
        title="Apps"
        description="Search the app a user wants, connect it once here, then let Backup, Automation, or other modules decide what they do with that connection later."
        overview={(
          <ModuleOverview
            icon={Database}
            title="Connect-first app workspace"
            description="Apps is now the registry of connected applications. Users search the app they need, create the reusable connection once, and only decide usage later inside the consuming modules."
            badges={['Search app', 'Connect once', 'Reuse later']}
            stats={[
              {
                label: 'Connected apps',
                value: overview.connected_app_count || connectedAppCount,
                helper: 'App types that already have at least one saved connection.',
              },
              {
                label: 'App connections',
                value: overview.connection_count,
                helper: 'Reusable app credentials already registered.',
              },
              {
                label: 'Storage profiles',
                value: overview.storage_count,
                helper: 'Reusable Google storage targets ready for later use.',
              },
            ]}
          />
        )}
        action={(
          <button
            type="button"
            onClick={() => directoryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            New App
          </button>
        )}
        isLoading={loading}
        loadingText="Loading apps overview…"
        searchPlaceholder="Search apps the user wants to connect"
        defaultView="list"
      >
        {({ filterText, viewMode }) => {
          const normalizedFilter = filterText.trim().toLowerCase()
          const activeTabMeta = APP_TABS.find((tab) => tab.key === activeTab) || APP_TABS[0]
          const visibleApps = APP_DIRECTORY.filter((entry) => {
            if (activeTab === 'connected' && getConnectionCount(entry) === 0) return false
            if (!normalizedFilter) return true
            return [entry.title, entry.description, ...entry.keywords]
              .filter(Boolean)
              .some((value) => String(value).toLowerCase().includes(normalizedFilter))
          })

          const totalForTab = activeTab === 'connected'
            ? APP_DIRECTORY.filter((entry) => getConnectionCount(entry) > 0).length
            : APP_DIRECTORY.length

          return (
            <div className="space-y-6">
              <Alert
                type="info"
                message="Search app first, decide usage later"
                description="Apps no longer asks the user to think in terms of source or destination. This module is only for finding the app and saving the reusable connection first. Backup, Automation, and the other modules decide later how they use that app."
              />

              <div ref={directoryRef} className="space-y-4">
                <div className="rounded-2xl border border-gray-200 bg-white p-2 shadow-sm">
                  <div className="flex flex-wrap gap-2">
                    {APP_TABS.map((tab) => {
                      const isActive = activeTab === tab.key
                      const tabCount = tab.key === 'connected' ? connectedAppCount : APP_DIRECTORY.length

                      return (
                        <button
                          key={tab.key}
                          type="button"
                          onClick={() => handleTabChange(tab.key)}
                          className={`flex items-center gap-2 rounded-xl px-4 py-3 text-left transition-colors ${
                            isActive
                              ? 'bg-blue-600 text-white shadow-sm'
                              : 'bg-white text-gray-600 hover:bg-gray-50'
                          }`}
                        >
                          <span className="text-sm font-semibold">{tab.label}</span>
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            isActive
                              ? 'bg-white/15 text-white'
                              : 'bg-gray-100 text-gray-500'
                          }`}
                          >
                            {tabCount}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900">{activeTabMeta.label}</h2>
                    <p className="mt-1 text-sm text-gray-500">{activeTabMeta.description}</p>
                  </div>
                  <div className="hidden items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-500 md:flex">
                    <Search className="h-3.5 w-3.5" />
                    {visibleApps.length} of {totalForTab} shown
                  </div>
                </div>

                {visibleApps.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-gray-200 bg-white px-6 py-12 text-center shadow-sm">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-400">
                      <Search className="h-5 w-5" />
                    </div>
                    <h3 className="mt-4 text-base font-semibold text-gray-900">
                      {activeTab === 'connected' && totalForTab === 0 ? 'No connected apps yet' : 'No apps match your search'}
                    </h3>
                    <p className="mt-2 text-sm text-gray-500">
                      {activeTab === 'connected' && totalForTab === 0
                        ? 'Connect an app first, then it will appear here as a reusable connected app.'
                        : 'Try another keyword such as Request, Service, Drive, or Sheets.'}
                    </p>
                  </div>
                ) : viewMode === 'grid' ? (
                  <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                    {visibleApps.map((entry) => (
                      <AppDirectoryCard
                        key={entry.id}
                        entry={entry}
                        connectionCount={getConnectionCount(entry)}
                        canManageApps={canManageApps}
                        onConnect={() => navigate(entry.connectPath)}
                        onManage={() => navigate(entry.managePath)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                    {visibleApps.map((entry) => (
                      <AppDirectoryRow
                        key={entry.id}
                        entry={entry}
                        connectionCount={getConnectionCount(entry)}
                        canManageApps={canManageApps}
                        onConnect={() => navigate(entry.connectPath)}
                        onManage={() => navigate(entry.managePath)}
                      />
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="max-w-2xl">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                      <Shield className="h-5 w-5" />
                    </div>
                    <h3 className="mt-4 text-base font-semibold text-gray-900">Workspace credentials stay in Settings</h3>
                    <p className="mt-2 text-sm leading-6 text-gray-500">Apps handles reusable app connections. Workspace-level OAuth client settings and shared service-account controls still live in Settings because they affect the whole workspace, not just one connected app.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => navigate('/settings')}
                    className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
                  >
                    {canManageSettings ? 'Open settings' : 'View settings'}
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          )
        }}
      </PageListLayout>
    </AppLayout>
  )
}


function AppDirectoryCard({ entry, connectionCount, canManageApps, onConnect, onManage }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:border-blue-200 hover:shadow-md">
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl" style={{ backgroundColor: entry.bg, color: entry.color }}>
        {entry.icon}
      </div>
      <div className="mt-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">{entry.title}</h2>
          <p className="mt-2 text-sm leading-6 text-gray-500">{entry.description}</p>
        </div>
        <div className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${connectionCount > 0 ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
          {connectionCount > 0 ? `${connectionCount} ${entry.countLabel}` : 'Not connected yet'}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {entry.keywords.map((keyword) => (
          <span key={keyword} className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-500">
            {keyword}
          </span>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={canManageApps ? onConnect : onManage}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
        >
          {canManageApps ? (connectionCount > 0 ? 'Add connection' : 'Connect app') : 'View app'}
          <ArrowRight className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onManage}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
        >
          Open saved connections
        </button>
      </div>
    </div>
  )
}


function AppDirectoryRow({ entry, connectionCount, canManageApps, onConnect, onManage }) {
  return (
    <div className="flex flex-col gap-4 border-b border-gray-100 px-5 py-5 last:border-b-0 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex min-w-0 items-start gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl" style={{ backgroundColor: entry.bg, color: entry.color }}>
          {entry.icon}
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-gray-900">{entry.title}</h3>
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${connectionCount > 0 ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
              {connectionCount > 0 ? `${connectionCount} ${entry.countLabel}` : 'Not connected yet'}
            </span>
          </div>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-500">{entry.description}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {entry.keywords.map((keyword) => (
              <span key={keyword} className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-500">
                {keyword}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 lg:justify-end">
        <button
          type="button"
          onClick={canManageApps ? onConnect : onManage}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
        >
          {canManageApps ? (connectionCount > 0 ? 'Add connection' : 'Connect app') : 'View app'}
          <ArrowRight className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onManage}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
        >
          Open saved connections
        </button>
      </div>
    </div>
  )
}


export default AppsPage