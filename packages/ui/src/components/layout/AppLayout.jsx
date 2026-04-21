import React, { useState } from 'react'
import Sidebar from './Sidebar'

const AppLayout = ({ children }) => {
  const [collapsed, setCollapsed] = useState(true)

  return (
    <div className="flex h-screen overflow-hidden bg-surface-0 print:block">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} />
      <main
        className={`flex-1 overflow-y-auto [scrollbar-gutter:stable] bg-surface-0 transition-[margin] duration-300 print:ml-0 print:overflow-visible print:bg-white ${
          collapsed ? 'ml-14' : 'ml-60'
        }`}
      >
        {children}
      </main>
    </div>
  )
}

export default AppLayout
