import React, { useState, useEffect } from 'react'
import axios from 'axios'
import { Layout, Typography, Spin, message, Tooltip, Form, Input, Modal } from 'antd'
import {
  GoogleOutlined,
  PlusOutlined,
  DeleteOutlined,
  LinkOutlined,
  ExclamationCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  CopyOutlined,
  InfoCircleOutlined,
  EyeOutlined,
  EyeInvisibleOutlined,
} from '@ant-design/icons'
import Sidebar from '@packages/ui/src/components/layout/Sidebar'
import Topbar from '@packages/ui/src/components/layout/Topbar'

const { Content } = Layout
const { Text } = Typography

const API_BASE = 'http://localhost:8000'
const DEFAULT_REDIRECT = 'http://localhost:8000/api/google/callback'

// ── colour palette ────────────────────────────────────────────────────────────
const C = {
  panel:       '#1e1e2e',
  sidebar:     '#141422',
  border:      '#2a2a3e',
  inputBg:     '#252535',
  inputBorder: '#3a3a4e',
  text:        '#e2e2f0',
  muted:       '#8888aa',
  accent:      '#4f8ef7',
  error:       '#f85149',
  headerBg:    '#16162a',
  card:        '#1a1a2a',
  cardHover:   '#22223a',
}

// ── shared input style ────────────────────────────────────────────────────────
const inputStyle = {
  background:   C.inputBg,
  border:       `1px solid ${C.inputBorder}`,
  borderRadius: 6,
  color:        C.text,
  fontSize:     13,
  height:       38,
}

// ── available credential types ────────────────────────────────────────────────
const CRED_TYPES = [
  {
    id:     'google',
    label:  'Google OAuth 2.0',
    desc:   'Google Drive & Sheets',
    iconBg: '#fff',
    icon:   <GoogleOutlined style={{ fontSize: 22, color: '#4285f4' }} />,
  },
]

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

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────
const CredentialsPage = () => {
  const [collapsed, setCollapsed]           = useState(false)
  const [connections, setConnections]       = useState([])
  const [loadingConns, setLoadingConns]     = useState(true)
  const [showTypeModal, setShowTypeModal]   = useState(false)
  const [credModalType, setCredModalType]   = useState(null)

  const fetchConnections = async () => {
    setLoadingConns(true)
    try {
      const res = await axios.get(`${API_BASE}/api/credentials`)
      setConnections(res.data || [])
    } catch {
      message.error('Failed to load credentials')
    } finally {
      setLoadingConns(false)
    }
  }

  useEffect(() => { fetchConnections() }, [])

  const handleDelete = async (id, type = 'google') => {
    try {
      await axios.delete(`${API_BASE}/api/credentials/${id}`, { params: { type } })
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
    <Layout style={{ minHeight: '100vh' }}>
      <Sidebar collapsed={collapsed} />
      <Layout style={{ marginLeft: collapsed ? 80 : 240, transition: 'all 0.2s' }}>
        <Topbar collapsed={collapsed} toggleCollapsed={() => setCollapsed(!collapsed)} />
        <Content style={{ margin: 24 }}>

          {/* ── page header ── */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
            <div>
              <Text style={{ fontSize: 22, fontWeight: 700, display: 'block' }}>Credentials</Text>
              <Text style={{ color: C.muted, fontSize: 13 }}>
                Manage connected accounts for backup destinations
              </Text>
            </div>
            <button
              onClick={() => setShowTypeModal(true)}
              style={{
                background: C.accent, border: 'none', color: '#fff',
                borderRadius: 8, padding: '9px 18px', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 8,
                fontSize: 14, fontWeight: 600,
              }}
              onMouseEnter={e => e.currentTarget.style.background = '#3d7ef0'}
              onMouseLeave={e =>  e.currentTarget.style.background = C.accent}
            >
              <PlusOutlined /> Add Credential
            </button>
          </div>

          {/* ── credential list ── */}
          {loadingConns ? (
            <div style={{ textAlign: 'center', padding: 60 }}><Spin /></div>
          ) : connections.length === 0 ? (
            <EmptyState onAdd={() => setShowTypeModal(true)} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 760 }}>
              {connections.map(conn => (
                <CredentialCard key={conn.id} conn={conn} onDelete={() => handleDelete(conn.id, conn.type)} />
              ))}
            </div>
          )}

        </Content>
      </Layout>

      {/* ── type selector modal ── */}
      <TypeSelectorModal
        open={showTypeModal}
        onSelect={(type) => { setShowTypeModal(false); setCredModalType(type) }}
        onCancel={() => setShowTypeModal(false)}
      />

      {/* ── credential editor modal ── */}
      {credModalType && (
        <CredentialModal
          type={credModalType}
          onSuccess={handleConnected}
          onCancel={() => setCredModalType(null)}
        />
      )}
    </Layout>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Empty state
// ─────────────────────────────────────────────────────────────────────────────
const EmptyState = ({ onAdd }) => (
  <div style={{
    border: `2px dashed ${C.border}`, borderRadius: 12,
    padding: '64px 40px', textAlign: 'center', maxWidth: 760,
  }}>
    <div style={{ fontSize: 40, marginBottom: 14 }}>🔑</div>
    <Text style={{ color: C.text, fontSize: 16, fontWeight: 600, display: 'block', marginBottom: 6 }}>
      No credentials yet
    </Text>
    <Text style={{ color: C.muted, fontSize: 13, display: 'block', marginBottom: 22 }}>
      Add a credential to connect your backup destinations
    </Text>
    <button
      onClick={onAdd}
      style={{
        background: C.accent, border: 'none', color: '#fff',
        borderRadius: 8, padding: '9px 20px', cursor: 'pointer',
        fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8,
      }}
    >
      <PlusOutlined /> Add Credential
    </button>
  </div>
)

// ─────────────────────────────────────────────────────────────────────────────
// Credential row card
// ─────────────────────────────────────────────────────────────────────────────
const CredentialCard = ({ conn, onDelete }) => (
  <div
    style={{
      background: C.card, border: `1px solid ${C.border}`,
      borderRadius: 10, padding: '14px 18px',
      display: 'flex', alignItems: 'center', gap: 14,
      transition: 'border-color 0.15s',
    }}
    onMouseEnter={e => e.currentTarget.style.borderColor = '#3a3a5a'}
    onMouseLeave={e => e.currentTarget.style.borderColor = C.border}
  >
    <div style={{
      width: 42, height: 42, borderRadius: 8, background: '#fff', flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    }}>
      {conn.picture_url
        ? <img src={conn.picture_url} alt="" style={{ width: 42, height: 42, objectFit: 'cover' }} />
        : <GoogleOutlined style={{ fontSize: 20, color: '#4285f4' }} />
      }
    </div>

    <div style={{ flex: 1, minWidth: 0 }}>
      <Text style={{ color: C.text, fontWeight: 600, fontSize: 14, display: 'block' }}>
        {conn.display_name || conn.email}
      </Text>
      <Text style={{ color: C.muted, fontSize: 12 }}>
        {conn.email} · Google Drive &amp; Sheets
      </Text>
    </div>

    <div style={{
      display: 'flex', alignItems: 'center', gap: 5,
      background: '#0d2818', border: '1px solid #2da44e44',
      borderRadius: 20, padding: '4px 12px', flexShrink: 0,
    }}>
      <CheckCircleOutlined style={{ color: '#2da44e', fontSize: 11 }} />
      <Text style={{ color: '#3fb950', fontSize: 11, fontWeight: 500 }}>Connected</Text>
    </div>

    <Tooltip title="Remove credential">
      <button
        onClick={onDelete}
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: C.muted, padding: 6, borderRadius: 6, display: 'flex', alignItems: 'center',
        }}
        onMouseEnter={e => e.currentTarget.style.color = C.error}
        onMouseLeave={e => e.currentTarget.style.color = C.muted}
      >
        <DeleteOutlined style={{ fontSize: 16 }} />
      </button>
    </Tooltip>
  </div>
)

// ─────────────────────────────────────────────────────────────────────────────
// Type selector modal
// ─────────────────────────────────────────────────────────────────────────────
const TypeSelectorModal = ({ open, onSelect, onCancel }) => (
  <Modal
    open={open}
    onCancel={onCancel}
    footer={null}
    title={<Text style={{ color: C.text, fontWeight: 600 }}>Select credential type</Text>}
    width={480}
    styles={{
      content: { background: C.panel, border: `1px solid ${C.border}`, padding: 0, borderRadius: 12, overflow: 'hidden' },
      header:  { background: C.panel, borderBottom: `1px solid ${C.border}`, padding: '16px 20px', marginBottom: 0 },
      body:    { padding: 20 },
      mask:    { backdropFilter: 'blur(2px)' },
    }}
  >
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {CRED_TYPES.map(t => (
        <button
          key={t.id}
          onClick={() => onSelect(t)}
          style={{
            display: 'flex', alignItems: 'center', gap: 14,
            background: C.card, border: `1px solid ${C.border}`,
            borderRadius: 10, padding: '14px 16px', cursor: 'pointer',
            transition: 'all 0.15s', width: '100%', textAlign: 'left',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = C.cardHover; e.currentTarget.style.borderColor = C.accent }}
          onMouseLeave={e => { e.currentTarget.style.background = C.card;      e.currentTarget.style.borderColor = C.border  }}
        >
          <div style={{
            width: 42, height: 42, borderRadius: 8, background: t.iconBg,
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            {t.icon}
          </div>
          <div>
            <Text style={{ color: C.text, fontWeight: 600, fontSize: 14, display: 'block' }}>{t.label}</Text>
            <Text style={{ color: C.muted, fontSize: 12 }}>{t.desc}</Text>
          </div>
        </button>
      ))}
    </div>
  </Modal>
)

// ─────────────────────────────────────────────────────────────────────────────
// Credential editor modal (n8n-style)
// ─────────────────────────────────────────────────────────────────────────────
const CredentialModal = ({ type, onSuccess, onCancel }) => {
  const [form]         = Form.useForm()
  const [activeTab, setActiveTab]     = useState('connection')
  const [secretSet, setSecretSet]     = useState(false)
  const [showSecret, setShowSecret]   = useState(false)
  const [saving, setSaving]           = useState(false)
  const [connecting, setConnecting]   = useState(false)
  const [error, setError]             = useState(null)
  const [redirectUri, setRedirectUri] = useState(DEFAULT_REDIRECT)

  useEffect(() => {
    axios.get(`${API_BASE}/api/settings/google`).then(res => {
      const d = res.data
      setSecretSet(!!(d.client_secret && d.client_secret !== ''))
      const uri = d.redirect_uri || DEFAULT_REDIRECT
      setRedirectUri(uri)
      form.setFieldsValue({ client_id: d.client_id || '', client_secret: '', redirect_uri: uri })
    }).catch(() => {})
  }, [])

  const handleSignIn = async () => {
    const values = form.getFieldsValue()
    if (!values.client_id?.trim())                   { setError('Client ID is required'); return }
    if (!values.client_secret?.trim() && !secretSet) { setError('Client Secret is required'); return }
    setError(null)

    // step 1 – save credentials
    setSaving(true)
    try {
      await axios.put(`${API_BASE}/api/settings/google`, {
        client_id:     values.client_id.trim(),
        client_secret: values.client_secret?.trim() || '__KEEP__',
        redirect_uri:  values.redirect_uri?.trim()  || redirectUri,
      })
      if (values.client_secret?.trim()) setSecretSet(true)
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to save credentials')
      setSaving(false)
      return
    }
    setSaving(false)

    // step 2 – OAuth popup
    setConnecting(true)
    try {
      const res = await axios.get(`${API_BASE}/api/google/auth-url`)
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
    <Modal
      open
      onCancel={onCancel}
      footer={null}
      closable={false}
      width={700}
      styles={{
        content: { background: C.panel, border: `1px solid ${C.border}`, padding: 0, borderRadius: 12, overflow: 'hidden' },
        header:  { display: 'none' },
        body:    { padding: 0 },
        mask:    { backdropFilter: 'blur(2px)' },
      }}
    >
      {/* title bar */}
      <div style={{
        background: C.headerBg, padding: '14px 20px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: `1px solid ${C.border}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 6, background: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {type.icon}
          </div>
          <div>
            <Text style={{ color: C.text, fontWeight: 600, fontSize: 14, display: 'block' }}>{type.label}</Text>
            <Text style={{ color: C.muted, fontSize: 11 }}>{type.desc}</Text>
          </div>
        </div>
        <button
          onClick={onCancel}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: C.muted, fontSize: 22, lineHeight: 1, padding: '2px 6px' }}
          onMouseEnter={e => e.currentTarget.style.color = C.text}
          onMouseLeave={e => e.currentTarget.style.color = C.muted}
        >×</button>
      </div>

      {/* sidebar + content */}
      <div style={{ display: 'flex', minHeight: 460 }}>

        {/* sidebar tabs */}
        <div style={{
          width: 150, background: C.sidebar,
          borderRight: `1px solid ${C.border}`,
          padding: '8px 0', flexShrink: 0,
        }}>
          {[
            { key: 'connection', icon: <LinkOutlined />,      label: 'Connection' },
            { key: 'details',    icon: <InfoCircleOutlined />, label: 'Details'    },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                width: '100%', border: 'none', cursor: 'pointer',
                background: activeTab === tab.key ? C.panel : 'transparent',
                borderLeft: activeTab === tab.key ? `2px solid ${C.accent}` : '2px solid transparent',
                color: activeTab === tab.key ? C.text : C.muted,
                padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8,
                fontSize: 13, fontWeight: activeTab === tab.key ? 600 : 400,
                transition: 'all 0.15s', textAlign: 'left',
              }}
              onMouseEnter={e => { if (activeTab !== tab.key) e.currentTarget.style.color = C.text }}
              onMouseLeave={e => { if (activeTab !== tab.key) e.currentTarget.style.color = C.muted }}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>

        {/* content pane */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {activeTab === 'connection' ? (
            <ConnectionTab
              form={form}
              secretSet={secretSet}
              showSecret={showSecret}
              setShowSecret={setShowSecret}
              saving={saving}
              connecting={connecting}
              error={error}
              redirectUri={redirectUri}
              onSignIn={handleSignIn}
            />
          ) : (
            <DetailsTab redirectUri={redirectUri} />
          )}
        </div>
      </div>
    </Modal>
  )
}

// ── label + field wrapper ─────────────────────────────────────────────────────
const CredField = ({ label, required, children, hint }) => (
  <div style={{ marginBottom: 18 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6 }}>
      <Text style={{ color: C.text, fontSize: 13, fontWeight: 500 }}>{label}</Text>
      {required && <span style={{ color: C.error, fontSize: 13 }}>*</span>}
    </div>
    {children}
    {hint && <Text style={{ color: C.muted, fontSize: 11, marginTop: 4, display: 'block' }}>{hint}</Text>}
  </div>
)

// ── Connection tab ────────────────────────────────────────────────────────────
const ConnectionTab = ({
  form, secretSet, showSecret, setShowSecret,
  saving, connecting, error, redirectUri, onSignIn,
}) => {
  const busy = saving || connecting
  return (
    <div>
      {/* help banner */}
      <div style={{
        background: '#2a1f0e', borderBottom: `1px solid #5c3d1a`,
        padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <ExclamationCircleOutlined style={{ color: '#f0a940', fontSize: 14 }} />
        <Text style={{ color: '#f0a940', fontSize: 12 }}>
          Need help filling out these fields?{' '}
          <a
            href="https://console.cloud.google.com/"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#f0a940', textDecoration: 'underline', fontWeight: 600 }}
          >
            Open Google Cloud Console <LinkOutlined style={{ fontSize: 10 }} />
          </a>
        </Text>
      </div>

      {/* error banner */}
      {error && (
        <div style={{
          background: '#2a0f0f', border: `1px solid ${C.error}55`,
          margin: '14px 20px 0', borderRadius: 8,
          padding: '10px 14px', display: 'flex', alignItems: 'flex-start', gap: 8,
        }}>
          <CloseCircleOutlined style={{ color: C.error, fontSize: 14, marginTop: 1, flexShrink: 0 }} />
          <Text style={{ color: C.error, fontSize: 12 }}>{error}</Text>
        </div>
      )}

      <div style={{ padding: '18px 20px 22px' }}>
        <Form form={form} layout="vertical">

          {/* OAuth Redirect URL */}
          <CredField
            label="OAuth Redirect URL"
            hint="Copy this URL into Authorized redirect URIs in Google Cloud Console."
          >
            <div style={{ display: 'flex' }}>
              <div style={{
                flex: 1, ...inputStyle,
                display: 'flex', alignItems: 'center', paddingLeft: 10,
                borderRight: 'none', borderRadius: '6px 0 0 6px', overflow: 'hidden',
              }}>
                <Text style={{ color: C.muted, fontSize: 12, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                  {redirectUri}
                </Text>
              </div>
              <button
                onClick={() => { navigator.clipboard.writeText(redirectUri); message.success('Copied!') }}
                style={{
                  ...inputStyle, height: 38, width: 40,
                  borderRadius: '0 6px 6px 0', borderLeft: `1px solid ${C.inputBorder}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                }}
                onMouseEnter={e => e.currentTarget.style.background = '#2e2e42'}
                onMouseLeave={e => e.currentTarget.style.background = C.inputBg}
              >
                <CopyOutlined style={{ color: C.muted, fontSize: 13 }} />
              </button>
            </div>
          </CredField>

          {/* Client ID */}
          <CredField
            label="Client ID"
            required
            hint="Found in Google Cloud Console → Credentials → OAuth 2.0 Client IDs"
          >
            <Form.Item name="client_id" noStyle>
              <Input
                placeholder="123456789-abc.apps.googleusercontent.com"
                style={inputStyle}
                styles={{ input: { background: C.inputBg, color: C.text } }}
              />
            </Form.Item>
          </CredField>

          {/* Client Secret */}
          <CredField
            label="Client Secret"
            required
            hint={secretSet
              ? 'A secret is already saved (encrypted). Enter a new one only to replace it.'
              : 'Stored encrypted in the database. Never exposed in the UI.'}
          >
            <div style={{ display: 'flex' }}>
              <Form.Item name="client_secret" noStyle style={{ flex: 1 }}>
                <Input
                  type={showSecret ? 'text' : 'password'}
                  placeholder={secretSet ? '●●●●●●●●●●●●●●●● (saved)' : 'GOCSPX-xxxxxxxxxxxxxxxx'}
                  style={{ ...inputStyle, borderRadius: '6px 0 0 6px', borderRight: 'none' }}
                  styles={{ input: { background: C.inputBg, color: C.text } }}
                />
              </Form.Item>
              <button
                onClick={() => setShowSecret(v => !v)}
                style={{
                  ...inputStyle, height: 38, width: 40,
                  borderRadius: '0 6px 6px 0', borderLeft: `1px solid ${C.inputBorder}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                }}
                onMouseEnter={e => e.currentTarget.style.background = '#2e2e42'}
                onMouseLeave={e => e.currentTarget.style.background = C.inputBg}
              >
                {showSecret
                  ? <EyeInvisibleOutlined style={{ color: C.muted, fontSize: 13 }} />
                  : <EyeOutlined style={{ color: C.muted, fontSize: 13 }} />
                }
              </button>
            </div>
          </CredField>

        </Form>

        {/* Sign in button */}
        <div style={{ paddingTop: 16, borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={onSignIn}
            disabled={busy}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              background: busy ? C.inputBg : '#fff',
              border: 'none', borderRadius: 8, padding: '9px 22px',
              cursor: busy ? 'not-allowed' : 'pointer',
              fontWeight: 600, fontSize: 14, color: busy ? C.muted : '#333',
              boxShadow: '0 1px 4px rgba(0,0,0,0.35)',
              transition: 'all 0.15s', opacity: busy ? 0.7 : 1,
            }}
            onMouseEnter={e => { if (!busy) e.currentTarget.style.boxShadow = '0 3px 12px rgba(0,0,0,0.4)' }}
            onMouseLeave={e => e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.35)'}
          >
            {busy
              ? <Spin size="small" />
              : <GoogleOutlined style={{ fontSize: 18, color: '#4285f4' }} />
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
  <div style={{ padding: 20 }}>
    <div style={{ marginBottom: 18 }}>
      <Text style={{ color: C.text, fontWeight: 600, fontSize: 14 }}>Required Google APIs</Text>
      <Text style={{ color: C.muted, fontSize: 12, display: 'block', marginTop: 4 }}>
        Enable these in Google Cloud Console → APIs &amp; Services → Library
      </Text>
    </div>

    {[
      { name: 'Google Drive API',  desc: 'Read/write files and folders',              color: '#4285f4' },
      { name: 'Google Sheets API', desc: 'Create and edit spreadsheets',              color: '#0f9d58' },
      { name: 'People API',        desc: 'Fetch user profile (email, name, picture)', color: '#db4437' },
    ].map(api => (
      <div key={api.name} style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 12px', borderRadius: 8,
        background: C.inputBg, marginBottom: 8, border: `1px solid ${C.inputBorder}`,
      }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: api.color, flexShrink: 0 }} />
        <div>
          <Text style={{ color: C.text, fontSize: 13, fontWeight: 500 }}>{api.name}</Text>
          <Text style={{ color: C.muted, fontSize: 11, display: 'block' }}>{api.desc}</Text>
        </div>
      </div>
    ))}

    <div style={{ marginTop: 20, padding: '12px 14px', background: C.inputBg, borderRadius: 8, border: `1px solid ${C.inputBorder}` }}>
      <Text style={{ color: C.muted, fontSize: 12 }}>
        <strong style={{ color: C.text }}>OAuth Consent Screen:</strong>{' '}
        Set to <strong style={{ color: C.text }}>External</strong>, add your email as a{' '}
        <strong style={{ color: C.text }}>Test User</strong> while the app is in testing mode.
      </Text>
    </div>

    <div style={{ marginTop: 10, padding: '12px 14px', background: C.inputBg, borderRadius: 8, border: `1px solid ${C.inputBorder}` }}>
      <Text style={{ color: C.muted, fontSize: 12, display: 'block', marginBottom: 4 }}>
        <strong style={{ color: C.text }}>Authorized redirect URI:</strong>
      </Text>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <code style={{ color: '#a6e3a1', fontSize: 12, fontFamily: 'monospace', flex: 1 }}>{redirectUri}</code>
        <button
          onClick={() => { navigator.clipboard.writeText(redirectUri); message.success('Copied!') }}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: C.muted }}
        >
          <CopyOutlined style={{ fontSize: 12 }} />
        </button>
      </div>
    </div>
  </div>
)

export default CredentialsPage
