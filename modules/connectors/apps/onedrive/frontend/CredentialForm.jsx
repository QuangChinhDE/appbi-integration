import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Cloud, Eye, EyeOff, KeyRound } from 'lucide-react'

import api from '@shared/api/client'
import { getAppMeta } from '@modules/apps/frontend/constants'
import { Alert, SpinCenter, message } from '@packages/ui/src/components/common/ui'


const EMPTY_FORM = {
  name: '',
  description: '',
  account_email: '',
  access_token: '',
  refresh_token: '',
  client_id: '',
  client_secret: '',
  tenant_id: 'common',
  token_expiry: '',
  folder_id: '',
  folder_name: '',
  drive_id: '',
  drive_name: '',
}


function normalize(detail) {
  const auth = detail?.auth || {}
  const config = detail?.config || {}
  return {
    ...EMPTY_FORM,
    name: detail?.name || '',
    description: detail?.description || '',
    account_email: auth.account_email || '',
    access_token: auth.access_token || '',
    refresh_token: auth.refresh_token || '',
    client_id: auth.client_id || '',
    client_secret: auth.client_secret || '',
    tenant_id: auth.tenant_id || 'common',
    token_expiry: auth.token_expiry || '',
    folder_id: config.folder_id || auth.folder_id || '',
    folder_name: config.folder_name || auth.folder_name || '',
    drive_id: config.drive_id || auth.drive_id || '',
    drive_name: config.drive_name || auth.drive_name || '',
  }
}


const OneDriveCredentialForm = forwardRef(function OneDriveCredentialForm(
  { appId, editingId = null, onSaved, onSavingChange },
  ref,
) {
  const app = getAppMeta(appId) || { id: appId, title: 'OneDrive' }
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [showAccessToken, setShowAccessToken] = useState(false)
  const [showRefreshToken, setShowRefreshToken] = useState(false)
  const [showClientSecret, setShowClientSecret] = useState(false)
  const savingRef = useRef(saving)
  savingRef.current = saving

  useEffect(() => { onSavingChange?.(saving) }, [saving, onSavingChange])

  useEffect(() => {
    if (!appId) return
    if (editingId) {
      setLoadingDetail(true)
      api.get(`/api/apps/credentials/${editingId}`)
        .then((res) => setForm(normalize(res.data || {})))
        .catch((err) => message.error(err.response?.data?.detail || 'Failed to load OneDrive credential'))
        .finally(() => setLoadingDetail(false))
    } else {
      setForm(EMPTY_FORM)
    }
    setShowAccessToken(false)
    setShowRefreshToken(false)
    setShowClientSecret(false)
  }, [appId, editingId])

  useImperativeHandle(ref, () => ({
    save: async () => {
      if (!form.name.trim()) { message.warning('Please enter a profile name'); return false }
      if (!form.access_token.trim()) { message.warning('Please enter a Microsoft Graph access token'); return false }
      if (form.refresh_token.trim() && !form.client_id.trim()) {
        message.warning('Client ID is required when refresh token is provided')
        return false
      }

      setSaving(true)
      try {
        const payload = {
          name: form.name.trim(),
          description: form.description.trim() || null,
          app_id: appId,
          app_name: app.title || 'OneDrive',
          auth: {
            auth_mode: 'access_token',
            access_token: form.access_token.trim(),
            refresh_token: form.refresh_token.trim() || null,
            client_id: form.client_id.trim() || null,
            client_secret: form.client_secret.trim() || null,
            tenant_id: form.tenant_id.trim() || 'common',
            token_expiry: form.token_expiry.trim() || null,
            account_email: form.account_email.trim() || null,
          },
          config: {
            folder_id: form.folder_id.trim() || null,
            folder_name: form.folder_name.trim() || null,
            drive_id: form.drive_id.trim() || null,
            drive_name: form.drive_name.trim() || null,
          },
        }

        if (editingId) {
          await api.put(`/api/apps/credentials/${editingId}`, payload)
          message.success('OneDrive profile updated')
        } else {
          await api.post('/api/apps/credentials', payload)
          message.success('OneDrive profile created')
        }
        onSaved?.()
        return true
      } catch (err) {
        message.error(err.response?.data?.detail || 'Failed to save OneDrive profile')
        return false
      } finally {
        setSaving(false)
      }
    },
  }), [appId, editingId, form, app, onSaved])

  if (loadingDetail) return <SpinCenter text="Loading OneDrive credential..." />

  const updateField = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }))
  }

  return (
    <div className="space-y-4">
      <Alert
        type="info"
        message="OneDrive uses Microsoft Graph tokens"
        description="Use an access token with Files.ReadWrite permissions. For scheduled backups, also provide refresh token and Azure app details so the runner can refresh during execution."
      />

      <div className="grid gap-4 md:grid-cols-2">
        <TextField label="Profile name" value={form.name} onChange={updateField('name')} placeholder="e.g. Finance OneDrive Backup" />
        <TextField label="Account label" value={form.account_email} onChange={updateField('account_email')} placeholder="name@company.com" />
      </div>

      <TextField label="Description" value={form.description} onChange={updateField('description')} placeholder="Optional note for the team" />

      <div className="rounded-lg border border-[rgb(var(--border-line))] bg-surface-2 p-4 space-y-3">
        <div className="flex items-center gap-2 text-caption font-emphasis text-text-secondary">
          <KeyRound className="h-3.5 w-3.5" />
          Microsoft Graph authentication
        </div>

        <SecretField
          label="Access token"
          value={form.access_token}
          onChange={updateField('access_token')}
          placeholder="Paste Microsoft Graph access token"
          visible={showAccessToken}
          onToggle={() => setShowAccessToken((current) => !current)}
        />

        <div className="grid gap-3 md:grid-cols-2">
          <SecretField
            label="Refresh token"
            value={form.refresh_token}
            onChange={updateField('refresh_token')}
            placeholder="Optional for scheduled backups"
            visible={showRefreshToken}
            onToggle={() => setShowRefreshToken((current) => !current)}
          />
          <TextField label="Token expiry" value={form.token_expiry} onChange={updateField('token_expiry')} placeholder="Optional ISO time, e.g. 2026-05-19T12:00:00Z" />
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <TextField label="Client ID" value={form.client_id} onChange={updateField('client_id')} placeholder="Azure app client ID" />
          <SecretField
            label="Client secret"
            value={form.client_secret}
            onChange={updateField('client_secret')}
            placeholder="Optional"
            visible={showClientSecret}
            onToggle={() => setShowClientSecret((current) => !current)}
          />
          <TextField label="Tenant ID" value={form.tenant_id} onChange={updateField('tenant_id')} placeholder="common or tenant ID" />
        </div>
      </div>

      <div className="rounded-lg border border-[rgb(var(--border-line))] bg-surface-2 p-4 space-y-3">
        <div className="flex items-center gap-2 text-caption font-emphasis text-text-secondary">
          <Cloud className="h-3.5 w-3.5" />
          Optional storage location defaults
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <TextField label="Folder name" value={form.folder_name} onChange={updateField('folder_name')} placeholder="e.g. Team Backup Root" />
          <TextField label="Folder item ID" value={form.folder_id} onChange={updateField('folder_id')} placeholder="Optional OneDrive folder item ID" />
          <TextField label="Drive name" value={form.drive_name} onChange={updateField('drive_name')} placeholder="Optional Graph drive label" />
          <TextField label="Drive ID" value={form.drive_id} onChange={updateField('drive_id')} placeholder="Optional Graph drive ID" />
        </div>
      </div>
    </div>
  )
})


function TextField({ label, value, onChange, placeholder }) {
  return (
    <div>
      <label className="mb-1 block text-caption font-emphasis text-text-secondary">{label}</label>
      <input
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="w-full rounded-md border border-[rgb(var(--border-strong))] bg-surface-0 px-3 py-2 text-caption text-text-primary placeholder:text-text-quaternary focus:border-brand focus:shadow-focus-brand focus:outline-none transition-colors"
      />
    </div>
  )
}


function SecretField({ label, value, onChange, placeholder, visible, onToggle }) {
  return (
    <div>
      <label className="mb-1 block text-caption font-emphasis text-text-secondary">{label}</label>
      <div className="relative">
        <input
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          className="w-full rounded-md border border-[rgb(var(--border-strong))] bg-surface-0 px-3 py-2 pr-10 text-caption text-text-primary placeholder:text-text-quaternary focus:border-brand focus:shadow-focus-brand focus:outline-none transition-colors"
        />
        <button
          type="button"
          onClick={onToggle}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-text-quaternary transition-colors hover:bg-surface-2 hover:text-text-secondary"
        >
          {visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  )
}


export default OneDriveCredentialForm

