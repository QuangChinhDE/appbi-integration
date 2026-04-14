import React, { useEffect, useState } from 'react'
import axios from 'axios'
import {
  Layout,
  Card,
  Row,
  Col,
  Statistic,
  Table,
  Tag,
  Progress,
  Space,
  Typography,
  Empty,
} from 'antd'
import {
  CloudServerOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  SyncOutlined,
} from '@ant-design/icons'
import Sidebar from '@packages/ui/src/components/layout/Sidebar'
import Topbar from '@packages/ui/src/components/layout/Topbar'
import dayjs from 'dayjs'

const { Content } = Layout
const { Text, Title } = Typography

const API_BASE = 'http://localhost:8000'
const REFRESH_INTERVAL_MS = 5000

const STATUS_COLORS = {
  completed: 'success',
  pending: 'warning',
  running: 'processing',
  failed: 'error',
}

const PROGRESS_STATUS = {
  completed: 'success',
  pending: 'normal',
  running: 'active',
  failed: 'exception',
}

const getRunProgressPercent = (run) => {
  const value = run?.execution_details?.progress_percent
  if (typeof value === 'number') {
    return Math.max(0, Math.min(100, Math.round(value)))
  }
  if (run?.status === 'completed') return 100
  if (run?.status === 'failed') return 100
  if (run?.status === 'running') return 15
  return 0
}

const getRunStepLabel = (run) => {
  if (run?.execution_details?.step_label) return run.execution_details.step_label
  if (run?.status === 'pending') return 'Queued to start'
  if (run?.status === 'running') return run?.latest_log_line || 'Backup is running'
  if (run?.status === 'failed') return run?.error_message || 'Backup failed'
  return run?.latest_log_line || 'Completed'
}

const getRunStructurePath = (run) => {
  return run?.execution_details?.structure_path || 'Structure path not reported yet'
}

const getRunSummary = (run) => {
  const details = run?.execution_details || {}
  if (details.app === 'service') {
    const completedServices = details.completed_services || 0
    const totalServices = details.total_services || 0
    const totalTickets = details.total_tickets || 0
    const attachmentsDownloaded = details.attachments_downloaded || 0
    return `${completedServices}/${totalServices} services, ${totalTickets} tickets, ${attachmentsDownloaded} attachments`
  }

  if (details.app === 'request') {
    const completedGroups = details.completed_groups || 0
    const totalGroups = details.total_groups || 0
    const totalRequests = details.total_requests || 0
    return `${completedGroups}/${totalGroups} groups, ${totalRequests} requests`
  }

  if (run?.status === 'failed') return run?.error_message || 'Run failed'
  return run?.latest_log_line || 'Waiting for updates'
}

const DashboardPage = () => {
  const [collapsed, setCollapsed] = useState(false)
  const [activeRuns, setActiveRuns] = useState([])
  const [recentRuns, setRecentRuns] = useState([])
  const [stats, setStats] = useState({
    configuredApps: 0,
    completedFlows: 0,
    pendingFlows: 0,
    runningFlows: 0,
  })
  const [loading, setLoading] = useState(false)
  const [lastUpdated, setLastUpdated] = useState(null)

  useEffect(() => {
    let active = true
    let intervalId = null

    const loadDashboard = async () => {
      if (active) setLoading(true)
      try {
        const response = await axios.get(`${API_BASE}/api/backup-flows/dashboard`, {
          params: {
            recent_limit: 8,
            active_limit: 6,
          },
        })

        if (!active) return

        setStats({
          configuredApps: response.data.configured_apps || 0,
          completedFlows: response.data.completed_flows || 0,
          pendingFlows: response.data.pending_flows || 0,
          runningFlows: response.data.running_flows || 0,
        })
        setActiveRuns(response.data.active_runs || [])
        setRecentRuns(response.data.recent_runs || [])
        setLastUpdated(dayjs())
      } catch (error) {
        if (!active) return
        console.error('Failed to load dashboard data', error)
        setStats({
          configuredApps: 0,
          completedFlows: 0,
          pendingFlows: 0,
          runningFlows: 0,
        })
        setActiveRuns([])
        setRecentRuns([])
      } finally {
        if (active) setLoading(false)
      }
    }

    loadDashboard()
    intervalId = window.setInterval(loadDashboard, REFRESH_INTERVAL_MS)

    return () => {
      active = false
      if (intervalId) window.clearInterval(intervalId)
    }
  }, [])

  const columns = [
    {
      title: 'Flow',
      key: 'flow',
      render: (_, record) => (
        <div>
          <div style={{ fontWeight: 600 }}>{record.flow_name || 'Unnamed flow'}</div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {record.app_name || record.app || 'Unknown app'}
          </Text>
        </div>
      ),
    },
    {
      title: 'Started',
      dataIndex: 'started_at',
      key: 'started_at',
      width: 150,
      render: (value) => dayjs(value).format('DD/MM/YYYY HH:mm:ss'),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (status) => {
        const normalizedStatus = status || 'pending'
        return <Tag color={STATUS_COLORS[normalizedStatus] || 'default'}>{normalizedStatus.toUpperCase()}</Tag>
      },
    },
    {
      title: 'Current Step',
      key: 'step',
      render: (_, record) => (
        <div>
          <div style={{ fontWeight: 500 }}>{getRunStepLabel(record)}</div>
          {record.latest_log_line && (
            <Text type="secondary" style={{ fontSize: 12 }}>{record.latest_log_line}</Text>
          )}
        </div>
      ),
    },
    {
      title: 'Structure Progress',
      key: 'structure',
      render: (_, record) => (
        <div>
          <div style={{ fontWeight: 500 }}>{getRunStructurePath(record)}</div>
          <Text type="secondary" style={{ fontSize: 12 }}>{getRunSummary(record)}</Text>
        </div>
      ),
    },
    {
      title: 'Progress',
      key: 'progress',
      width: 220,
      render: (_, record) => (
        <Progress
          percent={getRunProgressPercent(record)}
          status={PROGRESS_STATUS[record.status] || 'normal'}
          size="small"
        />
      ),
    },
  ]

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sidebar collapsed={collapsed} />
      <Layout style={{ marginLeft: collapsed ? 80 : 240, transition: 'all 0.2s' }}>
        <Topbar collapsed={collapsed} toggleCollapsed={() => setCollapsed(!collapsed)} />
        <Content style={{ margin: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 24 }}>
            <div>
              <Title level={2} style={{ margin: 0 }}>Dashboard</Title>
              <Text type="secondary">Monitor active backup flows, current execution step, and structure creation progress.</Text>
            </div>
            <Text type="secondary" style={{ whiteSpace: 'nowrap' }}>
              {lastUpdated ? `Auto refresh every 5s. Last updated ${lastUpdated.format('HH:mm:ss')}` : 'Loading dashboard...'}
            </Text>
          </div>

          <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
            <Col xs={24} sm={12} lg={6}>
              <Card loading={loading}>
                <Statistic title="Configured Apps" value={stats.configuredApps} prefix={<CloudServerOutlined />} valueStyle={{ color: '#3b82f6' }} />
              </Card>
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <Card loading={loading}>
                <Statistic title="Completed Flows" value={stats.completedFlows} prefix={<CheckCircleOutlined />} valueStyle={{ color: '#10b981' }} />
              </Card>
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <Card loading={loading}>
                <Statistic title="Pending Flows" value={stats.pendingFlows} prefix={<ClockCircleOutlined />} valueStyle={{ color: '#f59e0b' }} />
              </Card>
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <Card loading={loading}>
                <Statistic title="Running Flows" value={stats.runningFlows} prefix={<SyncOutlined spin />} valueStyle={{ color: '#6366f1' }} />
              </Card>
            </Col>
          </Row>

          <Card title="Active Flow Progress" style={{ marginBottom: 24 }} loading={loading}>
            {activeRuns.length === 0 ? (
              <Empty description="No backup flows are running right now" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                {activeRuns.map((run) => (
                  <Card key={run.run_id} size="small">
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
                      <div>
                        <div style={{ fontSize: 16, fontWeight: 700 }}>{run.flow_name || 'Unnamed flow'}</div>
                        <Space size={8} wrap style={{ marginTop: 4 }}>
                          <Tag color="blue">{run.app_name || run.app || 'Unknown app'}</Tag>
                          <Tag color={STATUS_COLORS[run.status] || 'default'}>{(run.status || 'pending').toUpperCase()}</Tag>
                          <Text type="secondary">Started {dayjs(run.started_at).format('DD/MM/YYYY HH:mm:ss')}</Text>
                        </Space>
                      </div>
                      <div style={{ minWidth: 260, flex: 1 }}>
                        <Progress
                          percent={getRunProgressPercent(run)}
                          status={PROGRESS_STATUS[run.status] || 'normal'}
                        />
                      </div>
                    </div>

                    <Row gutter={[16, 12]}>
                      <Col xs={24} md={8}>
                        <Text type="secondary">Current step</Text>
                        <div style={{ fontWeight: 600, marginTop: 4 }}>{getRunStepLabel(run)}</div>
                      </Col>
                      <Col xs={24} md={8}>
                        <Text type="secondary">Current structure</Text>
                        <div style={{ fontWeight: 600, marginTop: 4 }}>{getRunStructurePath(run)}</div>
                      </Col>
                      <Col xs={24} md={8}>
                        <Text type="secondary">Scope summary</Text>
                        <div style={{ fontWeight: 600, marginTop: 4 }}>{getRunSummary(run)}</div>
                      </Col>
                    </Row>
                  </Card>
                ))}
              </Space>
            )}
          </Card>

          <Card title="Recent Backup History">
            <Table
              columns={columns}
              dataSource={recentRuns}
              rowKey="run_id"
              pagination={false}
              loading={loading}
              locale={{ emptyText: 'No backup runs yet' }}
            />
          </Card>
        </Content>
      </Layout>
    </Layout>
  )
}

export default DashboardPage