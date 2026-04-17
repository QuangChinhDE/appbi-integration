import React, { useEffect } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import api from '@shared/api/client'
import { getFirstAccessibleRoute, hasPermission } from '@modules/identity/frontend/lib/permissions'
import { useAuthStore } from '@modules/identity/frontend/store/authStore'

const ProtectedRoute = ({ children, module, minLevel = 'view' }) => {
  const location = useLocation()
  const token = useAuthStore((state) => state.token)
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const permissions = useAuthStore((state) => state.permissions)
  const hasHydrated = useAuthStore((state) => state.hasHydrated)
  const setSession = useAuthStore((state) => state.setSession)
  const markHydrated = useAuthStore((state) => state.markHydrated)
  const logout = useAuthStore((state) => state.logout)

  useEffect(() => {
    let cancelled = false

    const hydrateSession = async () => {
      if (!token) {
        if (!hasHydrated) markHydrated()
        return
      }
      if (hasHydrated) return

      try {
        const res = await api.get('/api/auth/me')
        if (cancelled) return
        setSession({ token, user: res.data.user, permissions: res.data.permissions })
      } catch {
        if (cancelled) return
        logout()
      }
    }

    void hydrateSession()

    return () => {
      cancelled = true
    }
  }, [token, hasHydrated, setSession, markHydrated, logout])

  if (token && !hasHydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-6">
        <div className="rounded-xl border border-gray-200 bg-white px-6 py-5 text-sm text-gray-500 shadow-sm">
          Loading workspace access…
        </div>
      </div>
    )
  }

  if (!isAuthenticated || !token) {
    return <Navigate to="/login" replace />
  }

  if (module && !hasPermission(permissions, module, minLevel)) {
    const fallbackRoute = getFirstAccessibleRoute(permissions)
    if (fallbackRoute && fallbackRoute !== location.pathname) {
      return <Navigate to={fallbackRoute} replace />
    }

    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-6">
        <div className="max-w-lg rounded-2xl border border-gray-200 bg-white px-6 py-8 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-gray-900">Access denied</h1>
          <p className="mt-2 text-sm leading-6 text-gray-500">
            Your account does not currently have permission to open this module.
          </p>
        </div>
      </div>
    )
  }

  return children
}

export default ProtectedRoute