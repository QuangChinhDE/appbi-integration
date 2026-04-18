import React, { useState } from 'react'
import { Workflow, Mail, Lock, Eye, EyeOff } from 'lucide-react'
import api from '@shared/api/client'
import { getFirstAccessibleRoute } from '@modules/identity/frontend/lib/permissions'
import { Button, Input, Alert } from '@packages/ui/src/components/common/ui'

/**
 * Cookie-based login flow (aligned with appbi-ai):
 * 1. POST /api/auth/login → backend sets httpOnly `access_token` cookie.
 * 2. `window.location.replace(...)` does a full reload so every subsequent
 *    request picks up the fresh cookie, and ProtectedRoute re-hydrates
 *    session via /api/auth/me. No client-side token management.
 */
const LoginPage = () => {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const passwordLoginEnabled = String(import.meta.env.VITE_AUTH_PASSWORD_ENABLED ?? 'true').toLowerCase() !== 'false'

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!passwordLoginEnabled) {
      setError('Password login is currently disabled for this workspace.')
      return
    }
    if (!email || !password) {
      setError('Please enter your email and password.')
      return
    }
    setError('')
    setLoading(true)
    try {
      const res = await api.post('/api/auth/login', { email, password })
      const dest = getFirstAccessibleRoute(res.data?.permissions) || '/'
      window.location.replace(dest)
    } catch (err) {
      setError(err.response?.data?.detail || 'Login failed. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-0 px-4">
      <div className="w-full max-w-sm">
        <div className="rounded-xl border border-[rgb(var(--border-line))] bg-surface-1 shadow-linear-lg overflow-hidden">
          <div className="px-8 pt-8 pb-5 text-center border-b border-[rgb(var(--border-line))]">
            <div className="flex items-center justify-center mb-4">
              <div className="w-10 h-10 rounded-lg bg-brand flex items-center justify-center">
                <Workflow className="w-5 h-5 text-text-inverse" />
              </div>
            </div>
            <h1 className="text-h2 text-text-primary">IntegrationHub</h1>
            <p className="mt-1 text-caption text-text-tertiary">Sign in to your account</p>
          </div>

          <form onSubmit={handleSubmit} className="px-8 py-6 space-y-4">
            {error && <Alert type="error" message={error} />}

            {!passwordLoginEnabled && (
              <Alert type="warning" message="Password sign-in is disabled for this workspace." />
            )}

            <div className="space-y-1.5">
              <label className="block text-caption font-emphasis text-text-secondary">Email</label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                disabled={!passwordLoginEnabled || loading}
                leadingIcon={<Mail />}
                autoComplete="email"
                required
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-caption font-emphasis text-text-secondary">Password</label>
              <div className="relative">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  disabled={!passwordLoginEnabled || loading}
                  leadingIcon={<Lock />}
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  disabled={!passwordLoginEnabled || loading}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-quaternary hover:text-text-secondary transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              variant="primary"
              size="md"
              fullWidth
              disabled={!passwordLoginEnabled}
              loading={loading}
            >
              Sign in
            </Button>
          </form>
        </div>

        <p className="mt-5 text-center text-tiny text-text-quaternary">
          AppBI Data Platform · IntegrationHub
        </p>
      </div>
    </div>
  )
}

export default LoginPage
