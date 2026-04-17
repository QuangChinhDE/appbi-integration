import React from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import AppConnectionsPage from '@modules/apps/frontend/pages/AppConnectionsPage'
import AppsPage from '@modules/apps/frontend/pages/AppsPage'
import StorageAppsPage from '@modules/apps/frontend/pages/StorageAppsPage'
import BackupFlowPage from '@modules/backup/frontend/pages/BackupFlowPage'
import AutomationPage from '@modules/automation/frontend/pages/AutomationPage'
import { getFirstAccessibleRoute } from '@modules/identity/frontend/lib/permissions'
import LoginPage from '@modules/identity/frontend/pages/LoginPage'
import { useAuthStore } from '@modules/identity/frontend/store/authStore'
import PermissionSettingsPanel from '@modules/credentials/frontend/components/PermissionSettingsPanel'
import AppLayout from '@packages/ui/src/components/layout/AppLayout'
import ProtectedRoute from '@app/guards/ProtectedRoute'

const SETTINGS_TABS = [
  { key: 'matrix', label: 'Permission matrix' },
  { key: 'users', label: 'Users' },
  { key: 'presets', label: 'Presets' },
]

function HomeRedirect() {
  const permissions = useAuthStore((state) => state.permissions)
  const nextPath = getFirstAccessibleRoute(permissions)

  if (nextPath) {
    return <Navigate to={nextPath} replace />
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-6">
      <div className="max-w-lg rounded-2xl border border-gray-200 bg-white px-6 py-8 text-center shadow-sm">
        <h1 className="text-lg font-semibold text-gray-900">No modules assigned</h1>
        <p className="mt-2 text-sm leading-6 text-gray-500">
          Ask an administrator to grant at least one module permission for this account.
        </p>
      </div>
    </div>
  )
}

function LegacyRedirect({ to }) {
  const location = useLocation()
  return <Navigate to={`${to}${location.search || ''}`} replace />
}

function SettingsPage() {
  const [activeTab, setActiveTab] = React.useState('matrix')

  return (
    <AppLayout>
      <div className="w-full max-w-[1400px] px-8 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Permissions</h1>
          <p className="mt-1 text-sm text-gray-500">
            Set per-module access level for each user.
          </p>
        </div>

        <div className="mb-6 border-b border-gray-200">
          <nav className="flex flex-wrap gap-6">
            {SETTINGS_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`border-b-2 pb-3 text-sm font-medium transition-colors ${
                  activeTab === tab.key
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        <PermissionSettingsPanel view={activeTab} />
      </div>
    </AppLayout>
  )
}

function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/backup"
          element={
            <ProtectedRoute module="backup">
              <BackupFlowPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/apps"
          element={
            <ProtectedRoute module="apps">
              <AppsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/apps/connections"
          element={
            <ProtectedRoute module="apps">
              <AppConnectionsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/apps/storage"
          element={
            <ProtectedRoute module="apps">
              <StorageAppsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/apps/sources"
          element={
            <ProtectedRoute module="apps">
              <LegacyRedirect to="/apps/connections" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/apps/destinations"
          element={
            <ProtectedRoute module="apps">
              <LegacyRedirect to="/apps/storage" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/sources"
          element={
            <ProtectedRoute module="apps">
              <LegacyRedirect to="/apps/connections" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/destinations"
          element={
            <ProtectedRoute module="apps">
              <LegacyRedirect to="/apps/storage" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <ProtectedRoute module="settings">
              <SettingsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/automation"
          element={
            <ProtectedRoute module="automation">
              <AutomationPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <HomeRedirect />
            </ProtectedRoute>
          }
        />
        <Route
          path="*"
          element={
            <ProtectedRoute>
              <HomeRedirect />
            </ProtectedRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  )
}

export default AppRouter
