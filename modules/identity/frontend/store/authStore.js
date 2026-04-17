import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const useAuthStore = create(
  persist(
    (set) => ({
      user: null,
      token: null,
      permissions: {},
      isAuthenticated: false,
      hasHydrated: false,
      login: ({ user, token, permissions }) => {
        set({ user, token, permissions: permissions || {}, isAuthenticated: true, hasHydrated: true })
      },
      setSession: ({ user, token, permissions }) => {
        set((state) => ({
          user,
          token: token || state.token,
          permissions: permissions || {},
          isAuthenticated: Boolean(token || state.token),
          hasHydrated: true,
        }))
      },
      markHydrated: () => {
        set({ hasHydrated: true })
      },
      logout: () => {
        set({ user: null, token: null, permissions: {}, isAuthenticated: false, hasHydrated: true })
      },
    }),
    { name: 'auth-storage' }
  )
)