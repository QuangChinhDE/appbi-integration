import React from 'react'
import {
  Bell,
  CheckCheck,
  CheckCircle,
  AlertCircle,
  AlertTriangle,
  Info as InfoIcon,
  Trash2,
  X,
} from 'lucide-react'
import { Button, IconButton } from './ui'
import { cn } from '../../lib/utils'

/**
 * NotificationsModal — mirrors the appbi-ai pattern.
 * Shows the notification log with mark-all-read and clear-all actions.
 */

const LEVEL_APPEARANCE = {
  success: {
    icon: CheckCircle,
    iconClassName: 'text-success',
    badgeClassName: 'bg-success/10 text-success border-success/20',
  },
  error: {
    icon: AlertCircle,
    iconClassName: 'text-danger',
    badgeClassName: 'bg-danger/10 text-danger border-danger/20',
  },
  warning: {
    icon: AlertTriangle,
    iconClassName: 'text-warning',
    badgeClassName: 'bg-warning/10 text-warning border-warning/20',
  },
  info: {
    icon: InfoIcon,
    iconClassName: 'text-info',
    badgeClassName: 'bg-info/10 text-info border-info/20',
  },
}

function formatRelativeTime(iso) {
  const createdAt = new Date(iso)
  if (Number.isNaN(createdAt.getTime())) return ''
  const diffMs = Date.now() - createdAt.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 45) return 'just now'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 7) return `${diffDay}d ago`
  return createdAt.toLocaleDateString()
}

const NotificationsModal = ({
  open,
  onClose,
  notifications = [],
  unreadCount = 0,
  onMarkAllRead,
  onClearAll,
}) => {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-overlay/84 backdrop-blur-[3px] px-4 animate-fade-in">
      <div className="flex max-h-[80vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-[rgb(var(--border-strong))] bg-surface-1 shadow-linear-lg animate-slide-up">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-[rgb(var(--border-line))] px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="relative rounded-lg bg-brand/10 p-2 text-brand">
              <Bell className="h-4 w-4" />
              {unreadCount > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-strong text-text-inverse">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </div>
            <div>
              <h2 className="text-small font-strong text-text-primary">Notifications</h2>
              <p className="text-caption text-text-tertiary">In-app events appear here.</p>
            </div>
          </div>
          <IconButton aria-label="Close notifications" variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </IconButton>
        </div>

        {/* Toolbar */}
        <div className="flex items-center justify-between gap-3 border-b border-[rgb(var(--border-line))] bg-surface-2 px-5 py-2.5">
          <p className="text-caption text-text-secondary">
            {notifications.length} total{unreadCount > 0 ? `, ${unreadCount} unread` : ''}
          </p>
          <div className="flex items-center gap-2">
            <Button
              size="xs"
              variant="secondary"
              onClick={onMarkAllRead}
              disabled={unreadCount === 0}
              leadingIcon={<CheckCheck className="h-3 w-3" />}
            >
              Mark all read
            </Button>
            <Button
              size="xs"
              variant="ghost"
              onClick={onClearAll}
              disabled={notifications.length === 0}
              leadingIcon={<Trash2 className="h-3 w-3" />}
              className="text-danger hover:text-danger hover:bg-danger/10"
            >
              Clear all
            </Button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto bg-surface-0 px-4 py-4">
          {notifications.length === 0 ? (
            <div className="flex h-full min-h-48 flex-col items-center justify-center rounded-lg border border-dashed border-[rgb(var(--border-strong))] bg-surface-1 px-6 text-center">
              <Bell className="mb-3 h-8 w-8 text-text-quaternary" />
              <p className="text-small font-strong text-text-primary">No notifications yet</p>
              <p className="mt-1 max-w-sm text-caption text-text-tertiary">
                Save, update, delete, and share events will appear here.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {notifications.map((notification) => {
                const appearance = LEVEL_APPEARANCE[notification.level] || LEVEL_APPEARANCE.info
                const Icon = appearance.icon
                return (
                  <div
                    key={notification.id}
                    className={cn(
                      'rounded-lg border bg-surface-1 p-3 transition-colors',
                      notification.read
                        ? 'border-[rgb(var(--border-line))]'
                        : 'border-brand/30 shadow-linear-sm',
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={cn(
                          'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border',
                          appearance.badgeClassName,
                        )}
                      >
                        <Icon className={cn('h-3.5 w-3.5', appearance.iconClassName)} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-caption font-emphasis text-text-primary">
                            {notification.title}
                          </p>
                          {!notification.read && (
                            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" aria-hidden />
                          )}
                        </div>
                        {notification.description && (
                          <p className="mt-0.5 text-tiny text-text-tertiary">{notification.description}</p>
                        )}
                        <p className="mt-1 text-tiny text-text-quaternary">
                          {formatRelativeTime(notification.createdAt)}
                        </p>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default NotificationsModal
