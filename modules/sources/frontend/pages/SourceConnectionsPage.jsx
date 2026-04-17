import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  CheckCircle,
  Database,
  Globe,
  Headphones,
  Inbox,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Shield,
  Trash2,
  Workflow,
  Building2,
  Eye,
  EyeOff,
} from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import api from '@shared/api/client'
import AppLayout from '@packages/ui/src/components/layout/AppLayout'
import ConfirmDialog from '@packages/ui/src/components/common/ConfirmDialog'
import ModuleOverview from '@packages/ui/src/components/common/ModuleOverview'
import PageListLayout from '@packages/ui/src/components/common/PageListLayout'
import { hasPermission } from '@modules/identity/frontend/lib/permissions'
import { useAuthStore } from '@modules/identity/frontend/store/authStore'
import { Alert, Modal, SpinCenter, Tag, message } from '@packages/ui/src/components/common/ui'
import { APPS, APP_CONNECTION_CONFIG, formatDateTime } from '@modules/backup/frontend/constants'

const APP_ICONS = {
  request: Inbox,
  workflow: Workflow,
  wework: Building2,
  service: Headphones,
}

const EMPTY_FORM = {
  name: '',
  description: '',
  app_id: 'request',
  domain: '',
  access_token: '',
}

function SourceConnectionsPage() {
  const [searchParams] = useSearchParams()
  const handledIntentRef = useRef('')
  const [sources, setSources] = useState([])
  const [loadingSources, setLoadingSources] = useState(true)
  const [activeAppFilter, setActiveAppFilter] = useState('all')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [showToken, setShowToken] = useState(false)
  const [sourceToDelete, setSourceToDelete] = useState(null)
  const [deletingSource, setDeletingSource] = useState(false)
  const permissions = useAuthStore((state) => state.permissions)
  const canEditSources = hasPermission(permissions, 'apps', 'edit')

  const fetchSources = async () => {
    setLoadingSources(true)
    try {
      const res = await api.get('/api/apps/connections')
      setSources(Array.isArray(res.data) ? res.data : [])
    } catch {
      message.error('Failed to load app connections')
      setSources([])
    } finally {
      setLoadingSources(false)
    }
  }

  useEffect(() => {
    void fetchSources()
  }, [])

  const totalApps = useMemo(() => new Set(sources.map(item => item.app_id)).size, [sources])
  const documentedSources = useMemo(
    () => sources.filter((item) => Boolean(item.description?.trim())).length,
    [sources],
  )

  const resetModal = () => {
    setModalOpen(false)
    setEditingId(null)
    setForm(EMPTY_FORM)
    setShowToken(false)
  }

  const openCreateModal = (initialAppId = null) => {
    const resolvedAppId = initialAppId && APPS[initialAppId]
      ? initialAppId
      : activeAppFilter !== 'all' ? activeAppFilter : 'request'

    setEditingId(null)
    setForm({
      ...EMPTY_FORM,
      app_id: resolvedAppId,
    })
    setShowToken(false)
    setModalOpen(true)
  }

  useEffect(() => {
    const requestedAppId = searchParams.get('app')
    const normalizedAppId = requestedAppId && APPS[requestedAppId] ? requestedAppId : null
    const shouldCreate = searchParams.get('create') === '1'
    const signature = `${normalizedAppId || 'all'}|${shouldCreate ? 'create' : 'view'}`

    if (!normalizedAppId && !shouldCreate) return
    if (handledIntentRef.current === signature) return

    if (normalizedAppId) {
      setActiveAppFilter(normalizedAppId)
    }

    if (shouldCreate && canEditSources) {
      openCreateModal(normalizedAppId)
    }

    handledIntentRef.current = signature
  }, [searchParams, canEditSources])

  const openEditModal = async (sourceId) => {
    setLoadingDetail(true)
    try {
      const res = await api.get(`/api/apps/connections/${sourceId}`)
      const detail = res.data || {}
      setEditingId(String(detail.id || sourceId))
      setForm({
        name: detail.name || '',
        description: detail.description || '',
        app_id: detail.app_id || 'request',
        domain: detail.domain || '',
        access_token: detail.access_token || '',
      })
      setShowToken(false)
      setModalOpen(true)
    } catch (err) {
      message.error(err.response?.data?.detail || 'Failed to load source details')
    } finally {
      setLoadingDetail(false)
    }
  }

  const handleDelete = (source) => {
    setSourceToDelete(source)
  }

  const confirmDelete = async () => {
    if (!sourceToDelete) return
    setDeletingSource(true)
    try {
      await api.delete(`/api/apps/connections/${sourceToDelete.id}`)
      message.success('App connection deleted')
      await fetchSources()
      setSourceToDelete(null)
    } catch (err) {
      message.error(err.response?.data?.detail || 'Failed to delete app connection')
    } finally {
      setDeletingSource(false)
    }
  }

  const handleSave = async () => {
    if (!form.name.trim()) {
      message.warning('Please enter a source name')
      return
    }
    if (!form.app_id) {
      message.warning('Please choose a source app')
      return
    }
    if (!form.domain.trim()) {
      message.warning('Please enter the source domain')
      return
    }
    if (!form.access_token.trim()) {
      message.warning('Please enter the access token')
      return
    }

    setSaving(true)
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        app_id: form.app_id,
        app_name: APPS[form.app_id]?.name || form.app_id,
        domain: form.domain.trim(),
        access_token: form.access_token.trim(),
      }

      if (editingId) {
        await api.put(`/api/apps/connections/${editingId}`, payload)
        message.success('App connection updated')
      } else {
        await api.post('/api/apps/connections', payload)
        message.success('App connection created')
      }

      resetModal()
      await fetchSources()
    } catch (err) {
      message.error(err.response?.data?.detail || 'Failed to save source')
    } finally {
      setSaving(false)
    }
  }

  const selectedConfig = APP_CONNECTION_CONFIG[form.app_id] || APP_CONNECTION_CONFIG.request
  const visibleSources = useMemo(() => {
    return sources.filter((item) => activeAppFilter === 'all' || item.app_id === activeAppFilter)
  }, [activeAppFilter, sources])

  return (
    <AppLayout>
      <PageListLayout
        title="App Connections"
        description="Reusable app connections managed inside Apps so the other modules can decide later what data they read from each connected app."
        overview={(
          <ModuleOverview
            icon={Database}
            title="Connected app catalog"
            description="Connect Request, Service, Workflow, or WeWork once here, then let Backup or Automation decide later how that app is consumed."
            badges={['Connect once', 'App-scoped', 'Reuse later']}
            stats={[
              {
                label: 'Saved connections',
                value: sources.length,
                helper: 'Reusable connection profiles available for flows.',
              },
              {
                label: 'Connected apps',
                value: totalApps,
                helper: 'Different source applications represented here.',
              },
              {
                label: 'Documented',
                value: documentedSources,
                helper: 'Sources already carrying team-facing notes.',
              },
            ]}
          />
        )}
        action={canEditSources ? (
          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            New App
          </button>
        ) : null}
        isLoading={loadingSources}
        loadingText="Loading app connections…"
        searchPlaceholder="Search app connections, domains, descriptions, or apps"
        defaultView="grid"
      >
        {({ viewMode, filterText }) => {
          const normalizedFilter = filterText.trim().toLowerCase()
          const filteredSources = visibleSources.filter((source) => {
            if (!normalizedFilter) return true
            return [
              source.name,
              source.description,
              source.domain,
              source.app_name,
              APPS[source.app_id]?.name,
            ]
              .filter(Boolean)
              .some((value) => String(value).toLowerCase().includes(normalizedFilter))
          })

          return (
            <div className="space-y-6">
              <Alert
                type="info"
                message="This page only saves reusable app credentials"
                description={canEditSources
                  ? 'Data selection, filters, and execution logic still belong to Backup or Automation, so you can connect an app here once and reuse it later in many flows.'
                  : 'Your account currently has read-only access in Apps. You can inspect saved app connections but cannot create or edit them.'}
              />

              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap gap-2">
                  <FilterButton
                    active={activeAppFilter === 'all'}
                    label="All apps"
                    onClick={() => setActiveAppFilter('all')}
                  />
                  {Object.values(APPS).map(app => (
                    <FilterButton
                      key={app.id}
                      active={activeAppFilter === app.id}
                      label={app.name}
                      color={app.color}
                      onClick={() => setActiveAppFilter(app.id)}
                    />
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => fetchSources()}
                  className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50"
                >
                  <RefreshCw className="h-4 w-4" />
                  Refresh
                </button>
              </div>

              {sources.length === 0 ? (
                <EmptyPanel
                  title="No app connections yet"
                  description="Connect your first reusable app here, then let Backup or the other modules decide later how they use it."
                  actionLabel={canEditSources ? 'Connect app' : null}
                  onAction={canEditSources ? openCreateModal : null}
                />
              ) : filteredSources.length === 0 ? (
                <SearchEmptyState query={filterText} label="sources" />
              ) : viewMode === 'grid' ? (
                <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                  {filteredSources.map(source => (
                    <SourceCard
                      key={source.id}
                      source={source}
                      canEdit={canEditSources}
                      onEdit={canEditSources ? () => openEditModal(source.id) : null}
                      onDelete={canEditSources ? () => handleDelete(source) : null}
                    />
                  ))}
                </div>
              ) : (
                <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                  {filteredSources.map(source => (
                    <SourceListRow
                      key={source.id}
                      source={source}
                      canEdit={canEditSources}
                      onEdit={canEditSources ? () => openEditModal(source.id) : null}
                      onDelete={canEditSources ? () => handleDelete(source) : null}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        }}
      </PageListLayout>

      <Modal
        open={modalOpen}
        onCancel={resetModal}
        title={editingId ? 'Edit App Connection' : 'Create App Connection'}
        width={760}
        footer={(
          <>
            <button
              type="button"
              onClick={resetModal}
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {editingId ? 'Save Changes' : 'Create App'}
            </button>
          </>
        )}
      >
        {loadingDetail ? (
          <SpinCenter text="Loading source details…" />
        ) : (
          <div className="space-y-5">
            <div className="grid gap-5 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-semibold text-gray-800">Source name</label>
                <input
                  value={form.name}
                  onChange={(event) => setForm(prev => ({ ...prev, name: event.target.value }))}
                  placeholder="e.g. Request HR Production"
                  className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-semibold text-gray-800">App</label>
                <select
                  value={form.app_id}
                  onChange={(event) => setForm(prev => ({ ...prev, app_id: event.target.value }))}
                  className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                >
                  {Object.values(APPS).map(app => (
                    <option key={app.id} value={app.id}>{app.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-sm font-semibold text-gray-800">Description</label>
              <textarea
                value={form.description}
                onChange={(event) => setForm(prev => ({ ...prev, description: event.target.value }))}
                rows={3}
                placeholder="What this reusable source is for"
                className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>

            <div className="rounded-3xl border border-blue-100 bg-blue-50/50 p-5">
              <div className="flex items-center gap-2 text-sm font-semibold text-blue-800">
                <Globe className="w-4 h-4" />
                {selectedConfig.stepTitle}
              </div>
              <div className="mt-4 grid gap-5 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-semibold text-gray-800">{selectedConfig.domainLabel || 'Domain'}</label>
                  <input
                    value={form.domain}
                    onChange={(event) => setForm(prev => ({ ...prev, domain: event.target.value }))}
                    placeholder={selectedConfig.domainPlaceholder}
                    className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                  <p className="mt-2 text-xs text-gray-400">{selectedConfig.domainHelp}</p>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-semibold text-gray-800">{selectedConfig.tokenLabel || 'Access Token'}</label>
                  <div className="relative">
                    <input
                      type={showToken ? 'text' : 'password'}
                      value={form.access_token}
                      onChange={(event) => setForm(prev => ({ ...prev, access_token: event.target.value }))}
                      placeholder={selectedConfig.tokenPlaceholder || 'Paste your access token here'}
                      className="w-full rounded-2xl border border-gray-300 px-4 py-3 pr-12 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    />
                    <button
                      type="button"
                      onClick={() => setShowToken(prev => !prev)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                    >
                      {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-gray-400">{selectedConfig.tokenHelp}</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={Boolean(sourceToDelete)}
        onClose={() => { if (!deletingSource) setSourceToDelete(null) }}
        onConfirm={() => { void confirmDelete() }}
        title="Delete app connection?"
        description={sourceToDelete ? `Delete the app connection "${sourceToDelete.name}". Backup flows using it will need to reconnect or choose another saved app.` : ''}
        confirmLabel={deletingSource ? 'Deleting…' : 'Delete app'}
        cancelLabel="Cancel"
        variant="danger"
        isLoading={deletingSource}
      />
    </AppLayout>
  )
}

function SourceCard({ source, onEdit, onDelete, canEdit }) {
  const app = APPS[source.app_id]
  const Icon = APP_ICONS[source.app_id] || Globe

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:border-blue-300 hover:shadow-md">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
            style={{ backgroundColor: app?.bg || '#eff6ff', color: app?.color || '#2563eb' }}
          >
            <Icon className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold text-gray-900">{source.name}</h3>
              <Tag color="blue">{source.app_name}</Tag>
            </div>
            <div className="mt-1 text-sm text-gray-500">{source.domain || 'No domain configured'}</div>
          </div>
        </div>

        {canEdit && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onEdit}
              className="rounded-xl border border-gray-200 p-2 text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700"
            >
              <Pencil className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="rounded-xl border border-red-200 p-2 text-red-500 transition-colors hover:bg-red-50"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {source.description && <p className="mt-4 text-sm leading-6 text-gray-600">{source.description}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-gray-400">
        <span className="rounded-full bg-gray-100 px-2 py-1">Updated {formatDateTime(source.updated_at)}</span>
        <span className="rounded-full bg-green-50 px-2 py-1 text-green-700">Ready to reuse</span>
      </div>
    </div>
  )
}

function SourceListRow({ source, onEdit, onDelete, canEdit }) {
  const app = APPS[source.app_id]
  const Icon = APP_ICONS[source.app_id] || Globe

  return (
    <div className="flex items-center gap-4 border-b border-gray-100 px-5 py-4 last:border-b-0 hover:bg-gray-50">
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
        style={{ backgroundColor: app?.bg || '#eff6ff', color: app?.color || '#2563eb' }}
      >
        <Icon className="h-4 w-4" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-sm font-semibold text-gray-900">{source.name}</div>
          <Tag color="blue">{source.app_name}</Tag>
        </div>
        <div className="mt-1 text-xs text-gray-500">
          {source.domain || 'No domain configured'}
          {source.description && <span className="ml-2 hidden text-gray-400 md:inline">• {source.description}</span>}
        </div>
      </div>

      <div className="hidden text-xs text-gray-400 lg:block">Updated {formatDateTime(source.updated_at)}</div>

      {canEdit && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onEdit}
            className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-blue-50 hover:text-blue-600"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  )
}

function FilterButton({ active, label, onClick, color = '#2563eb' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border px-3 py-2 text-sm font-medium transition-colors"
      style={active
        ? { borderColor: color, backgroundColor: `${color}14`, color }
        : { borderColor: '#e5e7eb', backgroundColor: '#ffffff', color: '#4b5563' }}
    >
      {label}
    </button>
  )
}

function StatCard({ label, value }) {
  return (
    <div className="min-w-[140px] rounded-2xl border border-white/70 bg-white/80 px-4 py-3 shadow-sm backdrop-blur">
      <div className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</div>
      <div className="mt-1 text-2xl font-bold text-gray-900">{value}</div>
    </div>
  )
}

function EmptyPanel({ title, description, actionLabel, onAction }) {
  return (
    <div className="rounded-xl border-2 border-dashed border-gray-200 bg-white px-6 py-12 text-center shadow-sm">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
        <CheckCircle className="w-6 h-6" />
      </div>
      <h3 className="mt-4 text-lg font-semibold text-gray-900">{title}</h3>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-gray-500">{description}</p>
      {onAction && actionLabel && (
        <button
          type="button"
          onClick={onAction}
          className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
        >
          <Plus className="w-4 h-4" />
          {actionLabel}
        </button>
      )}
    </div>
  )
}

function SearchEmptyState({ query, label }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-200 bg-white px-6 py-12 text-center shadow-sm">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-400">
        <Search className="h-5 w-5" />
      </div>
      <h3 className="mt-4 text-base font-semibold text-gray-900">No {label} match your filters</h3>
      <p className="mt-2 text-sm text-gray-500">
        No results for <span className="font-medium text-gray-700">"{query}"</span>. Try another keyword or switch the app filter.
      </p>
    </div>
  )
}

export default SourceConnectionsPage