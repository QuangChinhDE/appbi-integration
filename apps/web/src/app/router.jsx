import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import AppsPage from '@modules/apps/frontend/pages/AppsPage'
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
    <div className="flex min-h-screen items-center justify-center bg-surface-0 px-6">
      <div className="max-w-lg rounded-xl border border-[rgb(var(--border-line))] bg-surface-1 px-6 py-8 text-center shadow-linear">
        <h1 className="text-lg font-strong text-text-primary">No modules assigned</h1>
        <p className="mt-2 text-caption leading-6 text-text-tertiary">
          Ask an administrator to grant at least one module permission for this account.
        </p>
      </div>
    </div>
  )
}

function SettingsPage() {
  const [activeTab, setActiveTab] = React.useState('matrix')

  return (
    <AppLayout>
      <div className="w-full max-w-[1400px] px-8 py-6">
        <div className="mb-6">
          <h1 className="text-h1 font-strong text-text-primary">Permissions</h1>
          <p className="mt-1 text-caption text-text-tertiary">
            Set per-module access level for each user.
          </p>
        </div>

        <div className="mb-6 border-b border-[rgb(var(--border-line))]">
          <nav className="flex flex-wrap gap-6">
            {SETTINGS_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`border-b-2 pb-3 text-caption font-emphasis transition-colors ${
                  activeTab === tab.key
                    ? 'border-brand text-brand'
                    : 'border-transparent text-text-tertiary hover:text-text-secondary'
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
