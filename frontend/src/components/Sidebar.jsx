import React from 'react'
import { Layout, Menu } from 'antd'
import { useNavigate, useLocation } from 'react-router-dom'
import { DashboardOutlined, CloudUploadOutlined, SettingOutlined, FileTextOutlined } from '@ant-design/icons'

const { Sider } = Layout

const Sidebar = ({ collapsed }) => {
  const navigate = useNavigate()
  const location = useLocation()
  const menuItems = [
    { key: '/dashboard', icon: <DashboardOutlined />, label: 'Dashboard' },
    { key: '/backup', icon: <CloudUploadOutlined />, label: 'Backup' },
    { key: '/logs', icon: <FileTextOutlined />, label: 'Logs' },
    { key: '/settings', icon: <SettingOutlined />, label: 'Settings' },
  ]

  return (
    <Sider collapsed={collapsed} width={240} style={{ overflow: 'auto', height: '100vh', position: 'fixed', left: 0, top: 0, bottom: 0 }}>
      <div style={{ height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 18, fontWeight: 600 }}>
        {!collapsed && 'IntegrationHub'}
      </div>
      <Menu theme="dark" mode="inline" selectedKeys={[location.pathname]} items={menuItems} onClick={({ key }) => navigate(key)} />
    </Sider>
  )
}

export default Sidebar