import React, { useState, useEffect } from 'react'
import api from '@shared/api/client'
import { Globe, Plus, Trash2, Copy, Link, Info, Eye, EyeOff, Loader2, CheckCircle, AlertTriangle } from 'lucide-react'
import { Alert, SpinCenter, message, Modal } from '@packages/ui/src/components/common/ui'
import AppLayout from '@packages/ui/src/components/layout/AppLayout'

const DEFAULT_REDIRECT = `${window.location.protocol}//${window.location.hostname}:8010/api/google/callback`

// ── open Google OAuth popup + listen for postMessage ─────────────────────────
function openGoogleOAuthPopup(authUrl, onSuccess, onError) {
  const w = 520, h = 660
  const popup = window.open(
    authUrl, 'google-oauth',
    `width=${w},height=${h},top=${Math.round((window.screen.height - h) / 2)},left=${Math.round((window.screen.width - w) / 2)}`,
  )
  if (!popup) { onError('Popup blocked. Please allow popups for this site.'); return }

  const onMessage = (event) => {
    if (!event.data || typeof event.data !== 'object') return
    const d = event.data
    if (d.success === true && d.connection_id) {
      window.removeEventListener('message', onMessage)
      onSuccess(d)
    } else if (d.success === false) {
      window.removeEventListener('message', onMessage)
      onError(d.error || 'Authentication failed')
    }
  }
  window.addEventListener('message', onMessage)

  const timer = setInterval(() => {
    if (popup.closed) { clearInterval(timer); window.removeEventListener('message', onMessage) }
  }, 800)
}

// ── available credential types ────────────────────────────────────────────────
const CRED_TYPES = [
  {
    id:    'google',
    label: 'Google OAuth 2.0',
    desc:  'Google Drive & Sheets',
    icon:  <Globe className="w-5 h-5 text-blue-500" />,
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────
const CredentialsPage = () => {
  const [connections, setConnections]     = useState([])
  const [loadingConns, setLoadingConns]   = useState(true)
  const [showTypeModal, setShowTypeModal] = useState(false)
  const [credModalType, setCredModalType] = useState(null)

  const fetchConnections = async () => {
    setLoadingConns(true)
    try {
      const res = await api.get(`/api/credentials`)
      setConnections(res.data || [])
    } catch {
      message.error('Failed to load credentials')
    } finally {
      setLoadingConns(false)
    }
  }

  useEffect(() => { fetchConnections() }, [])

  const handleDelete = async (id, type = 'google') => {
    if (!window.confirm('Remove this credential?\n\nBackup flows that use this account will no longer be able to run.')) return
    try {
      await api.delete(`/api/credentials/${id}`, { params: { type } })
      message.success('Credential removed')
      setConnections(prev => prev.filter(c => c.id !== id))
    } catch {
      message.error('Failed to delete credential')
    }
  }

  const handleConnected = (data) => {
    setCredModalType(null)
    message.success(`Connected as ${data.display_name || data.email}`)
    fetchConnections()
  }

  return (
    <AppLayout>
      <div className="p-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Credentials</h2>
            <p className="text-sm text-gray-500 mt-0.5">Manage connected accounts for backup destinations</p>
          </div>
          <button
            onClick={() => setShowTypeModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" /> Add Credential
          </button>
        </div>

        {/* Credential list */}
        {loadingConns ? (
          <SpinCenter text="Loading credentials…" />
        ) : connections.length === 0 ? (
          <EmptyState onAdd={() => setShowTypeModal(true)} />
        ) : (
          <div className="flex flex-col gap-2.5 max-w-2xl">
            {connections.map(conn => (
              <CredentialCard key={conn.id} conn={conn} onDelete={() => handleDelete(conn.id, conn.type)} />
            ))}
          </div>
        )}
      </div>

      {/* Type selector modal */}
      {showTypeModal && (
        <TypeSelectorModal
          onSelect={(type) => { setShowTypeModal(false); setCredModalType(type) }}
          onCancel={() => setShowTypeModal(false)}
        />
      )}

      {/* Credential editor modal */}
      {credModalType && (
        <CredentialModal
          type={credModalType}
          onSuccess={handleConnected}
          onCancel={() => setCredModalType(null)}
        />
      )}
    </AppLayout>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Empty state
// ─────────────────────────────────────────────────────────────────────────────
const EmptyState = ({ onAdd }) => (
  <div className="border-2 border-dashed border-gray-200 rounded-xl py-16 px-10 text-center max-w-2xl">
    <div className="text-4xl mb-4">🔑</div>
    <p className="text-base font-semibold text-gray-800 mb-1">No credentials yet</p>
    <p className="text-sm text-gray-500 mb-6">Add a credential to connect your backup destinations</p>
    <button
      onClick={onAdd}
      className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
    >
      <Plus className="w-4 h-4" /> Add Credential
    </button>
  </div>
)

// ─────────────────────────────────────────────────────────────────────────────
// Credential row card
// ─────────────────────────────────────────────────────────────────────────────
const CredentialCard = ({ conn, onDelete }) => (
  <div className="bg-white border border-gray-200 rounded-xl px-4 py-3.5 flex items-center gap-4 hover:border-gray-300 transition-colors shadow-sm">
    <div className="w-10 h-10 rounded-lg bg-white border border-gray-100 flex items-center justify-center shrink-0 overflow-hidden shadow-sm">
      {conn.picture_url
        ? <img src={conn.picture_url} alt="" className="w-10 h-10 object-cover" />
        : <Globe className="w-5 h-5 text-blue-500" />
      }
    </div>

    <div className="flex-1 min-w-0">
      <div className="font-semibold text-sm text-gray-900 truncate">{conn.display_name || conn.email}</div>
      <div className="text-xs text-gray-500 truncate">{conn.email} · Google Drive &amp; Sheets</div>
    </div>

    <div className="flex items-center gap-1.5 bg-green-50 border border-green-200 rounded-full px-3 py-1 shrink-0">
      <CheckCircle className="w-3 h-3 text-green-600" />
      <span className="text-xs font-medium text-green-700">Connected</span>
    </div>

    <button
      onClick={onDelete}
      title="Remove credential"
      className="p-1.5 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
    >
      <Trash2 className="w-4 h-4" />
    </button>
  </div>
)

// ─────────────────────────────────────────────────────────────────────────────
// Type selector modal
// ─────────────────────────────────────────────────────────────────────────────
const TypeSelectorModal = ({ onSelect, onCancel }) => (
  <Modal open onCancel={onCancel} title="Select credential type" width={460}>
    <div className="space-y-2">
      {CRED_TYPES.map(t => (
        <button
          key={t.id}
          onClick={() => onSelect(t)}
          className="w-full flex items-center gap-4 bg-gray-50 border border-gray-200 rounded-xl p-4 hover:border-blue-400 hover:bg-blue-50 transition-all text-left"
        >
          <div className="w-10 h-10 rounded-lg bg-white border border-gray-200 flex items-center justify-center shrink-0 shadow-sm">
            {t.icon}
          </div>
          <div>
            <div className="font-semibold text-sm text-gray-800">{t.label}</div>
            <div className="text-xs text-gray-500">{t.desc}</div>
          </div>
        </button>
      ))}
    </div>
  </Modal>
)

// ─────────────────────────────────────────────────────────────────────────────
// Credential editor modal
// ─────────────────────────────────────────────────────────────────────────────
const CredentialModal = ({ type, onSuccess, onCancel }) => {
  const [activeTab, setActiveTab]     = useState('connection')
  const [clientId, setClientId]       = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [redirectUri, setRedirectUri] = useState(DEFAULT_REDIRECT)
  const [secretSet, setSecretSet]     = useState(false)
  const [showSecret, setShowSecret]   = useState(false)
  const [saving, setSaving]           = useState(false)
  const [connecting, setConnecting]   = useState(false)
  const [error, setError]             = useState(null)

  useEffect(() => {
    api.get(`/api/settings/google`).then(res => {
      const d = res.data
      setSecretSet(!!(d.client_secret && d.client_secret !== ''))
      const uri = d.redirect_uri || DEFAULT_REDIRECT
      setRedirectUri(uri)
      setClientId(d.client_id || '')
    }).catch(() => {})
  }, [])

  const handleSignIn = async () => {
    if (!clientId.trim())               { setError('Client ID is required'); return }
    if (!clientSecret.trim() && !secretSet) { setError('Client Secret is required'); return }
    setError(null)

    setSaving(true)
    try {
      await api.put(`/api/settings/google`, {
        client_id:     clientId.trim(),
        client_secret: clientSecret.trim() || '__KEEP__',
        redirect_uri:  redirectUri.trim()  || DEFAULT_REDIRECT,
      })
      if (clientSecret.trim()) setSecretSet(true)
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to save credentials')
      setSaving(false)
      return
    }
    setSaving(false)

    setConnecting(true)
    try {
      const res = await api.get(`/api/google/auth-url`)
      openGoogleOAuthPopup(
        res.data.url,
        (data) => { setConnecting(false); onSuccess(data) },
        (errMsg) => { setConnecting(false); setError(errMsg) },
      )
    } catch (err) {
      setConnecting(false)
      setError(err.response?.data?.detail || 'Failed to start Google OAuth')
    }
  }

  const busy = saving || connecting

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} />
      <div className="relative bg-white rounded-xl shadow-2xl flex flex-col overflow-hidden" style={{ width: '100%', maxWidth: 680, maxHeight: '90vh' }}>
        {/* Title bar */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-200 bg-gray-50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-white border border-gray-200 flex items-center justify-center shadow-sm">
              {type.icon}
            </div>
            <div>
              <div className="font-semibold text-sm text-gray-900">{type.label}</div>
              <div className="text-xs text-gray-500">{type.desc}</div>
            </div>
          </div>
          <button onClick={onCancel} className="p-1.5 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors">
            ×
          </button>
        </div>

        {/* Body: sidebar + content */}
        <div className="flex flex-1 min-h-0" style={{ minHeight: 420 }}>
          {/* Sidebar tabs */}
          <div className="w-36 bg-gray-50 border-r border-gray-200 py-2 shrink-0">
            {[
              { key: 'connection', icon: <Link className="w-3.5 h-3.5" />, label: 'Connection' },
              { key: 'details',    icon: <Info className="w-3.5 h-3.5" />, label: 'Details'    },
            ].map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`w-full flex items-center gap-2 px-4 py-2.5 text-sm transition-all text-left border-l-2 ${
                  activeTab === tab.key
                    ? 'border-blue-600 bg-white text-blue-700 font-semibold'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab.icon} {tab.label}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-auto">
            {activeTab === 'connection' ? (
              <ConnectionTab
                clientId={clientId}
                setClientId={setClientId}
                clientSecret={clientSecret}
                setClientSecret={setClientSecret}
                redirectUri={redirectUri}
                setRedirectUri={setRedirectUri}
                secretSet={secretSet}
                showSecret={showSecret}
                setShowSecret={setShowSecret}
                saving={saving}
                connecting={connecting}
                error={error}
                onSignIn={handleSignIn}
              />
            ) : (
              <DetailsTab redirectUri={redirectUri} />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Connection tab ────────────────────────────────────────────────────────────
const ConnectionTab = ({
  clientId, setClientId, clientSecret, setClientSecret,
  redirectUri, setRedirectUri,
  secretSet, showSecret, setShowSecret,
  saving, connecting, error, onSignIn,
}) => {
  const busy = saving || connecting
  return (
    <div>
      {/* Help banner */}
      <div className="bg-amber-50 border-b border-amber-200 px-5 py-2.5 flex items-center gap-2">
        <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
        <span className="text-xs text-amber-700">
          Need help?{' '}
          <a href="https://console.cloud.google.com/" target="_blank" rel="noopener noreferrer" className="font-semibold underline">
            Open Google Cloud Console
          </a>
        </span>
      </div>

      <div className="p-5 space-y-4">
        {/* Error */}
        {error && <Alert type="error" message={error} />}

        {/* Redirect URL */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">OAuth Redirect URL</label>
          <div className="flex">
            <div className="flex-1 border border-gray-300 rounded-l-md px-3 py-2 bg-gray-50 text-xs font-mono text-gray-500 truncate">
              {redirectUri}
            </div>
            <button
              onClick={() => { navigator.clipboard.writeText(redirectUri); message.success('Copied!') }}
              className="border border-l-0 border-gray-300 rounded-r-md px-3 bg-gray-50 hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-1">Copy this URL into Authorized redirect URIs in Google Cloud Console.</p>
        </div>

        {/* Client ID */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Client ID <span className="text-red-500">*</span></label>
          <input
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="123456789-abc.apps.googleusercontent.com"
            value={clientId}
            onChange={e => setClientId(e.target.value)}
          />
          <p className="text-xs text-gray-400 mt-1">Found in Google Cloud Console → Credentials → OAuth 2.0 Client IDs</p>
        </div>

        {/* Client Secret */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Client Secret <span className="text-red-500">*</span></label>
          <div className="flex">
            <input
              type={showSecret ? 'text' : 'password'}
              className="flex-1 border border-gray-300 rounded-l-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder={secretSet ? '●●●●●●●●●●●●●●●● (saved)' : 'GOCSPX-xxxxxxxxxxxxxxxx'}
              value={clientSecret}
              onChange={e => setClientSecret(e.target.value)}
            />
            <button
              onClick={() => setShowSecret(v => !v)}
              className="border border-l-0 border-gray-300 rounded-r-md px-3 bg-gray-50 hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
            >
              {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-1">
            {secretSet ? 'A secret is already saved (encrypted). Enter a new one only to replace it.' : 'Stored encrypted in the database.'}
          </p>
        </div>

        {/* Sign in button */}
        <div className="pt-3 border-t border-gray-200 flex justify-end">
          <button
            onClick={onSignIn}
            disabled={busy}
            className="flex items-center gap-2.5 bg-white border border-gray-200 rounded-lg px-5 py-2.5 text-sm font-semibold text-gray-700 shadow-sm hover:shadow-md disabled:opacity-60 disabled:cursor-not-allowed transition-all"
          >
            {busy
              ? <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
              : <Globe className="w-4 h-4 text-blue-500" />
            }
            {saving ? 'Saving credentials…' : connecting ? 'Waiting for Google…' : 'Sign in with Google'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Details tab ───────────────────────────────────────────────────────────────
const DetailsTab = ({ redirectUri }) => (
  <div className="p-5 space-y-4">
    <div>
      <div className="font-semibold text-sm text-gray-800 mb-0.5">Required Google APIs</div>
      <p className="text-xs text-gray-500">Enable these in Google Cloud Console → APIs &amp; Services → Library</p>
    </div>

    <div className="space-y-2">
      {[
        { name: 'Google Drive API',  desc: 'Read/write files and folders',              color: '#4285f4' },
        { name: 'Google Sheets API', desc: 'Create and edit spreadsheets',              color: '#0f9d58' },
        { name: 'People API',        desc: 'Fetch user profile (email, name, picture)', color: '#db4437' },
      ].map(item => (
        <div key={item.name} className="flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-lg px-3.5 py-2.5">
          <div className="w-2 h-2 rounded-full shrink-0" style={{ background: item.color }} />
          <div>
            <div className="text-sm font-medium text-gray-800">{item.name}</div>
            <div className="text-xs text-gray-500">{item.desc}</div>
          </div>
        </div>
      ))}
    </div>

    <div className="bg-amber-50 border border-amber-200 rounded-lg px-3.5 py-3 text-xs text-amber-800">
      <strong>OAuth Consent Screen:</strong> Set to <strong>External</strong>, add your email as a <strong>Test User</strong> while the app is in testing mode.
    </div>

    <div className="bg-gray-50 border border-gray-200 rounded-lg px-3.5 py-3">
      <div className="text-xs font-semibold text-gray-600 mb-1.5">Authorized redirect URI:</div>
      <div className="flex items-center gap-2">
        <code className="text-xs font-mono text-green-700 flex-1 break-all">{redirectUri}</code>
        <button
          onClick={() => { navigator.clipboard.writeText(redirectUri); message.success('Copied!') }}
          className="text-gray-400 hover:text-gray-600 transition-colors shrink-0"
        >
          <Copy className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  </div>
)

export default CredentialsPage
