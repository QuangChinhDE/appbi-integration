import React, { useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { Navigate, useLocation } from 'react-router-dom'
import api from '@shared/api/client'
import { getFirstAccessibleRoute, hasPermission, isModuleEnabled } from '@modules/identity/frontend/lib/permissions'
import { useAuthStore } from '@modules/identity/frontend/store/authStore'

/**
 * Session gate. Auth lives in an httpOnly cookie so we can't inspect it from
 * JS — we validate by calling /api/auth/me once, cache the payload in the
 * zustand store for fast sync reads by other components, and redirect to
 * /login if the cookie is missing/expired.
 */
const ProtectedRoute = ({ children, module, minLevel = 'view' }) => {
  const location = useLocation()
  const hasHydrated = useAuthStore((state) => state.hasHydrated)
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const permissions = useAuthStore((state) => state.permissions)
  const modules = useAuthStore((state) => state.modules)
  const setSession = useAuthStore((state) => state.setSession)
  const clearSession = useAuthStore((state) => state.clearSession)

  useEffect(() => {
    if (hasHydrated) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await api.get('/api/auth/me')
        if (cancelled) return
        setSession({
          user: res.data.user,
          permissions: res.data.permissions,
          modules: res.data.modules,
        })
      } catch {
        if (cancelled) return
        clearSession()
      }
    })()
    return () => {
      cancelled = true
    }
  }, [hasHydrated, setSession, clearSession])

  if (!hasHydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-0 px-6">
        <div className="flex items-center gap-2 rounded-lg border border-[rgb(var(--border-line))] bg-surface-1 px-4 py-3 text-caption text-text-tertiary shadow-linear-sm">
          <Loader2 className="h-4 w-4 animate-spin text-brand" />
          <span>Loading workspace…</span>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  const moduleEnabled = !module || isModuleEnabled(modules, module)

  if (module && (!moduleEnabled || !hasPermission(permissions, module, minLevel))) {
    const fallbackRoute = getFirstAccessibleRoute(permissions, modules)
    if (fallbackRoute && fallbackRoute !== location.pathname) {
      return <Navigate to={fallbackRoute} replace />
    }
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-0 px-6">
        <div className="max-w-md rounded-xl border border-[rgb(var(--border-line))] bg-surface-1 px-6 py-8 text-center shadow-linear-sm">
          <h1 className="text-small font-strong text-text-primary">Access denied</h1>
          <p className="mt-2 text-caption leading-6 text-text-tertiary">
            {moduleEnabled
              ? 'This account has no permission for this module.'
              : 'This module is disabled for the current workspace.'}
          </p>
        </div>
      </div>
    )
  }

  return children
}

export default ProtectedRoute
