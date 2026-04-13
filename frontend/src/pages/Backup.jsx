import React, { useState, useEffect } from 'react'
import axios from 'axios'
import { useNavigate } from 'react-router-dom'
import { Layout, Card, Steps, Button, Checkbox, Form, Input, Select, message, Space, Tag, Alert, Modal, Tree, Row, Col, Typography, Divider, Table } from 'antd'
import { 
  InboxOutlined, 
  ProjectOutlined, 
  BankOutlined, 
  CustomerServiceOutlined,
  CloudOutlined,
  SettingOutlined,
  CheckOutlined,
  EyeOutlined,
  EyeInvisibleOutlined,
  GoogleOutlined,
  FileExcelOutlined,
  FolderOutlined,
  DatabaseOutlined,
  ApiOutlined,
  LockOutlined,
  SafetyOutlined,
  WarningOutlined,
  RocketOutlined,
  PlusOutlined,
  ArrowLeftOutlined,
  PlayCircleOutlined,
  EditOutlined,
  DeleteOutlined,
  ClockCircleOutlined
} from '@ant-design/icons'
import Sidebar from '../components/Sidebar'
import Topbar from '../components/Topbar'

const { Content } = Layout
const { Option } = Select
const { Text, Title, Paragraph } = Typography
const { Password } = Input

// App definitions
const APPS = {
  request: {
    id: 'request',
    name: 'Request',
    icon: <InboxOutlined />,
    color: '#ea580c',
    bg: '#fff7ed',
    description: 'Manage and backup request data',
    objects: ['group', 'request'],
    objectLabels: { group: 'Group', request: 'Request' },
    isSpecial: true // Request has different workflow
  },
  workflow: {
    id: 'workflow',
    name: 'Workflow',
    icon: <ProjectOutlined />,
    color: '#7c3aed',
    bg: '#f5f3ff',
    description: 'Backup workflow configurations',
    objects: ['workflow', 'job', 'todo'],
    objectLabels: { workflow: 'Workflow', job: 'Job', todo: 'Todo' },
    isSpecial: false
  },
  wework: {
    id: 'wework',
    name: 'WeWork',
    icon: <BankOutlined />,
    color: '#2563eb',
    bg: '#eff6ff',
    description: 'Backup organizational data',
    objects: ['department', 'project', 'task'],
    objectLabels: { department: 'Department', project: 'Project', task: 'Task' },
    isSpecial: false
  },
  service: {
    id: 'service',
    name: 'Service',
    icon: <CustomerServiceOutlined />,
    color: '#059669',
    bg: '#f0fdf4',
    description: 'Service desk and ticket backup',
    objects: ['service', 'ticket'],
    objectLabels: { service: 'Service', ticket: 'Ticket' },
    isSpecial: false
  }
}

// Mock custom fields for demo
const MOCK_FIELDS = {
  workflow: [
    { id: 'wf1', object: 'workflow', name: 'Priority Level', type: 'select', desc: 'Workflow priority classification' },
    { id: 'wf2', object: 'workflow', name: 'Approval Matrix', type: 'input-table', desc: 'Approval routing table' },
    { id: 'wf3', object: 'job', name: 'Estimated Hours', type: 'number', desc: 'Time estimation for job' },
    { id: 'wf4', object: 'job', name: 'Skills Required', type: 'select-master', desc: 'Required skills list' }
  ],
  wework: [
    { id: 'ww1', object: 'department', name: 'Budget', type: 'number', desc: 'Department budget allocation' },
    { id: 'ww2', object: 'project', name: 'Milestones', type: 'input-table', desc: 'Project milestone tracking' },
    { id: 'ww3', object: 'project', name: 'Status', type: 'select', desc: 'Project status' },
    { id: 'ww4', object: 'task', name: 'Priority', type: 'select', desc: 'Task priority level' }
  ],
  service: [
    { id: 'sv1', object: 'service', name: 'SLA Hours', type: 'number', desc: 'Service level agreement time' },
    { id: 'sv2', object: 'ticket', name: 'Resolution Steps', type: 'input-table', desc: 'Resolution procedure steps' },
    { id: 'sv3', object: 'ticket', name: 'Severity', type: 'select', desc: 'Ticket severity level' }
  ]
}

// Mock backup flows for demo
const MOCK_BACKUP_FLOWS = [
  {
    id: 1,
    name: 'Daily Request Backup',
    app: 'request',
    appName: 'Request',
    appIcon: <InboxOutlined />,
    appColor: '#ea580c',
    type: 'Complete Backup',
    destination: 'Google Drive',
    schedule: 'Daily at 2:00 AM',
    lastRun: '2026-04-12 02:00:00',
    status: 'completed',
    createdAt: '2026-04-01'
  },
  {
    id: 2,
    name: 'Weekly Workflow Export',
    app: 'workflow',
    appName: 'Workflow',
    appIcon: <ProjectOutlined />,
    appColor: '#7c3aed',
    type: 'Structured Data',
    destination: 'Google Sheets',
    schedule: 'Weekly (Monday)',
    lastRun: '2026-04-08 01:00:00',
    status: 'completed',
    createdAt: '2026-03-15'
  },
  {
    id: 3,
    name: 'WeWork Monthly Archive',
    app: 'wework',
    appName: 'WeWork',
    appIcon: <BankOutlined />,
    appColor: '#2563eb',
    type: 'Complete Backup',
    destination: 'Google Drive',
    schedule: 'Monthly (1st)',
    lastRun: '2026-04-01 00:00:00',
    status: 'completed',
    createdAt: '2026-02-01'
  },
  {
    id: 4,
    name: 'Service Tickets Backup',
    app: 'service',
    appName: 'Service',
    appIcon: <CustomerServiceOutlined />,
    appColor: '#059669',
    type: 'Unstructured Data',
    destination: 'Google Drive',
    schedule: 'Daily at 3:00 AM',
    lastRun: null,
    status: 'pending',
    createdAt: '2026-04-12'
  }
]

const API_BASE = 'http://localhost:8000'

const Backup = () => {
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useState(false)
  const [viewMode, setViewMode] = useState('list') // 'list' | 'create' | 'edit'
  const [currentStep, setCurrentStep] = useState(0)
  const [draftFlowId, setDraftFlowId] = useState(null) // ID of current draft in DB
  const [editFlowId, setEditFlowId] = useState(null)   // ID of flow being edited
  const [flowName, setFlowName] = useState('')           // user-provided flow name

  // List state
  const [flows, setFlows] = useState([])
  const [loadingFlows, setLoadingFlows] = useState(false)

  const fetchFlows = async () => {
    setLoadingFlows(true)
    try {
      const res = await axios.get(`${API_BASE}/api/backup-flows`)
      setFlows(res.data)
    } catch (err) {
      message.error('Failed to load backup flows')
      console.error(err)
    } finally {
      setLoadingFlows(false)
    }
  }

  useEffect(() => {
    if (viewMode === 'list') fetchFlows()
  }, [viewMode])

  // Load an existing flow into wizard state for editing
  const loadFlowForEdit = async (flowId) => {
    try {
      const res = await axios.get(`${API_BASE}/api/backup-flows/${flowId}`)
      const f = res.data

      // Reset everything first
      setCurrentStep(0)
      setFlowName('')
      setSelectedApp(null)
      setDomain('')
      setAccessTokenV2('')
      setBackupType(null)
      setStorageDestination(null)
      setGoogleAuth(null)
      setSelectedObjects([])
      setAccessToken('')
      setSelectedFieldIds([])
      setExportFormats({})

      // source is a nested object: { app, app_name, domain, access_token }
      const src = f.source || {}
      const dest = f.destination || {}
      const struct = f.structure || {}

      if (f.name) setFlowName(f.name)
      if (src.app) setSelectedApp(src.app)

      if (src.app === 'request') {
        if (src.domain)        setDomain(src.domain)
        if (src.access_token)  setAccessTokenV2(src.access_token)
        if (f.backup_type)     setBackupType(f.backup_type)
        if (dest.type)         setStorageDestination(dest.type)
        const auth = dest.auth || {}
        if (auth.connection_id) {
          setGoogleAuth({
            connection_id: auth.connection_id,
            email:         auth.email || '',
            display_name:  auth.email || '',
            picture_url:   '',
            folder_id:     auth.folder_id  || null,
            folder_name:   auth.folder_id  ? 'Saved folder' : null,
            drive_id:      auth.drive_id   || null,
          })
        }
      } else {
        if (src.access_token)  setAccessToken(src.access_token)
        const objs = struct.objects
        if (Array.isArray(objs)) setSelectedObjects(objs)
        const fields = struct.custom_fields
        if (Array.isArray(fields)) setSelectedFieldIds(fields)
        const fmts = struct.export_formats
        if (fmts && typeof fmts === 'object') setExportFormats(fmts)
      }

      setEditFlowId(flowId)
      setDraftFlowId(flowId)
      setViewMode('edit')
    } catch (err) {
      message.error('Failed to load backup flow for editing')
      console.error(err)
    }
  }
  
  // Step 1: App selection
  const [selectedApp, setSelectedApp] = useState(null)
  
  // Request-specific states
  const [domain, setDomain] = useState('')
  const [accessTokenV2, setAccessTokenV2] = useState('')
  const [showTokenV2, setShowTokenV2] = useState(false)
  const [backupType, setBackupType] = useState(null) // 'structured', 'unstructured', 'all'
  const [storageDestination, setStorageDestination] = useState(null) // 'gsheets', 'gdrive'
  const [googleAuth, setGoogleAuth] = useState(null)
  const [showDestinationModal, setShowDestinationModal] = useState(false)
  const [destinationSearch, setDestinationSearch] = useState('')

  // Google folder picker
  const [googleFolderModal, setGoogleFolderModal] = useState(false)
  const [drives, setDrives] = useState([])
  const [loadingDrives, setLoadingDrives] = useState(false)
  const [currentDriveId, setCurrentDriveId] = useState('root')
  const [folders, setFolders] = useState([])
  const [folderPath, setFolderPath] = useState([])
  const [loadingFolders, setLoadingFolders] = useState(false)
  
  // Generic workflow states
  const [selectedObjects, setSelectedObjects] = useState([])
  const [accessToken, setAccessToken] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [selectedFieldIds, setSelectedFieldIds] = useState([])
  const [exportFormats, setExportFormats] = useState({}) // { fieldId: 'json' | 'excel' }

  // Get current app data
  const currentApp = selectedApp ? APPS[selectedApp] : null
  const isRequestApp = currentApp?.isSpecial
  const totalSteps = 4

  // Define steps based on app type
  const getStepLabels = () => {
    if (isRequestApp) {
      return [
        { title: 'Choose App', icon: <CloudOutlined /> },
        { title: 'Connection', icon: <ApiOutlined /> },
        { title: 'Backup Type', icon: <DatabaseOutlined /> },
        { title: 'Review', icon: <CheckOutlined /> }
      ]
    } else {
      return [
        { title: 'Choose App', icon: <CloudOutlined /> },
        { title: 'Objects', icon: <FolderOutlined /> },
        { title: 'Access Token', icon: <LockOutlined /> },
        { title: 'Config & Review', icon: <CheckOutlined /> }
      ]
    }
  }

  const steps = getStepLabels()

  // Build partial autosave payload for the step just completed
  const buildAutosavePayload = (step) => {
    if (step === 0) {
      return {
        name: flowName.trim() || undefined,
        source: selectedApp ? { app: selectedApp, app_name: currentApp?.name } : undefined
      }
    }
    if (isRequestApp) {
      if (step === 1) {
        return { source: { app: 'request', app_name: 'Request', domain, access_token: accessTokenV2 } }
      }
      if (step === 2) {
        return {
          backup_type: backupType,
          destination: {
            type: storageDestination,
            name: storageDestination === 'gdrive' ? 'Google Drive' : 'Google Sheets',
            auth: {
              connection_id: googleAuth?.connection_id,
              email: googleAuth?.email,
              folder_id: googleAuth?.folder_id || null,
              drive_id: googleAuth?.drive_id || null
            }
          }
        }
      }
    } else {
      if (step === 1) {
        return { structure: { objects: selectedObjects } }
      }
      if (step === 2) {
        return {
          source: {
            app: selectedApp,
            app_name: currentApp?.name,
            domain: selectedApp,
            access_token: accessToken
          }
        }
      }
    }
    return {}
  }

  // Navigation handlers
  const next = async () => {
    // Validation
    if (currentStep === 0) {
      if (!flowName.trim()) {
        message.warning('Please enter a name for this backup flow')
        return
      }
      if (!selectedApp) {
        message.warning('Please select an application')
        return
      }
    }

    if (isRequestApp) {
      if (currentStep === 1) {
        if (!domain || !accessTokenV2) {
          message.warning('Please provide domain and access token')
          return
        }
      }
      if (currentStep === 2) {
        if (!backupType || !storageDestination || !googleAuth) {
          message.warning('Please select backup type, destination, and connect with Google')
          return
        }
      }
    } else {
      if (currentStep === 1 && selectedObjects.length === 0) {
        message.warning('Please select at least one object')
        return
      }
      if (currentStep === 2 && !accessToken) {
        message.warning('Please provide access token')
        return
      }
    }

    // Auto-save current step data silently
    if (draftFlowId) {
      const payload = buildAutosavePayload(currentStep)
      await axios.patch(`${API_BASE}/api/backup-flows/${draftFlowId}/autosave`, payload).catch(() => {})
    }

    setCurrentStep(currentStep + 1)
  }

  const prev = () => setCurrentStep(currentStep - 1)

  const handleFinish = async () => {
    if (!draftFlowId) {
      message.error('No draft flow found. Please try again.')
      return
    }

    const savePayload = isRequestApp ? {
      name: flowName.trim() || undefined,
      source: {
        app: 'request',
        app_name: 'Request',
        domain,
        access_token: accessTokenV2
      },
      backup_type: backupType,
      destination: {
        type: storageDestination,
        name: storageDestination === 'gdrive' ? 'Google Drive' : 'Google Sheets',
        auth: {
          connection_id: googleAuth?.connection_id,
          email: googleAuth?.email,
          folder_id: googleAuth?.folder_id || null,
          drive_id: googleAuth?.drive_id || null
        }
      },
      structure: { objects: ['group', 'request'] },
      updated_by: 'current_user'
    } : {
      name: flowName.trim() || undefined,
      source: {
        app: selectedApp,
        app_name: currentApp.name,
        domain: selectedApp,
        access_token: accessToken
      },
      backup_type: 'all',
      destination: {
        type: 'gdrive',
        name: 'Google Drive',
        auth: { email: 'user@gmail.com' }
      },
      structure: {
        objects: selectedObjects,
        custom_fields: selectedFieldIds,
        export_formats: exportFormats
      },
      updated_by: 'current_user'
    }

    const isEdit = viewMode === 'edit'
    const actionLabel = isEdit ? 'Updating backup flow...' : 'Saving backup flow...'
    const successLabel = isEdit ? 'Backup flow updated successfully!' : 'Backup flow created successfully!'

    try {
      message.loading({ content: actionLabel, key: 'save' })
      await axios.post(`${API_BASE}/api/backup-flows/${draftFlowId}/save`, savePayload)
      message.success({ content: successLabel, key: 'save' })
    } catch (err) {
      message.error({ content: `Failed to ${isEdit ? 'update' : 'save'} backup flow.`, key: 'save' })
      console.error(err)
      return
    }

    // Reset and return to list
    setCurrentStep(0)
    setSelectedApp(null)
    setDomain('')
    setAccessTokenV2('')
    setBackupType(null)
    setStorageDestination(null)
    setGoogleAuth(null)
    setSelectedObjects([])
    setAccessToken('')
    setSelectedFieldIds([])
    setExportFormats({})
    setFlowName('')
    setDraftFlowId(null)
    setEditFlowId(null)
    setViewMode('list')
  }

  // Helper functions
  const handleAppSelection = (appId) => {
    setSelectedApp(appId)
    // Reset states
    setSelectedObjects([])
    setAccessToken('')
    setAccessTokenV2('')
    setDomain('')
    setBackupType(null)
    setStorageDestination(null)
    setGoogleAuth(null)
    setSelectedFieldIds([])
    setExportFormats({})
  }

  const handleObjectToggle = (obj) => {
    setSelectedObjects(prev =>
      prev.includes(obj) ? prev.filter(o => o !== obj) : [...prev, obj]
    )
  }

  const handleSelectAllObjects = () => {
    if (selectedObjects.length === currentApp.objects.length) {
      setSelectedObjects([])
    } else {
      setSelectedObjects([...currentApp.objects])
    }
  }

  const handleFieldToggle = (fieldId) => {
    setSelectedFieldIds(prev =>
      prev.includes(fieldId) ? prev.filter(f => f !== fieldId) : [...prev, fieldId]
    )
  }

  const getAvailableFields = () => {
    if (!selectedApp || isRequestApp) return []
    const allFields = MOCK_FIELDS[selectedApp] || []
    return allFields.filter(f => selectedObjects.includes(f.object))
  }

  const handleSelectAllFields = () => {
    const available = getAvailableFields()
    if (selectedFieldIds.length === available.length) {
      setSelectedFieldIds([])
    } else {
      setSelectedFieldIds(available.map(f => f.id))
    }
  }

  const handleGoogleConnect = async () => {
    try {
      const res = await axios.get(`${API_BASE}/api/google/auth-url`)
      const { url } = res.data
      const w = 520, h = 660
      const popup = window.open(
        url, 'google-oauth',
        `width=${w},height=${h},top=${Math.round((window.screen.height - h) / 2)},left=${Math.round((window.screen.width - w) / 2)}`
      )
      const onMessage = (event) => {
        if (!event.data || typeof event.data !== 'object') return
        const data = event.data
        if (data.success === true && data.connection_id) {
          setGoogleAuth({
            connection_id: data.connection_id,
            email: data.email,
            display_name: data.display_name || data.email,
            picture_url: data.picture_url || '',
            folder_id: null,
            folder_name: null,
            drive_id: null
          })
          message.success(`Connected as ${data.email}`)
        } else if (data.success === false) {
          message.error(`Google auth failed: ${data.error || 'Unknown error'}`)
        } else {
          return
        }
        window.removeEventListener('message', onMessage)
        popup?.close()
      }
      window.addEventListener('message', onMessage)
    } catch (err) {
      if (err.response?.status === 503) {
        Modal.confirm({
          title: 'Google OAuth Not Configured',
          icon: null,
          content: (
            <div>
              <p>Google OAuth credentials have not been configured yet.</p>
              <p>Go to <strong>Settings</strong> to enter your <strong>Client ID</strong> and <strong>Client Secret</strong> from Google Cloud Console.</p>
            </div>
          ),
          okText: 'Go to Settings',
          cancelText: 'Cancel',
          onOk: () => navigate('/settings')
        })
      } else {
        message.error('Failed to start Google authentication')
      }
      console.error(err)
    }
  }

  const handleGoogleDisconnect = () => {
    setGoogleAuth(null)
    setDrives([])
    setFolders([])
    setFolderPath([])
    message.info('Disconnected from Google')
  }

  const handleOpenFolderPicker = async () => {
    if (!googleAuth?.connection_id) return
    setGoogleFolderModal(true)
    setLoadingDrives(true)
    try {
      const res = await axios.get(`${API_BASE}/api/google/drives`, {
        params: { connection_id: googleAuth.connection_id }
      })
      setDrives(res.data)
      if (res.data.length > 0) {
        await handleDriveChange(res.data[0].id, res.data)
      }
    } catch (err) {
      message.error('Failed to load Google Drives')
    } finally {
      setLoadingDrives(false)
    }
  }

  const handleDriveChange = async (driveId, drivesList = drives) => {
    setCurrentDriveId(driveId)
    const driveName = (drivesList.find(d => d.id === driveId) || {}).name || 'Drive'
    const rootParent = driveId === 'root' ? 'root' : driveId
    setFolderPath([{ id: rootParent, name: driveName, driveId: driveId === 'root' ? null : driveId }])
    await fetchSubFolders(rootParent, driveId === 'root' ? null : driveId)
  }

  const fetchSubFolders = async (parentId, driveId) => {
    setLoadingFolders(true)
    try {
      const params = { connection_id: googleAuth.connection_id, parent_id: parentId }
      if (driveId) params.drive_id = driveId
      const res = await axios.get(`${API_BASE}/api/google/folders`, { params })
      setFolders(res.data)
    } catch (err) {
      message.error('Failed to load folders')
    } finally {
      setLoadingFolders(false)
    }
  }

  const handleOpenSubFolder = async (folder) => {
    const driveId = currentDriveId !== 'root' ? currentDriveId : null
    setFolderPath(prev => [...prev, { id: folder.id, name: folder.name, driveId }])
    await fetchSubFolders(folder.id, driveId)
  }

  const handleBreadcrumbNav = async (index) => {
    const item = folderPath[index]
    setFolderPath(prev => prev.slice(0, index + 1))
    await fetchSubFolders(item.id, item.driveId)
  }

  const handleSelectCurrentFolder = () => {
    const current = folderPath[folderPath.length - 1]
    if (!current) return
    const isRoot = folderPath.length === 1
    setGoogleAuth(prev => ({
      ...prev,
      folder_id: isRoot ? null : current.id,
      folder_name: current.name,
      drive_id: current.driveId || null
    }))
    setGoogleFolderModal(false)
    message.success(`Folder selected: ${current.name}`)
  }

  const selectDestination = (dest) => {
    setStorageDestination(dest)
    setGoogleAuth(null) // Reset auth when changing destination
    setShowDestinationModal(false)
  }

  // Render functions for each step
  const renderStep1 = () => (
    <div>
      <div style={{ marginBottom: 24 }}>
        <Title level={4} style={{ marginBottom: 4 }}>Choose an Application</Title>
        <Paragraph type="secondary">Select the app whose data you want to back up.</Paragraph>
      </div>

      <div style={{ marginBottom: 24 }}>
        <div style={{ marginBottom: 8, fontWeight: 500 }}>
          Backup Flow Name <span style={{ color: '#ff4d4f' }}>*</span>
        </div>
        <Input
          placeholder="e.g. Daily Request Backup"
          value={flowName}
          onChange={e => setFlowName(e.target.value)}
          size="large"
          maxLength={120}
          style={{ maxWidth: 480 }}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 24 }}>
        {Object.values(APPS).map(app => (
          <Card
            key={app.id}
            hoverable
            onClick={() => handleAppSelection(app.id)}
            style={{
              border: selectedApp === app.id ? `2px solid ${app.color}` : '1px solid #d9d9d9',
              cursor: 'pointer',
              backgroundColor: selectedApp === app.id ? app.bg : '#fff',
              transition: 'all 0.3s'
            }}
          >
            <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
              <div style={{
                fontSize: 40,
                color: app.color,
                backgroundColor: app.bg,
                padding: 12,
                borderRadius: 10,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                {app.icon}
              </div>
              <div style={{ flex: 1 }}>
                <Title level={5} style={{ margin: '0 0 4px 0', color: app.color }}>{app.name}</Title>
                <Paragraph type="secondary" style={{ fontSize: 12, margin: '0 0 12px 0' }}>
                  {app.description}
                </Paragraph>
                <Space size={4} wrap>
                  {app.objects.map(obj => (
                    <Tag key={obj} color={app.color} style={{ fontSize: 11 }}>
                      {app.objectLabels[obj]}
                    </Tag>
                  ))}
                </Space>
              </div>
            </div>
            {selectedApp === app.id && (
              <div style={{ marginTop: 12, textAlign: 'center', color: app.color, fontSize: 12 }}>
                <CheckOutlined /> Selected
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  )

  const renderRequestStep2 = () => (
    <div>
      <div style={{ marginBottom: 24 }}>
        <Space align="start">
          <div style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: '#fff7ed',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <ApiOutlined style={{ color: '#ea580c', fontSize: 18 }} />
          </div>
          <div>
            <Title level={4} style={{ margin: 0 }}>Connection Information</Title>
            <Paragraph type="secondary">
              Provide information to connect to <strong>Request</strong>
            </Paragraph>
          </div>
        </Space>
      </div>

      <Alert
        message="Connection information is used only in this backup session and is not stored on the server."
        type="warning"
        showIcon
        icon={<WarningOutlined />}
        style={{ marginBottom: 24 }}
      />

      <Form layout="vertical">
        <Form.Item 
          label={<><CloudOutlined style={{ color: '#3b82f6', marginRight: 6 }} />Domain</>}
          required
        >
          <Input
            addonBefore="request."
            placeholder="yourdomain.com"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            size="large"
          />
          <Text type="secondary" style={{ fontSize: 12 }}>
            Example: if your URL is <code>request.company.vn</code> then enter <code>company.vn</code>
          </Text>
        </Form.Item>

        <Form.Item
          label={<><LockOutlined style={{ color: '#f59e0b', marginRight: 6 }} />Access Token V2</>}
          required
        >
          <Password
            placeholder="Paste access token v2 here…"
            value={accessTokenV2}
            onChange={(e) => setAccessTokenV2(e.target.value)}
            iconRender={visible => (visible ? <EyeOutlined /> : <EyeInvisibleOutlined />)}
            size="large"
          />
          <Text type="secondary" style={{ fontSize: 12 }}>
            Get token at <strong>Request</strong> → Settings → API Keys → Access Token V2
          </Text>
        </Form.Item>
      </Form>

      <Alert
        message={
          <div>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Secure Connection</div>
            <div style={{ fontSize: 12 }}>
              All connections are encrypted with TLS 1.3. Tokens are not stored on the server.
            </div>
          </div>
        }
        type="success"
        showIcon
        icon={<SafetyOutlined />}
      />
    </div>
  )

  const renderRequestStep3 = () => {
    const backupTypes = [
      {
        id: 'structured',
        name: 'Structured Data',
        desc: 'Store as spreadsheets',
        icon: <FileExcelOutlined />,
        color: '#0284c7',
        tooltip: 'Data stored in Google Sheets format with structured columns and rows'
      },
      {
        id: 'unstructured',
        name: 'Unstructured Data',
        desc: 'Store as folders & files',
        icon: <FolderOutlined />,
        color: '#d97706',
        tooltip: 'Data stored in Google Drive as folders and files with attachments'
      },
      {
        id: 'all',
        name: 'Complete Backup',
        desc: 'Full coverage',
        icon: <DatabaseOutlined />,
        color: '#7c3aed',
        tooltip: 'Combined approach with all files and structured data'
      }
    ]

    const storageOptions = [
      { id: 'gsheets', name: 'Google Sheets', icon: <FileExcelOutlined />, color: '#10b981', types: ['structured'] },
      { id: 'gdrive', name: 'Google Drive', icon: <GoogleOutlined />, color: '#4285f4', types: ['unstructured', 'all'] }
    ]

    const availableStorages = storageOptions.filter (s => !backupType || s.types.includes(backupType))

    return (
      <Row gutter={24}>
        <Col span={12}>
          <div>
            <Title level={5} style={{ marginBottom: 16 }}>
              <DatabaseOutlined style={{ color: '#3b82f6', marginRight: 8 }} />
              Backup Type
            </Title>

            <Space direction="vertical" style={{ width: '100%' }} size={10}>
              {backupTypes.map(type => (
                <Card
                  key={type.id}
                  hoverable
                  onClick={() => {
                    setBackupType(type.id)
                    setStorageDestination(null)
                    setGoogleAuth(null)
                  }}
                  style={{
                    border: backupType === type.id ? `2px solid ${type.color}` : '1px solid #d9d9d9',
                    backgroundColor: backupType === type.id ? `${type.color}10` : '#fff',
                    cursor: 'pointer'
                  }}
                  styles={{ body: { padding: 14 } }}
                >
                  <Space align="start">
                    <div style={{
                      fontSize: 24,
                      color: type.color,
                      backgroundColor: `${type.color}15`,
                      padding: 8,
                      borderRadius: 8
                    }}>
                      {type.icon}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 2 }}>{type.name}</div>
                      <Text type="secondary" style={{ fontSize: 11 }}>{type.desc}</Text>
                    </div>
                    {backupType === type.id && <CheckOutlined style={{ color: type.color, fontSize: 18 }} />}
                  </Space>
                </Card>
              ))}
            </Space>

            <Divider />

            <Title level={5} style={{ marginBottom: 16 }}>
              <CloudOutlined style={{ color: '#d97706', marginRight: 8 }} />
              Destination
            </Title>

            <Button
              onClick={() => setShowDestinationModal(true)}
              disabled={!backupType}
              block
              size="large"
              style={{
                borderStyle: 'dashed',
                borderWidth: 2,
                borderColor: !backupType ? '#e2e8f0' : '#cbd5e1',
                height: 'auto',
                padding: 16,
                opacity: !backupType ? 0.5 : 1,
                marginBottom: storageDestination ? 12 : 0
              }}
            >
              <Space>
                <CloudOutlined style={{ fontSize: 18, color: '#3b82f6' }} />
                <Text strong style={{ fontSize: 13 }}>
                  {storageDestination ? 'Change Destination' : 'Select Destination'}
                </Text>
              </Space>
            </Button>

            {storageDestination && (
              <Card style={{ background: '#ecfeff', border: '2px solid #a5f3fc' }}>
                <Space>
                  {storageDestination === 'gsheets' ? (
                    <FileExcelOutlined style={{ fontSize: 20, color: '#10b981' }} />
                  ) : (
                    <GoogleOutlined style={{ fontSize: 20, color: '#4285f4' }} />
                  )}
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#0e7490', textTransform: 'uppercase' }}>
                      SELECTED
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
                      {storageDestination === 'gsheets' ? 'Google Sheets' : 'Google Drive'}
                    </div>
                  </div>
                </Space>
              </Card>
            )}

            {storageDestination && (
              <>
                <Divider />
                <Title level={5} style={{ marginBottom: 16 }}>
                  <ApiOutlined style={{ color: '#059669', marginRight: 8 }} />
                  Authentication
                </Title>

                {googleAuth ? (
                  <Space direction="vertical" style={{ width: '100%' }} size={10}>
                    <Card style={{ background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Space>
                          {googleAuth.picture_url
                            ? <img src={googleAuth.picture_url} alt="" style={{ width: 32, height: 32, borderRadius: '50%' }} />
                            : <CheckOutlined style={{ color: '#059669', fontSize: 20 }} />}
                          <div>
                            <div style={{ fontSize: 10, color: '#065f46', fontWeight: 700 }}>CONNECTED</div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: '#047857' }}>
                              {googleAuth.display_name || googleAuth.email}
                            </div>
                            <div style={{ fontSize: 11, color: '#059669' }}>{googleAuth.email}</div>
                          </div>
                        </Space>
                        <Button size="small" danger onClick={handleGoogleDisconnect}>Disconnect</Button>
                      </div>
                    </Card>

                    <Button
                      block
                      icon={<FolderOutlined />}
                      onClick={handleOpenFolderPicker}
                      style={{ borderStyle: 'dashed' }}
                    >
                      {googleAuth.folder_name
                        ? `📁 ${googleAuth.folder_name}`
                        : 'Select folder in Google Drive'}
                    </Button>
                    {!googleAuth.folder_name && (
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        If no folder is selected, files will be saved to the root of My Drive.
                      </Text>
                    )}
                  </Space>
                ) : (
                  <Button
                    type="primary"
                    icon={<GoogleOutlined />}
                    block
                    size="large"
                    onClick={handleGoogleConnect}
                  >
                    Connect with Google
                  </Button>
                )}
              </>
            )}
          </div>
        </Col>

        <Col span={12}>
          <Title level={5} style={{ marginBottom: 16 }}>
            <FolderOutlined style={{ color: '#7c3aed', marginRight: 8 }} />
            Structure Preview
          </Title>

          <Card
            style={{
              background: '#0f172a',
              border: '2px solid #1e293b',
              minHeight: 400
            }}
            styles={{ body: { padding: 20 } }}
          >
            {backupType ? (
              <div style={{ color: '#e2e8f0', fontSize: 12 }}>
                <div style={{ marginBottom: 16, color: '#10b981', fontWeight: 700 }}>
                  <FolderOutlined /> Request Backup ({storageDestination === 'gsheets' ? 'Google Sheets' : 'Google Drive'})
                </div>
                {backupType === 'structured' && (
                  <ul style={{ listStyle: 'none', paddingLeft: 20 }}>
                    <li>📊 [Group 14007] Spreadsheet</li>
                    <li style={{ paddingLeft: 20 }}>
                      <ul style={{ listStyle: 'none' }}>
                        <li>📄 Sheet 1: request_info</li>
                        <li>📄 Sheet 2: custom_field</li>
                        <li>📄 Sheet 3: custom_table</li>
                        <li>📄 Sheet 4: activity_log</li>
                      </ul>
                    </li>
                  </ul>
                )}
                {backupType === 'unstructured' && (
                  <ul style={{ listStyle: 'none', paddingLeft: 20 }}>
                    <li>📁 [14007] Sample Group</li>
                    <li style={{ paddingLeft: 20 }}>
                      <ul style={{ listStyle: 'none' }}>
                        <li>📊 Spreadsheet: request_info</li>
                        <li>📁 [REQ-001] Sample Request</li>
                        <li style={{ paddingLeft: 20 }}>
                          <ul style={{ listStyle: 'none' }}>
                            <li>📁 Attachments</li>
                            <li>📄 Posts and comments.txt</li>
                          </ul>
                        </li>
                      </ul>
                    </li>
                  </ul>
                )}
                {backupType === 'all' && (
                  <ul style={{ listStyle: 'none', paddingLeft: 20 }}>
                    <li>📁 [14007] Sample Group</li>
                    <li style={{ paddingLeft: 20 }}>
                      <ul style={{ listStyle: 'none' }}>
                        <li>📊 Spreadsheet: group_data (4 sheets)</li>
                        <li>📁 [REQ-001] Request</li>
                        <li style={{ paddingLeft: 20 }}>
                          <ul style={{ listStyle: 'none' }}>
                            <li>📁 Attachments</li>
                            <li>📄 Posts.txt</li>
                          </ul>
                        </li>
                      </ul>
                    </li>
                  </ul>
                )}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>
                <FolderOutlined style={{ fontSize: 48, opacity: 0.3, marginBottom: 12 }} />
                <div style={{ fontSize: 13 }}>Select a backup type to preview structure</div>
              </div>
            )}
          </Card>
        </Col>
      </Row>
    )
  }

  const renderRequestStep4 = () => (
    <div>
      <div style={{ marginBottom: 24 }}>
        <Space>
          <RocketOutlined style={{ fontSize: 24, color: '#059669' }} />
          <div>
            <Title level={4} style={{ margin: 0 }}>Review Configuration</Title>
            <Paragraph type="secondary">Verify your backup settings before starting</Paragraph>
          </div>
        </Space>
      </div>

      <Card title="Backup Configuration" style={{ marginBottom: 16 }}>
        <Row gutter={[16, 16]}>
          <Col span={12}>
            <div>
              <Text type="secondary">Application</Text>
              <div style={{ fontWeight: 600, marginTop: 4 }}>
                <InboxOutlined style={{ color: '#ea580c', marginRight: 6 }} />
                Request
              </div>
            </div>
          </Col>
          <Col span={12}>
            <div>
              <Text type="secondary">Domain</Text>
              <div style={{ fontWeight: 600, marginTop: 4 }}>
                request.{domain}
              </div>
            </div>
          </Col>
          <Col span={12}>
            <div>
              <Text type="secondary">Backup Type</Text>
              <div style={{ fontWeight: 600, marginTop: 4 }}>
                {backupType === 'structured' && <>< FileExcelOutlined style={{ color: '#0284c7', marginRight: 6 }} />Structured</>}
                {backupType === 'unstructured' && <><FolderOutlined style={{ color: '#d97706', marginRight: 6 }} />Unstructured</>}
                {backupType === 'all' && <><DatabaseOutlined style={{ color: '#7c3aed', marginRight: 6 }} />Complete</>}
              </div>
            </div>
          </Col>
          <Col span={12}>
            <div>
              <Text type="secondary">Storage</Text>
              <div style={{ fontWeight: 600, marginTop: 4 }}>
                {storageDestination === 'gsheets' && <><FileExcelOutlined style={{ color: '#10b981', marginRight: 6 }} />Google Sheets</>}
                {storageDestination === 'gdrive' && <><GoogleOutlined style={{ color: '#4285f4', marginRight: 6 }} />Google Drive</>}
              </div>
            </div>
          </Col>
        </Row>
      </Card>

      <Card title="Data Pipeline" style={{ marginBottom: 16 }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 16,
          background: '#f8fafc',
          borderRadius: 8
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              <InboxOutlined style={{ color: '#ea580c', marginRight: 8 }} />
              Request API
            </div>
            <Text type="secondary" style={{ fontSize: 12 }}>Source data from Request</Text>
          </div>

          <div style={{ fontSize: 24, color: '#3b82f6' }}>→</div>

          <div style={{ flex: 1, textAlign: 'right' }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              {storageDestination === 'gsheets' ? (
                <><FileExcelOutlined style={{ color: '#10b981', marginRight: 8 }} />Google Sheets</>
              ) : (
                <><GoogleOutlined style={{ color: '#4285f4', marginRight: 8 }} />Google Drive</>
              )}
            </div>
            <div style={{ fontSize: 12 }}>
              <CheckOutlined style={{ color: '#059669', marginRight: 4 }} />
              Connected: {googleAuth?.email}
            </div>
          </div>
        </div>
      </Card>

      <Alert
        message={
          <div>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Ready to Start Backup!</div>
            <div>All configuration is complete. Click "Start Backup" to begin the backup process.</div>
          </div>
        }
        type="info"
        showIcon
        icon={<RocketOutlined />}
      />
    </div>
  )

  const renderGenericStep2 = () => (
    <div>
      <div style={{ marginBottom: 24 }}>
        <Space>
          <div style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: currentApp.bg,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            {currentApp.icon}
          </div>
          <div>
            <Title level={4} style={{ margin: 0 }}>Choose Objects</Title>
            <Paragraph type="secondary">
              Select which <strong>{currentApp.name}</strong> objects to include in the backup
            </Paragraph>
          </div>
        </Space>
      </div>

      <Card
        style={{ marginBottom: 14, cursor: 'pointer' }}
        onClick={handleSelectAllObjects}
        styles={{ body: { padding: '12px 16px' } }}
      >
        <Space>
          <Checkbox checked={selectedObjects.length === currentApp.objects.length} />
          <div>
            <Text strong>Select All Objects</Text>
            <Text type="secondary" style={{ marginLeft: 8 }}>
              ({currentApp.objects.length} objects)
            </Text>
          </div>
        </Space>
      </Card>

      <Space direction="vertical" style={{ width: '100%' }} size={9}>
        {currentApp.objects.map(obj => (
          <Card
            key={obj}
            hoverable
            onClick={() => handleObjectToggle(obj)}
            style={{
              border: selectedObjects.includes(obj) ? `2px solid ${currentApp.color}` : '1px solid #d9d9d9',
              backgroundColor: selectedObjects.includes(obj) ? currentApp.bg : '#fff',
              cursor: 'pointer'
            }}
            styles={{ body: { padding: '12px 16px' } }}
          >
            <Space>
              <Checkbox checked={selectedObjects.includes(obj)} />
              <div>
                <div style={{ fontWeight: 600 }}>{currentApp.objectLabels[obj]}</div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {currentApp.name} › {currentApp.objectLabels[obj]}
                </Text>
              </div>
            </Space>
          </Card>
        ))}
      </Space>
    </div>
  )

  const renderGenericStep3 = () => (
    <div>
      <div style={{ marginBottom: 24 }}>
        <Title level={4} style={{ marginBottom: 4 }}>Enter Access Token</Title>
        <Paragraph type="secondary">
          Provide your <strong>{currentApp.name}</strong> API access token to authenticate
        </Paragraph>
      </div>

      <Alert
        message="Your access token is used only for this backup session and is never stored on our servers."
        type="warning"
        showIcon
        style={{ marginBottom: 24 }}
      />

      <Form layout="vertical">
        <Form.Item
          label={<><LockOutlined style={{ color: '#f59e0b', marginRight: 6 }} />API Access Token</>}
          required
        >
          <Password
            placeholder="Paste your access token here…"
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            iconRender={visible => (visible ? <EyeOutlined /> : <EyeInvisibleOutlined />)}
            size="large"
          />
          <Text type="secondary" style={{ fontSize: 12 }}>
            You can find your access token in <strong>{currentApp.name}</strong> → Settings → API Keys
          </Text>
        </Form.Item>
      </Form>

      <Alert
        message={
          <div>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Secure Connection</div>
            <div>All data transfers are encrypted with TLS 1.3. Your credentials are processed in-memory only.</div>
          </div>
        }
        type="success"
        showIcon
        icon={<SafetyOutlined />}
      />
    </div>
  )

  const renderGenericStep4 = () => {
    const availableFields = getAvailableFields()
    const fieldsByObject = availableFields.reduce((acc, field) => {
      if (!acc[field.object]) acc[field.object] = []
      acc[field.object].push(field)
      return acc
    }, {})

    const specialFields = availableFields.filter(f =>
      selectedFieldIds.includes(f.id) && (f.type === 'input-table' || f.type === 'select-master')
    )

    return (
      <div>
        <div style={{ marginBottom: 24 }}>
          <Title level={4} style={{ marginBottom: 4 }}>Custom Fields & Configuration</Title>
          <Paragraph type="secondary">
            Select which custom fields to include in the backup for <strong>{currentApp.name}</strong>
          </Paragraph>
        </div>

        {availableFields.length > 0 && (
          <>
            <Card
              style={{ marginBottom: 16, cursor: 'pointer' }}
              onClick={handleSelectAllFields}
              styles={{ body: { padding: '12px 16px' } }}
            >
              <Space>
                <Checkbox checked={selectedFieldIds.length === availableFields.length} />
                <div>
                  <Text strong>Select All Custom Fields</Text>
                  <Text type="secondary" style={{ marginLeft: 8 }}>
                    ({availableFields.length} fields)
                  </Text>
                </div>
              </Space>
            </Card>

            {Object.entries(fieldsByObject).map(([objKey, fields]) => (
              <div key={objKey} style={{ marginBottom: 16 }}>
                <div style={{
                  fontSize: 12,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  color: '#64748b',
                  marginBottom: 8,
                  paddingLeft: 4
                }}>
                  {currentApp.objectLabels[objKey]}
                </div>

                <Space direction="vertical" style={{ width: '100%' }} size={8}>
                  {fields.map(field => (
                    <Card
                      key={field.id}
                      hoverable
                      onClick={() => handleFieldToggle(field.id)}
                      style={{
                        border: selectedFieldIds.includes(field.id) ? `2px solid ${currentApp.color}` : '1px solid #d9d9d9',
                        backgroundColor: selectedFieldIds.includes(field.id) ? currentApp.bg : '#fff',
                        cursor: 'pointer'
                      }}
                      styles={{ body: { padding: '10px 14px' } }}
                    >
                      <Space align="start">
                        <Checkbox checked={selectedFieldIds.includes(field.id)} />
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                            <Text strong style={{ fontSize: 13 }}>{field.name}</Text>
                            <Tag style={{ margin: 0, fontSize: 10 }}>{field.type}</Tag>
                          </div>
                          <Text type="secondary" style={{ fontSize: 12 }}>{field.desc}</Text>
                        </div>
                      </Space>
                    </Card>
                  ))}
                </Space>
              </div>
            ))}
          </>
        )}

        <Divider />

        <Card title="Backup Summary" style={{ marginBottom: 16 }}>
          <Row gutter={[16, 16]}>
            <Col span={12}>
              <Text type="secondary">Application</Text>
              <div style={{ fontWeight: 600, marginTop: 4 }}>
                {currentApp.icon} {currentApp.name}
              </div>
            </Col>
            <Col span={12}>
              <Text type="secondary">Objects</Text>
              <div style={{ marginTop: 4 }}>
                <Space size={4} wrap>
                  {selectedObjects.map(obj => (
                    <Tag key={obj} color={currentApp.color}>
                      {currentApp.objectLabels[obj]}
                    </Tag>
                  ))}
                </Space>
              </div>
            </Col>
            <Col span={12}>
              <Text type="secondary">Access Token</Text>
              <div style={{ fontWeight: 600, marginTop: 4, fontFamily: 'monospace' }}>
                {accessToken ? '••••••••' + accessToken.slice(-4) : <Text type="danger">Not provided</Text>}
              </div>
            </Col>
            <Col span={12}>
              <Text type="secondary">Custom Fields</Text>
              <div style={{ fontWeight: 700, marginTop: 4 }}>{selectedFieldIds.length} selected</div>
            </Col>
          </Row>
        </Card>

        {specialFields.length > 0 && (
          <Card title="Export Format for Structured Fields" style={{ marginBottom: 16 }}>
            <Paragraph type="secondary" style={{ marginBottom: 16 }}>
              Choose export format for fields with structured data types
            </Paragraph>

            <Space direction="vertical" style={{ width: '100%' }} size={12}>
              {specialFields.map(field => (
                <div key={field.id} style={{ border: '1px solid #d9d9d9', borderRadius: 8, padding: 16 }}>
                  <div style={{ marginBottom: 12 }}>
                    <Space>
                      <Text strong>{field.name}</Text>
                      <Tag>{field.type}</Tag>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {currentApp.objectLabels[field.object]}
                      </Text>
                    </Space>
                  </div>

                  <Row gutter={10}>
                    <Col span={12}>
                      <Card
                        hoverable
                        onClick={() => setExportFormats({ ...exportFormats, [field.id]: 'json' })}
                        style={{
                          border: exportFormats[field.id] === 'json' ? '2px solid #3b82f6' : '1px solid #d9d9d9',
                          cursor: 'pointer'
                        }}
                        styles={{ body: { padding: 12 } }}
                      >
                        <Space>
                          <span style={{ fontSize: 20 }}>📄</span>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: 13 }}>JSON</div>
                            <Text type="secondary" style={{ fontSize: 11 }}>Structured data format</Text>
                          </div>
                          {exportFormats[field.id] === 'json' && <CheckOutlined style={{ color: '#3b82f6' }} />}
                        </Space>
                      </Card>
                    </Col>
                    <Col span={12}>
                      <Card
                        hoverable
                        onClick={() => setExportFormats({ ...exportFormats, [field.id]: 'excel' })}
                        style={{
                          border: exportFormats[field.id] === 'excel' ? '2px solid #3b82f6' : '1px solid #d9d9d9',
                          cursor: 'pointer'
                        }}
                        styles={{ body: { padding: 12 } }}
                      >
                        <Space>
                          <span style={{ fontSize: 20 }}>📊</span>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: 13 }}>Excel (.xlsx)</div>
                            <Text type="secondary" style={{ fontSize: 11 }}>Spreadsheet format</Text>
                          </div>
                          {exportFormats[field.id] === 'excel' && <CheckOutlined style={{ color: '#3b82f6' }} />}
                        </Space>
                      </Card>
                    </Col>
                  </Row>
                </div>
              ))}
            </Space>
          </Card>
        )}

        <Alert
          message={
            <div>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Ready to Start Backup!</div>
              <div>All configuration is complete. Click "Start Backup" to begin.</div>
            </div>
          }
          type="info"
          showIcon
          icon={<RocketOutlined />}
        />
      </div>
    )
  }

  // Render list of backup flows
  const APP_META = {
    request:  { color: '#ea580c', icon: <InboxOutlined /> },
    workflow: { color: '#7c3aed', icon: <ProjectOutlined /> },
    wework:   { color: '#2563eb', icon: <BankOutlined /> },
    service:  { color: '#059669', icon: <CustomerServiceOutlined /> },
  }

  const BACKUP_TYPE_TAG = {
    structured:   { color: 'blue',   label: 'Structured' },
    unstructured: { color: 'orange', label: 'Unstructured' },
    all:          { color: 'purple', label: 'Complete' },
  }

  const handleDeleteFlow = (record) => {
    Modal.confirm({
      title: 'Delete Backup Flow',
      content: `Are you sure you want to delete "${record.name || 'Draft'}"?`,
      okText: 'Delete',
      okType: 'danger',
      cancelText: 'Cancel',
      onOk: async () => {
        try {
          await axios.delete(`${API_BASE}/api/backup-flows/${record.id}`)
          message.success('Backup flow deleted')
          fetchFlows()
        } catch (err) {
          message.error('Failed to delete')
        }
      }
    })
  }

  const handlePublishFlow = async (record) => {
    try {
      await axios.post(`${API_BASE}/api/backup-flows/${record.id}/publish`)
      message.success('Flow published!')
      fetchFlows()
    } catch (err) {
      message.error('Failed to publish')
    }
  }

  const renderListView = () => {
    const columns = [
      {
        title: 'App',
        key: 'app',
        width: 180,
        render: (_, record) => {
          const meta = APP_META[record.app] || { color: '#64748b', icon: <CloudOutlined /> }
          return (
            <Space>
              <div style={{
                width: 32, height: 32, borderRadius: 8,
                background: `${meta.color}18`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 16, color: meta.color, flexShrink: 0
              }}>
                {meta.icon}
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>
                  {record.app_name || <Text type="secondary">—</Text>}
                </div>
                <Text type="secondary" style={{ fontSize: 11 }}>
                  {record.name || 'Draft chưa đặt tên'}
                </Text>
              </div>
            </Space>
          )
        }
      },
      {
        title: 'Backup Type',
        key: 'backup_type',
        width: 140,
        render: (_, record) => {
          if (!record.backup_type) return <Text type="secondary">—</Text>
          const t = BACKUP_TYPE_TAG[record.backup_type] || { color: 'default', label: record.backup_type }
          return <Tag color={t.color}>{t.label}</Tag>
        }
      },
      {
        title: 'Destination',
        key: 'destination',
        width: 170,
        render: (_, record) => {
          if (!record.destination_name) return <Text type="secondary">—</Text>
          return (
            <Space>
              {record.destination_type === 'gsheets'
                ? <FileExcelOutlined style={{ color: '#10b981' }} />
                : <GoogleOutlined style={{ color: '#4285f4' }} />
              }
              <Text>{record.destination_name}</Text>
            </Space>
          )
        }
      },
      {
        title: 'Status',
        key: 'publish_status',
        width: 160,
        render: (_, record) => (
          <Space size={4}>
            {record.is_draft === 1
              ? <Tag color="gold">Draft</Tag>
              : <Tag color="cyan">Ready</Tag>
            }
            {record.is_published === 1
              ? <Tag color="green">Published</Tag>
              : <Tag color="default">Unpublished</Tag>
            }
          </Space>
        )
      },
      {
        title: 'Last Run',
        key: 'last_run',
        width: 160,
        render: (_, record) => record.last_run_at
          ? <Text type="secondary" style={{ fontSize: 12 }}>{record.last_run_at}</Text>
          : <Text type="secondary" style={{ fontSize: 12 }}>Never run</Text>
      },
      {
        title: 'Actions',
        key: 'actions',
        fixed: 'right',
        width: 200,
        render: (_, record) => (
          <Space size={4} wrap>
            {record.is_published === 0 && (
              <Button
                size="small"
                type="primary"
                ghost
                icon={<RocketOutlined />}
                onClick={() => handlePublishFlow(record)}
              >
                Publish
              </Button>
            )}
            <Button
              size="small"
              icon={<EditOutlined />}
              onClick={() => loadFlowForEdit(record.id)}
            >
              Edit
            </Button>
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={() => handleDeleteFlow(record)}
            />
          </Space>
        )
      }
    ]

    return (
      <>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <Title level={2} style={{ margin: 0 }}>Backup Flows</Title>
            <Paragraph type="secondary" style={{ margin: '4px 0 0 0' }}>
              Manage and monitor your backup configurations
            </Paragraph>
          </div>
          <Button
            type="primary"
            size="large"
            icon={<PlusOutlined />}
            onClick={async () => {
              try {
                const res = await axios.post(`${API_BASE}/api/backup-flows/draft`, {})
                setDraftFlowId(res.data.id)
                message.success('Draft created')
              } catch (err) {
                message.error('Failed to create draft. Is the backend running?')
                console.error(err)
                return
              }
              setViewMode('create')
            }}
          >
            New Backup Flow
          </Button>
        </div>

        <Card>
          <Table
            dataSource={flows}
            columns={columns}
            rowKey="id"
            loading={loadingFlows}
            scroll={{ x: 900 }}
            pagination={{
              pageSize: 10,
              showTotal: (total) => `Total ${total} flows`
            }}
            locale={{ emptyText: 'No backup flows yet. Click "New Backup Flow" to create one.' }}
          />
        </Card>
      </>
    )
  }

  // Render create/edit backup wizard
  const renderCreateView = () => {
    const isEdit = viewMode === 'edit'
    return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Title level={2} style={{ margin: 0 }}>
          {isEdit ? 'Edit Backup Flow' : 'Create Backup Flow'}
        </Title>
        <Button
          icon={<ArrowLeftOutlined />}
          onClick={() => {
            setViewMode('list')
            setCurrentStep(0)
            setSelectedApp(null)
            setFlowName('')
            setDraftFlowId(null)
            setEditFlowId(null)
          }}
        >
          Back to List
        </Button>
      </div>

      <Card>
        <Steps current={currentStep} items={steps} style={{ marginBottom: 32 }} />

        <div style={{ minHeight: 300, marginBottom: 24 }}>
          {renderStepContent()}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <Button disabled={currentStep === 0} onClick={prev}>
            Previous
          </Button>
          <div style={{ display: 'flex', gap: 8 }}>
            {currentStep < totalSteps - 1 && (
              <Button type="primary" onClick={next}>
                Continue
              </Button>
            )}
            {currentStep === totalSteps - 1 && (
              <Button type="primary" size="large" icon={isEdit ? <EditOutlined /> : <RocketOutlined />} onClick={handleFinish}>
                {isEdit ? 'Save Changes' : 'Create Backup Flow'}
              </Button>
            )}
          </div>
        </div>
      </Card>
    </>
  )}

  const renderStepContent = () => {
    if (isRequestApp) {
      switch (currentStep) {
        case 0: return renderStep1()
        case 1: return renderRequestStep2()
        case 2: return renderRequestStep3()
        case 3: return renderRequestStep4()
        default: return null
      }
    } else {
      switch (currentStep) {
        case 0: return renderStep1()
        case 1: return renderGenericStep2()
        case 2: return renderGenericStep3()
        case 3: return renderGenericStep4()
        default: return null
      }
    }
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sidebar collapsed={collapsed} />
      <Layout style={{ marginLeft: collapsed ? 80 : 240, transition: 'all 0.2s' }}>
        <Topbar collapsed={collapsed} toggleCollapsed={() => setCollapsed(!collapsed)} />
        <Content style={{ margin: 24 }}>
          {viewMode === 'list' ? renderListView() : renderCreateView()}
        </Content>
      </Layout>

      {/* Google Folder Picker Modal */}
      <Modal
        title={
          <Space>
            <GoogleOutlined style={{ color: '#4285f4' }} />
            Select Google Drive Folder
          </Space>
        }
        open={googleFolderModal}
        onCancel={() => setGoogleFolderModal(false)}
        footer={[
          <Button key="cancel" onClick={() => setGoogleFolderModal(false)}>Cancel</Button>,
          <Button key="select-here" type="primary" icon={<FolderOutlined />} onClick={handleSelectCurrentFolder}>
            Select Current Location
          </Button>
        ]}
        width={560}
      >
        {/* Drive selector */}
        {loadingDrives ? (
          <div style={{ textAlign: 'center', padding: 24 }}>Loading drives...</div>
        ) : (
          <Space direction="vertical" style={{ width: '100%' }} size={12}>
            {drives.length > 1 && (
              <Select
                value={currentDriveId}
                onChange={(val) => handleDriveChange(val)}
                style={{ width: '100%' }}
                options={drives.map(d => ({ value: d.id, label: d.name }))}
              />
            )}

            {/* Breadcrumb */}
            <div style={{
              background: '#f8fafc',
              borderRadius: 6,
              padding: '6px 10px',
              fontSize: 12,
              display: 'flex',
              flexWrap: 'wrap',
              gap: 4,
              alignItems: 'center'
            }}>
              {folderPath.map((item, idx) => (
                <span key={item.id}>
                  {idx > 0 && <span style={{ color: '#94a3b8', margin: '0 4px' }}>/</span>}
                  <span
                    style={{
                      color: idx === folderPath.length - 1 ? '#0f172a' : '#3b82f6',
                      cursor: idx === folderPath.length - 1 ? 'default' : 'pointer',
                      fontWeight: idx === folderPath.length - 1 ? 600 : 400
                    }}
                    onClick={() => idx < folderPath.length - 1 && handleBreadcrumbNav(idx)}
                  >
                    {item.name}
                  </span>
                </span>
              ))}
            </div>

            {/* Folder list */}
            <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 8 }}>
              {loadingFolders ? (
                <div style={{ textAlign: 'center', padding: 32, color: '#94a3b8' }}>Loading folders...</div>
              ) : folders.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 32, color: '#94a3b8' }}>
                  <FolderOutlined style={{ fontSize: 32, opacity: 0.4, display: 'block', margin: '0 auto 8px' }} />
                  No sub-folders here
                </div>
              ) : (
                folders.map(folder => (
                  <div
                    key={folder.id}
                    onClick={() => handleOpenSubFolder(folder)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '10px 14px',
                      cursor: 'pointer',
                      borderBottom: '1px solid #f1f5f9',
                      transition: 'background 0.15s'
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <FolderOutlined style={{ color: '#f59e0b', fontSize: 18 }} />
                    <span style={{ flex: 1, fontSize: 13 }}>{folder.name}</span>
                    <span style={{ color: '#94a3b8', fontSize: 12 }}>›</span>
                  </div>
                ))
              )}
            </div>
          </Space>
        )}
      </Modal>

      {/* Destination Selection Modal */}      <Modal
        title="Select Destination"
        open={showDestinationModal}
        onCancel={() => {
          setShowDestinationModal(false)
          setDestinationSearch('')
        }}
        footer={[
          <Button key="cancel" onClick={() => {
            setShowDestinationModal(false)
            setDestinationSearch('')
          }}>
            Cancel
          </Button>
        ]}
        width={800}
      >
        <div style={{ marginBottom: 16 }}>
          <Paragraph type="secondary">Choose where to store your backup data</Paragraph>
        </div>

        <Input
          placeholder="Search destinations..."
          value={destinationSearch}
          onChange={(e) => setDestinationSearch(e.target.value)}
          size="large"
          style={{ marginBottom: 16 }}
          prefix={<CloudOutlined style={{ color: '#94a3b8' }} />}
        />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
          {[
            { id: 'gsheets', name: 'Google Sheets', icon: <FileExcelOutlined />, color: '#10b981', types: ['structured'], disabled: false },
            { id: 'gdrive', name: 'Google Drive', icon: <GoogleOutlined />, color: '#4285f4', types: ['unstructured', 'all'], disabled: false },
            // Hidden for now - coming soon
            // { id: 'onedrive', name: 'OneDrive', icon: <CloudOutlined />, color: '#0078d4', types: ['unstructured', 'all'], disabled: true },
            // { id: 'dropbox', name: 'Dropbox', icon: <CloudOutlined />, color: '#0061ff', types: ['unstructured', 'all'], disabled: true },
            // { id: 'box', name: 'Box', icon: <CloudOutlined />, color: '#0061d5', types: ['unstructured', 'all'], disabled: true },
            // { id: 's3', name: 'Amazon S3', icon: <CloudOutlined />, color: '#ff9900', types: ['unstructured', 'all'], disabled: true }
          ]
            .filter(opt => !backupType || opt.types.includes(backupType))
            .filter(opt => opt.name.toLowerCase().includes(destinationSearch.toLowerCase()))
            .filter(opt => !opt.disabled) // Only show enabled options
            .map(opt => (
              <Card
                key={opt.id}
                hoverable
                onClick={() => {
                  setStorageDestination(opt.id)
                  setGoogleAuth(null)
                  setShowDestinationModal(false)
                  setDestinationSearch('')
                }}
                style={{
                  border: '2px solid #e2e8f0',
                  background: '#fff',
                  cursor: 'pointer',
                  textAlign: 'center'
                }}
                styles={{ body: { padding: 16 } }}
              >
                <div style={{ fontSize: 32, color: opt.color, marginBottom: 10 }}>
                  {opt.icon}
                </div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#0f172a', marginBottom: 2 }}>
                  {opt.name}
                </div>
              </Card>
            ))}
        </div>
      </Modal>
    </Layout>
  )
}

export default Backup
