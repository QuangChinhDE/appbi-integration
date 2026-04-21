import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Workflow, Mail, Lock, Eye, EyeOff } from 'lucide-react'
import api from '@shared/api/client'
import { getFirstAccessibleRoute } from '@modules/identity/frontend/lib/permissions'
import { Button, Input, Alert } from '@packages/ui/src/components/common/ui'

/**
 * Cookie-based login flow (aligned with appbi-ai):
 * 1. POST /api/auth/login → backend sets httpOnly `access_token` cookie.
 * 2. POST /api/auth/google does the same when Google Identity Services returns
 *    an ID token.
 * 2. `window.location.replace(...)` does a full reload so every subsequent
 *    request picks up the fresh cookie, and ProtectedRoute re-hydrates
 *    session via /api/auth/me. No client-side token management.
 */
const LoginPage = () => {
  const googleButtonRef = useRef(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [googleReady, setGoogleReady] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)

  const passwordLoginEnabled = String(import.meta.env.VITE_AUTH_PASSWORD_ENABLED ?? 'true').toLowerCase() !== 'false'
  const googleLoginEnabled = String(import.meta.env.VITE_AUTH_GOOGLE_ENABLED ?? 'false').toLowerCase() === 'true'
  const googleClientId = String(import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '').trim()
  const canUseGoogle = googleLoginEnabled && Boolean(googleClientId)

  const handleGoogleSignIn = useCallback(async (credential) => {
    if (!credential) {
      setError('Google sign-in failed. Please try again.')
      return
    }

    setError('')
    setGoogleLoading(true)
    try {
      const res = await api.post('/api/auth/google', { credential })
      const dest = getFirstAccessibleRoute(res.data?.permissions, res.data?.modules) || '/'
      window.location.replace(dest)
    } catch (err) {
      setError(err.response?.data?.detail || 'Google sign-in failed. Please try again.')
      setGoogleLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!googleLoginEnabled) return undefined
    if (window.google?.accounts?.id) {
      setGoogleReady(true)
      return undefined
    }

    const selector = 'script[data-google-identity="true"]'
    const existingScript = document.querySelector(selector)
    const handleLoad = () => setGoogleReady(true)
    const handleError = () => setError('Cannot load Google sign-in right now.')

    if (existingScript) {
      existingScript.addEventListener('load', handleLoad)
      existingScript.addEventListener('error', handleError)
      return () => {
        existingScript.removeEventListener('load', handleLoad)
        existingScript.removeEventListener('error', handleError)
      }
    }

    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.dataset.googleIdentity = 'true'
    script.addEventListener('load', handleLoad)
    script.addEventListener('error', handleError)
    document.head.appendChild(script)

    return () => {
      script.removeEventListener('load', handleLoad)
      script.removeEventListener('error', handleError)
    }
  }, [googleLoginEnabled])

  useEffect(() => {
    if (!canUseGoogle || !googleReady || !googleButtonRef.current || !window.google?.accounts?.id) {
      return
    }

    googleButtonRef.current.innerHTML = ''
    window.google.accounts.id.initialize({
      client_id: googleClientId,
      callback: ({ credential }) => {
        void handleGoogleSignIn(credential)
      },
    })
    window.google.accounts.id.renderButton(googleButtonRef.current, {
      theme: 'outline',
      size: 'large',
      shape: 'pill',
      text: 'continue_with',
      width: 320,
      logo_alignment: 'left',
    })
  }, [canUseGoogle, googleClientId, googleReady, handleGoogleSignIn])

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
      const dest = getFirstAccessibleRoute(res.data?.permissions, res.data?.modules) || '/'
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
            <p className="mt-1 text-caption text-text-tertiary">
              {canUseGoogle ? 'Sign in with your Google account' : 'Sign in to your account'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="px-8 py-6 space-y-4">
            {error && <Alert type="error" message={error} />}

            {!canUseGoogle && !passwordLoginEnabled && (
              <Alert
                type="warning"
                message="Authentication is not configured yet. Enable Google sign-in or password login in the environment settings."
              />
            )}

            {canUseGoogle && (
              <>
                <div className="rounded-md border border-[rgb(var(--border-line))] bg-surface-0 px-3 py-2 text-caption text-text-secondary">
                  Continue with the Google account that matches your IntegrationHub user email.
                </div>
                <div className="flex justify-center">
                  <div ref={googleButtonRef} className="min-h-11" />
                </div>
                {googleLoading && (
                  <p className="text-center text-caption text-text-tertiary">Signing you in with Google...</p>
                )}
              </>
            )}

            {googleLoginEnabled && !googleClientId && (
              <Alert type="warning" message="Google sign-in is enabled, but VITE_GOOGLE_CLIENT_ID is missing." />
            )}

            {!passwordLoginEnabled && !canUseGoogle && (
              <Alert type="warning" message="Password sign-in is disabled for this workspace." />
            )}

            {canUseGoogle && passwordLoginEnabled && (
              <div className="flex items-center gap-3 text-[10px] font-emphasis uppercase tracking-[0.18em] text-text-quaternary">
                <div className="h-px flex-1 bg-[rgb(var(--border-line))]" />
                <span>or</span>
                <div className="h-px flex-1 bg-[rgb(var(--border-line))]" />
              </div>
            )}

            {passwordLoginEnabled && (
              <>
                <div className="space-y-1.5">
                  <label className="block text-caption font-emphasis text-text-secondary">Email</label>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    disabled={loading || googleLoading}
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
                      disabled={loading || googleLoading}
                      leadingIcon={<Lock />}
                      autoComplete="current-password"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      disabled={loading || googleLoading}
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
                  disabled={loading || googleLoading}
                  loading={loading}
                >
                  Sign in
                </Button>
              </>
            )}
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
