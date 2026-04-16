import React, { useEffect, useMemo, useState } from 'react'
import {
  CheckCircle,
  Globe,
  Headphones,
  Inbox,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Shield,
  Trash2,
  Workflow,
  Building2,
  Eye,
  EyeOff,
} from 'lucide-react'
import api from '@shared/api/client'
import AppLayout from '@packages/ui/src/components/layout/AppLayout'
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
  const [sources, setSources] = useState([])
  const [loadingSources, setLoadingSources] = useState(true)
  const [activeAppFilter, setActiveAppFilter] = useState('all')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [showToken, setShowToken] = useState(false)

  const fetchSources = async (appId = activeAppFilter) => {
    setLoadingSources(true)
    try {
      const res = await api.get('/api/sources', {
        params: appId && appId !== 'all' ? { app_id: appId } : undefined,
      })
      setSources(Array.isArray(res.data) ? res.data : [])
    } catch {
      message.error('Failed to load saved sources')
      setSources([])
    } finally {
      setLoadingSources(false)
    }
  }

  useEffect(() => {
    void fetchSources(activeAppFilter)
  }, [activeAppFilter])

  const totalApps = useMemo(() => new Set(sources.map(item => item.app_id)).size, [sources])

  const resetModal = () => {
    setModalOpen(false)
    setEditingId(null)
    setForm(EMPTY_FORM)
    setShowToken(false)
  }

  const openCreateModal = () => {
    setEditingId(null)
    setForm({
      ...EMPTY_FORM,
      app_id: activeAppFilter !== 'all' ? activeAppFilter : 'request',
    })
    setShowToken(false)
    setModalOpen(true)
  }

  const openEditModal = async (sourceId) => {
    setLoadingDetail(true)
    try {
      const res = await api.get(`/api/sources/${sourceId}`)
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

  const handleDelete = async (source) => {
    if (!window.confirm(`Delete saved source "${source.name}"?`)) return
    try {
      await api.delete(`/api/sources/${source.id}`)
      message.success('Saved source deleted')
      await fetchSources(activeAppFilter)
    } catch (err) {
      message.error(err.response?.data?.detail || 'Failed to delete saved source')
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
        await api.put(`/api/sources/${editingId}`, payload)
        message.success('Saved source updated')
      } else {
        await api.post('/api/sources', payload)
        message.success('Saved source created')
      }

      resetModal()
      await fetchSources(activeAppFilter)
    } catch (err) {
      message.error(err.response?.data?.detail || 'Failed to save source')
    } finally {
      setSaving(false)
    }
  }

  const selectedConfig = APP_CONNECTION_CONFIG[form.app_id] || APP_CONNECTION_CONFIG.request

  return (
    <AppLayout>
      <div className="p-8 space-y-6">
        <section className="rounded-3xl border border-blue-100 bg-gradient-to-br from-white via-blue-50 to-cyan-50 p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-white/80 px-3 py-1 text-xs font-semibold text-blue-700">
                <Shield className="w-3.5 h-3.5" />
                Reusable connection layer
              </div>
              <h1 className="mt-4 text-2xl font-bold text-gray-900">Sources</h1>
              <p className="mt-2 text-sm leading-6 text-gray-600">
                Save source credentials once, then apply them into many backup flows without re-entering the same domain and token.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <StatCard label="Saved sources" value={String(sources.length)} />
              <StatCard label="Connected apps" value={String(totalApps)} />
              <button
                type="button"
                onClick={openCreateModal}
                className="inline-flex min-w-[180px] items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-4 text-sm font-semibold text-white shadow-sm shadow-blue-200 transition-colors hover:bg-blue-700"
              >
                <Plus className="w-4 h-4" />
                New Source
              </button>
            </div>
          </div>
        </section>

        <Alert
          type="info"
          message="Source templates only store connection details"
          description="Objects, filters, and per-flow scope still belong to each backup flow, so you can reuse one source across many different backups."
        />

        <section className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Saved source connections</h2>
              <p className="mt-1 text-sm text-gray-500">Filter by application, then edit or remove existing reusable connections.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => fetchSources(activeAppFilter)}
                className="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50"
              >
                <RefreshCw className="w-4 h-4" />
                Refresh
              </button>
              <button
                type="button"
                onClick={openCreateModal}
                className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100"
              >
                <Plus className="w-4 h-4" />
                Add Source
              </button>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
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

          <div className="mt-6">
            {loadingSources ? (
              <SpinCenter text="Loading saved sources…" />
            ) : sources.length === 0 ? (
              <EmptyPanel
                title="No saved sources yet"
                description="Create your first reusable connection here, then apply it directly inside the backup wizard."
                actionLabel="Create source"
                onAction={openCreateModal}
              />
            ) : (
              <div className="grid gap-4 xl:grid-cols-2">
                {sources.map(source => (
                  <SourceCard
                    key={source.id}
                    source={source}
                    onEdit={() => openEditModal(source.id)}
                    onDelete={() => handleDelete(source)}
                  />
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      <Modal
        open={modalOpen}
        onCancel={resetModal}
        title={editingId ? 'Edit Source' : 'Create Source'}
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
              {editingId ? 'Save Changes' : 'Create Source'}
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
    </AppLayout>
  )
}

function SourceCard({ source, onEdit, onDelete }) {
  const app = APPS[source.app_id]
  const Icon = APP_ICONS[source.app_id] || Globe

  return (
    <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm transition-colors hover:border-gray-300">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl"
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
      </div>

      {source.description && <p className="mt-4 text-sm leading-6 text-gray-600">{source.description}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-gray-400">
        <span className="rounded-full bg-gray-100 px-2 py-1">Updated {formatDateTime(source.updated_at)}</span>
        <span className="rounded-full bg-green-50 px-2 py-1 text-green-700">Ready to reuse</span>
      </div>
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
    <div className="rounded-3xl border-2 border-dashed border-gray-200 px-6 py-12 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
        <CheckCircle className="w-6 h-6" />
      </div>
      <h3 className="mt-4 text-lg font-semibold text-gray-900">{title}</h3>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-gray-500">{description}</p>
      <button
        type="button"
        onClick={onAction}
        className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
      >
        <Plus className="w-4 h-4" />
        {actionLabel}
      </button>
    </div>
  )
}

export default SourceConnectionsPage