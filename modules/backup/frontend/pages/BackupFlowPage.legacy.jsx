import React, { useState } from 'react'
import { Layout, Card, Steps, Button, Checkbox, Form, Input, Select, message, Space, Tag } from 'antd'
import { CloudOutlined, SettingOutlined, CheckOutlined, BankOutlined, ProjectOutlined, InboxOutlined, CustomerServiceOutlined } from '@ant-design/icons'
import Sidebar from '@packages/ui/src/components/layout/Sidebar'
import Topbar from '@packages/ui/src/components/layout/Topbar'

const { Content } = Layout
const { Option } = Select
const availableApps = [
  { 
    id: 'request', 
    name: 'Request', 
    icon: <InboxOutlined />, 
    color: '#ea580c',
    bg: '#fff7ed',
    description: 'Manage and backup request data',
    objects: ['group', 'request']
  },
  { 
    id: 'workflow', 
    name: 'Workflow', 
    icon: <ProjectOutlined />, 
    color: '#7c3aed',
    bg: '#f5f3ff',
    description: 'Backup workflow configurations',
    objects: ['workflow', 'job', 'todo']
  },
  { 
    id: 'wework', 
    name: 'WeWork', 
    icon: <BankOutlined />, 
    color: '#2563eb',
    bg: '#eff6ff',
    description: 'Backup organizational data',
    objects: ['department', 'project', 'task']
  },
  { 
    id: 'service', 
    name: 'Service', 
    icon: <CustomerServiceOutlined />, 
    color: '#059669',
    bg: '#f0fdf4',
    description: 'Service desk and ticket backup',
    objects: ['service', 'ticket']
  },
]

const Backup = () => {
  const [collapsed, setCollapsed] = useState(false)
  const [currentStep, setCurrentStep] = useState(0)
  const [selectedApps, setSelectedApps] = useState([])
  const [form] = Form.useForm()

  const steps = [
    { title: 'Select Apps', icon: <CloudOutlined /> },
    { title: 'Configure', icon: <SettingOutlined /> },
    { title: 'Confirm', icon: <CheckOutlined /> },
  ]

  const handleAppSelection = (appId) => {
    setSelectedApps((prev) => prev.includes(appId) ? prev.filter((id) => id !== appId) : [...prev, appId])
  }

  const next = async () => {
    if (currentStep === 0 && selectedApps.length === 0) {
      message.warning('Please select at least one application')
      return
    }
    if (currentStep === 1) {
      try {
        await form.validateFields()
      } catch (error) {
        return
      }
    }
    setCurrentStep(currentStep + 1)
  }

  const prev = () => setCurrentStep(currentStep - 1)

  const handleFinish = async () => {
    const values = form.getFieldsValue()
    console.log('Backup configuration:', { selectedApps, ...values })
    message.success('Backup job started successfully!')
    setCurrentStep(0)
    setSelectedApps([])
    form.resetFields()
  }

  const renderStepContent = () => {
    switch (currentStep) {
      case 0:
        return (
          <div>
            <h3 style={{ marginBottom: 16 }}>Select applications to backup</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 16 }}>
              {availableApps.map((app) => (
                <Card
                  key={app.id}
                  hoverable
                  onClick={() => handleAppSelection(app.id)}
                  style={{ 
                    border: selectedApps.includes(app.id) ? `2px solid ${app.color}` : '1px solid #d9d9d9', 
                    cursor: 'pointer',
                    backgroundColor: selectedApps.includes(app.id) ? app.bg : '#fff',
                    transition: 'all 0.3s ease'
                  }}
                >
                  <div style={{ position: 'relative' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                      <div style={{ 
                        fontSize: 32, 
                        color: app.color, 
                        backgroundColor: app.bg,
                        padding: 12,
                        borderRadius: 8,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}>
                        {app.icon}
                      </div>
                      <div style={{ flex: 1 }}>
                        <h4 style={{ margin: '0 0 4px 0', color: app.color }}>{app.name}</h4>
                        <p style={{ fontSize: 12, color: '#666', margin: 0 }}>{app.description}</p>
                      </div>
                    </div>
                    <div style={{ marginTop: 12, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {app.objects.map(obj => (
                        <Tag key={obj} color={app.color} style={{ fontSize: 11 }}>
                          {obj}
                        </Tag>
                      ))}
                    </div>
                    <Checkbox 
                      checked={selectedApps.includes(app.id)} 
                      style={{ position: 'absolute', top: 0, right: 0 }}
                    />
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )
      case 1:
        return (
          <div>
            <h3 style={{ marginBottom: 16 }}>Configure backup settings</h3>
            <Form form={form} layout="vertical">
              <Form.Item name="backupName" label="Backup Name" rules={[{ required: true, message: 'Please enter a backup name' }]}>
                <Input placeholder="e.g., Daily Backup" />
              </Form.Item>
              <Form.Item name="destination" label="Destination" rules={[{ required: true, message: 'Please select a destination' }]}>
                <Select placeholder="Select backup destination">
                  <Option value="local">Local Storage</Option>
                  <Option value="s3">AWS S3</Option>
                  <Option value="azure">Azure Blob</Option>
                </Select>
              </Form.Item>
              <Form.Item name="schedule" label="Schedule" rules={[{ required: true, message: 'Please select a schedule' }]}>
                <Select placeholder="Select backup schedule">
                  <Option value="now">Run Now</Option>
                  <Option value="daily">Daily</Option>
                  <Option value="weekly">Weekly</Option>
                  <Option value="monthly">Monthly</Option>
                </Select>
              </Form.Item>
              <Form.Item name="compression" valuePropName="checked"><Checkbox>Enable compression</Checkbox></Form.Item>
              <Form.Item name="encryption" valuePropName="checked"><Checkbox>Enable encryption</Checkbox></Form.Item>
            </Form>
          </div>
        )
      case 2:
        const values = form.getFieldsValue()
        return (
          <div>
            <h3 style={{ marginBottom: 16 }}>Confirm backup configuration</h3>
            <Card title="Selected Applications" style={{ marginBottom: 16 }}>
              <Space direction="vertical" style={{ width: '100%' }} size="middle">
                {selectedApps.map((appId) => {
                  const app = availableApps.find((a) => a.id === appId)
                  return (
                    <div key={appId} style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: 12,
                      padding: 12,
                      backgroundColor: app.bg,
                      borderRadius: 8,
                      border: `1px solid ${app.color}30`
                    }}>
                      <div style={{ 
                        fontSize: 28, 
                        color: app.color,
                        backgroundColor: '#fff',
                        padding: 8,
                        borderRadius: 6,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}>
                        {app.icon}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 500, color: app.color }}>{app.name}</div>
                        <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
                          Objects: {app.objects.join(', ')}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </Space>
            </Card>
            <Card title="Backup Settings">
              <p><strong>Backup Name:</strong> {values.backupName}</p>
              <p><strong>Destination:</strong> {values.destination}</p>
              <p><strong>Schedule:</strong> {values.schedule}</p>
              <p><strong>Compression:</strong> {values.compression ? 'Enabled' : 'Disabled'}</p>
              <p><strong>Encryption:</strong> {values.encryption ? 'Enabled' : 'Disabled'}</p>
            </Card>
          </div>
        )
      default:
        return null
    }
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sidebar collapsed={collapsed} />
      <Layout style={{ marginLeft: collapsed ? 80 : 240, transition: 'all 0.2s' }}>
        <Topbar collapsed={collapsed} toggleCollapsed={() => setCollapsed(!collapsed)} />
        <Content style={{ margin: 24 }}>
          <h2 style={{ marginBottom: 24 }}>Create Backup Job</h2>
          <Card>
            <Steps current={currentStep} items={steps} style={{ marginBottom: 32 }} />
            <div style={{ minHeight: 300, marginBottom: 24 }}>{renderStepContent()}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <Button disabled={currentStep === 0} onClick={prev}>Previous</Button>
              <div style={{ display: 'flex', gap: 8 }}>
                {currentStep < steps.length - 1 && <Button type="primary" onClick={next}>Next</Button>}
                {currentStep === steps.length - 1 && <Button type="primary" onClick={handleFinish}>Start Backup</Button>}
              </div>
            </div>
          </Card>
        </Content>
      </Layout>
    </Layout>
  )
}

export default Backup