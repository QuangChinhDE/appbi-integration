import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import DashboardPage from '@modules/admin/frontend/pages/DashboardPage'
import BackupFlowPage from '@modules/backup/frontend/pages/BackupFlowPage'
import CredentialsPage from '@modules/credentials/frontend/pages/CredentialsPage'
import LoginPage from '@modules/identity/frontend/pages/LoginPage'
import ProtectedRoute from '@app/guards/ProtectedRoute'

function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/dashboard" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
        <Route path="/backup" element={<ProtectedRoute><BackupFlowPage /></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute><CredentialsPage /></ProtectedRoute>} />
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default AppRouter