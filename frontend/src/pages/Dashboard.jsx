import React, { useState, useEffect } from 'react'
import { Layout, Card, Row, Col, Statistic, Table, Tag } from 'antd'
import { CloudServerOutlined, CheckCircleOutlined, ClockCircleOutlined, SyncOutlined } from '@ant-design/icons'
import Sidebar from '../components/Sidebar'
import Topbar from '../components/Topbar'
import dayjs from 'dayjs'

const { Content } = Layout

const Dashboard = () => {
  const [collapsed, setCollapsed] = useState(false)
  const [backupHistory, setBackupHistory] = useState([])

  useEffect(() => {
    setBackupHistory([
      { key: '1', app: 'Google Drive', date: dayjs().subtract(1, 'hour'), status: 'success', size: '2.3 GB' },
      { key: '2', app: 'Dropbox', date: dayjs().subtract(3, 'hour'), status: 'success', size: '1.8 GB' },
      { key: '3', app: 'OneDrive', date: dayjs().subtract(1, 'day'), status: 'pending', size: '-' },
    ])
  }, [])

  const columns = [
    { title: 'Application', dataIndex: 'app', key: 'app' },
    { title: 'Date', dataIndex: 'date', key: 'date', render: (date) => dayjs(date).format('DD/MM/YYYY HH:mm') },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (status) => {
        const colors = { success: 'success', pending: 'processing', failed: 'error' }
        return <Tag color={colors[status]}>{status.toUpperCase()}</Tag>
      },
    },
    { title: 'Size', dataIndex: 'size', key: 'size' },
  ]

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sidebar collapsed={collapsed} />
      <Layout style={{ marginLeft: collapsed ? 80 : 240, transition: 'all 0.2s' }}>
        <Topbar collapsed={collapsed} toggleCollapsed={() => setCollapsed(!collapsed)} />
        <Content style={{ margin: 24 }}>
          <h2 style={{ marginBottom: 24 }}>Dashboard</h2>
          <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
            <Col xs={24} sm={12} lg={6}>
              <Card><Statistic title="Total Apps" value={12} prefix={<CloudServerOutlined />} valueStyle={{ color: '#3b82f6' }} /></Card>
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <Card><Statistic title="Successful Backups" value={245} prefix={<CheckCircleOutlined />} valueStyle={{ color: '#10b981' }} /></Card>
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <Card><Statistic title="Pending" value={3} prefix={<ClockCircleOutlined />} valueStyle={{ color: '#f59e0b' }} /></Card>
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <Card><Statistic title="In Progress" value={1} prefix={<SyncOutlined spin />} valueStyle={{ color: '#6366f1' }} /></Card>
            </Col>
          </Row>
          <Card title="Recent Backup History">
            <Table columns={columns} dataSource={backupHistory} pagination={false} />
          </Card>
        </Content>
      </Layout>
    </Layout>
  )
}

export default Dashboard
