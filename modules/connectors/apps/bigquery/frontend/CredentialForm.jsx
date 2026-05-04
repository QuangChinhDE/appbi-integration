import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react'
import { CheckCircle, Database, Globe, Loader2, Lock, Shield, Upload } from 'lucide-react'

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
  auth_mode: 'service_account', // BigQuery: service account is the common path
  connection_id: '',
  project_id: '',
  dataset_id: '',
  service_account_source: 'shared',
  service_account_json: '',             // freshly uploaded/pasted JSON text
  service_account_json_encrypted: '',   // preserved from backend on edit
  service_account_email: '',
  service_account_file_name: '',
}


function normalizeDetail(detail) {
  if (!detail) return detail
  const auth = detail.auth || {}
  const config = detail.config || {}
  return {
    connection_id: auth.connection_id || auth.google_oauth_connection_id || '',
    project_id: config.project_id || auth.project_id || '',
    dataset_id: config.dataset_id || auth.dataset_id || '',
    service_account_email: auth.service_account_email || '',
    service_account_json_encrypted: auth.service_account_json_encrypted || '',
    service_account_file_name: auth.service_account_file_name || '',
    auth_mode: detail.auth_mode || '',
    uses_platform_service_account: Boolean(config.uses_platform_service_account),
  }
}


const BigQueryCredentialForm = forwardRef(function BigQueryCredentialForm(
  { appId = 'bigquery', editingId = null, onSaved, onSavingChange },
  ref,
) {
  const permissions = useAuthStore((state) => state.permissions)
  const canEdit = hasPermission(permissions, 'apps', 'edit')
  const option = useMemo(
    () => getAppMeta(appId) || { id: appId, title: 'BigQuery' },
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
  }, [])

  useEffect(() => {
    if (editingId) {
      setLoadingDetail(true)
      api.get(`/api/apps/credentials/${editingId}`)
        .then((res) => {
          const raw = res.data || {}
          const detail = normalizeDetail(raw)
          const isOAuth = raw.auth_mode === 'google_oauth' || Boolean(detail.connection_id)
          let saSource = 'shared'
          if (detail.service_account_json_encrypted) saSource = 'saved_key'
          else if (detail.uses_platform_service_account) saSource = 'shared'
          setForm({
            name: raw.name || '',
            description: raw.description || '',
            auth_mode: isOAuth ? 'oauth' : 'service_account',
            connection_id: detail.connection_id || '',
            project_id: detail.project_id || '',
            dataset_id: detail.dataset_id || '',
            service_account_source: saSource,
            service_account_json: '',
            service_account_json_encrypted: detail.service_account_json_encrypted || '',
            service_account_email: detail.service_account_email || '',
            service_account_file_name: detail.service_account_file_name || '',
          })
        })
        .catch((err) => message.error(err.response?.data?.detail || 'Failed to load credential'))
        .finally(() => setLoadingDetail(false))
    } else {
      setForm(EMPTY_FORM)
    }
  }, [editingId])

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

  const handleServiceAccountFile = async (file) => {
    if (!file) return
    try {
      const text = await file.text()
      // Sanity parse to catch obvious errors + extract common fields
      let parsed = null
      try { parsed = JSON.parse(text) } catch {
        message.error('Selected file is not valid JSON')
        return
      }
      setForm((prev) => ({
        ...prev,
        service_account_source: 'upload',
        service_account_json: text,
        service_account_json_encrypted: '',
        service_account_file_name: file.name,
        service_account_email: parsed?.client_email || prev.service_account_email,
        project_id: prev.project_id || parsed?.project_id || '',
      }))
    } catch (err) {
      message.error(err?.message || 'Failed to read service account JSON file')
    }
  }

  const buildAuthPayload = () => {
    if (form.auth_mode === 'oauth') {
      if (!form.connection_id) throw new Error('Please select or sign in with a Google account')
      return {
        auth_mode: 'oauth',
        auth_method: 'oauth',
        connection_id: form.connection_id,
        google_oauth_connection_id: form.connection_id,
      }
    }
    // service_account
    if (form.service_account_source === 'upload') {
      if (!form.service_account_json) throw new Error('Upload the service account JSON key file')
      return {
        auth_mode: 'service_account',
        auth_method: 'service_account',
        service_account_json: form.service_account_json,
        service_account_email: form.service_account_email || null,
        service_account_file_name: form.service_account_file_name || null,
      }
    }
    if (form.service_account_source === 'saved_key' && form.service_account_json_encrypted) {
      return {
        auth_mode: 'service_account',
        auth_method: 'service_account',
        service_account_json_encrypted: form.service_account_json_encrypted,
        service_account_email: form.service_account_email || null,
        service_account_file_name: form.service_account_file_name || null,
      }
    }
    if (!platformServiceAccount.available) {
      throw new Error('Shared platform service account is not configured. Upload a JSON key instead.')
    }
    return {
      auth_mode: 'service_account',
      auth_method: 'service_account',
      service_account_email: platformServiceAccount.email || form.service_account_email || null,
    }
  }

  const buildConfigPayload = () => {
    const cfg = {}
    if (form.project_id.trim()) cfg.project_id = form.project_id.trim()
    if (form.dataset_id.trim()) cfg.dataset_id = form.dataset_id.trim()
    return cfg
  }

  useImperativeHandle(ref, () => ({
    save: async () => {
      if (!form.name.trim()) { message.warning('Please enter a profile name'); return false }
      if (!form.project_id.trim()) { message.warning('Please enter the GCP project ID'); return false }
      setSaving(true)
      try {
        const payload = {
          name: form.name.trim(),
          description: form.description.trim() || null,
          app_id: appId,
          app_name: option.title || 'BigQuery',
          auth: buildAuthPayload(),
          config: buildConfigPayload(),
        }
        if (editingId) {
          await api.put(`/api/apps/credentials/${editingId}`, payload)
          message.success('BigQuery credential updated')
        } else {
          await api.post('/api/apps/credentials', payload)
          message.success('BigQuery credential created')
        }
        onSaved?.()
        return true
      } catch (err) {
        message.error(err.response?.data?.detail || err.message || 'Failed to save BigQuery credential')
        return false
      } finally {
        setSaving(false)
      }
    },
  }), [appId, editingId, form, option, platformServiceAccount, onSaved])

  if (loadingDetail) return <SpinCenter text="Loading BigQuery credential…" />

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-caption font-emphasis text-text-secondary">Profile name</label>
          <input
            value={form.name}
            onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
            placeholder="e.g. Analytics Warehouse — Prod"
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
          <Database className="h-3.5 w-3.5" />
          BigQuery target
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-caption font-emphasis text-text-secondary">GCP project ID</label>
            <input
              value={form.project_id}
              onChange={(event) => setForm((prev) => ({ ...prev, project_id: event.target.value }))}
              placeholder="my-gcp-project"
              className="w-full rounded-md border border-[rgb(var(--border-strong))] bg-surface-0 px-3 py-2 text-caption text-text-primary placeholder:text-text-quaternary focus:border-brand focus:shadow-focus-brand focus:outline-none transition-colors"
            />
            <p className="mt-1.5 text-tiny text-text-quaternary">Required. The project that owns the BigQuery datasets.</p>
          </div>
          <div>
            <label className="mb-1 block text-caption font-emphasis text-text-secondary">Default dataset ID (optional)</label>
            <input
              value={form.dataset_id}
              onChange={(event) => setForm((prev) => ({ ...prev, dataset_id: event.target.value }))}
              placeholder="analytics"
              className="w-full rounded-md border border-[rgb(var(--border-strong))] bg-surface-0 px-3 py-2 text-caption text-text-primary placeholder:text-text-quaternary focus:border-brand focus:shadow-focus-brand focus:outline-none transition-colors"
            />
            <p className="mt-1.5 text-tiny text-text-quaternary">Used as the default in pipeline bindings. Can be overridden per stream.</p>
          </div>
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
            onClick={() => setForm((prev) => ({ ...prev, auth_mode: 'service_account' }))}
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
                <div className="mt-0.5 text-tiny text-text-tertiary">Recommended for warehouse workloads.</div>
              </div>
            </div>
          </button>

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
                <div className="text-caption font-emphasis text-text-primary">Sign in with Google</div>
                <div className="mt-0.5 text-tiny text-text-tertiary">Use an interactive Google account.</div>
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
                  <div className="mt-0.5 text-tiny text-text-tertiary">The account must have BigQuery access in the target project.</div>
                </div>
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

            {googleConnections.length === 0 ? (
              <Alert
                type="warning"
                message="No saved Google connections yet"
                description="Sign in with Google above to add an interactive account."
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
            <div className="grid gap-2 md:grid-cols-3">
              <button
                type="button"
                onClick={() => setForm((prev) => ({ ...prev, service_account_source: 'shared' }))}
                disabled={!platformServiceAccount.available}
                className={`rounded-md border px-3 py-2 text-left transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
                  form.service_account_source === 'shared'
                    ? 'border-brand bg-brand/6'
                    : 'border-[rgb(var(--border-line))] bg-surface-1 hover:border-brand/30'
                }`}
              >
                <div className="text-caption font-emphasis text-text-primary">Shared platform</div>
                <div className="mt-0.5 text-tiny text-text-tertiary">Use the built-in service account (if configured).</div>
              </button>
              <button
                type="button"
                onClick={() => setForm((prev) => ({ ...prev, service_account_source: 'upload' }))}
                className={`rounded-md border px-3 py-2 text-left transition-all ${
                  form.service_account_source === 'upload'
                    ? 'border-brand bg-brand/6'
                    : 'border-[rgb(var(--border-line))] bg-surface-1 hover:border-brand/30'
                }`}
              >
                <div className="text-caption font-emphasis text-text-primary">Upload JSON key</div>
                <div className="mt-0.5 text-tiny text-text-tertiary">Provide a service account JSON key file.</div>
              </button>
              {form.service_account_json_encrypted && (
                <button
                  type="button"
                  onClick={() => setForm((prev) => ({ ...prev, service_account_source: 'saved_key' }))}
                  className={`rounded-md border px-3 py-2 text-left transition-all ${
                    form.service_account_source === 'saved_key'
                      ? 'border-brand bg-brand/6'
                      : 'border-[rgb(var(--border-line))] bg-surface-1 hover:border-brand/30'
                  }`}
                >
                  <div className="text-caption font-emphasis text-text-primary">Keep existing key</div>
                  <div className="mt-0.5 text-tiny text-text-tertiary">Preserve the stored encrypted JSON key.</div>
                </button>
              )}
            </div>

            {form.service_account_source === 'shared' && (
              platformServiceAccount.available ? (
                <Alert
                  type="success"
                  message="Shared platform service account available"
                  description={`This profile will use ${platformServiceAccount.email}. Make sure it has BigQuery roles on ${form.project_id || 'your project'}.`}
                />
              ) : (
                <Alert
                  type="warning"
                  message="Shared platform service account is not configured"
                  description="Set GCP_SERVICE_ACCOUNT_* env vars, or upload a JSON key below."
                />
              )
            )}

            {form.service_account_source === 'upload' && (
              <div className="rounded-md border border-dashed border-[rgb(var(--border-line))] bg-surface-1 p-3 space-y-2">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-[rgb(var(--border-strong))] bg-surface-0 px-3 py-1.5 text-caption font-emphasis text-text-primary hover:border-brand/40">
                  <Upload className="h-3.5 w-3.5" />
                  <span>{form.service_account_file_name ? 'Replace JSON key' : 'Choose JSON key file'}</span>
                  <input
                    type="file"
                    accept="application/json,.json"
                    className="hidden"
                    onChange={(event) => handleServiceAccountFile(event.target.files?.[0])}
                  />
                </label>
                {form.service_account_file_name && (
                  <div className="text-tiny text-text-tertiary">
                    File: <span className="text-text-secondary">{form.service_account_file_name}</span>
                    {form.service_account_email && <> · Email: <span className="text-text-secondary">{form.service_account_email}</span></>}
                  </div>
                )}
                <p className="text-tiny text-text-quaternary">The JSON is encrypted at rest. Ensure the service account has BigQuery Data Editor + Job User roles.</p>
              </div>
            )}

            {form.service_account_source === 'saved_key' && form.service_account_json_encrypted && (
              <div className="rounded-md border border-[rgb(var(--border-line))] bg-surface-1 px-3 py-2 text-caption text-text-secondary">
                <div className="font-emphasis text-text-primary">Encrypted service account key preserved</div>
                <div className="mt-1 text-tiny text-text-tertiary">Email: {form.service_account_email || 'Unknown'}</div>
                {form.service_account_file_name && <div className="mt-0.5 text-tiny text-text-tertiary">File: {form.service_account_file_name}</div>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
})

export default BigQueryCredentialForm
