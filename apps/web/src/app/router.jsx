import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import BackupFlowPage from '@modules/backup/frontend/pages/BackupFlowPage'
import CredentialsPage from '@modules/credentials/frontend/pages/CredentialsPage'
import LoginPage from '@modules/identity/frontend/pages/LoginPage'
import ProtectedRoute from '@app/guards/ProtectedRoute'

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
              <div className="flex items-center justify-center h-full min-h-[60vh]">
                <div className="text-center">
                  <p className="text-gray-400 text-sm">Automation module coming soon</p>
                </div>
              </div>
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
