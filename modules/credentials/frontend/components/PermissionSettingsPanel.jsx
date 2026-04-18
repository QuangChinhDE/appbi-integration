import React, { useCallback, useEffect, useState } from 'react'
import { ChevronDown, Edit2, Plus, UserX } from 'lucide-react'

import api from '@shared/api/client'
import { BACKUP_APPS_PERMISSION_MESSAGE, resolvePermissionDependencies } from '@modules/identity/frontend/lib/permissions'
import { message, SpinCenter } from '@packages/ui/src/components/common/ui'
import { useAuthStore } from '@modules/identity/frontend/store/authStore'


const MODULE_LABELS = {
  backup: 'Backup',
  apps: 'Apps',
  automation: 'Automation',
  settings: 'Settings',
}

const LEVEL_STYLES = {
  none: { bg: 'bg-danger/10', text: 'text-danger', ring: 'ring-danger/20' },
  view: { bg: 'bg-info/10', text: 'text-info', ring: 'ring-info/20' },
  edit: { bg: 'bg-success/10', text: 'text-success', ring: 'ring-success/20' },
  full: { bg: 'bg-[#7c3aed]/10', text: 'text-[#7c3aed]', ring: 'ring-[#7c3aed]/20' },
}

const LEVEL_LABELS = {
  none: 'No access',
  view: 'View',
  edit: 'Edit',
  full: 'Full',
}

const PRESET_ORDER = ['admin', 'editor', 'viewer', 'minimal']
const PRESET_LABELS = {
  admin: 'Admin (full)',
  editor: 'Editor',
  viewer: 'Viewer',
  minimal: 'Minimal',
}

const PRESET_COLORS = {
  admin: 'bg-[#7c3aed]/10 text-[#7c3aed] border-[#7c3aed]/20',
  editor: 'bg-info/10 text-info border-info/20',
  viewer: 'bg-success/10 text-success border-success/20',
  minimal: 'bg-warning/10 text-warning border-warning/20',
}

const STATUS_COLORS = {
  active: 'bg-success/10 text-success',
  deactivated: 'bg-danger/10 text-danger',
}

const DEFAULT_MATRIX_PERMISSIONS = {
  backup: 'none',
  apps: 'none',
  automation: 'none',
  settings: 'none',
}

const EMPTY_INVITE_FORM = {
  email: '',
  full_name: '',
  auth_provider: 'google',
  password: '',
}
function getAuthMethodLabel(authProvider) {
  return authProvider === 'google' ? 'Google' : 'Password'
}


function formatDate(value) {
  if (!value) return 'Never'
  return new Date(value).toLocaleDateString()
}


function ModalShell({ title, subtitle, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/84 backdrop-blur-[3px] p-4 animate-fade-in" onClick={onClose}>
      <div className="w-full max-w-sm rounded-xl bg-surface-1 border border-[rgb(var(--border-strong))] p-5 shadow-linear-lg animate-slide-up" onClick={(event) => event.stopPropagation()}>
        <h2 className="text-small font-strong text-text-primary">{title}</h2>
        {subtitle && <p className="mt-0.5 text-caption text-text-tertiary">{subtitle}</p>}
        <div className="mt-4">{children}</div>
      </div>
    </div>
  )
}


function InviteUserModal({ onClose, onSuccess }) {
  const passwordLoginEnabled = String(import.meta.env.VITE_AUTH_PASSWORD_ENABLED ?? 'true').toLowerCase() !== 'false'
  const googleLoginEnabled = String(import.meta.env.VITE_AUTH_GOOGLE_ENABLED ?? 'true').toLowerCase() !== 'false'
  const availableProviders = [
    ...(googleLoginEnabled ? [{ value: 'google', label: 'Google' }] : []),
    ...(passwordLoginEnabled ? [{ value: 'password', label: 'Password' }] : []),
  ]
  const [form, setForm] = useState({
    ...EMPTY_INVITE_FORM,
    auth_provider: availableProviders[0]?.value || 'password',
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')

    if (!form.full_name.trim() || !form.email.trim()) {
      setError('Full name and email are required.')
      return
    }
    if (form.auth_provider === 'password' && form.password.trim().length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }

    setLoading(true)
    try {
      await api.post('/api/users/', {
        email: form.email.trim(),
        full_name: form.full_name.trim(),
        auth_provider: form.auth_provider,
        ...(form.auth_provider === 'password' ? { password: form.password.trim() } : {}),
      })
      message.success(`User ${form.email.trim()} created`)
      onSuccess()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to create user.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <ModalShell
      title="Add user"
      subtitle="New users start with the Viewer preset. Adjust their module access from Permission matrix after the account is created."
      onClose={loading ? () => {} : onClose}
    >
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && <p className="rounded-lg border border-danger/20 bg-danger/6 px-3 py-2 text-caption text-danger">{error}</p>}

        <div>
          <label className="mb-1 block text-caption font-emphasis text-text-secondary">Full name</label>
          <input
            type="text"
            required
            value={form.full_name}
            onChange={(event) => setForm((prev) => ({ ...prev, full_name: event.target.value }))}
            className="w-full rounded-md border border-[rgb(var(--border-strong))] bg-surface-0 px-3 py-2 text-caption text-text-primary focus:outline-none focus:border-brand focus:shadow-focus-brand transition-colors"
          />
        </div>

        <div>
          <label className="mb-1 block text-caption font-emphasis text-text-secondary">Email</label>
          <input
            type="email"
            required
            value={form.email}
            onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
            className="w-full rounded-md border border-[rgb(var(--border-strong))] bg-surface-0 px-3 py-2 text-caption text-text-primary focus:outline-none focus:border-brand focus:shadow-focus-brand transition-colors"
          />
        </div>

        {availableProviders.length > 0 && (
          <div>
            <label className="mb-1 block text-caption font-emphasis text-text-secondary">Login method</label>
            <div className="relative">
              <select
                value={form.auth_provider}
                onChange={(event) => setForm((prev) => ({ ...prev, auth_provider: event.target.value, password: '' }))}
                className="w-full appearance-none rounded-md border border-[rgb(var(--border-strong))] bg-surface-0 px-3 py-2 pr-8 text-caption text-text-primary focus:outline-none focus:border-brand focus:shadow-focus-brand transition-colors"
              >
                {availableProviders.map((provider) => (
                  <option key={provider.value} value={provider.value}>{provider.label}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-text-quaternary" />
            </div>
          </div>
        )}

        {form.auth_provider === 'password' ? (
          <div>
            <label className="mb-1 block text-caption font-emphasis text-text-secondary">Password</label>
            <input
              type="password"
              required
              minLength={8}
              value={form.password}
              onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
              className="w-full rounded-md border border-[rgb(var(--border-strong))] bg-surface-0 px-3 py-2 text-caption text-text-primary focus:outline-none focus:border-brand focus:shadow-focus-brand transition-colors"
              placeholder="Minimum 8 characters"
            />
            <p className="mt-1 text-tiny text-text-quaternary">Use at least 8 characters for the initial password.</p>
          </div>
        ) : (
          <div className="rounded-lg border border-info/20 bg-info/6 px-3 py-2 text-caption text-info">
            The user will sign in with Google using this email. No password is required.
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-md border border-[rgb(var(--border-strong))] bg-surface-1 px-3.5 py-1.5 text-caption text-text-secondary transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="rounded-md bg-brand px-3.5 py-1.5 text-caption font-emphasis text-text-inverse transition-colors hover:bg-brand-hover disabled:opacity-60"
          >
            {loading ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
    </ModalShell>
  )
}


function EditUserModal({ user, onClose, onSuccess }) {
  const [status, setStatus] = useState(user.status)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')
    setLoading(true)
    try {
      await api.put(`/api/users/${user.id}`, { status })
      message.success('User updated')
      onSuccess()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to update user.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <ModalShell
      title="Edit user"
      subtitle={user.email}
      onClose={loading ? () => {} : onClose}
    >
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && <p className="rounded-lg border border-danger/20 bg-danger/6 px-3 py-2 text-caption text-danger">{error}</p>}

        <div>
          <label className="mb-1 block text-caption font-emphasis text-text-secondary">Status</label>
          <div className="relative">
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="w-full appearance-none rounded-md border border-[rgb(var(--border-strong))] bg-surface-0 px-3 py-2 pr-8 text-caption text-text-primary focus:outline-none focus:border-brand focus:shadow-focus-brand transition-colors"
            >
              <option value="active">Active</option>
              <option value="deactivated">Deactivated</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-text-quaternary" />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-md border border-[rgb(var(--border-strong))] bg-surface-1 px-3.5 py-1.5 text-caption text-text-secondary transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="rounded-md bg-brand px-3.5 py-1.5 text-caption font-emphasis text-text-inverse transition-colors hover:bg-brand-hover disabled:opacity-60"
          >
            {loading ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </ModalShell>
  )
}


function MatrixView({
  currentUser,
  matrix,
  presets,
  loading,
  pendingChanges,
  selectedUser,
  savingAll,
  applyingPreset,
  onSelectUser,
  onChangeLevel,
  onApplyPreset,
  onResetAll,
  onSaveAll,
}) {
  const modules = matrix?.modules || []
  const users = matrix?.users || []
  const moduleLevels = matrix?.module_levels || {}
  const hasPending = Object.keys(pendingChanges).length > 0

  const getEffective = (user, module) => pendingChanges[user.user_id]?.[module] ?? user.permissions?.[module] ?? 'none'

  if (loading) {
    return <SpinCenter text="Loading permission matrix…" />
  }

  return (
    <>
      <div className="mb-5 rounded-xl border border-warning/20 bg-warning/6 px-4 py-3 text-caption text-warning">
        {BACKUP_APPS_PERMISSION_MESSAGE} The matrix keeps Apps at View or higher automatically whenever Backup is set to Edit or Full.
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-2.5">
        <span className="mr-1 text-caption text-text-tertiary">Apply preset:</span>
        {PRESET_ORDER.filter((preset) => presets[preset]).map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => { void onApplyPreset(preset) }}
            disabled={Boolean(applyingPreset)}
            className={`rounded-full border px-3.5 py-1 text-caption font-emphasis transition-all hover:shadow-linear-sm disabled:opacity-50 ${PRESET_COLORS[preset]}`}
          >
            {PRESET_LABELS[preset]}
          </button>
        ))}
        {!selectedUser && (
          <span className="text-tiny italic text-text-quaternary">Select a user first, then click preset</span>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-[rgb(var(--border-line))] bg-surface-1">
        <table className="min-w-full divide-y divide-[rgb(var(--border-line))]">
          <thead>
            <tr className="bg-surface-2">
              <th className="sticky left-0 min-w-[220px] bg-surface-2 px-5 py-3 text-left text-tiny font-emphasis uppercase tracking-[0.14em] text-text-quaternary">User</th>
              {modules.map((module) => (
                <th key={module} className="min-w-[120px] px-3 py-3 text-center text-tiny font-emphasis uppercase tracking-[0.14em] text-text-quaternary">
                  {MODULE_LABELS[module] || module}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[rgb(var(--border-line))]">
            {users.map((user) => {
              const isSelected = selectedUser === user.user_id
              const rowPending = Boolean(pendingChanges[user.user_id])
              const isOwner = user.permissions?.settings === 'full'
              return (
                <tr
                  key={user.user_id}
                  onClick={() => onSelectUser(isSelected ? null : user.user_id)}
                  className={`cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-brand/6 ring-1 ring-inset ring-brand/20'
                      : rowPending
                        ? 'bg-warning/6'
                        : 'hover:bg-surface-2'
                  }`}
                >
                  <td className="sticky left-0 bg-inherit px-4 py-3">
                    <div className="flex items-center space-x-3">
                      <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-tiny font-strong text-white ${
                        isSelected ? 'bg-brand' : 'bg-brand'
                      }`}>
                        {(user.full_name || user.email).slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="truncate font-emphasis text-text-primary">{user.full_name}</p>
                          {isOwner && (
                            <span className="rounded bg-surface-3 px-1.5 py-0.5 text-[10px] font-emphasis text-text-tertiary">Owner</span>
                          )}
                        </div>
                        <p className="truncate text-tiny text-text-quaternary">{user.email}</p>
                      </div>
                    </div>
                  </td>
                  {modules.map((module) => {
                    const value = getEffective(user, module)
                    const changed = pendingChanges[user.user_id]?.[module] !== undefined
                    const allowed = moduleLevels[module] || ['none', 'view', 'edit', 'full']
                    const style = LEVEL_STYLES[value] || LEVEL_STYLES.none
                    const disableSelfAdminDowngrade = currentUser?.id === user.user_id && module === 'settings'
                    return (
                      <td key={module} className="px-3 py-3 text-center">
                        <select
                          value={value}
                          onClick={(event) => event.stopPropagation()}
                          onChange={(event) => onChangeLevel(user.user_id, module, event.target.value)}
                          disabled={disableSelfAdminDowngrade}
                          className={`min-w-[90px] cursor-pointer appearance-none rounded-md px-2.5 py-1 text-center text-tiny font-strong ring-1 ring-inset transition-all hover:shadow-linear-sm disabled:cursor-not-allowed disabled:opacity-50 ${
                            changed
                              ? 'bg-warning/10 text-warning ring-warning/30 shadow-linear-sm'
                              : `${style.bg} ${style.text} ${style.ring}`
                          }`}
                        >
                          {allowed.map((level) => (
                            <option key={level} value={level}>{LEVEL_LABELS[level] || level}</option>
                          ))}
                        </select>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-4 text-tiny text-text-tertiary">
        {Object.entries(LEVEL_LABELS).map(([value, label]) => {
          const style = LEVEL_STYLES[value] || LEVEL_STYLES.none
          return (
            <div key={value} className="flex items-center gap-1.5">
              <span className={`inline-flex items-center rounded-md px-2 py-0.5 font-emphasis ring-1 ring-inset ${style.bg} ${style.text} ${style.ring}`}>
                {label}
              </span>
              <span>
                {value === 'none'
                  ? '— module hidden from navigation'
                  : value === 'view'
                    ? '— read-only access for the module'
                    : value === 'edit'
                      ? '— create, edit, and delete inside the module'
                      : '— full admin or workspace-level control'}
              </span>
            </div>
          )
        })}
      </div>

      <div className="mt-6 flex items-center justify-center gap-4">
        <button
          type="button"
          onClick={onResetAll}
          disabled={!hasPending}
          className="rounded-md border border-[rgb(var(--border-strong))] bg-surface-1 px-5 py-2 text-caption font-emphasis text-text-secondary transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Reset to defaults
        </button>
        <button
          type="button"
          onClick={() => { void onSaveAll() }}
          disabled={!hasPending || savingAll}
          className="rounded-md bg-brand px-5 py-2 text-caption font-emphasis text-text-inverse transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-40"
        >
          {savingAll ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </>
  )
}


function UsersView({ currentUser, users, loading, deactivatingUserId, onOpenInvite, onEdit, onDeactivate }) {
  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-caption text-text-tertiary">{users.length} users</p>
        <button
          type="button"
          onClick={onOpenInvite}
          className="flex items-center rounded-md bg-brand px-3.5 py-1.5 text-caption font-emphasis text-text-inverse hover:bg-brand-hover"
        >
          <Plus className="mr-2 h-4 w-4" />
          Add user
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-[rgb(var(--border-line))] bg-surface-1">
        {loading ? (
          <div className="p-12 text-center text-text-quaternary">
            <SpinCenter text="Loading users…" />
          </div>
        ) : (
          <table className="min-w-full divide-y divide-[rgb(var(--border-line))]">
            <thead>
              <tr className="bg-surface-2">
                <th className="px-5 py-3 text-left text-tiny font-emphasis uppercase tracking-[0.14em] text-text-quaternary">Name</th>
                <th className="px-5 py-3 text-left text-tiny font-emphasis uppercase tracking-[0.14em] text-text-quaternary">Email</th>
                <th className="px-5 py-3 text-left text-tiny font-emphasis uppercase tracking-[0.14em] text-text-quaternary">Login method</th>
                <th className="px-5 py-3 text-left text-tiny font-emphasis uppercase tracking-[0.14em] text-text-quaternary">Status</th>
                <th className="px-5 py-3 text-left text-tiny font-emphasis uppercase tracking-[0.14em] text-text-quaternary">Last login</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[rgb(var(--border-line))]">
              {users.map((user) => {
                const isSelf = currentUser?.id === user.id
                return (
                  <tr key={user.id} className="transition-colors hover:bg-surface-2">
                    <td className="px-5 py-3 font-emphasis text-text-primary">{user.full_name}</td>
                    <td className="px-5 py-3 text-text-secondary">{user.email}</td>
                    <td className="px-5 py-3 text-text-secondary">
                      <span className="inline-flex items-center rounded-full bg-surface-3 px-2.5 py-0.5 text-tiny font-emphasis text-text-secondary">
                        {getAuthMethodLabel(user.auth_provider)}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-tiny font-emphasis capitalize ${STATUS_COLORS[user.status] || 'bg-surface-3 text-text-secondary'}`}>
                        {user.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-text-tertiary">{formatDate(user.last_login_at)}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end space-x-2">
                        <button
                          type="button"
                          onClick={() => onEdit(user)}
                          disabled={isSelf}
                          className="rounded p-1.5 text-text-quaternary hover:bg-brand/10 hover:text-brand disabled:cursor-not-allowed disabled:opacity-40"
                          title="Edit"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        {user.status === 'active' && (
                          <button
                            type="button"
                            onClick={() => { void onDeactivate(user.id) }}
                            disabled={Boolean(deactivatingUserId) || isSelf}
                            className="rounded p-1.5 text-text-quaternary hover:bg-danger/10 hover:text-danger disabled:cursor-not-allowed disabled:opacity-40"
                            title="Deactivate"
                          >
                            <UserX className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}


function PresetsView({ presets, loading }) {
  if (loading) {
    return <SpinCenter text="Loading presets…" />
  }

  return (
    <div className="space-y-6">
      <p className="text-caption text-text-tertiary">
        Presets are pre-defined permission sets that can be applied quickly from the Permission matrix tab.
      </p>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {Object.entries(presets || {}).map(([name, permissions]) => (
          <div key={name} className="rounded-xl border border-[rgb(var(--border-line))] bg-surface-1 p-5">
            <div className="mb-3 flex items-center gap-2">
              <span className={`rounded-full border px-3 py-1 text-caption font-strong capitalize ${PRESET_COLORS[name] || 'border-[rgb(var(--border-strong))] bg-surface-2 text-text-secondary'}`}>
                {PRESET_LABELS[name] || name}
              </span>
            </div>

            <div className="flex flex-wrap gap-2">
              {Object.entries(permissions).map(([module, level]) => {
                const style = LEVEL_STYLES[level] || LEVEL_STYLES.none
                return (
                  <div key={module} className="flex items-center gap-1 text-xs">
                    <span className="text-text-tertiary">{MODULE_LABELS[module] || module}:</span>
                    <span className={`rounded px-1.5 py-0.5 font-emphasis ${style.bg} ${style.text}`}>
                      {LEVEL_LABELS[level] || level}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}


const PermissionSettingsPanel = ({ view = 'matrix' }) => {
  const currentUser = useAuthStore((state) => state.user)
  const [matrix, setMatrix] = useState(null)
  const [presets, setPresets] = useState({})
  const [pendingChanges, setPendingChanges] = useState({})
  const [selectedUser, setSelectedUser] = useState(null)
  const [loadingPermissionData, setLoadingPermissionData] = useState(false)
  const [savingAll, setSavingAll] = useState(false)
  const [applyingPreset, setApplyingPreset] = useState('')
  const [users, setUsers] = useState([])
  const [loadingUsers, setLoadingUsers] = useState(false)
  const [deactivatingUserId, setDeactivatingUserId] = useState('')
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [editingUser, setEditingUser] = useState(null)

  const loadPermissionData = useCallback(async () => {
    setLoadingPermissionData(true)
    try {
      const [matrixRes, presetsRes] = await Promise.all([
        api.get('/api/permissions/matrix'),
        api.get('/api/permissions/presets'),
      ])
      setMatrix(matrixRes.data)
      setPresets(presetsRes.data.presets || {})
      setPendingChanges({})
    } catch (err) {
      message.error(err.response?.data?.detail || 'Failed to load workspace permissions')
    } finally {
      setLoadingPermissionData(false)
    }
  }, [])

  const loadUsers = useCallback(async () => {
    setLoadingUsers(true)
    try {
      const res = await api.get('/api/users/')
      setUsers(Array.isArray(res.data) ? res.data : [])
    } catch (err) {
      message.error(err.response?.data?.detail || 'Failed to load users')
      setUsers([])
    } finally {
      setLoadingUsers(false)
    }
  }, [])

  useEffect(() => {
    if (view === 'users') {
      void loadUsers()
      return
    }

    if (view === 'matrix' || view === 'presets') {
      void loadPermissionData()
    }
  }, [view, loadPermissionData, loadUsers])

  const getBasePermissionsForUser = useCallback((userId) => {
    const user = matrix?.users?.find((item) => item.user_id === userId)
    return {
      ...DEFAULT_MATRIX_PERMISSIONS,
      ...(user?.permissions || {}),
    }
  }, [matrix])

  const handleLevelChange = (userId, module, level) => {
    const basePermissions = getBasePermissionsForUser(userId)
    const resolvedPermissions = resolvePermissionDependencies({
      ...basePermissions,
      ...(pendingChanges[userId] || {}),
      [module]: level,
    })

    const nextPendingForUser = Object.fromEntries(
      Object.entries(resolvedPermissions).filter(([permissionModule, permissionLevel]) => permissionLevel !== basePermissions[permissionModule])
    )

    setPendingChanges((prev) => {
      const next = { ...prev }
      if (Object.keys(nextPendingForUser).length === 0) {
        delete next[userId]
      } else {
        next[userId] = nextPendingForUser
      }
      return next
    })
  }

  const handleSaveAll = async () => {
    if (!Object.keys(pendingChanges).length) return

    setSavingAll(true)
    try {
      await Promise.all(
        Object.entries(pendingChanges).map(([userId, permissions]) => api.put(`/api/permissions/${userId}`, { permissions }))
      )
      message.success('Permissions saved')
      await loadPermissionData()
    } catch (err) {
      message.error(err.response?.data?.detail || 'Save failed')
    } finally {
      setSavingAll(false)
    }
  }

  const handleApplyPreset = async (preset) => {
    if (!selectedUser) {
      message.info('Select a user first, then click preset')
      return
    }

    setApplyingPreset(selectedUser)
    try {
      await api.put(`/api/permissions/${selectedUser}/preset`, { preset })
      message.success(`Applied "${preset}" preset`)
      await loadPermissionData()
    } catch (err) {
      message.error(err.response?.data?.detail || 'Preset failed')
    } finally {
      setApplyingPreset('')
    }
  }

  const handleDeactivate = async (userId) => {
    setDeactivatingUserId(userId)
    try {
      await api.delete(`/api/users/${userId}`)
      message.success('User deactivated')
      await loadUsers()
    } catch (err) {
      message.error(err.response?.data?.detail || 'Failed to deactivate user')
    } finally {
      setDeactivatingUserId('')
    }
  }

  if (view === 'users') {
    return (
      <>
        <UsersView
          currentUser={currentUser}
          users={users}
          loading={loadingUsers}
          deactivatingUserId={deactivatingUserId}
          onOpenInvite={() => setShowInviteModal(true)}
          onEdit={(user) => setEditingUser(user)}
          onDeactivate={handleDeactivate}
        />

        {showInviteModal && (
          <InviteUserModal
            onClose={() => setShowInviteModal(false)}
            onSuccess={() => {
              setShowInviteModal(false)
              void loadUsers()
            }}
          />
        )}

        {editingUser && (
          <EditUserModal
            user={editingUser}
            onClose={() => setEditingUser(null)}
            onSuccess={() => {
              setEditingUser(null)
              void loadUsers()
            }}
          />
        )}
      </>
    )
  }

  if (view === 'presets') {
    return <PresetsView presets={presets} loading={loadingPermissionData} />
  }

  return (
    <MatrixView
      currentUser={currentUser}
      matrix={matrix}
      presets={presets}
      loading={loadingPermissionData}
      pendingChanges={pendingChanges}
      selectedUser={selectedUser}
      savingAll={savingAll}
      applyingPreset={applyingPreset}
      onSelectUser={setSelectedUser}
      onChangeLevel={handleLevelChange}
      onApplyPreset={handleApplyPreset}
      onResetAll={() => {
        setPendingChanges({})
        message.info('Changes discarded')
      }}
      onSaveAll={handleSaveAll}
    />
  )
}


export default PermissionSettingsPanel
