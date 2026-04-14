import React, { useState } from 'react'
import Sidebar from './Sidebar'

/**
 * AppLayout - shared shell for all authenticated pages.
 *
 * Usage:
 *   <AppLayout>
 *     {children}
 *   </AppLayout>
 *
 * Page titles and descriptions live inside the page's content area.
 */
const AppLayout = ({ children }) => {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} />

      {/* Main content — shifts right based on sidebar width */}
      <main
        className={`flex-1 overflow-y-auto bg-gray-50 transition-[margin] duration-300 ${
          collapsed ? 'ml-16' : 'ml-64'
        }`}
      >
        {children}
      </main>
    </div>
  )
}

export default AppLayout
