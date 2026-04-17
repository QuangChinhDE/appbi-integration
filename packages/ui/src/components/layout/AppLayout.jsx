import React, { useState } from 'react'
import Sidebar from './Sidebar'

const AppLayout = ({ children }) => {
  const [collapsed, setCollapsed] = useState(true)

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} />
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
