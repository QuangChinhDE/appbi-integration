import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import AppsPage from '@modules/apps/frontend/pages/AppsPage'
import BackupFlowPage from '@modules/backup/frontend/pages/BackupFlowPage'
import AutomationPage from '@modules/automation/frontend/pages/AutomationPage'
import AutomationDetailPage from '@modules/automation/frontend/pages/AutomationDetailPage'
import PipelinePage from '@modules/pipeline/frontend/pages/PipelinePage'
import PipelineDetailPage from '@modules/pipeline/frontend/pages/PipelineDetailPage'
import { getFirstAccessibleRoute } from '@modules/identity/frontend/lib/permissions'
import { getNavigableModules } from '@modules/identity/frontend/lib/moduleRegistry'
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

const MODULE_PAGE_COMPONENTS = {
  apps: AppsPage,
  automation: AutomationPage,
  backup: BackupFlowPage,
  pipeline: PipelinePage,
  settings: SettingsPage,
}

function HomeRedirect() {
  const permissions = useAuthStore((state) => state.permissions)
  const modules = useAuthStore((state) => state.modules)
  const nextPath = getFirstAccessibleRoute(permissions, modules)

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
  const modules = useAuthStore((state) => state.modules)
  const hasHydrated = useAuthStore((state) => state.hasHydrated)
  const dynamicRoutes = hasHydrated ? getNavigableModules(modules) : getNavigableModules()

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/automation/:connectorKey"
          element={
            <ProtectedRoute module="automation">
              <AutomationDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/pipeline/:kind/:capabilityKey"
          element={
            <ProtectedRoute module="pipeline">
              <PipelineDetailPage />
            </ProtectedRoute>
          }
        />

        {dynamicRoutes.map((module) => {
          const PageComponent = MODULE_PAGE_COMPONENTS[module.key]
          if (!PageComponent) return null
          return (
            <Route
              key={module.key}
              path={module.route}
              element={
                <ProtectedRoute module={module.key}>
                  <PageComponent />
                </ProtectedRoute>
              }
            />
          )
        })}
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
