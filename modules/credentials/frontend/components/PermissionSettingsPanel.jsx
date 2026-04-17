import React, { useCallback, useEffect, useState } from 'react'
import { ChevronDown, Edit2, Plus, UserX } from 'lucide-react'

import api from '@shared/api/client'
import { message, SpinCenter } from '@packages/ui/src/components/common/ui'
import { useAuthStore } from '@modules/identity/frontend/store/authStore'


const MODULE_LABELS = {
  backup: 'Backup',
  apps: 'Apps',
  automation: 'Automation',
  settings: 'Settings',
}

const LEVEL_STYLES = {
  none: { bg: 'bg-red-50', text: 'text-red-700', ring: 'ring-red-200' },
  view: { bg: 'bg-blue-50', text: 'text-blue-700', ring: 'ring-blue-200' },
  edit: { bg: 'bg-green-50', text: 'text-green-700', ring: 'ring-green-200' },
  full: { bg: 'bg-purple-50', text: 'text-purple-700', ring: 'ring-purple-200' },
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
  admin: 'bg-purple-100 text-purple-800 border-purple-300',
  editor: 'bg-blue-100 text-blue-800 border-blue-300',
  viewer: 'bg-green-100 text-green-800 border-green-300',
  minimal: 'bg-orange-100 text-orange-800 border-orange-300',
}

const STATUS_COLORS = {
  active: 'bg-green-100 text-green-700',
  deactivated: 'bg-red-100 text-red-700',
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl" onClick={(event) => event.stopPropagation()}>
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-gray-500">{subtitle}</p>}
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
        {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Full name</label>
          <input
            type="text"
            required
            value={form.full_name}
            onChange={(event) => setForm((prev) => ({ ...prev, full_name: event.target.value }))}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Email</label>
          <input
            type="email"
            required
            value={form.email}
            onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {availableProviders.length > 0 && (
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Login method</label>
            <div className="relative">
              <select
                value={form.auth_provider}
                onChange={(event) => setForm((prev) => ({ ...prev, auth_provider: event.target.value, password: '' }))}
                className="w-full appearance-none rounded-lg border border-gray-300 bg-white px-3 py-2 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {availableProviders.map((provider) => (
                  <option key={provider.value} value={provider.value}>{provider.label}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            </div>
          </div>
        )}

        {form.auth_provider === 'password' ? (
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Password</label>
            <input
              type="password"
              required
              minLength={8}
              value={form.password}
              onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Minimum 8 characters"
            />
            <p className="mt-1 text-xs text-gray-500">Use at least 8 characters for the initial password.</p>
          </div>
        ) : (
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
            The user will sign in with Google using this email. No password is required.
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
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
        {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Status</label>
          <div className="relative">
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="w-full appearance-none rounded-lg border border-gray-300 bg-white px-3 py-2 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="active">Active</option>
              <option value="deactivated">Deactivated</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
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
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <span className="mr-1 text-sm text-gray-500">Apply preset:</span>
        {PRESET_ORDER.filter((preset) => presets[preset]).map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => { void onApplyPreset(preset) }}
            disabled={Boolean(applyingPreset)}
            className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-all hover:shadow-sm disabled:opacity-50 ${PRESET_COLORS[preset]}`}
          >
            {PRESET_LABELS[preset]}
          </button>
        ))}
        {!selectedUser && (
          <span className="text-xs italic text-gray-400">Select a user first, then click preset</span>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50/80">
              <th className="sticky left-0 min-w-[220px] bg-gray-50/80 px-5 py-3.5 text-left font-medium text-gray-600">User</th>
              {modules.map((module) => (
                <th key={module} className="min-w-[120px] px-3 py-3.5 text-center font-medium text-gray-600">
                  {MODULE_LABELS[module] || module}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
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
                      ? 'bg-blue-50/60 ring-1 ring-inset ring-blue-200'
                      : rowPending
                        ? 'bg-yellow-50/60'
                        : 'hover:bg-gray-50'
                  }`}
                >
                  <td className="sticky left-0 bg-inherit px-5 py-3.5">
                    <div className="flex items-center space-x-3">
                      <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${
                        isSelected ? 'bg-blue-600' : 'bg-gradient-to-br from-blue-500 to-purple-500'
                      }`}>
                        {(user.full_name || user.email).slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="truncate font-medium text-gray-900">{user.full_name}</p>
                          {isOwner && (
                            <span className="rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">Owner</span>
                          )}
                        </div>
                        <p className="truncate text-xs text-gray-400">{user.email}</p>
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
                      <td key={module} className="px-3 py-3.5 text-center">
                        <select
                          value={value}
                          onClick={(event) => event.stopPropagation()}
                          onChange={(event) => onChangeLevel(user.user_id, module, event.target.value)}
                          disabled={disableSelfAdminDowngrade}
                          className={`min-w-[90px] cursor-pointer appearance-none rounded-lg px-3 py-1.5 text-center text-xs font-semibold ring-1 ring-inset transition-all hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-50 ${
                            changed
                              ? 'bg-yellow-50 text-yellow-800 ring-yellow-400 shadow-sm'
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

      <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-gray-500">
        {Object.entries(LEVEL_LABELS).map(([value, label]) => {
          const style = LEVEL_STYLES[value] || LEVEL_STYLES.none
          return (
            <div key={value} className="flex items-center gap-1.5">
              <span className={`inline-flex items-center rounded-md px-2 py-0.5 font-medium ring-1 ring-inset ${style.bg} ${style.text} ${style.ring}`}>
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
          className="rounded-lg border border-gray-300 bg-white px-6 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Reset to defaults
        </button>
        <button
          type="button"
          onClick={() => { void onSaveAll() }}
          disabled={!hasPending || savingAll}
          className="rounded-lg bg-gray-900 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
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
        <p className="text-sm text-gray-500">{users.length} users</p>
        <button
          type="button"
          onClick={onOpenInvite}
          className="flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          <Plus className="mr-2 h-4 w-4" />
          Add user
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        {loading ? (
          <div className="p-12 text-center text-gray-400">
            <SpinCenter text="Loading users…" />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/80">
                <th className="px-6 py-3 text-left font-medium text-gray-600">Name</th>
                <th className="px-6 py-3 text-left font-medium text-gray-600">Email</th>
                <th className="px-6 py-3 text-left font-medium text-gray-600">Login method</th>
                <th className="px-6 py-3 text-left font-medium text-gray-600">Status</th>
                <th className="px-6 py-3 text-left font-medium text-gray-600">Last login</th>
                <th className="px-6 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.map((user) => {
                const isSelf = currentUser?.id === user.id
                return (
                  <tr key={user.id} className="transition-colors hover:bg-gray-50">
                    <td className="px-6 py-3 font-medium text-gray-900">{user.full_name}</td>
                    <td className="px-6 py-3 text-gray-600">{user.email}</td>
                    <td className="px-6 py-3 text-gray-600">
                      <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                        {getAuthMethodLabel(user.auth_provider)}
                      </span>
                    </td>
                    <td className="px-6 py-3">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${STATUS_COLORS[user.status] || 'bg-gray-100 text-gray-700'}`}>
                        {user.status}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-gray-500">{formatDate(user.last_login_at)}</td>
                    <td className="px-6 py-3">
                      <div className="flex items-center justify-end space-x-2">
                        <button
                          type="button"
                          onClick={() => onEdit(user)}
                          disabled={isSelf}
                          className="rounded p-1.5 text-gray-400 hover:bg-blue-50 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-40"
                          title="Edit"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        {user.status === 'active' && (
                          <button
                            type="button"
                            onClick={() => { void onDeactivate(user.id) }}
                            disabled={Boolean(deactivatingUserId) || isSelf}
                            className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
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
      <p className="text-sm text-gray-500">
        Presets are pre-defined permission sets that can be applied quickly from the Permission matrix tab.
      </p>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {Object.entries(presets || {}).map(([name, permissions]) => (
          <div key={name} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <span className={`rounded-full border px-3 py-1 text-sm font-semibold capitalize ${PRESET_COLORS[name] || 'border-gray-300 bg-gray-100 text-gray-700'}`}>
                {PRESET_LABELS[name] || name}
              </span>
            </div>

            <div className="flex flex-wrap gap-2">
              {Object.entries(permissions).map(([module, level]) => {
                const style = LEVEL_STYLES[level] || LEVEL_STYLES.none
                return (
                  <div key={module} className="flex items-center gap-1 text-xs">
                    <span className="text-gray-500">{MODULE_LABELS[module] || module}:</span>
                    <span className={`rounded px-1.5 py-0.5 font-medium ${style.bg} ${style.text}`}>
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

  const handleLevelChange = (userId, module, level) => {
    setPendingChanges((prev) => ({
      ...prev,
      [userId]: {
        ...(prev[userId] || {}),
        [module]: level,
      },
    }))
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
