import React, { useState, useRef, useEffect } from 'react'
import { LogOut, ChevronDown } from 'lucide-react'
import api from '@shared/api/client'
import { useAuthStore } from '@modules/identity/frontend/store/authStore'

const Topbar = ({ collapsed, pageTitle, pageDescription }) => {
  const user = useAuthStore((state) => state.user)
  const clearSession = useAuthStore((state) => state.clearSession)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef(null)

  const handleLogout = async () => {
    try {
      await api.post('/api/auth/logout')
    } catch {
      // Cookie may already be invalid — fall through to client-side cleanup.
    }
    clearSession()
    window.location.replace('/login')
  }

  useEffect(() => {
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const initials = user?.email
    ? user.email.slice(0, 2).toUpperCase()
    : 'U'

  return (
    <header className="sticky top-0 z-20 h-14 flex items-center justify-between px-5 bg-surface-1 border-b border-[rgb(var(--border-line))]">
      <div>
        {pageTitle && (
          <h1 className="text-small font-strong text-text-primary">{pageTitle}</h1>
        )}
        {pageDescription && (
          <p className="text-tiny text-text-tertiary">{pageDescription}</p>
        )}
      </div>

      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setDropdownOpen((v) => !v)}
          className="flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-surface-2 transition-colors"
        >
          <div className="w-7 h-7 rounded-full bg-brand flex items-center justify-center text-text-inverse text-tiny font-emphasis">
            {initials}
          </div>
          <span className="text-caption text-text-secondary max-w-[160px] truncate hidden sm:block font-emphasis">
            {user?.email}
          </span>
          <ChevronDown className="w-3.5 h-3.5 text-text-quaternary" />
        </button>

        {dropdownOpen && (
          <div className="absolute right-0 mt-1 w-48 bg-surface-1 rounded-xl border border-[rgb(var(--border-strong))] shadow-linear-lg py-1 z-50">
            <div className="px-3 py-2 border-b border-[rgb(var(--border-line))]">
              <p className="text-caption font-emphasis text-text-primary truncate">{user?.email}</p>
            </div>
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-2 px-3 py-2 text-caption text-danger hover:bg-danger/6 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  )
}

export default Topbar
