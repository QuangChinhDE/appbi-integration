import React, { useState, useRef, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  CloudUpload,
  Database,
  Folder,
  Zap,
  Settings,
  ChevronLeft,
  ChevronRight,
  Workflow,
  LogOut,
  User,
} from 'lucide-react'
import { useAuthStore } from '@modules/identity/frontend/store/authStore'

const NAV_ITEMS = [
  { key: '/backup',     icon: CloudUpload, label: 'Backup' },
  { key: '/sources',    icon: Database,    label: 'Sources' },
  { key: '/destinations', icon: Folder,    label: 'Destinations' },
  { key: '/automation', icon: Zap,         label: 'Automation' },
  { key: '/settings',   icon: Settings,    label: 'Settings' },
]

const Sidebar = ({ collapsed, onToggle }) => {
  const navigate = useNavigate()
  const location = useLocation()
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const menuRef = useRef(null)

  const { user, logout } = useAuthStore()
  const email = user?.email || ''
  const initials = email ? email.slice(0, 2).toUpperCase() : 'U'

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
      className={`fixed left-0 top-0 bottom-0 z-30 flex flex-col border-r border-gray-200 bg-gradient-to-b from-white to-slate-50 transition-all duration-300 ${
        collapsed ? 'w-16' : 'w-64'
      }`}
    >
      {/* Logo / Brand */}
      <div
        className={`flex items-center h-16 border-b border-gray-200 px-4 shrink-0 ${
          collapsed ? 'justify-center' : 'gap-3'
        }`}
      >
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-blue-600 to-cyan-500 shrink-0 shadow-sm shadow-blue-200">
          <Workflow className="w-4 h-4 text-white" />
        </div>
        {!collapsed && (
          <span className="text-sm font-semibold bg-gradient-to-r from-blue-700 to-cyan-500 bg-clip-text text-transparent whitespace-nowrap">
            IntegrationHub
          </span>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4 px-2">
        <ul className="space-y-1">
          {NAV_ITEMS.map(({ key, icon: Icon, label }) => {
            const isActive =
              location.pathname === key || location.pathname.startsWith(key + '/')
            return (
              <li key={key}>
                <button
                  onClick={() => navigate(key)}
                  title={collapsed ? label : undefined}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-blue-50 text-blue-700 shadow-sm'
                      : 'text-gray-600 hover:bg-white hover:text-gray-900'
                  } ${collapsed ? 'justify-center' : ''}`}
                >
                  <Icon
                    className={`shrink-0 ${collapsed ? 'w-5 h-5' : 'w-4 h-4'} ${
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
        {/* User dropdown (opens upward) */}
        {userMenuOpen && (
          <div
            className={`absolute bottom-full z-50 mb-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden ${
              collapsed ? 'left-0 w-48' : 'left-2 right-2'
            }`}
          >
            <div className="px-4 py-3 border-b border-gray-100">
              <p className="text-xs font-semibold text-gray-900 truncate">{email || 'User'}</p>
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
          className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors ${
            collapsed ? 'justify-center' : ''
          }`}
        >
          <div className="h-8 w-8 rounded-full bg-gradient-to-br from-blue-600 to-cyan-500 flex items-center justify-center text-xs font-bold text-white shrink-0 shadow-sm shadow-blue-200">
            {initials}
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0 text-left">
              <p className="text-sm font-medium text-gray-700 truncate">{email || 'User'}</p>
              <p className="text-xs text-gray-400">Account</p>
            </div>
          )}
        </button>
      </div>

      {/* Collapse toggle */}
      <div className="shrink-0 border-t border-gray-200 p-2">
        <button
          onClick={onToggle}
          className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors ${
            collapsed ? 'justify-center' : ''
          }`}
        >
          {collapsed ? (
            <ChevronRight className="w-4 h-4" />
          ) : (
            <>
              <ChevronLeft className="w-4 h-4" />
              <span>Collapse</span>
            </>
          )}
        </button>
      </div>
    </aside>
  )
}

export default Sidebar
