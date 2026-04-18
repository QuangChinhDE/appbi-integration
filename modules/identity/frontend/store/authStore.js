import { create } from 'zustand'

/**
 * Session cache — NOT the source of truth.
 *
 * Authentication is managed by an httpOnly `access_token` cookie set by the
 * backend on /api/auth/login. The browser attaches it to every request
 * automatically (axios `withCredentials: true`).
 *
 * This store only caches the user + permissions payload returned by
 * /api/auth/me so components can read them synchronously. There is no token
 * here on purpose — we never read/write it from JS (no XSS surface, no
 * rehydration races).
 */
export const useAuthStore = create((set) => ({
  user: null,
  permissions: {},
  isAuthenticated: false,
  hasHydrated: false,
  setSession: ({ user, permissions }) =>
    set({
      user: user || null,
      permissions: permissions || {},
      isAuthenticated: Boolean(user),
      hasHydrated: true,
    }),
  clearSession: () =>
    set({ user: null, permissions: {}, isAuthenticated: false, hasHydrated: true }),
  markHydrated: () => set({ hasHydrated: true }),
}))
