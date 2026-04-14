import React from 'react'
import { Layout, Avatar, Dropdown } from 'antd'
import { MenuFoldOutlined, MenuUnfoldOutlined, UserOutlined, LogoutOutlined } from '@ant-design/icons'
import { useAuthStore } from '@modules/identity/frontend/store/authStore'
import { useNavigate } from 'react-router-dom'

const { Header } = Layout

const Topbar = ({ collapsed, toggleCollapsed }) => {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const handleLogout = () => {
    logout()
    navigate('/login')
  }
  const items = [{ key: 'logout', icon: <LogoutOutlined />, label: 'Logout', onClick: handleLogout }]

  return (
    <Header style={{ padding: '0 24px', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #f0f0f0' }}>
      <div onClick={toggleCollapsed} style={{ cursor: 'pointer', fontSize: 18 }}>
        {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
      </div>
      <Dropdown menu={{ items }} placement="bottomRight">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <span>{user?.email}</span>
          <Avatar icon={<UserOutlined />} />
        </div>
      </Dropdown>
    </Header>
  )
}

export default Topbar