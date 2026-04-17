import React, { useEffect, useMemo, useState } from 'react'
import {
  CheckCircle,
  FileSpreadsheet,
  Folder,
  Globe,
  Loader2,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Shield,
  Trash2,
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
import { DEFAULT_GOOGLE_REDIRECT, DESTINATION_OPTIONS, formatDateTime } from '@modules/backup/frontend/constants'

function openGoogleOAuthPopup(authUrl, onSuccess, onError) {
  const width = 520
  const height = 660
  const popup = window.open(
    authUrl,
    'google-oauth',
    `width=${width},height=${height},top=${Math.round((window.screen.height - height) / 2)},left=${Math.round((window.screen.width - width) / 2)}`,
  )

  if (!popup) {
    onError('Popup blocked. Please allow popups for this site.')
    return
  }

  const onMessage = (event) => {
    if (!event.data || typeof event.data !== 'object') return
    const payload = event.data
    if (payload.success === true && payload.connection_id) {
      window.removeEventListener('message', onMessage)
      onSuccess(payload)
    } else if (payload.success === false) {
      window.removeEventListener('message', onMessage)
      onError(payload.error || 'Authentication failed')
    }
  }

  window.addEventListener('message', onMessage)

  const timer = setInterval(() => {
    if (popup.closed) {
      clearInterval(timer)
      window.removeEventListener('message', onMessage)
    }
  }, 800)
}

const EMPTY_FORM = {
  name: '',
  description: '',
  destination_type: 'gdrive',
  auth_mode: 'oauth',
  connection_id: '',
  folder_id: '',
  folder_name: '',
  drive_id: '',
  drive_name: '',
  service_account_source: 'shared',
  service_account_json_encrypted: '',
  service_account_email: '',
  project_id: '',
  service_account_file_name: '',
}

function DestinationProfilesPage() {
  const [searchParams] = useSearchParams()
  const [handledIntentSignature, setHandledIntentSignature] = useState('')
  const [profiles, setProfiles] = useState([])
  const [loadingProfiles, setLoadingProfiles] = useState(true)
  const [activeTypeFilter, setActiveTypeFilter] = useState('all')
  const [googleConnections, setGoogleConnections] = useState([])
  const [platformServiceAccount, setPlatformServiceAccount] = useState({ available: false, email: '' })
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [connectingGoogle, setConnectingGoogle] = useState(false)
  const [googleConfigModalOpen, setGoogleConfigModalOpen] = useState(false)
  const [googleConfigLoading, setGoogleConfigLoading] = useState(false)
  const [googleConfigSaving, setGoogleConfigSaving] = useState(false)
  const [googleSecretSet, setGoogleSecretSet] = useState(false)
  const [googleRedirectUri, setGoogleRedirectUri] = useState(DEFAULT_GOOGLE_REDIRECT)
  const [googleConfigError, setGoogleConfigError] = useState('')
  const [gcClientId, setGcClientId] = useState('')
  const [gcClientSecret, setGcClientSecret] = useState('')
  const [gcRedirectUri, setGcRedirectUri] = useState(DEFAULT_GOOGLE_REDIRECT)
  const [profileToDelete, setProfileToDelete] = useState(null)
  const [deletingProfile, setDeletingProfile] = useState(false)
  const permissions = useAuthStore((state) => state.permissions)
  const canEditDestinations = hasPermission(permissions, 'apps', 'edit')
  const canManageSettings = hasPermission(permissions, 'settings', 'full')

  const fetchProfiles = async () => {
    setLoadingProfiles(true)
    try {
      const res = await api.get('/api/apps/storage')
      setProfiles(Array.isArray(res.data) ? res.data : [])
    } catch {
      message.error('Failed to load storage apps')
      setProfiles([])
    } finally {
      setLoadingProfiles(false)
    }
  }

  const loadReusableDependencies = async () => {
    if (!canEditDestinations) {
      setGoogleConnections([])
      setPlatformServiceAccount({ available: false, email: '' })
      return
    }

    try {
      const [connectionsRes, platformRes] = await Promise.all([
        api.get('/api/google/connections').catch(() => ({ data: [] })),
        api.get('/api/google/platform-service-account').catch(() => ({ data: {} })),
      ])

      setGoogleConnections(Array.isArray(connectionsRes.data) ? connectionsRes.data : [])
      setPlatformServiceAccount({
        available: Boolean(platformRes.data?.platform_credential_available),
        email: platformRes.data?.service_account_email || '',
      })
    } catch {
      setGoogleConnections([])
      setPlatformServiceAccount({ available: false, email: '' })
    }
  }

  useEffect(() => {
    void fetchProfiles()
  }, [])

  useEffect(() => {
    void loadReusableDependencies()
  }, [canEditDestinations])

  const handleConnectedGoogle = async (data) => {
    if (!canEditDestinations) return
    await loadReusableDependencies()
    setForm(prev => ({
      ...prev,
      auth_mode: 'oauth',
      connection_id: String(data.connection_id),
    }))
    message.success(`Connected as ${data.display_name || data.email}`)
  }

  const openGoogleConfigModal = async () => {
    if (!canManageSettings) return
    setGoogleConfigModalOpen(true)
    setGoogleConfigError('')
    setGoogleConfigLoading(true)
    try {
      const res = await api.get('/api/settings/google')
      const data = res.data || {}
      const redirectUri = data.redirect_uri || DEFAULT_GOOGLE_REDIRECT
      setGoogleRedirectUri(redirectUri)
      setGoogleSecretSet(Boolean(data.client_secret && data.client_secret !== ''))
      setGcClientId(data.client_id || '')
      setGcClientSecret('')
      setGcRedirectUri(redirectUri)
    } catch {
      setGoogleRedirectUri(DEFAULT_GOOGLE_REDIRECT)
      setGoogleSecretSet(false)
      setGcClientId('')
      setGcClientSecret('')
      setGcRedirectUri(DEFAULT_GOOGLE_REDIRECT)
    } finally {
      setGoogleConfigLoading(false)
    }
  }

  const handleGoogleConnect = async () => {
    if (!canEditDestinations) return
    setConnectingGoogle(true)
    try {
      const res = await api.get('/api/google/auth-url')
      openGoogleOAuthPopup(
        res.data.url,
        (data) => {
          setConnectingGoogle(false)
          void handleConnectedGoogle(data)
        },
        (errorMessage) => {
          setConnectingGoogle(false)
          message.error(errorMessage)
        },
      )
    } catch (err) {
      setConnectingGoogle(false)
      if (err.response?.status === 503) {
        if (canManageSettings) {
          await openGoogleConfigModal()
          return
        }
        message.error('Google OAuth has not been configured yet. Ask an administrator to finish the workspace setup in Settings.')
        return
      }
      message.error(err.response?.data?.detail || 'Failed to start Google authentication')
    }
  }

  const handleSaveGoogleConfigAndConnect = async () => {
    if (!gcClientId.trim()) {
      setGoogleConfigError('Client ID is required')
      return
    }
    if (!gcClientSecret.trim() && !googleSecretSet) {
      setGoogleConfigError('Client Secret is required')
      return
    }

    setGoogleConfigSaving(true)
    setGoogleConfigError('')
    try {
      await api.put('/api/settings/google', {
        client_id: gcClientId.trim(),
        client_secret: gcClientSecret.trim() || '__KEEP__',
        redirect_uri: gcRedirectUri.trim() || DEFAULT_GOOGLE_REDIRECT,
      })

      const authRes = await api.get('/api/google/auth-url')
      openGoogleOAuthPopup(
        authRes.data.url,
        (data) => {
          setGoogleConfigSaving(false)
          setGoogleConfigModalOpen(false)
          setGoogleSecretSet(true)
          void handleConnectedGoogle(data)
        },
        (errorMessage) => {
          setGoogleConfigSaving(false)
          setGoogleConfigError(errorMessage)
        },
      )
    } catch (err) {
      setGoogleConfigSaving(false)
      setGoogleConfigError(err.response?.data?.detail || err.message || 'Failed to configure Google OAuth')
    }
  }

  const oauthCount = useMemo(
    () => profiles.filter(item => item.auth_mode === 'google_oauth').length,
    [profiles],
  )

  const serviceAccountCount = useMemo(
    () => profiles.filter(item => item.auth_mode === 'service_account').length,
    [profiles],
  )

  const resetModal = () => {
    setModalOpen(false)
    setEditingId(null)
    setForm(EMPTY_FORM)
  }

  const openCreateModal = (initialType = null) => {
    const resolvedType = DESTINATION_OPTIONS.some((option) => option.id === initialType)
      ? initialType
      : activeTypeFilter !== 'all' ? activeTypeFilter : 'gdrive'

    setEditingId(null)
    setForm({
      ...EMPTY_FORM,
      destination_type: resolvedType,
    })
    setModalOpen(true)
  }

  useEffect(() => {
    const requestedType = searchParams.get('type')
    const normalizedType = DESTINATION_OPTIONS.some((option) => option.id === requestedType) ? requestedType : null
    const shouldCreate = searchParams.get('create') === '1'
    const signature = `${normalizedType || 'all'}|${shouldCreate ? 'create' : 'view'}`

    if (!normalizedType && !shouldCreate) return
    if (handledIntentSignature === signature) return

    if (normalizedType) {
      setActiveTypeFilter(normalizedType)
    }

    if (shouldCreate && canEditDestinations) {
      openCreateModal(normalizedType)
    }

    setHandledIntentSignature(signature)
  }, [searchParams, canEditDestinations, handledIntentSignature])

  const openEditModal = async (profileId) => {
    setLoadingDetail(true)
    try {
      const res = await api.get(`/api/apps/storage/${profileId}`)
      const detail = res.data || {}
      const auth = detail.auth || {}
      const isServiceAccount = detail.auth_mode === 'service_account'
      setEditingId(String(detail.id || profileId))
      setForm({
        name: detail.name || '',
        description: detail.description || '',
        destination_type: detail.destination_type || 'gdrive',
        auth_mode: isServiceAccount ? 'service_account' : 'oauth',
        connection_id: auth.connection_id || auth.google_oauth_connection_id || '',
        folder_id: auth.folder_id || '',
        folder_name: auth.folder_name || '',
        drive_id: auth.drive_id || '',
        drive_name: auth.drive_name || '',
        service_account_source: auth.service_account_json_encrypted && !auth.uses_platform_service_account ? 'saved_key' : 'shared',
        service_account_json_encrypted: auth.service_account_json_encrypted || '',
        service_account_email: auth.service_account_email || auth.client_email || '',
        project_id: auth.project_id || '',
        service_account_file_name: auth.service_account_file_name || '',
      })
      setModalOpen(true)
    } catch (err) {
      message.error(err.response?.data?.detail || 'Failed to load storage app')
    } finally {
      setLoadingDetail(false)
    }
  }

  const handleDelete = (profile) => {
    setProfileToDelete(profile)
  }

  const confirmDelete = async () => {
    if (!profileToDelete) return
    setDeletingProfile(true)
    try {
      await api.delete(`/api/apps/storage/${profileToDelete.id}`)
      message.success('Storage app deleted')
      await fetchProfiles()
      setProfileToDelete(null)
    } catch (err) {
      message.error(err.response?.data?.detail || 'Failed to delete storage app')
    } finally {
      setDeletingProfile(false)
    }
  }

  const buildAuthPayload = () => {
    const folder = {
      folder_id: form.folder_id.trim() || null,
      folder_name: form.folder_name.trim() || null,
      drive_id: form.drive_id.trim() || null,
      drive_name: form.drive_name.trim() || null,
    }

    if (form.auth_mode === 'oauth') {
      if (!form.connection_id) {
        throw new Error('Please select a saved Google connection')
      }

      return {
        auth_mode: 'oauth',
        auth_method: 'oauth',
        connection_id: form.connection_id,
        google_oauth_connection_id: form.connection_id,
        ...folder,
      }
    }

    if (form.service_account_source === 'saved_key' && form.service_account_json_encrypted) {
      return {
        auth_mode: 'service_account',
        auth_method: 'service_account',
        uses_platform_service_account: false,
        service_account_json_encrypted: form.service_account_json_encrypted,
        service_account_email: form.service_account_email || null,
        project_id: form.project_id || null,
        service_account_file_name: form.service_account_file_name || null,
        ...folder,
      }
    }

    if (!platformServiceAccount.available) {
      throw new Error('Shared platform service account is not configured yet')
    }

    return {
      auth_mode: 'service_account',
      auth_method: 'service_account',
      uses_platform_service_account: true,
      service_account_email: platformServiceAccount.email || form.service_account_email || null,
      ...folder,
    }
  }

  const handleSave = async () => {
    if (!form.name.trim()) {
      message.warning('Please enter a destination name')
      return
    }

    setSaving(true)
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        destination_type: form.destination_type,
        auth: buildAuthPayload(),
      }

      if (editingId) {
        await api.put(`/api/apps/storage/${editingId}`, payload)
        message.success('Storage app updated')
      } else {
        await api.post('/api/apps/storage', payload)
        message.success('Storage app created')
      }

      resetModal()
      await fetchProfiles()
    } catch (err) {
      message.error(err.response?.data?.detail || err.message || 'Failed to save storage app')
    } finally {
      setSaving(false)
    }
  }

  const selectedDestinationOption = DESTINATION_OPTIONS.find(item => item.id === form.destination_type) || DESTINATION_OPTIONS[0]
  const visibleProfiles = useMemo(() => {
    return profiles.filter((item) => activeTypeFilter === 'all' || item.destination_type === activeTypeFilter)
  }, [activeTypeFilter, profiles])

  return (
    <AppLayout>
      <PageListLayout
        title="Storage Apps"
        description="Reusable Google storage apps managed inside Apps so the consuming modules can later decide when and how they write into them."
        overview={(
          <ModuleOverview
            icon={Folder}
            title="Connected storage catalog"
            description="Prepare Google Drive and Google Sheets once here, then let Backup or Automation decide later which flows use those storage targets."
            badges={['Connect once', 'Storage-ready', 'Reuse later']}
            stats={[
              {
                label: 'Profiles',
                value: profiles.length,
                helper: 'Reusable storage app profiles available to flows.',
              },
              {
                label: 'OAuth',
                value: oauthCount,
                helper: 'Profiles using reusable Google sign-in.',
              },
              {
                label: 'Service account',
                value: serviceAccountCount,
                helper: 'Profiles relying on service credentials.',
              },
            ]}
          />
        )}
        action={canEditDestinations ? (
          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            New App
          </button>
        ) : null}
        isLoading={loadingProfiles}
        loadingText="Loading storage apps…"
        searchPlaceholder="Search storage apps, folders, accounts, or descriptions"
        defaultView="grid"
      >
        {({ viewMode, filterText }) => {
          const normalizedFilter = filterText.trim().toLowerCase()
          const filteredProfiles = visibleProfiles.filter((profile) => {
            if (!normalizedFilter) return true
            return [
              profile.name,
              profile.description,
              profile.destination_name,
              profile.connection_label,
              profile.folder_name,
              profile.drive_name,
            ]
              .filter(Boolean)
              .some((value) => String(value).toLowerCase().includes(normalizedFilter))
          })

          return (
            <div className="space-y-6">
              <Alert
                type="info"
                message="Storage settings can still be overridden inside each backup"
                description={canEditDestinations
                  ? 'Applying a saved storage app pre-fills account and folder settings, but a single flow can still override them later when needed.'
                  : 'Your account currently has read-only access in Apps. You can inspect saved storage apps but cannot create or edit them.'}
              />

              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap gap-2">
                  <FilterButton active={activeTypeFilter === 'all'} label="All" onClick={() => setActiveTypeFilter('all')} />
                  {DESTINATION_OPTIONS.map(option => (
                    <FilterButton
                      key={option.id}
                      active={activeTypeFilter === option.id}
                      label={option.title}
                      color={option.color}
                      onClick={() => setActiveTypeFilter(option.id)}
                    />
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    void fetchProfiles()
                    void loadReusableDependencies()
                  }}
                  className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50"
                >
                  <RefreshCw className="h-4 w-4" />
                  Refresh
                </button>
              </div>

              {profiles.length === 0 ? (
                <EmptyPanel
                  title="No storage apps yet"
                  description="Connect a reusable Google Drive or Google Sheets target here first, then let the other modules decide later when they use it."
                  actionLabel={canEditDestinations ? 'Connect app' : null}
                  onAction={canEditDestinations ? openCreateModal : null}
                />
              ) : filteredProfiles.length === 0 ? (
                <SearchEmptyState query={filterText} label="destinations" />
              ) : viewMode === 'grid' ? (
                <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                  {filteredProfiles.map(profile => (
                    <DestinationCard
                      key={profile.id}
                      profile={profile}
                      canEdit={canEditDestinations}
                      onEdit={canEditDestinations ? () => openEditModal(profile.id) : null}
                      onDelete={canEditDestinations ? () => handleDelete(profile) : null}
                    />
                  ))}
                </div>
              ) : (
                <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                  {filteredProfiles.map(profile => (
                    <DestinationListRow
                      key={profile.id}
                      profile={profile}
                      canEdit={canEditDestinations}
                      onEdit={canEditDestinations ? () => openEditModal(profile.id) : null}
                      onDelete={canEditDestinations ? () => handleDelete(profile) : null}
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
        title={editingId ? 'Edit Storage App' : 'Create Storage App'}
        width={860}
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
          <SpinCenter text="Loading destination details…" />
        ) : (
          <div className="space-y-5">
            <div className="grid gap-5 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-semibold text-gray-800">Destination name</label>
                <input
                  value={form.name}
                  onChange={(event) => setForm(prev => ({ ...prev, name: event.target.value }))}
                  placeholder="e.g. HR Sheets Archive"
                  className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-semibold text-gray-800">Description</label>
                <input
                  value={form.description}
                  onChange={(event) => setForm(prev => ({ ...prev, description: event.target.value }))}
                  placeholder="Optional note for the team"
                  className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-gray-800">Destination type</label>
              <div className="grid gap-3 md:grid-cols-2">
                {DESTINATION_OPTIONS.map(option => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setForm(prev => ({ ...prev, destination_type: option.id }))}
                    className="rounded-2xl border-2 px-4 py-4 text-left transition-all"
                    style={form.destination_type === option.id
                      ? { borderColor: option.color, backgroundColor: `${option.color}10` }
                      : { borderColor: '#e5e7eb', backgroundColor: '#ffffff' }}
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ backgroundColor: `${option.color}18`, color: option.color }}>
                        {option.icon}
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-gray-900">{option.title}</div>
                        <div className="mt-1 text-xs text-gray-500">{option.desc}</div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-3xl border border-blue-100 bg-blue-50/50 p-5 space-y-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-blue-800">
                <Shield className="w-4 h-4" />
                Authentication
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setForm(prev => ({ ...prev, auth_mode: 'oauth' }))}
                  className={`rounded-2xl border-2 px-4 py-4 text-left transition-all ${form.auth_mode === 'oauth' ? 'shadow-sm' : ''}`}
                  style={form.auth_mode === 'oauth'
                    ? { borderColor: '#2563eb', backgroundColor: '#dbeafe' }
                    : { borderColor: '#e5e7eb', backgroundColor: '#ffffff' }}
                >
                  <div className="flex items-center gap-3">
                    <Globe className="w-5 h-5 text-blue-600" />
                    <div>
                      <div className="text-sm font-semibold text-gray-900">Saved Google OAuth</div>
                      <div className="mt-1 text-xs text-gray-500">Use a connected Google email from the Credentials module.</div>
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setForm(prev => ({
                    ...prev,
                    auth_mode: 'service_account',
                    service_account_source: prev.service_account_json_encrypted ? prev.service_account_source : 'shared',
                  }))}
                  className={`rounded-2xl border-2 px-4 py-4 text-left transition-all ${form.auth_mode === 'service_account' ? 'shadow-sm' : ''}`}
                  style={form.auth_mode === 'service_account'
                    ? { borderColor: '#7c3aed', backgroundColor: '#f3e8ff' }
                    : { borderColor: '#e5e7eb', backgroundColor: '#ffffff' }}
                >
                  <div className="flex items-center gap-3">
                    <Lock className="w-5 h-5 text-violet-600" />
                    <div>
                      <div className="text-sm font-semibold text-gray-900">Service account</div>
                      <div className="mt-1 text-xs text-gray-500">Use the shared platform credential or keep an already-saved encrypted JSON key.</div>
                    </div>
                  </div>
                </button>
              </div>

              {form.auth_mode === 'oauth' && (
                <div className="space-y-3">
                  <div className="rounded-2xl border border-blue-200 bg-white/80 p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <div className="text-sm font-semibold text-gray-900">Google account</div>
                        <div className="mt-1 text-xs text-gray-500">Sign in directly here like `appbi-ai`, or reuse one of the saved Google connections below.</div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={handleGoogleConnect}
                          disabled={connectingGoogle}
                          className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {connectingGoogle ? <Loader2 className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />}
                          {connectingGoogle ? 'Waiting for Google…' : 'Sign in with Google'}
                        </button>
                        {canManageSettings && (
                          <button
                            type="button"
                            onClick={openGoogleConfigModal}
                            className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50"
                          >
                            Configure OAuth Client
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {googleConnections.length === 0 ? (
                    <Alert
                      type="warning"
                      message="No saved Google connections found yet"
                      description="Use Sign in with Google above. After the popup login succeeds, the account will appear here automatically."
                    />
                  ) : (
                    <div>
                      <label className="mb-2 block text-sm font-semibold text-gray-800">Saved Google connection</label>
                      <div className="grid gap-2 md:grid-cols-2">
                        {googleConnections.map(connection => {
                          const isActive = form.connection_id === String(connection.id)
                          return (
                            <button
                              key={connection.id}
                              type="button"
                              onClick={() => setForm(prev => ({ ...prev, connection_id: String(connection.id) }))}
                              className={`rounded-2xl border px-4 py-3 text-left transition-all ${
                                isActive
                                  ? 'border-blue-300 bg-white shadow-sm'
                                  : 'border-white/60 bg-white/70 hover:border-blue-200 hover:bg-white'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className={`text-sm font-semibold ${isActive ? 'text-blue-700' : 'text-gray-800'}`}>{connection.display_name || connection.email}</span>
                                {isActive && <CheckCircle className="w-4 h-4 text-blue-600" />}
                              </div>
                              <div className="mt-1 text-xs text-gray-500">{connection.email}</div>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {form.auth_mode === 'service_account' && (
                <div className="space-y-3">
                  {form.service_account_json_encrypted ? (
                    <div className="grid gap-3 md:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => setForm(prev => ({ ...prev, service_account_source: 'saved_key' }))}
                        className={`rounded-2xl border px-4 py-4 text-left transition-all ${form.service_account_source === 'saved_key' ? 'border-violet-300 bg-white shadow-sm' : 'border-white/60 bg-white/70 hover:border-violet-200 hover:bg-white'}`}
                      >
                        <div className="text-sm font-semibold text-gray-900">Keep existing encrypted key</div>
                        <div className="mt-1 text-xs text-gray-500">Preserve the uploaded JSON key already stored for this destination.</div>
                      </button>

                      <button
                        type="button"
                        onClick={() => setForm(prev => ({ ...prev, service_account_source: 'shared' }))}
                        className={`rounded-2xl border px-4 py-4 text-left transition-all ${form.service_account_source === 'shared' ? 'border-violet-300 bg-white shadow-sm' : 'border-white/60 bg-white/70 hover:border-violet-200 hover:bg-white'}`}
                        disabled={!platformServiceAccount.available}
                      >
                        <div className="text-sm font-semibold text-gray-900">Use shared platform credential</div>
                        <div className="mt-1 text-xs text-gray-500">Switch this profile to the shared service account configured in the environment.</div>
                      </button>
                    </div>
                  ) : platformServiceAccount.available ? (
                    <Alert
                      type="success"
                      message="Shared platform credential is available"
                      description={`Profiles created in service account mode will reuse ${platformServiceAccount.email}.`}
                    />
                  ) : (
                    <Alert
                      type="warning"
                      message="Shared platform credential is not configured"
                      description="Set the GCP_SERVICE_ACCOUNT_* environment values first, or create this profile with a saved Google OAuth connection instead."
                    />
                  )}

                  {form.service_account_source === 'saved_key' && form.service_account_json_encrypted && (
                    <div className="rounded-2xl border border-violet-200 bg-white px-4 py-4 text-sm text-gray-700">
                      <div className="font-semibold text-gray-900">Encrypted service account key preserved</div>
                      <div className="mt-2 text-xs text-gray-500">Email: {form.service_account_email || 'Unknown'}</div>
                      <div className="mt-1 text-xs text-gray-500">Project: {form.project_id || 'Unknown'}</div>
                      {form.service_account_file_name && <div className="mt-1 text-xs text-gray-500">File: {form.service_account_file_name}</div>}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="rounded-3xl border border-gray-200 bg-white p-5 space-y-4">
              <div>
                <div className="text-sm font-semibold text-gray-900">Optional storage location hints</div>
                <p className="mt-1 text-xs text-gray-500">
                  Add folder or drive identifiers if this destination should default to a specific location. You can still override these fields from the backup wizard later.
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-semibold text-gray-800">Folder name</label>
                  <input
                    value={form.folder_name}
                    onChange={(event) => setForm(prev => ({ ...prev, folder_name: event.target.value }))}
                    placeholder="e.g. Team Backup Root"
                    className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-semibold text-gray-800">Folder ID</label>
                  <input
                    value={form.folder_id}
                    onChange={(event) => setForm(prev => ({ ...prev, folder_id: event.target.value }))}
                    placeholder="Optional Google Drive folder ID"
                    className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-semibold text-gray-800">Drive name</label>
                  <input
                    value={form.drive_name}
                    onChange={(event) => setForm(prev => ({ ...prev, drive_name: event.target.value }))}
                    placeholder="e.g. Operations Shared Drive"
                    className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-semibold text-gray-800">Drive ID</label>
                  <input
                    value={form.drive_id}
                    onChange={(event) => setForm(prev => ({ ...prev, drive_id: event.target.value }))}
                    placeholder="Optional shared drive ID"
                    className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
              </div>

              <div className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3 text-xs text-gray-500">
                Tip: if you are unsure about Google folder or drive IDs, you can leave these blank here and choose the exact folder from the backup wizard when applying the profile.
              </div>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
              Creating a <span className="font-semibold">{selectedDestinationOption.title}</span> profile means future flows can apply this exact destination in one click.
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={googleConfigModalOpen}
        onCancel={() => {
          if (googleConfigSaving) return
          setGoogleConfigModalOpen(false)
          setGoogleConfigError('')
        }}
        title="Configure Google OAuth"
        width={600}
        footer={(
          <>
            <button
              type="button"
              onClick={() => {
                setGoogleConfigModalOpen(false)
                setGoogleConfigError('')
              }}
              disabled={googleConfigSaving}
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveGoogleConfigAndConnect}
              disabled={googleConfigSaving}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              {googleConfigSaving && <Loader2 className="w-4 h-4 animate-spin" />}
              Save & Connect Google
            </button>
          </>
        )}
      >
        <p className="mb-4 text-sm text-gray-500">
          Enter <strong>Client ID</strong>, <strong>Client Secret</strong>, and <strong>Redirect URI</strong>, then start Google sign-in. If these values already exist in `.env`, this step is optional.
        </p>
        {googleConfigError && <Alert type="error" message={googleConfigError} className="mb-4" />}
        {googleConfigLoading ? (
          <SpinCenter text="Loading Google OAuth settings…" />
        ) : (
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Client ID <span className="text-red-500">*</span></label>
              <input
                value={gcClientId}
                onChange={event => setGcClientId(event.target.value)}
                placeholder="123456789-abc.apps.googleusercontent.com"
                className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Client Secret</label>
              <input
                type="password"
                value={gcClientSecret}
                onChange={event => setGcClientSecret(event.target.value)}
                placeholder={googleSecretSet ? 'Leave blank to keep current secret' : 'GOCSPX-xxxxxxxxxxxxxxxx'}
                className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="mt-1 text-xs text-gray-400">{googleSecretSet ? 'A secret is already stored. Leave blank to keep it.' : 'Stored encrypted in the database.'}</p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Redirect URI <span className="text-red-500">*</span></label>
              <input
                value={gcRedirectUri}
                onChange={event => setGcRedirectUri(event.target.value)}
                placeholder={DEFAULT_GOOGLE_REDIRECT}
                className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <Alert
              type="info"
              message="Google Cloud Console reminder"
              description={`Authorized redirect URI must include ${googleRedirectUri || DEFAULT_GOOGLE_REDIRECT}`}
            />
          </div>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={Boolean(profileToDelete)}
        onClose={() => { if (!deletingProfile) setProfileToDelete(null) }}
        onConfirm={() => { void confirmDelete() }}
        title="Delete storage app?"
        description={profileToDelete ? `Delete the storage app "${profileToDelete.name}". Backup flows that reuse it will need another storage target.` : ''}
        confirmLabel={deletingProfile ? 'Deleting…' : 'Delete app'}
        cancelLabel="Cancel"
        variant="danger"
        isLoading={deletingProfile}
      />
    </AppLayout>
  )
}

function DestinationCard({ profile, onEdit, onDelete, canEdit }) {
  const option = DESTINATION_OPTIONS.find(item => item.id === profile.destination_type)

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:border-blue-300 hover:shadow-md">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
            style={{ backgroundColor: `${option?.color || '#2563eb'}18`, color: option?.color || '#2563eb' }}
          >
            {profile.destination_type === 'gsheets'
              ? <FileSpreadsheet className="w-5 h-5" />
              : <Folder className="w-5 h-5" />}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold text-gray-900">{profile.name}</h3>
              <Tag color={profile.destination_type === 'gsheets' ? 'green' : 'blue'}>{profile.destination_name}</Tag>
              <Tag color={profile.auth_mode === 'service_account' ? 'purple' : 'cyan'}>
                {profile.auth_mode === 'service_account' ? 'Service account' : 'Google OAuth'}
              </Tag>
            </div>
            <div className="mt-1 text-sm text-gray-500">{profile.connection_label || 'No connection label'}</div>
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

      {profile.description && <p className="mt-4 text-sm leading-6 text-gray-600">{profile.description}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-gray-400">
        {profile.folder_name && <span className="rounded-full bg-gray-100 px-2 py-1">Folder: {profile.folder_name}</span>}
        {profile.drive_name && <span className="rounded-full bg-gray-100 px-2 py-1">Drive: {profile.drive_name}</span>}
        <span className="rounded-full bg-gray-100 px-2 py-1">Updated {formatDateTime(profile.updated_at)}</span>
      </div>
    </div>
  )
}

function DestinationListRow({ profile, onEdit, onDelete, canEdit }) {
  const option = DESTINATION_OPTIONS.find(item => item.id === profile.destination_type)

  return (
    <div className="flex items-center gap-4 border-b border-gray-100 px-5 py-4 last:border-b-0 hover:bg-gray-50">
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
        style={{ backgroundColor: `${option?.color || '#2563eb'}18`, color: option?.color || '#2563eb' }}
      >
        {profile.destination_type === 'gsheets'
          ? <FileSpreadsheet className="h-4 w-4" />
          : <Folder className="h-4 w-4" />}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-sm font-semibold text-gray-900">{profile.name}</div>
          <Tag color={profile.destination_type === 'gsheets' ? 'green' : 'blue'}>{profile.destination_name}</Tag>
          <Tag color={profile.auth_mode === 'service_account' ? 'purple' : 'cyan'}>
            {profile.auth_mode === 'service_account' ? 'Service account' : 'Google OAuth'}
          </Tag>
        </div>
        <div className="mt-1 text-xs text-gray-500">
          {profile.connection_label || 'No connection label'}
          {profile.folder_name && <span className="ml-2 hidden text-gray-400 md:inline">• Folder: {profile.folder_name}</span>}
        </div>
      </div>

      <div className="hidden text-xs text-gray-400 lg:block">Updated {formatDateTime(profile.updated_at)}</div>

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
        No results for <span className="font-medium text-gray-700">"{query}"</span>. Try another keyword or switch the destination type filter.
      </p>
    </div>
  )
}

export default DestinationProfilesPage