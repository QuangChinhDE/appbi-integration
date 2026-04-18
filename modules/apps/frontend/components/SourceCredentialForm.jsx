import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Eye, EyeOff, Globe } from 'lucide-react'

import api from '@shared/api/client'
import { APPS, APP_CONNECTION_CONFIG } from '@modules/backup/frontend/constants'
import { APP_CATALOG } from '@modules/apps/frontend/constants'
import { SpinCenter, message } from '@packages/ui/src/components/common/ui'


const EMPTY_FORM = {
  name: '',
  description: '',
  domain: '',
  access_token: '',
}

function normalize(detail) {
  const preview = detail?.preview || {}
  const config = detail?.config || {}
  return {
    ...detail,
    domain: preview.domain || config.domain || '',
    access_token: detail?.auth?.access_token || '',
  }
}


/** Imperative form body for a source-style credential.
 * Parent owns the modal shell + footer buttons; it calls `ref.save()` to submit
 * and listens to `onSavingChange` to disable its own buttons. */
const SourceCredentialForm = forwardRef(function SourceCredentialForm(
  { appId, editingId = null, onSaved, onSavingChange },
  ref,
) {
  const resolvedApp = APPS[appId] || APP_CATALOG.find((a) => a.id === appId) || { id: appId, name: appId }
  const connectionConfig = APP_CONNECTION_CONFIG[appId] || {
    stepTitle: `${resolvedApp.name || resolvedApp.title || appId} Connection`,
    stepDescription: `Provide the domain and access token for ${resolvedApp.name || resolvedApp.title || appId}.`,
    requiresDomain: true,
    domainLabel: 'Base Domain',
    domainPlaceholder: 'company.base.com.vn',
    domainHelp: 'Enter your Base domain. The backend will normalize it.',
    tokenLabel: 'Access Token V2',
    tokenPlaceholder: 'Paste your Base Account access_token_v2 here…',
    tokenHelp: 'Get this value from Settings → API Keys.',
  }
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [showToken, setShowToken] = useState(false)
  const savingRef = useRef(saving)
  savingRef.current = saving

  useEffect(() => { onSavingChange?.(saving) }, [saving, onSavingChange])

  useEffect(() => {
    if (!appId) return
    if (editingId) {
      setLoadingDetail(true)
      api.get(`/api/apps/credentials/${editingId}`)
        .then((res) => {
          const detail = normalize(res.data || {})
          setForm({
            name: detail.name || '',
            description: detail.description || '',
            domain: detail.domain || '',
            access_token: detail.access_token || '',
          })
        })
        .catch((err) => message.error(err.response?.data?.detail || 'Failed to load credential'))
        .finally(() => setLoadingDetail(false))
    } else {
      setForm(EMPTY_FORM)
    }
    setShowToken(false)
  }, [appId, editingId])

  useImperativeHandle(ref, () => ({
    save: async () => {
      if (!resolvedApp) return false
      const appDisplayName = resolvedApp.name || resolvedApp.title || appId
      if (!form.name.trim()) { message.warning('Please enter a credential name'); return false }
      if (!form.domain.trim()) { message.warning('Please enter the source domain'); return false }
      if (!form.access_token.trim()) { message.warning('Please enter the access token'); return false }

      setSaving(true)
      try {
        const payload = {
          name: form.name.trim(),
          description: form.description.trim() || null,
          app_id: appId,
          app_name: appDisplayName,
          auth: { access_token: form.access_token.trim() },
          config: { domain: form.domain.trim() },
        }
        if (editingId) {
          await api.put(`/api/apps/credentials/${editingId}`, payload)
          message.success('Credential updated')
        } else {
          await api.post('/api/apps/credentials', payload)
          message.success('Credential created')
        }
        onSaved?.()
        return true
      } catch (err) {
        message.error(err.response?.data?.detail || 'Failed to save credential')
        return false
      } finally {
        setSaving(false)
      }
    },
  }), [appId, editingId, form, resolvedApp, onSaved])

  if (!resolvedApp) return null
  if (loadingDetail) return <SpinCenter text="Loading credential details..." />

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1 block text-caption font-emphasis text-text-secondary">Credential name</label>
        <input
          value={form.name}
          onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
          placeholder={`e.g. ${resolvedApp.name || resolvedApp.title || appId} HR Production`}
          className="w-full rounded-md border border-[rgb(var(--border-strong))] bg-surface-0 px-3 py-2 text-caption text-text-primary placeholder:text-text-quaternary focus:border-brand focus:shadow-focus-brand focus:outline-none transition-colors"
        />
      </div>

      <div>
        <label className="mb-1 block text-caption font-emphasis text-text-secondary">Description</label>
        <textarea
          value={form.description}
          onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
          rows={2}
          placeholder="Optional note for the team"
          className="w-full rounded-md border border-[rgb(var(--border-strong))] bg-surface-0 px-3 py-2 text-caption text-text-primary placeholder:text-text-quaternary focus:border-brand focus:shadow-focus-brand focus:outline-none transition-colors"
        />
      </div>

      <div className="rounded-lg border border-[rgb(var(--border-line))] bg-surface-2 p-4">
        <div className="flex items-center gap-2 text-caption font-emphasis text-text-secondary">
          <Globe className="h-3.5 w-3.5" />
          {connectionConfig.stepTitle}
        </div>

        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-caption font-emphasis text-text-secondary">{connectionConfig.domainLabel || 'Domain'}</label>
            <input
              value={form.domain}
              onChange={(event) => setForm((current) => ({ ...current, domain: event.target.value }))}
              placeholder={connectionConfig.domainPlaceholder}
              className="w-full rounded-md border border-[rgb(var(--border-strong))] bg-surface-0 px-3 py-2 text-caption text-text-primary placeholder:text-text-quaternary focus:border-brand focus:shadow-focus-brand focus:outline-none transition-colors"
            />
            <p className="mt-1.5 text-tiny text-text-quaternary">{connectionConfig.domainHelp}</p>
          </div>

          <div>
            <label className="mb-1 block text-caption font-emphasis text-text-secondary">{connectionConfig.tokenLabel || 'Access token'}</label>
            <div className="relative">
              <input
                type={showToken ? 'text' : 'password'}
                value={form.access_token}
                onChange={(event) => setForm((current) => ({ ...current, access_token: event.target.value }))}
                placeholder={connectionConfig.tokenPlaceholder || 'Paste your access token here'}
                className="w-full rounded-md border border-[rgb(var(--border-strong))] bg-surface-0 px-3 py-2 pr-10 text-caption text-text-primary placeholder:text-text-quaternary focus:border-brand focus:shadow-focus-brand focus:outline-none transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowToken((current) => !current)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-text-quaternary transition-colors hover:bg-surface-2 hover:text-text-secondary"
              >
                {showToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
            <p className="mt-1.5 text-tiny text-text-quaternary">{connectionConfig.tokenHelp}</p>
          </div>
        </div>
      </div>
    </div>
  )
})

export default SourceCredentialForm
