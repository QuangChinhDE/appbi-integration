import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react'
import { CheckCircle, Globe, Loader2, Lock, Shield } from 'lucide-react'

import api from '@shared/api/client'
import { getAppMeta } from '@modules/apps/frontend/constants'
import { hasPermission } from '@modules/identity/frontend/lib/permissions'
import { useAuthStore } from '@modules/identity/frontend/store/authStore'
import { Alert, SpinCenter, message } from '@packages/ui/src/components/common/ui'


function openGoogleOAuthPopup(authUrl, onSuccess, onError) {
  const width = 520
  const height = 660
  const popup = window.open(
    authUrl,
    'google-oauth',
    `width=${width},height=${height},top=${Math.round((window.screen.height - height) / 2)},left=${Math.round((window.screen.width - width) / 2)}`,
  )
  if (!popup) { onError('Popup blocked. Please allow popups for this site.'); return }

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
    if (popup.closed) { clearInterval(timer); window.removeEventListener('message', onMessage) }
  }, 800)
}


const EMPTY_FORM = {
  name: '',
  description: '',
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


function normalize(detail) {
  if (!detail) return detail
  const auth = detail.auth || {}
  const config = detail.config || {}
  return {
    ...detail,
    connection_id: auth.connection_id || auth.google_oauth_connection_id || '',
    folder_id: config.folder_id || auth.folder_id || '',
    folder_name: config.folder_name || auth.folder_name || '',
    drive_id: config.drive_id || auth.drive_id || '',
    drive_name: config.drive_name || auth.drive_name || '',
    service_account_email: auth.service_account_email || '',
    service_account_json_encrypted: auth.service_account_json_encrypted || '',
    project_id: auth.project_id || '',
    service_account_file_name: auth.service_account_file_name || '',
  }
}


const GoogleCredentialForm = forwardRef(function GoogleCredentialForm(
  { appId, editingId = null, onSaved, onSavingChange },
  ref,
) {
  const permissions = useAuthStore((state) => state.permissions)
  const canEdit = hasPermission(permissions, 'apps', 'edit')
  const option = useMemo(
    () => getAppMeta(appId) || getAppMeta('gdrive') || { id: appId, title: appId },
    [appId],
  )

  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [googleConnections, setGoogleConnections] = useState([])
  const [platformServiceAccount, setPlatformServiceAccount] = useState({ available: false, email: '' })
  const [connectingGoogle, setConnectingGoogle] = useState(false)

  useEffect(() => { onSavingChange?.(saving) }, [saving, onSavingChange])

  useEffect(() => {
    if (!appId) return
    let cancelled = false
    ;(async () => {
      try {
        const [connectionsRes, platformRes] = await Promise.all([
          api.get('/api/google/connections').catch(() => ({ data: [] })),
          api.get('/api/google/platform-service-account').catch(() => ({ data: {} })),
        ])
        if (cancelled) return
        setGoogleConnections(Array.isArray(connectionsRes.data) ? connectionsRes.data : [])
        setPlatformServiceAccount({
          available: Boolean(platformRes.data?.platform_credential_available),
          email: platformRes.data?.service_account_email || '',
        })
      } catch {
        if (!cancelled) {
          setGoogleConnections([])
          setPlatformServiceAccount({ available: false, email: '' })
        }
      }
    })()
    return () => { cancelled = true }
  }, [appId])

  useEffect(() => {
    if (!appId) return
    if (editingId) {
      setLoadingDetail(true)
      api.get(`/api/apps/credentials/${editingId}`)
        .then((res) => {
          const detail = normalize(res.data || {})
          const isServiceAccount = detail.auth_mode === 'service_account'
          setForm({
            name: detail.name || '',
            description: detail.description || '',
            auth_mode: isServiceAccount ? 'service_account' : 'oauth',
            connection_id: detail.connection_id || '',
            folder_id: detail.folder_id || '',
            folder_name: detail.folder_name || '',
            drive_id: detail.drive_id || '',
            drive_name: detail.drive_name || '',
            service_account_source: detail.service_account_json_encrypted ? 'saved_key' : 'shared',
            service_account_json_encrypted: detail.service_account_json_encrypted || '',
            service_account_email: detail.service_account_email || '',
            project_id: detail.project_id || '',
            service_account_file_name: detail.service_account_file_name || '',
          })
        })
        .catch((err) => message.error(err.response?.data?.detail || 'Failed to load credential'))
        .finally(() => setLoadingDetail(false))
    } else {
      setForm(EMPTY_FORM)
    }
  }, [appId, editingId])

  const handleConnectedGoogle = async (data) => {
    try {
      const res = await api.get('/api/google/connections')
      setGoogleConnections(Array.isArray(res.data) ? res.data : [])
    } catch { /* ignore */ }
    setForm((prev) => ({ ...prev, auth_mode: 'oauth', connection_id: String(data.connection_id) }))
    message.success(`Connected as ${data.display_name || data.email}`)
  }

  const handleGoogleConnect = async () => {
    if (!canEdit) return
    setConnectingGoogle(true)
    try {
      const res = await api.get('/api/google/auth-url', {
        params: { frontend_origin: window.location.origin },
      })
      openGoogleOAuthPopup(
        res.data.url,
        (data) => { setConnectingGoogle(false); void handleConnectedGoogle(data) },
        (err) => { setConnectingGoogle(false); message.error(err) },
      )
    } catch (err) {
      setConnectingGoogle(false)
      if (err.response?.status === 503) {
        message.error(err.response?.data?.detail || 'Google sign-in is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env first.')
        return
      }
      message.error(err.response?.data?.detail || 'Failed to start Google authentication')
    }
  }

  const buildAuthPayload = () => {
    if (form.auth_mode === 'oauth') {
      if (!form.connection_id) throw new Error('Please select a saved Google connection')
      return {
        auth_mode: 'oauth',
        auth_method: 'oauth',
        connection_id: form.connection_id,
        google_oauth_connection_id: form.connection_id,
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
      }
    }
    if (!platformServiceAccount.available) throw new Error('Shared platform service account is not configured yet')
    return {
      auth_mode: 'service_account',
      auth_method: 'service_account',
      uses_platform_service_account: true,
      service_account_email: platformServiceAccount.email || form.service_account_email || null,
    }
  }

  const buildConfigPayload = () => ({
    folder_id: form.folder_id.trim() || null,
    folder_name: form.folder_name.trim() || null,
    drive_id: form.drive_id.trim() || null,
    drive_name: form.drive_name.trim() || null,
  })

  useImperativeHandle(ref, () => ({
    save: async () => {
      if (!form.name.trim()) { message.warning('Please enter a profile name'); return false }
      setSaving(true)
      try {
        const payload = {
          name: form.name.trim(),
          description: form.description.trim() || null,
          app_id: appId,
          app_name: option.title,
          auth: buildAuthPayload(),
          config: buildConfigPayload(),
        }
        if (editingId) {
          await api.put(`/api/apps/credentials/${editingId}`, payload)
          message.success('Storage profile updated')
        } else {
          await api.post('/api/apps/credentials', payload)
          message.success('Storage profile created')
        }
        onSaved?.()
        return true
      } catch (err) {
        message.error(err.response?.data?.detail || err.message || 'Failed to save storage profile')
        return false
      } finally {
        setSaving(false)
      }
    },
  }), [appId, editingId, form, option, platformServiceAccount, onSaved])

  if (loadingDetail) return <SpinCenter text="Loading destination details…" />

  return (
    <>
      <div className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-caption font-emphasis text-text-secondary">Profile name</label>
            <input
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="e.g. HR Sheets Archive"
              className="w-full rounded-md border border-[rgb(var(--border-strong))] bg-surface-0 px-3 py-2 text-caption text-text-primary placeholder:text-text-quaternary focus:border-brand focus:shadow-focus-brand focus:outline-none transition-colors"
            />
          </div>
          <div>
            <label className="mb-1 block text-caption font-emphasis text-text-secondary">Description</label>
            <input
              value={form.description}
              onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
              placeholder="Optional note for the team"
              className="w-full rounded-md border border-[rgb(var(--border-strong))] bg-surface-0 px-3 py-2 text-caption text-text-primary placeholder:text-text-quaternary focus:border-brand focus:shadow-focus-brand focus:outline-none transition-colors"
            />
          </div>
        </div>

        <div className="rounded-lg border border-[rgb(var(--border-line))] bg-surface-2 p-4 space-y-3">
          <div className="flex items-center gap-2 text-caption font-emphasis text-text-secondary">
            <Shield className="h-3.5 w-3.5" />
            Authentication
          </div>

          <div className="grid gap-2 md:grid-cols-2">
            <button
              type="button"
              onClick={() => setForm((prev) => ({ ...prev, auth_mode: 'oauth' }))}
              className={`rounded-md border px-3 py-2.5 text-left transition-all ${
                form.auth_mode === 'oauth'
                  ? 'border-brand bg-brand/6'
                  : 'border-[rgb(var(--border-strong))] bg-surface-1 hover:border-brand/30'
              }`}
            >
              <div className="flex items-center gap-2">
                <Globe className="h-3.5 w-3.5 text-brand" />
                <div>
                  <div className="text-caption font-emphasis text-text-primary">Sign in</div>
                  <div className="mt-0.5 text-tiny text-text-tertiary">Use a signed-in Google account.</div>
                </div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setForm((prev) => ({
                ...prev,
                auth_mode: 'service_account',
                service_account_source: prev.service_account_json_encrypted ? prev.service_account_source : 'shared',
              }))}
              className={`rounded-md border px-3 py-2.5 text-left transition-all ${
                form.auth_mode === 'service_account'
                  ? 'border-brand bg-brand/6'
                  : 'border-[rgb(var(--border-strong))] bg-surface-1 hover:border-brand/30'
              }`}
            >
              <div className="flex items-center gap-2">
                <Lock className="h-3.5 w-3.5 text-brand" />
                <div>
                  <div className="text-caption font-emphasis text-text-primary">Service account</div>
                  <div className="mt-0.5 text-tiny text-text-tertiary">Shared platform or saved JSON key.</div>
                </div>
              </div>
            </button>
          </div>

          {form.auth_mode === 'oauth' && (
            <div className="space-y-2">
              <div className="rounded-md border border-[rgb(var(--border-line))] bg-surface-1 p-3">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="text-caption font-emphasis text-text-primary">Google account</div>
                    <div className="mt-0.5 text-tiny text-text-tertiary">Sign in once; the account becomes reusable.</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={handleGoogleConnect}
                      disabled={connectingGoogle}
                      className="inline-flex items-center gap-2 rounded-md bg-brand px-3 py-1.5 text-caption font-emphasis text-text-inverse transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {connectingGoogle ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Globe className="h-3.5 w-3.5" />}
                      {connectingGoogle ? 'Waiting for Google…' : 'Sign in with Google'}
                    </button>
                  </div>
                </div>
              </div>

              {googleConnections.length === 0 ? (
                <Alert
                  type="warning"
                  message="No saved Google connections yet"
                  description="Sign in with Google above. After the popup login succeeds, the account appears here automatically."
                />
              ) : (
                <div>
                  <label className="mb-1.5 block text-caption font-emphasis text-text-secondary">Saved Google connection</label>
                  <div className="grid gap-2 md:grid-cols-2">
                    {googleConnections.map((connection) => {
                      const isActive = form.connection_id === String(connection.id)
                      return (
                        <button
                          key={connection.id}
                          type="button"
                          onClick={() => setForm((prev) => ({ ...prev, connection_id: String(connection.id) }))}
                          className={`rounded-md border px-3 py-2 text-left transition-all ${
                            isActive
                              ? 'border-brand bg-brand/6'
                              : 'border-[rgb(var(--border-line))] bg-surface-1 hover:border-brand/30'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className={`text-caption font-emphasis ${isActive ? 'text-brand' : 'text-text-primary'}`}>
                              {connection.display_name || connection.email}
                            </span>
                            {isActive && <CheckCircle className="h-3.5 w-3.5 text-brand" />}
                          </div>
                          <div className="mt-0.5 text-tiny text-text-tertiary">{connection.email}</div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {form.auth_mode === 'service_account' && (
            <div className="space-y-2">
              {form.service_account_json_encrypted ? (
                <div className="grid gap-2 md:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setForm((prev) => ({ ...prev, service_account_source: 'saved_key' }))}
                    className={`rounded-md border px-3 py-2 text-left transition-all ${
                      form.service_account_source === 'saved_key'
                        ? 'border-brand bg-brand/6'
                        : 'border-[rgb(var(--border-line))] bg-surface-1 hover:border-brand/30'
                    }`}
                  >
                    <div className="text-caption font-emphasis text-text-primary">Keep existing encrypted key</div>
                    <div className="mt-0.5 text-tiny text-text-tertiary">Preserve the uploaded JSON key already stored.</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm((prev) => ({ ...prev, service_account_source: 'shared' }))}
                    className={`rounded-md border px-3 py-2 text-left transition-all ${
                      form.service_account_source === 'shared'
                        ? 'border-brand bg-brand/6'
                        : 'border-[rgb(var(--border-line))] bg-surface-1 hover:border-brand/30'
                    }`}
                    disabled={!platformServiceAccount.available}
                  >
                    <div className="text-caption font-emphasis text-text-primary">Use shared platform credential</div>
                    <div className="mt-0.5 text-tiny text-text-tertiary">Switch to the shared service account.</div>
                  </button>
                </div>
              ) : platformServiceAccount.available ? (
                <Alert
                  type="success"
                  message="Shared platform credential is available"
                  description={`Profiles in service account mode will reuse ${platformServiceAccount.email}.`}
                />
              ) : (
                <Alert
                  type="warning"
                  message="Shared platform credential is not configured"
                  description="Set the GCP_SERVICE_ACCOUNT_* environment values first, or switch this profile to Sign in instead."
                />
              )}

              {form.service_account_source === 'saved_key' && form.service_account_json_encrypted && (
                <div className="rounded-md border border-[rgb(var(--border-line))] bg-surface-1 px-3 py-2 text-caption text-text-secondary">
                  <div className="font-emphasis text-text-primary">Encrypted service account key preserved</div>
                  <div className="mt-1 text-tiny text-text-tertiary">Email: {form.service_account_email || 'Unknown'}</div>
                  <div className="mt-0.5 text-tiny text-text-tertiary">Project: {form.project_id || 'Unknown'}</div>
                  {form.service_account_file_name && <div className="mt-0.5 text-tiny text-text-tertiary">File: {form.service_account_file_name}</div>}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-[rgb(var(--border-line))] bg-surface-2 p-4 space-y-3">
          <div>
            <div className="text-caption font-emphasis text-text-secondary">Optional storage location defaults</div>
            <p className="mt-0.5 text-tiny text-text-tertiary">
              You can still override folder / drive from the backup wizard per flow.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-caption font-emphasis text-text-secondary">Folder name</label>
              <input
                value={form.folder_name}
                onChange={(event) => setForm((prev) => ({ ...prev, folder_name: event.target.value }))}
                placeholder="e.g. Team Backup Root"
                className="w-full rounded-md border border-[rgb(var(--border-strong))] bg-surface-0 px-3 py-2 text-caption text-text-primary placeholder:text-text-quaternary focus:border-brand focus:shadow-focus-brand focus:outline-none transition-colors"
              />
            </div>
            <div>
              <label className="mb-1 block text-caption font-emphasis text-text-secondary">Folder ID</label>
              <input
                value={form.folder_id}
                onChange={(event) => setForm((prev) => ({ ...prev, folder_id: event.target.value }))}
                placeholder="Optional Google Drive folder ID"
                className="w-full rounded-md border border-[rgb(var(--border-strong))] bg-surface-0 px-3 py-2 text-caption text-text-primary placeholder:text-text-quaternary focus:border-brand focus:shadow-focus-brand focus:outline-none transition-colors"
              />
            </div>
            <div>
              <label className="mb-1 block text-caption font-emphasis text-text-secondary">Drive name</label>
              <input
                value={form.drive_name}
                onChange={(event) => setForm((prev) => ({ ...prev, drive_name: event.target.value }))}
                placeholder="e.g. Operations Shared Drive"
                className="w-full rounded-md border border-[rgb(var(--border-strong))] bg-surface-0 px-3 py-2 text-caption text-text-primary placeholder:text-text-quaternary focus:border-brand focus:shadow-focus-brand focus:outline-none transition-colors"
              />
            </div>
            <div>
              <label className="mb-1 block text-caption font-emphasis text-text-secondary">Drive ID</label>
              <input
                value={form.drive_id}
                onChange={(event) => setForm((prev) => ({ ...prev, drive_id: event.target.value }))}
                placeholder="Optional shared drive ID"
                className="w-full rounded-md border border-[rgb(var(--border-strong))] bg-surface-0 px-3 py-2 text-caption text-text-primary placeholder:text-text-quaternary focus:border-brand focus:shadow-focus-brand focus:outline-none transition-colors"
              />
            </div>
          </div>
        </div>
      </div>
    </>
  )
})

export default GoogleCredentialForm
