import React, { useState } from 'react'
import Sidebar from './Sidebar'

const AppLayout = ({ children }) => {
  const [collapsed, setCollapsed] = useState(true)

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} />
      <main
        className={`flex-1 overflow-y-auto bg-surface-0 transition-[margin] duration-300 ${
          collapsed ? 'ml-14' : 'ml-60'
        }`}
      >
        {children}
      </main>
    </div>
  )
}

export default AppLayout
