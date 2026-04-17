import React, { useState, useRef, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  CloudUpload,
  Database,
  Zap,
  Settings,
  ChevronLeft,
  ChevronRight,
  Workflow,
  LogOut,
} from 'lucide-react'
import { hasPermission } from '@modules/identity/frontend/lib/permissions'
import { useAuthStore } from '@modules/identity/frontend/store/authStore'

const NAV_ITEMS = [
  { key: '/backup', icon: CloudUpload, label: 'Backup', module: 'backup' },
  { key: '/apps', icon: Database, label: 'Apps', module: 'apps' },
  { key: '/automation', icon: Zap, label: 'Automation', module: 'automation' },
  { key: '/settings', icon: Settings, label: 'Settings', module: 'settings' },
]

const Sidebar = ({ collapsed, onToggle }) => {
  const navigate = useNavigate()
  const location = useLocation()
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const menuRef = useRef(null)

  const { user, permissions, logout } = useAuthStore()
  const displayName = user?.full_name || user?.email || ''
  const email = user?.email || ''
  const initials = (displayName || email) ? (displayName || email).slice(0, 2).toUpperCase() : 'U'
  const visibleItems = NAV_ITEMS.filter((item) => hasPermission(permissions, item.module, 'view'))

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setUserMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-40 flex flex-col border-r border-gray-200 bg-white transition-all duration-300 ${
        collapsed ? 'w-16' : 'w-64'
      }`}
    >
      <div
        className={`flex h-16 items-center border-b border-gray-200 px-4 shrink-0 ${
          collapsed ? 'justify-center' : 'gap-3'
        }`}
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-cyan-500 shrink-0">
          <Workflow className="h-4 w-4 text-white" />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <div className="bg-gradient-to-r from-blue-700 to-cyan-500 bg-clip-text text-sm font-semibold text-transparent">
              AppBI Integration
            </div>
            <div className="text-xs text-gray-400">Operational workspace</div>
          </div>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto py-4">
        <ul className="space-y-1 px-2">
          {visibleItems.map(({ key, icon: Icon, label }) => {
            const isActive =
              location.pathname === key || location.pathname.startsWith(key + '/')
            return (
              <li key={key}>
                <button
                  onClick={() => navigate(key)}
                  title={collapsed ? label : undefined}
                  className={`flex w-full items-center rounded-lg px-3 py-2.5 text-sm transition-all ${
                    isActive
                      ? 'bg-blue-50 font-medium text-blue-700'
                      : 'text-gray-700 hover:bg-gray-50 hover:text-gray-900'
                  } ${collapsed ? 'justify-center' : 'gap-3'}`}
                >
                  <Icon
                    className={`shrink-0 ${collapsed ? 'h-5 w-5' : 'h-4 w-4'} ${
                      isActive ? 'text-blue-600' : 'text-gray-400'
                    }`}
                  />
                  {!collapsed && <span>{label}</span>}
                </button>
              </li>
            )
          })}
        </ul>
      </nav>

      {/* User section — bottom, above collapse */}
      <div className="shrink-0 border-t border-gray-200" ref={menuRef}>
        {userMenuOpen && (
          <div
            className={`absolute bottom-full z-50 mb-2 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg ${
              collapsed ? 'left-full ml-2 w-56' : 'left-2 right-2'
            }`}
          >
            <div className="border-b border-gray-100 px-4 py-3">
              <p className="text-xs font-semibold text-gray-900 truncate">{displayName || email || 'User'}</p>
              <p className="text-xs text-gray-400 mt-0.5">Signed in</p>
            </div>
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Sign out
            </button>
          </div>
        )}

        <button
          onClick={() => setUserMenuOpen((v) => !v)}
          title={collapsed ? (email || 'User') : undefined}
          className={`w-full px-4 py-3 transition-colors hover:bg-gray-50 ${
            collapsed ? 'flex justify-center' : 'flex items-center gap-3'
          }`}
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-cyan-500 text-xs font-bold text-white">
            {initials}
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1 text-left">
              <p className="text-sm font-medium text-gray-700 truncate">{displayName || email || 'User'}</p>
              <p className="text-xs text-gray-400 truncate">{email || 'Workspace account'}</p>
            </div>
          )}
        </button>
      </div>

      <div className="shrink-0 border-t border-gray-200 p-4">
        <button
          onClick={onToggle}
          className={`flex w-full items-center justify-center rounded-lg px-3 py-2 text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900 ${
            collapsed ? '' : 'gap-2'
          }`}
        >
          {collapsed ? (
            <ChevronRight className="h-5 w-5" />
          ) : (
            <>
              <ChevronLeft className="h-5 w-5" />
              <span className="text-sm">Collapse</span>
            </>
          )}
        </button>
      </div>
    </aside>
  )
}

export default Sidebar
