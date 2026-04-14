/**
 * Lightweight Tailwind UI primitives — replaces Ant Design basics.
 * Used throughout the Integration app.
 */
import React from 'react'
import { Loader2, X, AlertCircle, Info, CheckCircle, AlertTriangle } from 'lucide-react'

// ─── Badge / Tag ────────────────────────────────────────────────────────────
const TAG_VARIANTS = {
  default:    'bg-gray-100 text-gray-700',
  blue:       'bg-blue-50 text-blue-700',
  green:      'bg-green-50 text-green-700',
  success:    'bg-green-50 text-green-700',
  red:        'bg-red-50 text-red-700',
  error:      'bg-red-50 text-red-700',
  orange:     'bg-orange-50 text-orange-700',
  gold:       'bg-yellow-50 text-yellow-700',
  purple:     'bg-purple-50 text-purple-700',
  cyan:       'bg-cyan-50 text-cyan-700',
  processing: 'bg-blue-50 text-blue-700 animate-pulse',
}

export const Tag = ({ color = 'default', children, className = '' }) => (
  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${TAG_VARIANTS[color] ?? TAG_VARIANTS.default} ${className}`}>
    {children}
  </span>
)

// ─── Alert ───────────────────────────────────────────────────────────────────
const ALERT_STYLES = {
  info:    { wrap: 'bg-blue-50 border-blue-200',   text: 'text-blue-800',  icon: Info,          iconCls: 'text-blue-500' },
  success: { wrap: 'bg-green-50 border-green-200', text: 'text-green-800', icon: CheckCircle,   iconCls: 'text-green-500' },
  warning: { wrap: 'bg-yellow-50 border-yellow-200', text: 'text-yellow-800', icon: AlertTriangle, iconCls: 'text-yellow-500' },
  error:   { wrap: 'bg-red-50 border-red-200',     text: 'text-red-800',   icon: AlertCircle,   iconCls: 'text-red-500' },
}

export const Alert = ({ type = 'info', message, description, className = '' }) => {
  const s = ALERT_STYLES[type] ?? ALERT_STYLES.info
  const Icon = s.icon
  return (
    <div className={`flex gap-3 p-3 rounded-md border ${s.wrap} ${className}`}>
      <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${s.iconCls}`} />
      <div>
        {message && <p className={`text-sm font-medium ${s.text}`}>{message}</p>}
        {description && <p className={`text-xs mt-0.5 ${s.text} opacity-80`}>{description}</p>}
      </div>
    </div>
  )
}

// ─── Spinner ─────────────────────────────────────────────────────────────────
export const Spinner = ({ className = '' }) => (
  <Loader2 className={`animate-spin ${className || 'w-5 h-5 text-blue-500'}`} />
)

export const SpinCenter = ({ text = 'Loading…' }) => (
  <div className="flex flex-col items-center justify-center gap-3 py-12 text-gray-400">
    <Spinner className="w-6 h-6 text-blue-400" />
    {text && <p className="text-sm">{text}</p>}
  </div>
)

// ─── Progress bar ─────────────────────────────────────────────────────────────
const PROGRESS_COLORS = {
  normal:    'bg-blue-500',
  active:    'bg-blue-500 animate-pulse',
  success:   'bg-green-500',
  exception: 'bg-red-500',
}

export const Progress = ({ percent = 0, status = 'normal', size = 'default' }) => {
  const h = size === 'small' ? 'h-1.5' : 'h-2'
  return (
    <div className={`w-full bg-gray-200 rounded-full overflow-hidden ${h}`}>
      <div
        className={`${h} rounded-full transition-all duration-300 ${PROGRESS_COLORS[status] ?? PROGRESS_COLORS.normal}`}
        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
      />
    </div>
  )
}

// ─── Modal ────────────────────────────────────────────────────────────────────
export const Modal = ({ open, onCancel, title, children, footer, width = 520, className = '' }) => {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} />
      <div
        className={`relative bg-white rounded-xl shadow-2xl flex flex-col max-h-[90vh] ${className}`}
        style={{ width: '100%', maxWidth: width }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <button onClick={onCancel} className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">{children}</div>
        {/* Footer */}
        {footer && (
          <div className="flex items-center justify-end gap-2 px-6 py-3 border-t border-gray-200 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Drawer ───────────────────────────────────────────────────────────────────
export const Drawer = ({ open, onClose, title, children, extra, width = 880 }) => {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        className="relative bg-white shadow-2xl flex flex-col h-full"
        style={{ width: Math.min(width, window.innerWidth - 32) }}
      >
        {title !== null ? (
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0">
            <h2 className="text-base font-semibold text-gray-900 truncate">{title}</h2>
            <div className="flex items-center gap-2">
              {extra}
              <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors ml-1">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={onClose}
            className="absolute top-4 right-4 z-10 p-1.5 rounded-lg bg-white/80 hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors shadow-sm border border-gray-200"
          >
            <X className="w-4 h-4" />
          </button>
        )}
        <div className="flex-1 overflow-y-auto px-6 py-4">{children}</div>
      </div>
    </div>
  )
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────
export const Tabs = ({ activeKey, onChange, items = [] }) => (
  <div>
    <div className="flex border-b border-gray-200 mb-4 gap-1">
      {items.map(item => (
        <button
          key={item.key}
          onClick={() => onChange(item.key)}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
            activeKey === item.key
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
    {items.find(i => i.key === activeKey)?.children}
  </div>
)

// ─── Confirm dialog ───────────────────────────────────────────────────────────
export const useConfirm = () => {
  const confirm = ({ title, content, okText = 'Confirm', cancelText = 'Cancel', onOk, danger = false }) => {
    // Use native confirm as minimal replacement
    if (window.confirm(`${title}\n\n${content}`)) {
      onOk?.()
    }
  }
  return confirm
}

// ─── Toast (simple) ───────────────────────────────────────────────────────────
let _toastContainer = null

const showToast = (msg, type = 'info') => {
  if (!_toastContainer) {
    _toastContainer = document.createElement('div')
    _toastContainer.style.cssText = 'position:fixed;top:16px;right:16px;z-index:9999;display:flex;flex-direction:column;gap:8px;max-width:360px;'
    document.body.appendChild(_toastContainer)
  }
  const el = document.createElement('div')
  const colors = { success: '#dcfce7;color:#166534', error: '#fee2e2;color:#991b1b', warning: '#fef9c3;color:#854d0e', info: '#dbeafe;color:#1e40af' }
  const [bg, color] = (colors[type] || colors.info).split(';color:')
  el.style.cssText = `background:${bg};color:#${color};padding:10px 14px;border-radius:8px;font-size:13px;box-shadow:0 4px 12px rgba(0,0,0,.15);transition:opacity .3s;`
  el.textContent = msg
  _toastContainer.appendChild(el)
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300) }, 3000)
}

export const message = {
  success: (msg) => showToast(typeof msg === 'object' ? msg.content : msg, 'success'),
  error:   (msg) => showToast(typeof msg === 'object' ? msg.content : msg, 'error'),
  warning: (msg) => showToast(typeof msg === 'object' ? msg.content : msg, 'warning'),
  info:    (msg) => showToast(typeof msg === 'object' ? msg.content : msg, 'info'),
  loading: (msg) => showToast(typeof msg === 'object' ? msg.content : msg, 'info'),
}

// ─── Empty state ──────────────────────────────────────────────────────────────
export const Empty = ({ description = 'No data', image }) => (
  <div className="flex flex-col items-center justify-center py-10 text-gray-400">
    <div className="w-12 h-12 mb-3 opacity-30">
      <svg viewBox="0 0 64 64" fill="currentColor"><path d="M32 4C16.536 4 4 16.536 4 32s12.536 28 28 28 28-12.536 28-28S47.464 4 32 4zm0 4c13.255 0 24 10.745 24 24S45.255 56 32 56 8 45.255 8 32 18.745 8 32 8zm-1 12v14h2V20h-2zm0 18v4h2v-4h-2z"/></svg>
    </div>
    <p className="text-sm">{description}</p>
  </div>
)
