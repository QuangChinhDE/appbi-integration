import React, { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Bell,
  ChevronLeft,
  ChevronRight,
  CloudUpload,
  Database,
  LogOut,
  Settings,
  Workflow,
  Zap,
} from 'lucide-react'
import api from '@shared/api/client'
import { hasPermission } from '@modules/identity/frontend/lib/permissions'
import { getNavigableModules } from '@modules/identity/frontend/lib/moduleRegistry'
import { useAuthStore } from '@modules/identity/frontend/store/authStore'
import { useNotifications } from '@modules/identity/frontend/lib/notifications'
import NotificationsModal from '../common/NotificationsModal'
import { cn } from '../../lib/utils'

const ICON_MAP = {
  CloudUpload,
  Database,
  Workflow,
  Zap,
  Settings,
}

function getInitials(name) {
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

const Sidebar = ({ collapsed, onToggle }) => {
  const navigate = useNavigate()
  const location = useLocation()
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const menuRef = useRef(null)

  const user = useAuthStore((state) => state.user)
  const permissions = useAuthStore((state) => state.permissions)
  const modules = useAuthStore((state) => state.modules)
  const clearSession = useAuthStore((state) => state.clearSession)
  const {
    notifications,
    unreadCount,
    markAllNotificationsRead,
    clearNotifications,
  } = useNotifications()

  const displayName = user?.full_name || user?.email || ''
  const email = user?.email || ''
  const initials = (displayName || email) ? getInitials(displayName || email) : 'U'
  const visibleItems = getNavigableModules(modules)
    .filter((item) => hasPermission(permissions, item.key, 'view'))
    .map((item) => ({
      ...item,
      Icon: ICON_MAP[item.icon] || Workflow,
    }))

  // Auto-mark as read when the modal opens with unread items.
  useEffect(() => {
    if (notificationsOpen && unreadCount > 0) {
      markAllNotificationsRead()
    }
  }, [notificationsOpen, unreadCount, markAllNotificationsRead])

  useEffect(() => {
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setUserMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleLogout = async () => {
    setUserMenuOpen(false)
    try {
      await api.post('/api/auth/logout')
    } catch {
      // Cookie may already be invalid — proceed to client-side cleanup.
    }
    clearSession()
    window.location.replace('/login')
  }

  const openNotifications = () => {
    setNotificationsOpen(true)
    setUserMenuOpen(false)
  }

  return (
    <>
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex flex-col bg-surface-1 border-r border-[rgb(var(--border-line))] transition-all duration-300',
          collapsed ? 'w-14' : 'w-60',
        )}
      >
        {/* Logo */}
        <div
          className={cn(
            'flex h-14 items-center border-b border-[rgb(var(--border-line))] px-3 shrink-0',
            collapsed ? 'justify-center' : 'gap-3',
          )}
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-text-inverse shrink-0">
            <Workflow className="h-4 w-4" />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <div className="text-caption font-strong text-text-primary">
                AppBI Integration
              </div>
              <div className="text-tiny text-text-quaternary">Workspace</div>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-3">
          <ul className="space-y-0.5 px-2">
            {visibleItems.map(({ route, Icon, label }) => {
              const isActive =
                location.pathname === route || location.pathname.startsWith(route + '/')
              return (
                <li key={route}>
                  <button
                    onClick={() => navigate(route)}
                    title={collapsed ? label : undefined}
                    className={cn(
                      'flex w-full items-center h-8 rounded-md transition-colors duration-150',
                      collapsed ? 'justify-center px-0' : 'gap-2.5 px-2.5',
                      isActive
                        ? 'bg-surface-2 text-text-primary'
                        : 'text-text-tertiary hover:bg-surface-2 hover:text-text-primary',
                    )}
                  >
                    <Icon
                      className={cn(
                        'shrink-0 h-4 w-4',
                        isActive ? 'text-brand' : '',
                      )}
                    />
                    {!collapsed && (
                      <span className="text-caption font-emphasis">{label}</span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        </nav>

        {/* User section */}
        <div className="relative shrink-0 border-t border-[rgb(var(--border-line))]" ref={menuRef}>
          {userMenuOpen && (
            <div
              className={cn(
                'absolute bottom-full z-50 mb-2 overflow-hidden rounded-xl border border-[rgb(var(--border-strong))] bg-surface-1 shadow-linear-lg',
                collapsed ? 'left-full ml-2 w-60' : 'left-2 right-2',
              )}
            >
              <div className="border-b border-[rgb(var(--border-line))] px-4 py-3">
                <p className="text-caption font-strong text-text-primary truncate">
                  {displayName || email || 'User'}
                </p>
                {email && displayName && (
                  <p className="text-tiny text-text-tertiary truncate mt-0.5">{email}</p>
                )}
              </div>
              <button
                onClick={openNotifications}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-caption text-text-secondary hover:bg-surface-2 transition-colors"
              >
                <div className="relative">
                  <Bell className="h-4 w-4 text-text-tertiary" />
                  {unreadCount > 0 && (
                    <span className="absolute -right-1 -top-1 flex h-3 min-w-[0.75rem] items-center justify-center rounded-full bg-danger px-0.5 text-[9px] font-strong text-text-inverse">
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                </div>
                <span>Notifications</span>
              </button>
              <button
                onClick={handleLogout}
                className="flex w-full items-center gap-2 border-t border-[rgb(var(--border-line))] px-4 py-2.5 text-caption text-danger hover:bg-danger/10 transition-colors"
              >
                <LogOut className="h-4 w-4" />
                <span>Sign out</span>
              </button>
            </div>
          )}

          <button
            onClick={() => setUserMenuOpen((v) => !v)}
            title={collapsed ? (email || 'User') : undefined}
            className={cn(
              'w-full px-3 py-2.5 transition-colors hover:bg-surface-2',
              collapsed ? 'flex justify-center' : 'flex items-center gap-2.5',
            )}
          >
            <div className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand text-tiny font-emphasis text-text-inverse">
              {initials}
              {unreadCount > 0 && collapsed && (
                <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-[0.875rem] items-center justify-center rounded-full bg-danger px-1 text-[9px] font-strong text-text-inverse">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </div>
            {!collapsed && (
              <div className="min-w-0 flex-1 text-left">
                <p className="text-caption font-emphasis text-text-primary truncate">
                  {displayName || email || 'User'}
                </p>
                <p className="text-tiny text-text-quaternary truncate">
                  {email || 'Workspace account'}
                </p>
              </div>
            )}
            {!collapsed && unreadCount > 0 && (
              <span className="ml-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-strong text-text-inverse">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>
        </div>

        {/* Collapse toggle */}
        <div className="shrink-0 border-t border-[rgb(var(--border-line))] p-2">
          <button
            onClick={onToggle}
            className={cn(
              'flex w-full items-center justify-center rounded-md h-8 text-text-tertiary transition-colors hover:bg-surface-2 hover:text-text-primary',
              !collapsed && 'gap-2',
            )}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <>
                <ChevronLeft className="h-4 w-4" />
                <span className="text-caption font-emphasis">Collapse</span>
              </>
            )}
          </button>
        </div>
      </aside>

      <NotificationsModal
        open={notificationsOpen}
        onClose={() => setNotificationsOpen(false)}
        notifications={notifications}
        unreadCount={unreadCount}
        onMarkAllRead={markAllNotificationsRead}
        onClearAll={clearNotifications}
      />
    </>
  )
}

export default Sidebar
