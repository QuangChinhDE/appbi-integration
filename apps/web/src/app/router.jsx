import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import BackupFlowPage from '@modules/backup/frontend/pages/BackupFlowPage'
import CredentialsPage from '@modules/credentials/frontend/pages/CredentialsPage'
import DestinationProfilesPage from '@modules/destinations/frontend/pages/DestinationProfilesPage'
import LoginPage from '@modules/identity/frontend/pages/LoginPage'
import SourceConnectionsPage from '@modules/sources/frontend/pages/SourceConnectionsPage'
import ProtectedRoute from '@app/guards/ProtectedRoute'
import AppLayout from '@packages/ui/src/components/layout/AppLayout'

function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/backup"
          element={
            <ProtectedRoute>
              <BackupFlowPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/sources"
          element={
            <ProtectedRoute>
              <SourceConnectionsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/destinations"
          element={
            <ProtectedRoute>
              <DestinationProfilesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <ProtectedRoute>
              <CredentialsPage />
            </ProtectedRoute>
          }
        />
        {/* Automation placeholder — will be built next */}
        <Route
          path="/automation"
          element={
            <ProtectedRoute>
              <AppLayout>
                <div className="p-8">
                  <div className="flex min-h-[60vh] items-center justify-center rounded-3xl border border-dashed border-gray-200 bg-white">
                    <div className="text-center">
                      <p className="text-sm font-medium text-gray-500">Automation module coming soon</p>
                    </div>
                  </div>
                </div>
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route path="/" element={<Navigate to="/backup" replace />} />
        <Route path="*" element={<Navigate to="/backup" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default AppRouter
