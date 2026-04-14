import React, { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import { Layout, Card, Steps, Button, Checkbox, Form, Input, Select, message, Space, Tag, Alert, Modal, Tree, Row, Col, Typography, Divider, Table, Spin, Empty, Tooltip, Drawer, Tabs, Descriptions, Progress } from 'antd'
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
  WarningOutlined,
  RocketOutlined,
  PlusOutlined,
  ArrowLeftOutlined,
  PlayCircleOutlined,
  EditOutlined,
  DeleteOutlined,
  ClockCircleOutlined,
  ReloadOutlined
} from '@ant-design/icons'
import Sidebar from '@packages/ui/src/components/layout/Sidebar'
import Topbar from '@packages/ui/src/components/layout/Topbar'

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
    isSpecial: true
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

const APP_CONNECTION_CONFIG = {
  service: {
    stepTitle: 'Connection Information',
    stepDescription: 'Provide the Service domain and Base Account token used for backup access.',
    requiresDomain: true,
    domainLabel: 'Base Domain',
    domainPlaceholder: 'base.com.vn',
    domainHelp: 'Enter base.com.vn, service.base.com.vn, or a full Service URL. The backend will normalize it.',
    tokenLabel: 'Access Token V2',
    tokenPlaceholder: 'Paste your Base Account access_token_v2 here�',
    tokenHelp: 'Get this value from Service ? Settings ? API Keys. Use the Base Account access_token_v2 token.',
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

const API_BASE = 'http://localhost:8000'
const DEFAULT_GOOGLE_REDIRECT = 'http://localhost:8000/api/google/callback'
const SERVICE_ACCOUNT_SHARED_DRIVE_MESSAGE = 'This folder is shared with the service account, but it still belongs to regular My Drive, not a Shared Drive. Google service accounts can browse directly shared My Drive folders, but they cannot upload backup files there because they have no storage quota. Choose a folder inside a Shared Drive or switch this destination to OAuth User authentication.'

const BackupFlowPage = () => {
  const [collapsed, setCollapsed] = useState(false)
  const [viewMode, setViewMode] = useState('list')
  const [currentStep, setCurrentStep] = useState(0)
  const [draftFlowId, setDraftFlowId] = useState(null)
  const [editFlowId, setEditFlowId] = useState(null)
  const [flowName, setFlowName] = useState('')

  // List state
  const [flows, setFlows] = useState([])
  const [loadingFlows, setLoadingFlows] = useState(false)
  const [detailsDrawerOpen, setDetailsDrawerOpen] = useState(false)
  const [detailsActiveTab, setDetailsActiveTab] = useState('overview')
  const [detailsFlowId, setDetailsFlowId] = useState(null)
  const [detailsFlowRecord, setDetailsFlowRecord] = useState(null)
  const [detailsFlow, setDetailsFlow] = useState(null)
  const [detailsRuns, setDetailsRuns] = useState([])
  const [loadingFlowDetails, setLoadingFlowDetails] = useState(false)

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
      setGoogleAuthMethod('oauth')
      setGoogleAuth(null)
      setSelectedObjects([])
      setAccessToken('')
      setSelectedFieldIds([])
      setExportFormats({})
      setServicePreview(null)
      setSelectedServiceIds([])
      setShowAppSelectionModal(false)
      setServiceSourceSetupSaved(false)
      setServiceBackupSetupSaved(false)
      setServiceAccountAnalysis(null)
      setServiceAccountFileName('')
      setServiceAccountError('')

      const src = f.source || {}
      const dest = f.destination || {}
      const struct = f.structure || {}

      if (f.name) setFlowName(f.name)
      if (src.app) setSelectedApp(src.app)

      if (src.app === 'request') {
        if (src.domain) setDomain(src.domain)
        if (src.access_token) setAccessTokenV2(src.access_token)
        if (f.backup_type) setBackupType(f.backup_type)
        if (dest.type) setStorageDestination(dest.type)
        const auth = dest.auth || {}
        if (auth.auth_method === 'service_account' || auth.service_account_json_encrypted) {
          setGoogleAuthMethod('service_account')
          setGoogleAuth({
            auth_method: 'service_account',
            service_account_email: auth.service_account_email || auth.client_email || '',
            email: auth.service_account_email || auth.client_email || '',
            display_name: auth.service_account_email || auth.client_email || 'Service Account',
            picture_url: '',
            folder_id: auth.folder_id || null,
            folder_name: auth.folder_name || (auth.folder_id ? 'Saved folder' : null),
            drive_id: auth.drive_id || null,
            drive_name: auth.drive_name || null,
            project_id: auth.project_id || null,
            service_account_json_encrypted: auth.service_account_json_encrypted || null,
          })
          setServiceAccountAnalysis({
            auth_method: 'service_account',
            client_email: auth.service_account_email || auth.client_email || '',
            project_id: auth.project_id || '',
            drives: [],
          })
          setServiceAccountFileName(auth.service_account_file_name || 'saved-service-account.json')
        } else if (auth.connection_id) {
          setGoogleAuth({
            auth_method: 'oauth',
            connection_id: auth.connection_id,
            email: auth.email || '',
            display_name: auth.email || '',
            picture_url: '',
            folder_id: auth.folder_id || null,
            folder_name: auth.folder_id ? 'Saved folder' : null,
            drive_id: auth.drive_id || null,
            drive_name: auth.drive_name || null,
          })
        }
      } else {
        if (src.app === 'service' && src.domain) setDomain(src.domain)
        if (f.backup_type) setBackupType(f.backup_type)
        if (dest.type) setStorageDestination(dest.type)
        if (src.access_token) setAccessToken(src.access_token)
        const objs = struct.objects
        if (Array.isArray(objs)) setSelectedObjects(objs)
        const fields = struct.custom_fields
        if (Array.isArray(fields)) setSelectedFieldIds(fields)
        const fmts = struct.export_formats
        if (fmts && typeof fmts === 'object') setExportFormats(fmts)
        if (Array.isArray(struct.service_ids)) setSelectedServiceIds(struct.service_ids)
        const auth = dest.auth || {}
        if (auth.auth_method === 'service_account' || auth.service_account_json_encrypted) {
          setGoogleAuthMethod('service_account')
          setGoogleAuth({
            auth_method: 'service_account',
            service_account_email: auth.service_account_email || auth.client_email || '',
            email: auth.service_account_email || auth.client_email || '',
            display_name: auth.service_account_email || auth.client_email || 'Service Account',
            picture_url: '',
            folder_id: auth.folder_id || null,
            folder_name: auth.folder_name || (auth.folder_id ? 'Saved folder' : null),
            drive_id: auth.drive_id || null,
            drive_name: auth.drive_name || null,
            project_id: auth.project_id || null,
            service_account_json_encrypted: auth.service_account_json_encrypted || null,
          })
          setServiceAccountAnalysis({
            auth_method: 'service_account',
            client_email: auth.service_account_email || auth.client_email || '',
            project_id: auth.project_id || '',
            drives: [],
          })
          setServiceAccountFileName(auth.service_account_file_name || 'saved-service-account.json')
        } else if (auth.connection_id) {
          setGoogleAuthMethod('oauth')
          setGoogleAuth({
            auth_method: 'oauth',
            connection_id: auth.connection_id,
            email: auth.email || '',
            display_name: auth.display_name || auth.email || '',
            picture_url: auth.picture_url || '',
            folder_id: auth.folder_id || null,
            folder_name: auth.folder_name || (auth.folder_id ? 'Saved folder' : null),
            drive_id: auth.drive_id || null,
            drive_name: auth.drive_name || null,
          })
        }

        if (src.app === 'service' && src.domain && src.access_token) {
          setServiceSourceSetupSaved(true)
        }
        if (src.app === 'service' && f.backup_type && dest.type && auth && (auth.connection_id || auth.service_account_json_encrypted || auth.service_account_email)) {
          setServiceBackupSetupSaved(true)
        }
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
  const [googleAuthMethod, setGoogleAuthMethod] = useState('oauth')
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
  const [sharedFolders, setSharedFolders] = useState([])
  const [loadingSharedFolders, setLoadingSharedFolders] = useState(false)
  const [sharedFolderQuery, setSharedFolderQuery] = useState('')
  const [sharedFolderReference, setSharedFolderReference] = useState('')
  const [resolvingSharedFolder, setResolvingSharedFolder] = useState(false)
  
  // Generic workflow states
  const [selectedObjects, setSelectedObjects] = useState([])
  const [accessToken, setAccessToken] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [selectedFieldIds, setSelectedFieldIds] = useState([])
  const [exportFormats, setExportFormats] = useState({}) // { fieldId: 'json' | 'excel' }
  const [servicePreview, setServicePreview] = useState(null)
  const [loadingServicePreview, setLoadingServicePreview] = useState(false)
  const [selectedServiceIds, setSelectedServiceIds] = useState([])
  const [showAppSelectionModal, setShowAppSelectionModal] = useState(false)
  const [serviceSourceSetupSaved, setServiceSourceSetupSaved] = useState(false)
  const [serviceBackupSetupSaved, setServiceBackupSetupSaved] = useState(false)
  const [serviceSelectorModalOpen, setServiceSelectorModalOpen] = useState(false)
  const [draftSelectedServiceIds, setDraftSelectedServiceIds] = useState([])
  const [serviceAccountAnalysis, setServiceAccountAnalysis] = useState(null)
  const [serviceAccountAnalysisLoading, setServiceAccountAnalysisLoading] = useState(false)
  const [serviceAccountFileName, setServiceAccountFileName] = useState('')
  const [serviceAccountError, setServiceAccountError] = useState('')
  const [googleConfigModalOpen, setGoogleConfigModalOpen] = useState(false)
  const [googleConfigLoading, setGoogleConfigLoading] = useState(false)
  const [googleConfigSaving, setGoogleConfigSaving] = useState(false)
  const [googleSecretSet, setGoogleSecretSet] = useState(false)
  const [googleRedirectUri, setGoogleRedirectUri] = useState(DEFAULT_GOOGLE_REDIRECT)
  const [googleConfigError, setGoogleConfigError] = useState('')
  const [googleConfigForm] = Form.useForm()
  const servicePreviewListRef = useRef(null)
  const shouldResetServicePreviewScrollRef = useRef(false)

  // Get current app data
  const currentApp = selectedApp ? APPS[selectedApp] : null
  const isRequestApp = currentApp?.isSpecial
  const isServiceApp = currentApp?.id === 'service'
  const usesCondensedServiceWizard = isServiceApp || (!selectedApp && viewMode !== 'list')
  const connectionConfig = selectedApp ? APP_CONNECTION_CONFIG[selectedApp] : null
  const hasServiceAccountStep = googleAuthMethod === 'service_account'
  const resolvedGoogleAuthMethod = googleAuth?.auth_method || googleAuthMethod
  const isServiceAccountDestinationAuth = resolvedGoogleAuthMethod === 'service_account'
    || Boolean(googleAuth?.service_account_json)
    || Boolean(googleAuth?.service_account_json_encrypted)
  const totalSteps = usesCondensedServiceWizard ? 3 : (hasServiceAccountStep ? 5 : 4)

  // Define steps based on app type
  const getStepLabels = () => {
    if (usesCondensedServiceWizard) {
      return [
        { title: 'App & Objects', icon: <CloudOutlined /> },
        { title: 'Backup Setup', icon: <DatabaseOutlined /> },
        { title: 'Review', icon: <CheckOutlined /> }
      ]
    }

    if (isRequestApp) {
      return [
        { title: 'Choose App', icon: <CloudOutlined /> },
        { title: 'Connection', icon: <ApiOutlined /> },
        { title: 'Backup Type', icon: <DatabaseOutlined /> },
        ...(hasServiceAccountStep ? [{ title: 'Service Account', icon: <ApiOutlined /> }] : []),
        { title: 'Review', icon: <CheckOutlined /> }
      ]
    } else if (isServiceApp) {
      return [
        { title: 'Choose App', icon: <CloudOutlined /> },
        { title: 'Objects', icon: <FolderOutlined /> },
        { title: 'Backup Setup', icon: <DatabaseOutlined /> },
        ...(hasServiceAccountStep ? [{ title: 'Service Account', icon: <ApiOutlined /> }] : []),
        { title: 'Source Review', icon: <CheckOutlined /> }
      ]
    } else {
      return [
        { title: 'Choose App', icon: <CloudOutlined /> },
        { title: 'Objects', icon: <FolderOutlined /> },
        { title: isServiceApp ? 'Connection' : 'Access Token', icon: <LockOutlined /> },
        { title: 'Config & Review', icon: <CheckOutlined /> }
      ]
    }
  }

  const steps = getStepLabels()
  const servicePreviewRows = Array.isArray(servicePreview?.services) ? servicePreview.services : []
  const servicePreviewRowMap = new Map(servicePreviewRows.map(item => [String(item.service_id), item]))
  const selectedServicesForFlow = selectedServiceIds
    .map(serviceId => servicePreviewRowMap.get(String(serviceId)) || {
      service_id: serviceId,
      service_name: `Service ${serviceId}`,
      detail_loaded: false,
    })
    .filter(Boolean)
  const serviceSelectionRowSelection = {
    selectedRowKeys: draftSelectedServiceIds,
    onChange: (keys) => setDraftSelectedServiceIds(keys)
  }
  const canSaveServiceSourceSetup = Boolean(
    flowName.trim()
    && selectedApp === 'service'
    && domain.trim()
    && accessToken.trim()
  )
  const canSaveServiceBackupSetup = Boolean(
    backupType
    && storageDestination
    && googleAuthMethod
    && (
      googleAuthMethod === 'oauth'
        ? (googleAuth?.connection_id || googleAuth?.email)
        : (googleAuth?.auth_method === 'service_account'
          || googleAuth?.service_account_json_encrypted
          || serviceAccountAnalysis?.client_email)
    )
  )

  const handleConfirmServiceSourceSetup = () => {
    if (!flowName.trim()) {
      message.warning('Please enter a name for this backup flow')
      return
    }
    if (selectedApp !== 'service') {
      message.warning('Please choose Service as the application for this flow')
      return
    }
    if (!domain.trim() || !accessToken.trim()) {
      message.warning('Please provide Service domain and access token')
      return
    }

    setServiceSourceSetupSaved(true)
    message.success('Service source information saved')
  }

  const handleConfirmServiceBackupSetup = () => {
    if (!backupType || !storageDestination || !googleAuthMethod) {
      message.warning('Please choose backup type, destination, and authentication method')
      return
    }
    if (googleAuthMethod === 'oauth' && !googleAuth) {
      message.warning('Please connect a Google account first')
      return
    }
    if (googleAuthMethod === 'service_account' && (!googleAuth || googleAuth.auth_method !== 'service_account')) {
      message.warning('Please upload and analyze a Google service account JSON file first')
      return
    }

    setServiceBackupSetupSaved(true)
    message.success('Backup destination settings saved')
  }

  // Build partial autosave payload for the step just completed
  const buildAutosavePayload = (step) => {
    if (isServiceApp && totalSteps === 3) {
      if (step === 0) {
        return {
          name: flowName.trim() || undefined,
          source: selectedApp ? {
            app: selectedApp,
            app_name: currentApp?.name,
            domain,
            access_token: accessToken
          } : undefined,
          structure: { objects: selectedObjects }
        }
      }

      if (step === 1) {
        return {
          backup_type: backupType,
          destination: {
            type: storageDestination,
            name: storageDestination === 'gsheets' ? 'Google Sheets' : 'Google Drive',
            auth: buildGoogleDestinationAuth()
          }
        }
      }
    }

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
            auth: buildGoogleDestinationAuth()
          }
        }
      }
    } else {
      if (step === 1) {
        return { structure: { objects: selectedObjects } }
      }
      if (step === 2) {
        if (isServiceApp) {
          return {
            source: {
              app: selectedApp,
              app_name: currentApp?.name,
              domain,
              access_token: accessToken
            },
            backup_type: backupType,
            destination: {
              type: storageDestination,
              name: storageDestination === 'gsheets' ? 'Google Sheets' : 'Google Drive',
              auth: buildGoogleDestinationAuth()
            }
          }
        }
        return {
          source: {
            app: selectedApp,
            app_name: currentApp?.name,
            domain: isServiceApp ? domain : selectedApp,
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

    if (isServiceApp && totalSteps === 3) {
      if (currentStep === 0) {
        if (!domain || !accessToken) {
          message.warning('Please provide Service domain and access token')
          return
        }
        if (!serviceSourceSetupSaved) {
          message.warning('Please save the Service source information first')
          return
        }
        if (selectedObjects.length === 0) {
          message.warning('Please select at least one object')
          return
        }
      }

      if (currentStep === 1) {
        if (!backupType || !storageDestination || !googleAuthMethod) {
          message.warning('Please choose backup type, destination, and Google auth method')
          return
        }
        if (googleAuthMethod === 'oauth' && !googleAuth) {
          message.warning('Please connect with Google')
          return
        }
        if (googleAuthMethod === 'service_account' && (!googleAuth || googleAuth.auth_method !== 'service_account')) {
          message.warning('Please upload and analyze a Google service account JSON file')
          return
        }
        if (!serviceBackupSetupSaved) {
          message.warning('Please save the backup destination settings first')
          return
        }
      }
    } else if (isRequestApp) {
      if (currentStep === 1) {
        if (!domain || !accessTokenV2) {
          message.warning('Please provide domain and access token')
          return
        }
      }
      if (currentStep === 2) {
        if (!backupType || !storageDestination || !googleAuthMethod) {
          message.warning('Please select backup type, destination, and Google auth method')
          return
        }
        if (googleAuthMethod === 'oauth' && !googleAuth) {
          message.warning('Please connect with Google')
          return
        }
      }
      if (hasServiceAccountStep && currentStep === 3 && (!googleAuth || googleAuth.auth_method !== 'service_account')) {
        message.warning('Please upload and analyze a Google service account JSON file')
        return
      }
    } else {
      if (currentStep === 1 && selectedObjects.length === 0) {
        message.warning('Please select at least one object')
        return
      }
      if (currentStep === 2 && isServiceApp && (!domain || !accessToken || !backupType || !storageDestination || !googleAuthMethod)) {
        message.warning('Please provide Service credentials, backup type, destination, and Google auth method')
        return
      }
      if (currentStep === 2 && isServiceApp && googleAuthMethod === 'oauth' && !googleAuth) {
        message.warning('Please connect with Google')
        return
      }
      if (hasServiceAccountStep && currentStep === 3 && (!googleAuth || googleAuth.auth_method !== 'service_account')) {
        message.warning('Please upload and analyze a Google service account JSON file')
        return
      }
      if (currentStep === 2 && !isServiceApp && !accessToken) {
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

  const handleFinish = async (runAfterSave = false) => {
    if (!draftFlowId) {
      message.error('No draft flow found. Please try again.')
      return
    }

    if (hasServiceAccountStep && (!googleAuth || googleAuth.auth_method !== 'service_account')) {
      message.warning('Please upload and analyze a Google service account JSON file first')
      return
    }

    if (isServiceApp && !servicePreview) {
      message.warning('Please load the current Service source preview before saving this flow')
      return
    }

    if (isServiceApp && Array.isArray(servicePreview?.services) && servicePreview.services.length > 0 && selectedServiceIds.length === 0) {
      message.warning('Please select at least one Service for this test flow')
      return
    }

    if (runAfterSave) {
      const runBlockedReason = getGoogleDriveRunBlockedReason()
      if (runBlockedReason) {
        message.error(runBlockedReason)
        return
      }
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
        auth: buildGoogleDestinationAuth()
      },
      structure: { objects: ['group', 'request'] },
      updated_by: 'current_user'
    } : {
      name: flowName.trim() || undefined,
      source: {
        app: selectedApp,
        app_name: currentApp.name,
        domain: isServiceApp ? domain : selectedApp,
        access_token: accessToken
      },
      backup_type: isServiceApp ? backupType : 'all',
      destination: isServiceApp ? {
        type: storageDestination,
        name: storageDestination === 'gsheets' ? 'Google Sheets' : 'Google Drive',
        auth: buildGoogleDestinationAuth()
      } : {
        type: 'gdrive',
        name: 'Google Drive',
        auth: { email: 'user@gmail.com' }
      },
      structure: {
        objects: selectedObjects,
        custom_fields: selectedFieldIds,
        export_formats: exportFormats,
        ...(isServiceApp ? {
          service_ids: selectedServiceIds,
          include_catalog: true,
          include_stages: true,
          include_ticket_details: backupType === 'all',
          include_activity_logs: false
        } : {})
      },
      updated_by: 'current_user'
    }

    const isEdit = viewMode === 'edit'
    const actionLabel = runAfterSave
      ? (isEdit ? 'Saving changes and starting backup...' : 'Saving flow and starting backup...')
      : (isEdit ? 'Updating backup flow...' : 'Saving backup flow...')
    const successLabel = runAfterSave
      ? (isEdit ? 'Backup flow updated and started!' : 'Backup flow created and started!')
      : (isEdit ? 'Backup flow updated successfully!' : 'Backup flow created successfully!')
    let saveCompleted = false

    try {
      message.loading({ content: actionLabel, key: 'save' })
      await axios.post(`${API_BASE}/api/backup-flows/${draftFlowId}/save`, savePayload)
      saveCompleted = true
      if (runAfterSave) {
        await axios.post(`${API_BASE}/api/backup-flows/${draftFlowId}/run`)
      }
      message.success({ content: successLabel, key: 'save' })
    } catch (err) {
      const detail = err.response?.data?.detail
      const errorContent = runAfterSave && saveCompleted
        ? (detail || 'Backup flow was saved but could not be started.')
        : (detail || `Failed to ${isEdit ? 'update' : 'save'} backup flow.`)
      message.error({ content: errorContent, key: 'save' })
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
    setGoogleAuthMethod('oauth')
    setGoogleAuth(null)
    setSelectedObjects([])
    setAccessToken('')
    setSelectedFieldIds([])
    setExportFormats({})
    setServicePreview(null)
    setSelectedServiceIds([])
    setShowAppSelectionModal(false)
    setServiceSourceSetupSaved(false)
    setServiceBackupSetupSaved(false)
    setServiceAccountAnalysis(null)
    setServiceAccountFileName('')
    setServiceAccountError('')
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
    setGoogleAuthMethod('oauth')
    setGoogleAuth(null)
    setSelectedFieldIds([])
    setExportFormats({})
    setServicePreview(null)
    setSelectedServiceIds([])
    setShowAppSelectionModal(false)
    setServiceSourceSetupSaved(false)
    setServiceBackupSetupSaved(false)
    setServiceAccountAnalysis(null)
    setServiceAccountFileName('')
    setServiceAccountError('')
  }

  const buildGoogleDestinationAuthFromState = (
    googleAuthState = googleAuth,
    authMethod = googleAuthMethod,
    serviceAccountAnalysisState = serviceAccountAnalysis,
  ) => {
    const resolvedAuthMethod = googleAuthState?.auth_method || authMethod

    if (resolvedAuthMethod === 'service_account') {
      return {
        auth_method: 'service_account',
        service_account_json: googleAuthState?.service_account_json || null,
        service_account_json_encrypted: googleAuthState?.service_account_json_encrypted || null,
        service_account_email: googleAuthState?.service_account_email || googleAuthState?.email || serviceAccountAnalysisState?.client_email || null,
        project_id: googleAuthState?.project_id || serviceAccountAnalysisState?.project_id || null,
        service_account_file_name: serviceAccountFileName || null,
        folder_id: googleAuthState?.folder_id || null,
        folder_name: googleAuthState?.folder_name || null,
        drive_id: googleAuthState?.drive_id || null,
        drive_name: googleAuthState?.drive_name || null,
      }
    }

    return {
      auth_method: 'oauth',
      connection_id: googleAuthState?.connection_id,
      email: googleAuthState?.email,
      folder_id: googleAuthState?.folder_id || null,
      folder_name: googleAuthState?.folder_name || null,
      drive_id: googleAuthState?.drive_id || null,
      drive_name: googleAuthState?.drive_name || null,
    }
  }

  const buildGoogleDestinationAuth = () => buildGoogleDestinationAuthFromState(googleAuth, resolvedGoogleAuthMethod, serviceAccountAnalysis)

  const resolveDriveName = (driveId, explicitDriveName = null) => {
    if (explicitDriveName) return explicitDriveName
    if (!driveId) return 'My Drive'
    return drives.find(item => item.id === driveId)?.name || 'Shared Drive'
  }

  const getGoogleDriveRunBlockedReason = (
    googleAuthState = googleAuth,
    authMethod = resolvedGoogleAuthMethod,
    serviceAccountAnalysisState = serviceAccountAnalysis,
    destinationType = storageDestination,
  ) => {
    if (destinationType !== 'gdrive') return null

    const destinationAuth = buildGoogleDestinationAuthFromState(
      googleAuthState,
      authMethod,
      serviceAccountAnalysisState,
    )

    if (destinationAuth?.auth_method === 'service_account' && !destinationAuth?.drive_id) {
      return SERVICE_ACCOUNT_SHARED_DRIVE_MESSAGE
    }

    return null
  }

  const getGoogleDriveFolderSummary = (
    googleAuthState = googleAuth,
    authMethod = resolvedGoogleAuthMethod,
    destinationType = storageDestination,
  ) => {
    if (destinationType !== 'gdrive') return null

    const resolvedAuthMethod = googleAuthState?.auth_method || authMethod
    const driveName = resolveDriveName(googleAuthState?.drive_id, googleAuthState?.drive_name)
    if (googleAuthState?.drive_id) {
      return {
        tag: 'Shared Drive folder',
        color: 'green',
        driveName,
        help: 'This folder belongs to a Shared Drive and can be used with the current Google service account.',
      }
    }

    if (resolvedAuthMethod === 'service_account') {
      return {
        tag: 'Direct share in My Drive',
        color: 'gold',
        driveName,
        help: 'This folder is visible because it is shared to the service account, but it is still a regular My Drive folder, not a Shared Drive.',
      }
    }

    return {
      tag: 'My Drive folder',
      color: 'blue',
      driveName,
      help: 'This folder belongs to regular My Drive.',
    }
  }

  const renderGoogleDriveFolderSummary = (
    googleAuthState = googleAuth,
    authMethod = resolvedGoogleAuthMethod,
    destinationType = storageDestination,
  ) => {
    const summary = getGoogleDriveFolderSummary(googleAuthState, authMethod, destinationType)
    if (!summary) return null

    return (
      <Space size={6} wrap style={{ marginTop: 6 }}>
        <Tag color={summary.color}>{summary.tag}</Tag>
        <Tag>{summary.driveName}</Tag>
        <Text type="secondary" style={{ fontSize: 12 }}>{summary.help}</Text>
      </Space>
    )
  }

  const renderServiceRootArchiveNotice = (appId, destinationType = 'gdrive', style = {}) => {
    if (appId !== 'service' || destinationType !== 'gdrive') return null

    return (
      <Alert
        type="info"
        showIcon
        message="Rerun sẽ đưa Base Service cũ vào Trash"
        description="Mỗi lần chạy backup Service mới, hệ thống sẽ chuyển folder Base Service cũ vào Google Drive Trash trước khi tạo lại cây Base Service mới."
        style={style}
      />
    )
  }

  const autosaveDestinationAuth = async (
    googleAuthState = googleAuth,
    authMethod = googleAuthMethod,
    serviceAccountAnalysisState = serviceAccountAnalysis,
  ) => {
    if (!draftFlowId || !storageDestination) return

    await axios.patch(`${API_BASE}/api/backup-flows/${draftFlowId}/autosave`, {
      destination: {
        type: storageDestination,
        name: storageDestination === 'gsheets' ? 'Google Sheets' : 'Google Drive',
        auth: buildGoogleDestinationAuthFromState(googleAuthState, authMethod, serviceAccountAnalysisState),
      }
    }).catch(() => {})
  }

  const handleServiceAccountFileUpload = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return

    setServiceBackupSetupSaved(false)
    setGoogleAuthMethod('service_account')
    setServiceAccountAnalysisLoading(true)
    setServiceAccountError('')

    try {
      const rawText = await file.text()
      const parsed = JSON.parse(rawText)
      const res = await axios.post(`${API_BASE}/api/google/service-account/analyze`, {
        service_account_json: parsed,
      })

      const nextGoogleAuth = {
        auth_method: 'service_account',
        service_account_json: parsed,
        service_account_json_encrypted: googleAuth?.service_account_json_encrypted || null,
        service_account_email: res.data.client_email,
        email: res.data.client_email,
        display_name: res.data.client_email || 'Service Account',
        picture_url: '',
        project_id: res.data.project_id || null,
        folder_id: googleAuth?.folder_id || null,
        folder_name: googleAuth?.folder_name || null,
        drive_id: googleAuth?.drive_id || null,
      }

      setServiceAccountFileName(file.name)
      setServiceAccountAnalysis(res.data)
      setGoogleAuth(nextGoogleAuth)
      await autosaveDestinationAuth(nextGoogleAuth, 'service_account', res.data)
      message.success('Service account analyzed successfully')
    } catch (err) {
      setServiceAccountAnalysis(null)
      setServiceAccountError(err.response?.data?.detail || err.message || 'Invalid service account JSON file')
    } finally {
      setServiceAccountAnalysisLoading(false)
      event.target.value = ''
    }
  }

  const loadServicePreview = async (serviceIdsOverride = selectedServiceIds) => {
    if (!domain || !accessToken) {
      message.warning('Please enter Service domain and access token first')
      return
    }

    shouldResetServicePreviewScrollRef.current = true
    setLoadingServicePreview(true)
    try {
      const res = await axios.post(`${API_BASE}/api/connectors/service/preview`, {
        domain,
        access_token: accessToken,
        ticket_sample_limit: 2,
        service_ids: serviceIdsOverride.length ? serviceIdsOverride : undefined,
        detail_service_limit: serviceIdsOverride.length ? Math.min(serviceIdsOverride.length, 10) : 2,
      })
      setServicePreview(res.data)
      if (!selectedServiceIds.length && Array.isArray(res.data?.services)) {
        const defaultServiceIds = res.data.services.slice(0, 2).map(item => item.service_id)
        setSelectedServiceIds(defaultServiceIds)
        if (serviceSelectorModalOpen) {
          setDraftSelectedServiceIds(defaultServiceIds)
        }
      }
      message.success('Loaded Service source preview')
    } catch (err) {
      message.error(err.response?.data?.detail || 'Failed to load Service source preview')
    } finally {
      setLoadingServicePreview(false)
    }
  }

  useEffect(() => {
    if (!servicePreview || !shouldResetServicePreviewScrollRef.current) return

    shouldResetServicePreviewScrollRef.current = false
    window.requestAnimationFrame(() => {
      const tableBody = servicePreviewListRef.current?.querySelector('.ant-table-body')
      if (tableBody?.scrollTo) {
        tableBody.scrollTo({ top: 0, behavior: 'smooth' })
      }
    })
  }, [servicePreview])

  const openServiceSelectorModal = () => {
    if (!servicePreview && !loadingServicePreview) {
      loadServicePreview()
    }
    setDraftSelectedServiceIds(selectedServiceIds)
    setServiceSelectorModalOpen(true)
  }

  const closeServiceSelectorModal = () => {
    setDraftSelectedServiceIds(selectedServiceIds)
    setServiceSelectorModalOpen(false)
  }

  const applyServiceSelectorModal = () => {
    setSelectedServiceIds(draftSelectedServiceIds)
    setServiceSelectorModalOpen(false)
  }

  useEffect(() => {
    if (
      viewMode !== 'list' &&
      isServiceApp &&
      currentStep === (totalSteps - 1) &&
      domain &&
      accessToken &&
      !servicePreview &&
      !loadingServicePreview
    ) {
      loadServicePreview()
    }
  }, [viewMode, isServiceApp, currentStep, domain, accessToken, totalSteps])

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
    if (selectedApp === 'service') return []
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

  const startGoogleOAuthPopup = (url) => new Promise((resolve, reject) => {
    const w = 520
    const h = 660
    const popup = window.open(
      url,
      'google-oauth',
      `width=${w},height=${h},top=${Math.round((window.screen.height - h) / 2)},left=${Math.round((window.screen.width - w) / 2)}`
    )

    if (!popup) {
      reject(new Error('Popup blocked. Please allow popups for this site.'))
      return
    }

    const onMessage = (event) => {
      if (!event.data || typeof event.data !== 'object') return
      const data = event.data
      if (data.success === true && data.connection_id) {
        window.removeEventListener('message', onMessage)
        popup.close()
        resolve(data)
      } else if (data.success === false) {
        window.removeEventListener('message', onMessage)
        popup.close()
        reject(new Error(data.error || 'Unknown Google OAuth error'))
      }
    }

    window.addEventListener('message', onMessage)
  })

  const openGoogleConfigModal = async () => {
    setGoogleConfigModalOpen(true)
    setGoogleConfigError('')
    setGoogleConfigLoading(true)
    try {
      const res = await axios.get(`${API_BASE}/api/settings/google`)
      const data = res.data || {}
      const redirectUri = data.redirect_uri || DEFAULT_GOOGLE_REDIRECT
      setGoogleRedirectUri(redirectUri)
      setGoogleSecretSet(!!(data.client_secret && data.client_secret !== ''))
      googleConfigForm.setFieldsValue({
        client_id: data.client_id || '',
        client_secret: '',
        redirect_uri: redirectUri,
      })
    } catch {
      setGoogleRedirectUri(DEFAULT_GOOGLE_REDIRECT)
      setGoogleSecretSet(false)
      googleConfigForm.setFieldsValue({
        client_id: '',
        client_secret: '',
        redirect_uri: DEFAULT_GOOGLE_REDIRECT,
      })
    } finally {
      setGoogleConfigLoading(false)
    }
  }

  const handleSaveGoogleConfigAndConnect = async () => {
    let values
    try {
      values = await googleConfigForm.validateFields()
    } catch {
      return
    }

    if (!values.client_secret?.trim() && !googleSecretSet) {
      setGoogleConfigError('Client Secret is required')
      return
    }

    setGoogleConfigSaving(true)
    setGoogleConfigError('')
    try {
      await axios.put(`${API_BASE}/api/settings/google`, {
        client_id: values.client_id.trim(),
        client_secret: values.client_secret?.trim() || '__KEEP__',
        redirect_uri: values.redirect_uri?.trim() || googleRedirectUri,
      })

      const authRes = await axios.get(`${API_BASE}/api/google/auth-url`)
      const data = await startGoogleOAuthPopup(authRes.data.url)
      setGoogleAuthMethod('oauth')
      setGoogleAuth({
        auth_method: 'oauth',
        connection_id: data.connection_id,
        email: data.email,
        display_name: data.display_name || data.email,
        picture_url: data.picture_url || '',
        folder_id: null,
        folder_name: null,
        drive_id: null
      })
      setGoogleConfigModalOpen(false)
      setGoogleSecretSet(true)
      message.success(`Connected as ${data.email}`)
    } catch (err) {
      setGoogleConfigError(err.response?.data?.detail || err.message || 'Failed to configure Google OAuth')
    } finally {
      setGoogleConfigSaving(false)
    }
  }

  const handleGoogleConnect = async () => {
    try {
      const res = await axios.get(`${API_BASE}/api/google/auth-url`)
      const data = await startGoogleOAuthPopup(res.data.url)
      setGoogleAuthMethod('oauth')
      setServiceBackupSetupSaved(false)
      setGoogleAuth({
        auth_method: 'oauth',
        connection_id: data.connection_id,
        email: data.email,
        display_name: data.display_name || data.email,
        picture_url: data.picture_url || '',
        folder_id: null,
        folder_name: null,
        drive_id: null
      })
      message.success(`Connected as ${data.email}`)
    } catch (err) {
      if (err.response?.status === 503) {
        await openGoogleConfigModal()
      } else {
        message.error(err.response?.data?.detail || err.message || 'Failed to start Google authentication')
      }
      console.error(err)
    }
  }

  const handleGoogleDisconnect = () => {
    setGoogleAuth(null)
    setServiceBackupSetupSaved(false)
    if (isServiceAccountDestinationAuth) {
      setServiceAccountAnalysis(null)
      setServiceAccountFileName('')
      setServiceAccountError('')
    }
    setDrives([])
    setFolders([])
    setFolderPath([])
    setSharedFolders([])
    setSharedFolderQuery('')
    setSharedFolderReference('')
    message.info('Disconnected from Google')
  }

  const loadSharedFolders = async (query = '') => {
    if (!isServiceAccountDestinationAuth || !googleAuth) return

    setLoadingSharedFolders(true)
    try {
      const res = await axios.post(`${API_BASE}/api/google/service-account/shared-folders`, {
        auth: buildGoogleDestinationAuth(),
        query,
      })
      setSharedFolders(res.data)
    } catch (err) {
      message.error(err.response?.data?.detail || 'Failed to load folders shared with this service account')
    } finally {
      setLoadingSharedFolders(false)
    }
  }

  const openFolderLocation = async (folder) => {
    const driveId = folder?.drive_id || null
    setCurrentDriveId(driveId || 'root')
    setFolderPath([
      {
        id: folder.id,
        name: folder.name,
        driveId,
        isDriveRoot: false,
      }
    ])
    await fetchSubFolders(folder.id, driveId)
  }

  const applyGoogleFolderSelection = async (folder, options = {}) => {
    if (!folder) return

    if (isServiceAccountDestinationAuth && !folder.drive_id) {
      message.error(SERVICE_ACCOUNT_SHARED_DRIVE_MESSAGE)
      return
    }

    const nextGoogleAuth = {
      ...(googleAuth || {}),
      folder_id: folder.id || null,
      folder_name: folder.name || null,
      drive_id: folder.drive_id || null,
      drive_name: resolveDriveName(folder.drive_id, folder.drive_name || null),
    }

    setGoogleAuth(nextGoogleAuth)
    await autosaveDestinationAuth(nextGoogleAuth)

    if (options.closeModal !== false) {
      setGoogleFolderModal(false)
    }

    message.success(`Folder selected: ${folder.name} (${resolveDriveName(folder.drive_id, folder.drive_name || null)})`)
  }

  const handleResolveSharedFolder = async () => {
    const folderReference = sharedFolderReference.trim()
    if (!folderReference) {
      message.warning('Paste a Google Drive folder link or folder ID first')
      return
    }

    setResolvingSharedFolder(true)
    try {
      const res = await axios.post(`${API_BASE}/api/google/service-account/folder-info`, {
        auth: buildGoogleDestinationAuth(),
        folder_id_or_url: folderReference,
      })
      const resolvedFolder = res.data
      setSharedFolderReference('')
      setSharedFolders(prev => prev.some(item => item.id === resolvedFolder.id) ? prev : [resolvedFolder, ...prev])
      await applyGoogleFolderSelection(resolvedFolder)
    } catch (err) {
      message.error(err.response?.data?.detail || 'Failed to resolve the Google Drive folder')
    } finally {
      setResolvingSharedFolder(false)
    }
  }

  const handleOpenFolderPicker = async () => {
    if (!googleAuth) return
    setGoogleFolderModal(true)
    setLoadingDrives(true)
    setSharedFolderReference('')
    try {
      const res = isServiceAccountDestinationAuth
        ? await axios.post(`${API_BASE}/api/google/service-account/drives`, {
            auth: buildGoogleDestinationAuth()
          })
        : await axios.get(`${API_BASE}/api/google/drives`, {
            params: { connection_id: googleAuth.connection_id }
          })
      setDrives(res.data)
      if (res.data.length > 0) {
        await handleDriveChange(res.data[0].id, res.data)
      }
      if (isServiceAccountDestinationAuth) {
        await loadSharedFolders('')
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
    setFolderPath([{ id: rootParent, name: driveName, driveId: driveId === 'root' ? null : driveId, isDriveRoot: true }])
    await fetchSubFolders(rootParent, driveId === 'root' ? null : driveId)
  }

  const fetchSubFolders = async (parentId, driveId) => {
    setLoadingFolders(true)
    try {
      const res = isServiceAccountDestinationAuth
        ? await axios.post(`${API_BASE}/api/google/service-account/folders`, {
            auth: buildGoogleDestinationAuth(),
            parent_id: parentId,
            drive_id: driveId || null,
          })
        : await axios.get(`${API_BASE}/api/google/folders`, {
            params: {
              connection_id: googleAuth.connection_id,
              parent_id: parentId,
              ...(driveId ? { drive_id: driveId } : {})
            }
          })
      setFolders(res.data)
    } catch (err) {
      message.error('Failed to load folders')
    } finally {
      setLoadingFolders(false)
    }
  }

  const handleOpenSubFolder = async (folder) => {
    const driveId = currentDriveId !== 'root' ? currentDriveId : null
    setFolderPath(prev => [...prev, { id: folder.id, name: folder.name, driveId, isDriveRoot: false }])
    await fetchSubFolders(folder.id, driveId)
  }

  const handleBreadcrumbNav = async (index) => {
    const item = folderPath[index]
    setFolderPath(prev => prev.slice(0, index + 1))
    await fetchSubFolders(item.id, item.driveId)
  }

  const handleSelectCurrentFolder = async () => {
    const current = folderPath[folderPath.length - 1]
    if (!current) return
    const isRoot = Boolean(current.isDriveRoot)
    if (isServiceAccountDestinationAuth && !current.driveId) {
      message.error(SERVICE_ACCOUNT_SHARED_DRIVE_MESSAGE)
      return
    }
    const nextGoogleAuth = {
      ...(googleAuth || {}),
      folder_id: isRoot ? null : current.id,
      folder_name: current.name,
      drive_id: current.driveId || null,
      drive_name: resolveDriveName(current.driveId, current.isDriveRoot ? current.name : null),
    }
    setGoogleAuth(nextGoogleAuth)
    await autosaveDestinationAuth(nextGoogleAuth)
    setGoogleFolderModal(false)
    message.success(`Folder selected: ${current.name} (${resolveDriveName(current.driveId, current.isDriveRoot ? current.name : null)})`)
  }

  const selectDestination = (dest) => {
    setStorageDestination(dest)
    setGoogleAuth(null) // Reset auth when changing destination
    setGoogleAuthMethod('oauth')
    setServiceAccountAnalysis(null)
    setServiceAccountFileName('')
    setServiceAccountError('')
    setSharedFolders([])
    setSharedFolderQuery('')
    setSharedFolderReference('')
    setShowDestinationModal(false)
  }

  // Render functions for each step
  const renderHoverHint = (content) => (
    <Tooltip title={<div style={{ maxWidth: 320, whiteSpace: 'normal' }}>{content}</div>}>
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 18,
          height: 18,
          borderRadius: '50%',
          border: '1px solid #cbd5e1',
          color: '#475569',
          fontSize: 11,
          fontWeight: 700,
          cursor: 'help',
          background: '#fff'
        }}
      >
        !
      </span>
    </Tooltip>
  )

  const condensedServiceSectionHeight = 'clamp(360px, calc(100vh - 400px), 520px)'
  const balancedSetupTopSectionFlex = '0 0 42%'
  const balancedReviewStateFlex = '0 0 40%'

  const renderStep1 = () => {
    if (usesCondensedServiceWizard) {
      return (
        <div>
          <div style={{ marginBottom: 24 }}>
            <Title level={4} style={{ marginBottom: 4 }}>App & Objects</Title>
            <Paragraph type="secondary">
              Chọn ứng dụng trong modal, nhập thông tin source, lưu lại phần source rồi tiếp tục chọn objects cho flow backup.
            </Paragraph>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
              gap: 16,
              alignItems: 'stretch'
            }}
          >
            <Card
              title="Section 1: App & Source"
              style={{ height: condensedServiceSectionHeight, minHeight: condensedServiceSectionHeight, display: 'flex', flexDirection: 'column' }}
              styles={{ body: { flex: 1, minHeight: 0, overflowY: 'auto' } }}
            >
              <Form layout="vertical">
                <Form.Item label="Backup Flow Name" required>
                  <Input
                    placeholder="e.g. Daily Service Backup"
                    value={flowName}
                    onChange={e => setFlowName(e.target.value)}
                    size="large"
                    maxLength={120}
                  />
                </Form.Item>

                <Form.Item label="Application" required>
                  <Button
                    block
                    size="large"
                    style={{ borderStyle: 'dashed', justifyContent: 'flex-start', height: 'auto', padding: '12px 16px' }}
                    onClick={() => setShowAppSelectionModal(true)}
                  >
                    <Space>
                      {currentApp?.icon || <CloudOutlined style={{ color: '#3b82f6' }} />}
                      <span>{currentApp ? `Selected: ${currentApp.name}` : 'Choose App in Modal'}</span>
                    </Space>
                  </Button>
                </Form.Item>

                {selectedApp === 'service' ? (
                  <>
                    <Form.Item
                      label={<><CloudOutlined style={{ color: '#3b82f6', marginRight: 6 }} />Base Domain</>}
                      required
                    >
                      <Input
                        placeholder="base.com.vn"
                        value={domain}
                        onChange={(e) => {
                          setServiceSourceSetupSaved(false)
                          setDomain(e.target.value)
                          setServicePreview(null)
                        }}
                        size="large"
                      />
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        Enter base.com.vn, service.base.com.vn, or a full Service URL. The backend will normalize it.
                      </Text>
                    </Form.Item>

                    <Form.Item
                      label={<><LockOutlined style={{ color: '#f59e0b', marginRight: 6 }} />Access Token V2</>}
                      required
                    >
                      <Password
                        placeholder="Paste your Base Account access_token_v2 here…"
                        value={accessToken}
                        onChange={(e) => {
                          setServiceSourceSetupSaved(false)
                          setAccessToken(e.target.value)
                          setServicePreview(null)
                        }}
                        iconRender={visible => (visible ? <EyeOutlined /> : <EyeInvisibleOutlined />)}
                        size="large"
                      />
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        Get this value from Service → Settings → API Keys. Use the Base Account access_token_v2 token.
                      </Text>
                    </Form.Item>

                    <Button type="primary" onClick={handleConfirmServiceSourceSetup} disabled={!canSaveServiceSourceSetup}>
                      Save Source Information
                    </Button>
                  </>
                ) : selectedApp ? (
                  <Alert
                    type="info"
                    showIcon
                    message="Legacy wizard applies to this app"
                    description="The compact 3-step layout is currently optimized for the Service flow. Continue to keep the existing wizard behavior for the selected app."
                  />
                ) : (
                  <Alert
                    type="info"
                    showIcon
                    message="Choose an app to continue"
                    description="Sau khi chọn Service trong modal, form domain và access token sẽ hiện ngay bên dưới."
                  />
                )}
              </Form>
            </Card>

            <Card
              title="Section 2: Objects"
              style={{ height: condensedServiceSectionHeight, minHeight: condensedServiceSectionHeight, display: 'flex', flexDirection: 'column' }}
              styles={{ body: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' } }}
            >
              <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 4 }}>
                {selectedApp !== 'service' ? (
                  <Empty description="Choose Service in Section 1 to continue with object selection" />
                ) : !serviceSourceSetupSaved ? (
                  <Alert
                    type="info"
                    showIcon
                    message="Save source information first"
                    description="Sau khi lưu xong app, domain và access token, section Objects sẽ sẵn sàng để chọn scope backup."
                  />
                ) : (
                  <>
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
                  </>
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16, paddingTop: 16, borderTop: '1px solid #f1f5f9' }}>
                <Button
                  type="primary"
                  onClick={next}
                  disabled={!flowName.trim() || selectedApp !== 'service' || !serviceSourceSetupSaved || selectedObjects.length === 0}
                >
                  Continue
                </Button>
              </div>
            </Card>
          </div>
        </div>
      )
    }

    return (
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
  }

  const renderGenericStep3 = () => {
    if (isServiceApp && totalSteps === 3) {
      const analysis = serviceAccountAnalysis || {}
      const availableDrives = Array.isArray(analysis.drives) ? analysis.drives : []
      const serviceAccountEmail = analysis.client_email || googleAuth?.service_account_email || googleAuth?.email
      const projectId = analysis.project_id || googleAuth?.project_id
      const destinationLabel = storageDestination === 'gsheets' ? 'Google Sheets' : 'Google Drive'
      const serviceSetupColumnHeight = condensedServiceSectionHeight

      return (
        <div>
          <div style={{ marginBottom: 24 }}>
            <Title level={4} style={{ marginBottom: 4 }}>Backup Setup</Title>
            <Paragraph type="secondary">
              Chia phần cấu hình thành 3 section rõ ràng: backup type, destination, rồi authentication kết hợp với destination folder.
            </Paragraph>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))',
              gap: 16,
              alignItems: 'stretch'
            }}
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 16,
                height: serviceSetupColumnHeight,
                minHeight: serviceSetupColumnHeight,
                minWidth: 0
              }}
            >
              <Card
                title="Section 1: Backup Type"
                style={{ flex: `0 0 ${balancedSetupTopSectionFlex}`, minHeight: 0, display: 'flex', flexDirection: 'column' }}
                styles={{ body: { flex: 1, minHeight: 0, overflowY: 'auto' } }}
              >
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  {[
                    { id: 'structured', title: 'Structured', desc: 'Service and ticket spreadsheets only', color: '#0284c7', icon: <FileExcelOutlined /> },
                    { id: 'unstructured', title: 'Unstructured', desc: 'Ticket folders, files, and artifacts', color: '#d97706', icon: <FolderOutlined /> },
                    { id: 'all', title: 'Complete', desc: 'Structured + unstructured artifacts', color: '#7c3aed', icon: <DatabaseOutlined /> },
                  ].map(type => (
                    <Card
                      key={type.id}
                      hoverable
                      onClick={() => {
                        setBackupType(type.id)
                        setServiceBackupSetupSaved(false)
                      }}
                      style={{
                        border: backupType === type.id ? `2px solid ${type.color}` : '1px solid #d9d9d9',
                        backgroundColor: backupType === type.id ? `${type.color}12` : '#fff',
                        cursor: 'pointer'
                      }}
                      styles={{ body: { padding: 14 } }}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                        <div style={{ color: type.color, fontSize: 18, marginTop: 2 }}>{type.icon}</div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 700, fontSize: 14 }}>{type.title}</div>
                          <Text type="secondary" style={{ fontSize: 12 }}>{type.desc}</Text>
                        </div>
                        {backupType === type.id && <CheckOutlined style={{ color: type.color, marginTop: 4 }} />}
                      </div>
                    </Card>
                  ))}
                </Space>
              </Card>

              <Card
                title="Section 2: Destination"
                style={{ flex: '1 1 0', minHeight: 0, display: 'flex', flexDirection: 'column' }}
                styles={{ body: { flex: 1, minHeight: 0, overflowY: 'auto' } }}
              >
                <Space direction="vertical" size={16} style={{ width: '100%' }}>
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
                      justifyContent: 'flex-start'
                    }}
                  >
                    <Space>
                      <CloudOutlined style={{ fontSize: 18, color: '#3b82f6' }} />
                      <Text strong style={{ fontSize: 13 }}>
                        {storageDestination ? `Selected: ${destinationLabel}` : 'Select Destination in Modal'}
                      </Text>
                    </Space>
                  </Button>

                  {storageDestination ? (
                    <Card size="small" style={{ background: '#ecfeff', border: '2px solid #a5f3fc' }}>
                      <Space direction="vertical" size={6} style={{ width: '100%' }}>
                        <Text type="secondary">Destination Summary</Text>
                        <div style={{ fontWeight: 700 }}>{destinationLabel}</div>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {storageDestination === 'gdrive' ? 'Folder, xlsx, json, attachments' : 'Spreadsheet destination'}
                        </Text>
                      </Space>
                    </Card>
                  ) : (
                    <Alert
                      type="info"
                      showIcon
                      message="Choose destination"
                      description="Chọn backup type trước, sau đó chọn nơi sẽ nhận dữ liệu backup ở section này."
                    />
                  )}
                </Space>
              </Card>
            </div>

            <Card
              title={
                <Space size={8}>
                  <span>Section 3: Authentication & Destination Folder</span>
                  {renderHoverHint('If you do not specify specific service IDs later, this flow will back up all services visible to the provided Service token.')}
                </Space>
              }
              style={{ height: serviceSetupColumnHeight, minHeight: serviceSetupColumnHeight, display: 'flex', flexDirection: 'column' }}
              styles={{ body: { flex: 1, minHeight: 0, overflowY: 'auto' } }}
            >
              {!storageDestination ? (
                <Alert
                  type="info"
                  showIcon
                  message="Select destination first"
                  description="Choose a destination in Section 2 before configuring authentication and destination folder."
                />
              ) : (
                <Space direction="vertical" size={16} style={{ width: '100%' }}>
                  <div>
                    <Text strong style={{ display: 'block', marginBottom: 8 }}>Authentication</Text>
                    <Space direction="vertical" size={12} style={{ width: '100%' }}>
                      {[
                        {
                          id: 'oauth',
                          title: 'OAuth User',
                          desc: 'Connect a Google account via popup',
                          color: '#2563eb',
                          icon: <GoogleOutlined />,
                          hint: 'Connect a Google user account, then choose the destination folder below.'
                        },
                        {
                          id: 'service_account',
                          title: 'Service Account',
                          desc: 'Upload a service account JSON key below',
                          color: '#7c3aed',
                          icon: <ApiOutlined />,
                          hint: 'Upload and analyze the Google service account JSON key below. Then choose a destination folder in the same section.'
                        },
                      ].map(method => (
                        <Card
                          key={method.id}
                          hoverable
                          onClick={() => {
                            setGoogleAuthMethod(method.id)
                            setGoogleAuth(null)
                            setServiceAccountAnalysis(null)
                            setServiceAccountFileName('')
                            setServiceAccountError('')
                            setServiceBackupSetupSaved(false)
                          }}
                          style={{
                            border: googleAuthMethod === method.id ? `2px solid ${method.color}` : '1px solid #d9d9d9',
                            backgroundColor: googleAuthMethod === method.id ? `${method.color}12` : '#fff',
                            cursor: 'pointer'
                          }}
                          styles={{ body: { padding: 14 } }}
                        >
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                            <div style={{ color: method.color, fontSize: 18, marginTop: 2 }}>{method.icon}</div>
                            <div style={{ flex: 1 }}>
                              <Space size={8} align="center" style={{ marginBottom: 2 }}>
                                <span style={{ fontWeight: 700, fontSize: 14 }}>{method.title}</span>
                                {renderHoverHint(method.hint)}
                              </Space>
                              <div>
                                <Text type="secondary" style={{ fontSize: 12 }}>{method.desc}</Text>
                              </div>
                            </div>
                            {googleAuthMethod === method.id && <CheckOutlined style={{ color: method.color, marginTop: 4 }} />}
                          </div>
                        </Card>
                      ))}
                    </Space>
                  </div>

                  {storageDestination === 'gdrive' && googleAuthMethod === 'oauth' && (
                    <div>
                      {googleAuth ? (
                        <Card style={{ background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
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
                      ) : (
                        <Space wrap>
                          <Button onClick={openGoogleConfigModal}>Configure OAuth Client</Button>
                          <Button type="primary" icon={<GoogleOutlined />} onClick={handleGoogleConnect}>
                            Connect with Google
                          </Button>
                        </Space>
                      )}
                    </div>
                  )}

                  {storageDestination === 'gdrive' && googleAuthMethod === 'service_account' && (
                    <div>
                      <Card style={{ marginBottom: 12 }}>
                        <Space direction="vertical" size={12} style={{ width: '100%' }}>
                          <Text strong>Upload Service Account JSON</Text>
                          <input type="file" accept=".json,application/json" onChange={handleServiceAccountFileUpload} />
                          {serviceAccountFileName && (
                            <Text type="secondary">Uploaded file: {serviceAccountFileName}</Text>
                          )}
                        </Space>
                      </Card>

                      {serviceAccountError && (
                        <Alert type="error" showIcon style={{ marginBottom: 12 }} message={serviceAccountError} />
                      )}

                      {serviceAccountAnalysisLoading ? (
                        <div style={{ textAlign: 'center', padding: 24 }}>
                          <Spin />
                        </div>
                      ) : serviceAccountEmail ? (
                        <Card title="Service Account Summary">
                          <Space direction="vertical" size={10} style={{ width: '100%' }}>
                            <div>
                              <Text type="secondary">Service Account Email</Text>
                              <div style={{ fontWeight: 700, marginTop: 4 }}>{serviceAccountEmail}</div>
                            </div>
                            <div>
                              <Text type="secondary">Project ID</Text>
                              <div style={{ fontWeight: 700, marginTop: 4 }}>{projectId || '—'}</div>
                            </div>
                            <div>
                              <Text type="secondary">Available Drives</Text>
                              <div style={{ marginTop: 8 }}>
                                <Space size={6} wrap>
                                  {availableDrives.length > 0
                                    ? availableDrives.map(drive => <Tag key={drive.id}>{drive.name}</Tag>)
                                    : <Text type="secondary">No drives listed yet. This is normal if the service account has not been shared onto any Drive resources.</Text>}
                                </Space>
                              </div>
                            </div>
                          </Space>
                        </Card>
                      ) : null}
                    </div>
                  )}

                  <div>
                    <Text strong style={{ display: 'block', marginBottom: 8 }}>Destination Folder</Text>
                    {storageDestination !== 'gdrive' ? (
                      <Alert
                        type="info"
                        showIcon
                        message="Folder picker is not required"
                        description="This destination does not need a Google Drive folder selection."
                      />
                    ) : !googleAuth ? (
                      <Alert
                        type="info"
                        showIcon
                        message="Complete authentication first"
                        description="Connect OAuth or upload a service account file before selecting the destination folder."
                      />
                    ) : (
                      <Space direction="vertical" size={12} style={{ width: '100%' }}>
                        <Button block icon={<FolderOutlined />} onClick={handleOpenFolderPicker} style={{ borderStyle: 'dashed' }}>
                          {googleAuth.folder_name ? `📁 ${googleAuth.folder_name}` : 'Select folder in Google Drive'}
                        </Button>
                        {renderGoogleDriveFolderSummary()}
                        {getGoogleDriveRunBlockedReason() && (
                          <Alert
                            type="warning"
                            showIcon
                            message="This destination cannot run yet"
                            description={getGoogleDriveRunBlockedReason()}
                          />
                        )}
                      </Space>
                    )}
                  </div>

                  <Button type="primary" onClick={handleConfirmServiceBackupSetup} disabled={!canSaveServiceBackupSetup}>
                    Save Destination Settings
                  </Button>
                </Space>
              )}
            </Card>
          </div>

        </div>
      )
    }

    return (
      <div>
        <div style={{ marginBottom: 24 }}>
          <Title level={4} style={{ marginBottom: 4 }}>{connectionConfig?.stepTitle || 'Enter Access Token'}</Title>
          <Paragraph type="secondary">
            {connectionConfig?.stepDescription || <>Provide your <strong>{currentApp.name}</strong> API access token to authenticate</>}
          </Paragraph>
        </div>

        <Form layout="vertical">
          {connectionConfig?.requiresDomain && (
            <Form.Item
              label={<><CloudOutlined style={{ color: '#3b82f6', marginRight: 6 }} />{connectionConfig.domainLabel}</>}
              required
            >
              <Input
                placeholder={connectionConfig.domainPlaceholder}
                value={domain}
                onChange={(e) => {
                  setDomain(e.target.value)
                  if (isServiceApp) setServicePreview(null)
                }}
                size="large"
              />
              <Text type="secondary" style={{ fontSize: 12 }}>
                {connectionConfig.domainHelp}
              </Text>
            </Form.Item>
          )}

          <Form.Item
            label={<><LockOutlined style={{ color: '#f59e0b', marginRight: 6 }} />{connectionConfig?.tokenLabel || 'API Access Token'}</>}
            required
          >
            <Password
              placeholder={connectionConfig?.tokenPlaceholder || 'Paste your access token here…'}
              value={accessToken}
              onChange={(e) => {
                setAccessToken(e.target.value)
                if (isServiceApp) setServicePreview(null)
              }}
              iconRender={visible => (visible ? <EyeOutlined /> : <EyeInvisibleOutlined />)}
              size="large"
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              {connectionConfig?.tokenHelp || <>You can find your access token in <strong>{currentApp.name}</strong> → Settings → API Keys</>}
            </Text>
          </Form.Item>
        </Form>

      </div>
    )
  }

  const renderGenericStep4 = () => {
    if (isServiceApp) {
      const isEdit = viewMode === 'edit'
      const structurePreviewServices = (selectedServicesForFlow.length > 0 ? selectedServicesForFlow : servicePreviewRows).slice(0, 2)
      const reviewColumnHeight = condensedServiceSectionHeight

      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {getGoogleDriveRunBlockedReason() && (
            <Alert
              type="warning"
              showIcon
              message="This destination cannot run yet"
              description={getGoogleDriveRunBlockedReason()}
            />
          )}

          {renderServiceRootArchiveNotice(currentApp?.id || selectedApp, storageDestination)}

          <div>
            <Space>
              <RocketOutlined style={{ fontSize: 24, color: '#059669' }} />
              <div>
                <Title level={4} style={{ margin: 0 }}>Review</Title>
                <Paragraph type="secondary">Tách review thành 2 cột cân bằng: cột trái là flow summary & action, cột phải là current service state và destination structure preview.</Paragraph>
              </div>
            </Space>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))',
              gap: 16,
              alignItems: 'stretch'
            }}
          >
            <Card
              title="Section 1: Flow Summary & Action"
              style={{ height: reviewColumnHeight, minHeight: reviewColumnHeight, display: 'flex', flexDirection: 'column' }}
              styles={{ body: { flex: 1, minHeight: 0, overflowY: 'auto' } }}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                  gap: 16,
                  alignItems: 'start'
                }}
              >
                <Card size="small" title="App">
                  <Space direction="vertical" size={14} style={{ width: '100%' }}>
                    <div>
                      <Text type="secondary">Application</Text>
                      <div style={{ fontWeight: 600, marginTop: 4 }}>
                        <CustomerServiceOutlined style={{ color: '#059669', marginRight: 6 }} />
                        Service
                      </div>
                    </div>
                    <div>
                      <Text type="secondary">Domain</Text>
                      <div style={{ fontWeight: 600, marginTop: 4 }}>{domain}</div>
                    </div>
                    <div>
                      <Text type="secondary">Flow Name</Text>
                      <div style={{ fontWeight: 600, marginTop: 4 }}>{flowName || 'Untitled flow'}</div>
                    </div>
                    <div>
                      <Text type="secondary">Objects</Text>
                      <div style={{ marginTop: 8 }}>
                        <Space size={4} wrap>
                          {selectedObjects.map(obj => (
                            <Tag key={obj} color={currentApp.color}>{currentApp.objectLabels[obj]}</Tag>
                          ))}
                        </Space>
                      </div>
                    </div>
                    <div>
                      <Text type="secondary">Selected Services</Text>
                      <div style={{ fontWeight: 600, marginTop: 4 }}>{selectedServiceIds.length} service</div>
                    </div>
                  </Space>
                </Card>

                <Card size="small" title="Destination">
                  <Space direction="vertical" size={14} style={{ width: '100%' }}>
                    <div>
                      <Text type="secondary">Backup Type</Text>
                      <div style={{ fontWeight: 600, marginTop: 4 }}>
                        {backupType === 'structured' && <><FileExcelOutlined style={{ color: '#0284c7', marginRight: 6 }} />Structured</>}
                        {backupType === 'unstructured' && <><FolderOutlined style={{ color: '#d97706', marginRight: 6 }} />Unstructured</>}
                        {backupType === 'all' && <><DatabaseOutlined style={{ color: '#7c3aed', marginRight: 6 }} />Complete</>}
                      </div>
                    </div>
                    <div>
                      <Text type="secondary">Destination</Text>
                      <div style={{ fontWeight: 600, marginTop: 4 }}>
                        {storageDestination === 'gsheets'
                          ? <><FileExcelOutlined style={{ color: '#10b981', marginRight: 6 }} />Google Sheets</>
                          : <><GoogleOutlined style={{ color: '#4285f4', marginRight: 6 }} />Google Drive</>}
                      </div>
                    </div>
                    <div>
                      <Text type="secondary">Google Account</Text>
                      <div style={{ fontWeight: 600, marginTop: 4 }}>{googleAuth?.email || 'Not connected'}</div>
                    </div>
                    <div>
                      <Text type="secondary">Drive Folder</Text>
                      <div style={{ fontWeight: 600, marginTop: 4 }}>{googleAuth?.folder_name || 'My Drive root'}</div>
                      <div style={{ marginTop: 8 }}>
                        {renderGoogleDriveFolderSummary()}
                      </div>
                    </div>
                  </Space>
                </Card>

                <Card size="small" title="Action">
                  <Space direction="vertical" size={12} style={{ width: '100%' }}>
                    <Text type="secondary">Đã chọn {selectedServiceIds.length} service cho flow này.</Text>
                    <Button onClick={prev}>Previous</Button>
                    <Button block type="primary" size="large" icon={isEdit ? <EditOutlined /> : <RocketOutlined />} onClick={() => handleFinish(false)}>
                      {isEdit ? 'Save Changes' : 'Create Backup Flow'}
                    </Button>
                    <Button block size="large" icon={<PlayCircleOutlined />} onClick={() => handleFinish(true)}>
                      {isEdit ? 'Save & Run' : 'Create & Run'}
                    </Button>
                  </Space>
                </Card>
              </div>
            </Card>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 16,
                height: reviewColumnHeight,
                minHeight: reviewColumnHeight,
                minWidth: 0
              }}
            >
              <Card
                title="Section 2: Current Service State"
                style={{ flex: `0 0 ${balancedReviewStateFlex}`, minHeight: 0, display: 'flex', flexDirection: 'column' }}
                styles={{ body: { flex: 1, minHeight: 0, overflowY: 'auto' } }}
              >
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                    gap: 16,
                    alignItems: 'stretch',
                    marginBottom: 16
                  }}
                >
                  <Card size="small">
                    <Text type="secondary">Detected Services</Text>
                    <div style={{ fontSize: 24, fontWeight: 700 }}>{servicePreview?.service_count || 0}</div>
                  </Card>
                  <Card size="small">
                    <Text type="secondary">Selected for Backup</Text>
                    <div style={{ fontSize: 24, fontWeight: 700 }}>{selectedServiceIds.length || 0}</div>
                  </Card>
                  <Card size="small">
                    <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>Service Selection</Text>
                    <Button
                      block
                      type="primary"
                      icon={<EyeOutlined />}
                      onClick={openServiceSelectorModal}
                      disabled={!servicePreview && !loadingServicePreview}
                    >
                      Open Full Service List
                    </Button>
                  </Card>
                </div>

                {loadingServicePreview ? (
                  <div style={{ padding: '24px 0', textAlign: 'center' }}>
                    <Spin />
                  </div>
                ) : !servicePreview ? (
                  <Empty description="No Service source preview loaded yet" />
                ) : (
                  <>
                    {!servicePreview.ticket_count_complete && (
                      <Alert
                        type="warning"
                        showIcon
                        style={{ marginBottom: 16 }}
                        message={`Detailed preview loaded for ${servicePreview.detail_loaded_count || 0} services only`}
                        description="Mở modal Service list rồi bấm Refresh Source ngay trong modal nếu bạn cần nạp lại sample ticket theo đúng nhóm service mới chọn."
                      />
                    )}

                    {servicePreview.partial_error_count > 0 && (
                      <Alert
                        type="warning"
                        showIcon
                        style={{ marginBottom: 0 }}
                        message={`Some services could not be previewed completely (${servicePreview.partial_error_count})`}
                        description="Các service này vẫn được liệt kê để chọn backup, nhưng preview chi tiết có thể chưa đầy đủ."
                      />
                    )}
                  </>
                )}
              </Card>

              <Card
                title={<span style={{ color: '#ffffff', fontWeight: 700 }}>Section 3: Destination Structure Preview</span>}
                style={{ flex: '1 1 0', minHeight: 0, background: '#0f172a', borderColor: '#1e293b', display: 'flex', flexDirection: 'column' }}
                styles={{
                  header: { background: '#0f172a', borderBottom: '1px solid #1e293b' },
                  body: { flex: 1, minHeight: 0, overflowY: 'auto', color: '#e2e8f0', background: '#0f172a' }
                }}
              >
                <div style={{ fontSize: 12 }}>
                  <div style={{ marginBottom: 12, color: '#10b981', fontWeight: 700 }}>
                    <FolderOutlined /> {googleAuth?.folder_name || 'Selected Drive Folder'} / Base Service
                  </div>
                  {structurePreviewServices.length > 0 ? structurePreviewServices.map(service => {
                    const exampleTickets = (service.sample_tickets || []).slice(0, 2)
                    const ticketRows = exampleTickets.length > 0
                      ? exampleTickets
                      : [
                          { ticket_id: `${service.service_id}-sample-1`, ticket_code: 'TICKET-001', ticket_name: 'Sample ticket 1' },
                          { ticket_id: `${service.service_id}-sample-2`, ticket_code: 'TICKET-002', ticket_name: 'Sample ticket 2' }
                        ]

                    return (
                      <div key={service.service_id} style={{ marginBottom: 14 }}>
                        <div style={{ fontWeight: 700 }}>📁 {service.service_name}</div>
                        {selectedObjects.includes('service') && backupType !== 'unstructured' && (
                          <div style={{ paddingLeft: 18 }}>📄 service_overview.xlsx</div>
                        )}
                        {selectedObjects.includes('ticket') && backupType !== 'structured' && (
                          <div style={{ paddingLeft: 18 }}>📁 Tickets</div>
                        )}
                        {selectedObjects.includes('ticket') && ticketRows.map(ticket => (
                          <div key={ticket.ticket_id} style={{ paddingLeft: 36 }}>
                            {backupType === 'structured' ? '📄' : '📁'} {ticket.ticket_code} - {ticket.ticket_name}
                          </div>
                        ))}
                      </div>
                    )
                  }) : (
                    <Text style={{ color: '#cbd5e1' }}>Choose services in the modal to preview the example folder structure here.</Text>
                  )}
                </div>
              </Card>
            </div>
          </div>
        </div>
      )
    }

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

        {isServiceApp && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="Service custom-field discovery is not connected yet."
            description="This flow will save the selected Service objects and connection settings. Dynamic ticket or service field discovery will be added when Service metadata endpoints are wired into the backup wizard."
          />
        )}

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
            {connectionConfig?.requiresDomain && (
              <Col span={12}>
                <Text type="secondary">{connectionConfig.domainLabel}</Text>
                <div style={{ fontWeight: 600, marginTop: 4 }}>
                  {domain || <Text type="danger">Not provided</Text>}
                </div>
              </Col>
            )}
            <Col span={12}>
              <Text type="secondary">{connectionConfig?.tokenLabel || 'Access Token'}</Text>
              <div style={{ fontWeight: 600, marginTop: 4, fontFamily: 'monospace' }}>
                {accessToken ? '••••••••' + accessToken.slice(-4) : <Text type="danger">Not provided</Text>}
              </div>
            </Col>
            <Col span={12}>
              <Text type="secondary">Custom Fields</Text>
              <div style={{ fontWeight: 700, marginTop: 4 }}>
                {isServiceApp ? 'Discovery pending' : `${selectedFieldIds.length} selected`}
              </div>
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

  const RUN_STATUS_TAG = {
    pending: { color: 'gold', label: 'Pending' },
    running: { color: 'processing', label: 'Running' },
    completed: { color: 'success', label: 'Completed' },
    failed: { color: 'error', label: 'Failed' },
  }

  const RUN_PROGRESS_STATUS = {
    completed: 'success',
    pending: 'normal',
    running: 'active',
    failed: 'exception',
  }

  const formatDateTime = (value) => {
    if (!value) return '—'

    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) return String(value)

    return parsed.toLocaleString('en-GB', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
  }

  const renderFallbackValue = (value, fallback = '—') => {
    if (value === null || value === undefined || value === '') {
      return <Text type="secondary">{fallback}</Text>
    }
    return value
  }

  const getFlowRunStatusTag = (status) => {
    const meta = RUN_STATUS_TAG[status] || { color: 'default', label: status || 'Unknown' }
    return <Tag color={meta.color}>{meta.label}</Tag>
  }

  const getHistoryRunProgressPercent = (run) => {
    const value = run?.execution_details?.progress_percent
    if (typeof value === 'number') {
      return Math.max(0, Math.min(100, Math.round(value)))
    }
    if (run?.status === 'completed' || run?.status === 'failed') return 100
    if (run?.status === 'running') return 15
    return 0
  }

  const getHistoryRunStepLabel = (run) => {
    if (run?.execution_details?.step_label) return run.execution_details.step_label
    if (run?.status === 'pending') return 'Queued to start'
    if (run?.status === 'running') return 'Backup is running'
    if (run?.status === 'failed') return run?.error_message || 'Backup failed'
    return 'Completed'
  }

  const getHistoryRunSummary = (run) => {
    const details = run?.execution_details || {}

    if (details.app === 'service') {
      return `${details.completed_services || 0}/${details.total_services || 0} services, ${details.total_tickets || 0} tickets, ${details.attachments_downloaded || 0} attachments`
    }

    if (details.app === 'request') {
      return `${details.completed_groups || 0}/${details.total_groups || 0} groups, ${details.total_requests || 0} requests`
    }

    return details.structure_path || 'No execution summary yet'
  }

  const getDestinationAuthMethodLabel = (auth = {}) => {
    if (auth.auth_method === 'service_account' || auth.service_account_json_encrypted) {
      return 'Service Account'
    }
    if (auth.connection_id) {
      return 'OAuth User'
    }
    return 'Not configured'
  }

  const getDestinationIdentityLabel = (auth = {}) => {
    return auth.service_account_email || auth.client_email || auth.email || null
  }

  const renderTagCollection = (items, { color = 'default', max = 8 } = {}) => {
    if (!Array.isArray(items) || items.length === 0) {
      return <Text type="secondary">—</Text>
    }

    const visibleItems = items.slice(0, max)
    const hiddenCount = items.length - visibleItems.length

    return (
      <Space size={[6, 6]} wrap>
        {visibleItems.map(item => (
          <Tag key={String(item)} color={color}>{item}</Tag>
        ))}
        {hiddenCount > 0 && <Tag>+{hiddenCount} more</Tag>}
      </Space>
    )
  }

  const fetchFlowDetails = async (flowId, summaryRecord = null) => {
    setLoadingFlowDetails(true)
    try {
      const [flowResult, runsResult] = await Promise.allSettled([
        axios.get(`${API_BASE}/api/backup-flows/${flowId}`),
        axios.get(`${API_BASE}/api/backup-flows/${flowId}/runs`, { params: { limit: 20 } }),
      ])

      if (flowResult.status !== 'fulfilled') {
        throw flowResult.reason
      }

      setDetailsFlow(flowResult.value.data)
      if (summaryRecord) {
        setDetailsFlowRecord(summaryRecord)
      }

      if (runsResult.status === 'fulfilled' && Array.isArray(runsResult.value.data)) {
        setDetailsRuns(runsResult.value.data)
      } else {
        setDetailsRuns([])
        if (runsResult.status === 'rejected') {
          message.warning('Loaded flow details, but could not load run history')
        }
      }
    } catch (err) {
      message.error('Failed to load backup flow details')
      console.error(err)
      setDetailsFlow(null)
      setDetailsRuns([])
      setDetailsDrawerOpen(false)
    } finally {
      setLoadingFlowDetails(false)
    }
  }

  const handleOpenFlowDetails = async (record) => {
    setDetailsFlowId(record.id)
    setDetailsFlowRecord(record)
    setDetailsFlow(null)
    setDetailsRuns([])
    setDetailsActiveTab('overview')
    setDetailsDrawerOpen(true)
    await fetchFlowDetails(record.id, record)
  }

  const handleRefreshFlowDetails = async () => {
    if (!detailsFlowId) return
    await fetchFlowDetails(detailsFlowId, detailsFlowRecord)
  }

  const renderFlowDetailsDrawer = () => {
    const source = detailsFlow?.source || {}
    const destination = detailsFlow?.destination || {}
    const auth = destination.auth || {}
    const structure = detailsFlow?.structure || {}
    const schedule = detailsFlow?.schedule || {}
    const appMeta = APP_META[source.app] || { color: '#64748b', icon: <CloudOutlined /> }
    const appConfig = APPS[source.app] || {}
    const objectLabels = appConfig.objectLabels || {}
    const selectedObjects = Array.isArray(structure.objects)
      ? structure.objects.map(objectId => objectLabels[objectId] || objectId)
      : []
    const selectedServices = Array.isArray(structure.service_ids)
      ? structure.service_ids.map(serviceId => `Service ${serviceId}`)
      : []
    const supportsRun = ['request', 'service'].includes(detailsFlowRecord?.app || source.app)
    const isPublished = detailsFlowRecord?.is_published === 1 || detailsFlow?.is_published === 1
    const runBlockedReason = detailsFlowRecord?.run_blocked_reason
    const runDisabled = !supportsRun || !isPublished || Boolean(runBlockedReason)

    const runFromDetailsButton = (
      <Button
        type="primary"
        icon={<PlayCircleOutlined />}
        disabled={runDisabled}
        onClick={() => handleRunFlow(detailsFlowRecord || {
          id: detailsFlowId,
          app: source.app,
          run_blocked_reason: runBlockedReason,
        }, {
          onStarted: async () => {
            setDetailsActiveTab('runs')
            await fetchFlowDetails(detailsFlowId || detailsFlowRecord?.id, detailsFlowRecord)
          }
        })}
      >
        Run Now
      </Button>
    )

    const runHistoryColumns = [
      {
        title: 'Started',
        dataIndex: 'started_at',
        key: 'started_at',
        width: 180,
        render: (_, record) => (
          <div>
            <div style={{ fontWeight: 600 }}>{formatDateTime(record.started_at)}</div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Completed: {formatDateTime(record.completed_at)}
            </Text>
          </div>
        )
      },
      {
        title: 'Status',
        dataIndex: 'status',
        key: 'status',
        width: 120,
        render: status => getFlowRunStatusTag(status)
      },
      {
        title: 'Progress',
        key: 'progress',
        width: 180,
        render: (_, record) => (
          <Progress
            percent={getHistoryRunProgressPercent(record)}
            status={RUN_PROGRESS_STATUS[record.status] || 'normal'}
            size="small"
          />
        )
      },
      {
        title: 'Details',
        key: 'details',
        render: (_, record) => (
          <div>
            <div style={{ fontWeight: 600 }}>{getHistoryRunStepLabel(record)}</div>
            <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
              {getHistoryRunSummary(record)}
            </Text>
            <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
              Triggered by: {record.triggered_by || 'manual'}
            </Text>
            {record.error_message && (
              <Text type="danger" style={{ display: 'block', fontSize: 12, marginTop: 4 }}>
                {record.error_message}
              </Text>
            )}
          </div>
        )
      }
    ]

    const tabs = [
      {
        key: 'overview',
        label: 'Overview',
        children: detailsFlow ? (
          <Row gutter={[16, 16]}>
            <Col xs={24} lg={12}>
              <Card title="Flow Summary" size="small">
                <Descriptions column={1} size="small" colon={false}>
                  <Descriptions.Item label="Name">{renderFallbackValue(detailsFlow.name)}</Descriptions.Item>
                  <Descriptions.Item label="App">
                    <Space>
                      <span style={{ color: appMeta.color, display: 'inline-flex' }}>{appMeta.icon}</span>
                      <span>{renderFallbackValue(source.app_name || source.app)}</span>
                    </Space>
                  </Descriptions.Item>
                  <Descriptions.Item label="Backup Type">
                    {detailsFlow.backup_type
                      ? <Tag color={(BACKUP_TYPE_TAG[detailsFlow.backup_type] || {}).color || 'default'}>{(BACKUP_TYPE_TAG[detailsFlow.backup_type] || {}).label || detailsFlow.backup_type}</Tag>
                      : <Text type="secondary">—</Text>
                    }
                  </Descriptions.Item>
                  <Descriptions.Item label="Lifecycle">
                    <Space size={4} wrap>
                      {detailsFlow.is_draft === 1 ? <Tag color="gold">Draft</Tag> : <Tag color="cyan">Ready</Tag>}
                      {detailsFlow.is_published === 1 ? <Tag color="green">Published</Tag> : <Tag>Unpublished</Tag>}
                      <Tag color={detailsFlow.status === 'active' ? 'green' : 'default'}>{detailsFlow.status || 'unknown'}</Tag>
                    </Space>
                  </Descriptions.Item>
                  <Descriptions.Item label="Created">{formatDateTime(detailsFlow.created_at)}</Descriptions.Item>
                  <Descriptions.Item label="Updated">{formatDateTime(detailsFlow.updated_at)}</Descriptions.Item>
                </Descriptions>
              </Card>
            </Col>
            <Col xs={24} lg={12}>
              <Card title="Last Run" size="small">
                <Descriptions column={1} size="small" colon={false}>
                  <Descriptions.Item label="Status">
                    {detailsFlow.last_run_status ? getFlowRunStatusTag(detailsFlow.last_run_status) : <Text type="secondary">Never run</Text>}
                  </Descriptions.Item>
                  <Descriptions.Item label="Started">{formatDateTime(detailsFlow.last_run_at)}</Descriptions.Item>
                  <Descriptions.Item label="Message">{renderFallbackValue(detailsFlow.last_run_message)}</Descriptions.Item>
                  <Descriptions.Item label="Run Availability">
                    {detailsFlowRecord?.run_blocked_reason
                      ? <Text type="danger">{detailsFlowRecord.run_blocked_reason}</Text>
                      : <Tag color="success">Runnable</Tag>
                    }
                  </Descriptions.Item>
                </Descriptions>
              </Card>
            </Col>
            <Col xs={24} lg={12}>
              <Card title="Source" size="small">
                <Descriptions column={1} size="small" colon={false}>
                  <Descriptions.Item label="App ID">{renderFallbackValue(source.app)}</Descriptions.Item>
                  <Descriptions.Item label="Domain">{renderFallbackValue(source.domain)}</Descriptions.Item>
                  <Descriptions.Item label="Selected Objects">{renderTagCollection(selectedObjects, { color: appMeta.color === '#64748b' ? 'default' : 'processing' })}</Descriptions.Item>
                </Descriptions>
              </Card>
            </Col>
            <Col xs={24} lg={12}>
              <Card title="Destination" size="small">
                <Descriptions column={1} size="small" colon={false}>
                  <Descriptions.Item label="Type">{renderFallbackValue(destination.name || destination.type)}</Descriptions.Item>
                  <Descriptions.Item label="Auth Method">{renderFallbackValue(getDestinationAuthMethodLabel(auth))}</Descriptions.Item>
                  <Descriptions.Item label="Identity">{renderFallbackValue(getDestinationIdentityLabel(auth))}</Descriptions.Item>
                  <Descriptions.Item label="Drive">{renderFallbackValue(auth.drive_name || (auth.drive_id ? 'Shared Drive' : 'My Drive'))}</Descriptions.Item>
                  <Descriptions.Item label="Folder">{renderFallbackValue(auth.folder_name || auth.folder_id)}</Descriptions.Item>
                </Descriptions>
              </Card>
            </Col>
            <Col xs={24}>
              <Card title="Structure & Options" size="small">
                <Descriptions column={1} size="small" colon={false}>
                  <Descriptions.Item label="Objects">{renderTagCollection(selectedObjects, { color: 'blue' })}</Descriptions.Item>
                  <Descriptions.Item label="Selected Services">{renderTagCollection(selectedServices, { color: 'green', max: 6 })}</Descriptions.Item>
                  <Descriptions.Item label="Custom Fields">{renderFallbackValue(Array.isArray(structure.custom_fields) ? `${structure.custom_fields.length} field(s)` : null)}</Descriptions.Item>
                  <Descriptions.Item label="Export Formats">{renderFallbackValue(structure.export_formats ? `${Object.keys(structure.export_formats).length} configured format(s)` : null)}</Descriptions.Item>
                  <Descriptions.Item label="Service Options">
                    <Space size={[6, 6]} wrap>
                      {'include_catalog' in structure && <Tag color={structure.include_catalog ? 'success' : 'default'}>Catalog: {structure.include_catalog ? 'On' : 'Off'}</Tag>}
                      {'include_stages' in structure && <Tag color={structure.include_stages ? 'success' : 'default'}>Stages: {structure.include_stages ? 'On' : 'Off'}</Tag>}
                      {'include_ticket_details' in structure && <Tag color={structure.include_ticket_details ? 'success' : 'default'}>Ticket Details: {structure.include_ticket_details ? 'On' : 'Off'}</Tag>}
                      {'include_activity_logs' in structure && <Tag color={structure.include_activity_logs ? 'success' : 'default'}>Activity Logs: {structure.include_activity_logs ? 'On' : 'Off'}</Tag>}
                      {'ticket_limit_per_service' in structure && <Tag>Ticket limit: {structure.ticket_limit_per_service}</Tag>}
                      {!('include_catalog' in structure) && !('include_stages' in structure) && !('include_ticket_details' in structure) && !('include_activity_logs' in structure) && !('ticket_limit_per_service' in structure) && <Text type="secondary">—</Text>}
                    </Space>
                  </Descriptions.Item>
                  <Descriptions.Item label="Schedule">
                    {schedule.type
                      ? (
                        <Space size={[6, 6]} wrap>
                          <Tag color={schedule.enabled === false ? 'default' : 'blue'}>{schedule.type}</Tag>
                          {schedule.time && <Tag>{schedule.time}</Tag>}
                          {typeof schedule.day_of_week === 'number' && <Tag>Weekday: {schedule.day_of_week}</Tag>}
                          {typeof schedule.day_of_month === 'number' && <Tag>Day: {schedule.day_of_month}</Tag>}
                        </Space>
                      )
                      : <Text type="secondary">Manual / not configured</Text>
                    }
                  </Descriptions.Item>
                </Descriptions>
              </Card>
            </Col>
          </Row>
        ) : (
          <Empty description="No flow details loaded" />
        )
      },
      {
        key: 'runs',
        label: `Run History${detailsRuns.length ? ` (${detailsRuns.length})` : ''}`,
        children: (
          <Card size="small" bodyStyle={{ padding: 0 }}>
            <Table
              dataSource={detailsRuns}
              columns={runHistoryColumns}
              rowKey="id"
              size="small"
              pagination={{ pageSize: 5, hideOnSinglePage: detailsRuns.length <= 5 }}
              scroll={{ x: 860 }}
              locale={{
                emptyText: <Empty description="No runs recorded for this flow yet" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              }}
            />
          </Card>
        )
      },
      {
        key: 'actions',
        label: 'Actions',
        children: (
          <Row gutter={[16, 16]}>
            <Col xs={24} lg={14}>
              <Card title="Quick Actions" size="small">
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  {renderServiceRootArchiveNotice(detailsFlowRecord?.app || source.app, destination.type, { marginBottom: 4 })}
                  <Text type="secondary">
                    Manage this flow directly from the details panel.
                  </Text>
                  <Space wrap>
                    <Button
                      icon={<EditOutlined />}
                      onClick={async () => {
                        const targetFlowId = detailsFlowId || detailsFlowRecord?.id
                        if (!targetFlowId) return
                        setDetailsDrawerOpen(false)
                        await loadFlowForEdit(targetFlowId)
                      }}
                    >
                      Edit Flow
                    </Button>
                    {runBlockedReason ? (
                      <Tooltip title={runBlockedReason}>
                        <span>{runFromDetailsButton}</span>
                      </Tooltip>
                    ) : runFromDetailsButton}
                    <Button
                      danger
                      icon={<DeleteOutlined />}
                      disabled={!(detailsFlowRecord?.id || detailsFlowId)}
                      onClick={() => handleDeleteFlow(detailsFlowRecord || {
                        id: detailsFlowId,
                        name: detailsFlow?.name,
                      }, {
                        onDeleted: () => {
                          setDetailsDrawerOpen(false)
                          setDetailsFlowId(null)
                          setDetailsFlowRecord(null)
                          setDetailsFlow(null)
                          setDetailsRuns([])
                        }
                      })}
                    >
                      Delete Flow
                    </Button>
                  </Space>
                </Space>
              </Card>
            </Col>
            <Col xs={24} lg={10}>
              <Card title="Run Availability" size="small">
                <Space direction="vertical" size={10} style={{ width: '100%' }}>
                  <Text>
                    Publish status:
                    <Tag color={isPublished ? 'green' : 'default'} style={{ marginInlineStart: 8 }}>
                      {isPublished ? 'Published' : 'Unpublished'}
                    </Tag>
                  </Text>
                  <Text>
                    App support:
                    <Tag color={supportsRun ? 'blue' : 'default'} style={{ marginInlineStart: 8 }}>
                      {supportsRun ? 'Runnable' : 'Not supported'}
                    </Tag>
                  </Text>
                  {runBlockedReason ? (
                    <Alert type="warning" showIcon message="Run is blocked" description={runBlockedReason} />
                  ) : (
                    <Alert type="success" showIcon message="Run is available" description="You can trigger this flow directly from the details drawer." />
                  )}
                </Space>
              </Card>
            </Col>
          </Row>
        )
      }
    ]

    return (
      <Drawer
        title={detailsFlow?.name || detailsFlowRecord?.name || 'Backup Flow Details'}
        open={detailsDrawerOpen}
        onClose={() => setDetailsDrawerOpen(false)}
        width={880}
        extra={
          <Space>
            {runBlockedReason ? (
              <Tooltip title={runBlockedReason}>
                <span>{runFromDetailsButton}</span>
              </Tooltip>
            ) : runFromDetailsButton}
            <Button icon={<ReloadOutlined />} onClick={handleRefreshFlowDetails} loading={loadingFlowDetails}>
              Refresh
            </Button>
          </Space>
        }
      >
        <Spin spinning={loadingFlowDetails}>
          {detailsFlow ? (
            <Tabs activeKey={detailsActiveTab} onChange={setDetailsActiveTab} items={tabs} />
          ) : (
            <Empty description="Select a flow to inspect its details" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          )}
        </Spin>
      </Drawer>
    )
  }

  const handleDeleteFlow = (record, options = {}) => {
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
          if (typeof options.onDeleted === 'function') {
            options.onDeleted()
          }
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

  const handleRunFlow = async (record, options = {}) => {
    if (!['request', 'service'].includes(record.app)) {
      message.warning('Run is currently supported only for Request and Service flows')
      return false
    }
    if (record.run_blocked_reason) {
      message.error(record.run_blocked_reason)
      return false
    }
    try {
      await axios.post(`${API_BASE}/api/backup-flows/${record.id}/run`)
      message.success('Backup flow started')
      fetchFlows()
      if (typeof options.onStarted === 'function') {
        await options.onStarted()
      }
      return true
    } catch (err) {
      message.error(err.response?.data?.detail || 'Failed to run flow')
      return false
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
        width: 320,
        render: (_, record) => {
          const runButton = (
            <Button
              size="small"
              type="primary"
              icon={<PlayCircleOutlined />}
              disabled={Boolean(record.run_blocked_reason)}
              onClick={() => handleRunFlow(record)}
            >
              Run
            </Button>
          )

          return (
          <Space size={4} wrap>
            <Button
              size="small"
              icon={<EyeOutlined />}
              onClick={() => handleOpenFlowDetails(record)}
            >
              Details
            </Button>
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
            {record.is_published === 1 && ['request', 'service'].includes(record.app) && (
              record.run_blocked_reason ? (
                <Tooltip title={record.run_blocked_reason}>
                  <span>{runButton}</span>
                </Tooltip>
              ) : record.app === 'service' && record.destination_type === 'gdrive' ? (
                <Tooltip title="Khi run lại, Base Service cũ sẽ được chuyển vào Google Drive Trash trước khi hệ thống tạo cây backup mới.">
                  <span>{runButton}</span>
                </Tooltip>
              ) : runButton
            )}
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={() => handleDeleteFlow(record)}
            />
          </Space>
        )}
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
    const isServiceReviewStep = isServiceApp && currentStep === totalSteps - 1
    const isCondensedServiceAppObjectsStep = usesCondensedServiceWizard && currentStep === 0
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
        <Steps current={currentStep} items={steps} style={{ marginBottom: 32, flexShrink: 0 }} />

        <div style={isServiceReviewStep ? { marginBottom: 24 } : { minHeight: 300, marginBottom: 24 }}>
          {renderStepContent()}
        </div>

        {!isServiceReviewStep && !isCondensedServiceAppObjectsStep && (
          <div style={{ display: 'flex', justifyContent: 'space-between', flexShrink: 0 }}>
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
                <>
                  <Button type="primary" size="large" icon={isEdit ? <EditOutlined /> : <RocketOutlined />} onClick={() => handleFinish(false)}>
                    {isEdit ? 'Save Changes' : 'Create Backup Flow'}
                  </Button>
                  {['request', 'service'].includes(currentApp?.id || '') && (
                    <Button size="large" icon={<PlayCircleOutlined />} onClick={() => handleFinish(true)}>
                      {isEdit ? 'Save & Run' : 'Create & Run'}
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </Card>
    </>
  )}

  const renderStepContent = () => {
    if (usesCondensedServiceWizard) {
      switch (currentStep) {
        case 0: return renderStep1()
        case 1: return renderGenericStep3()
        case 2: return renderGenericStep4()
        default: return null
      }
    }

    if (isRequestApp) {
      switch (currentStep) {
        case 0: return renderStep1()
        case 1: return renderRequestStep2()
        case 2: return renderRequestStep3()
        case 3: return hasServiceAccountStep ? renderServiceAccountStep() : renderRequestStep4()
        case 4: return renderRequestStep4()
        default: return null
      }
    } else {
      switch (currentStep) {
        case 0: return renderStep1()
        case 1: return renderGenericStep2()
        case 2: return renderGenericStep3()
        case 3: return hasServiceAccountStep ? renderServiceAccountStep() : renderGenericStep4()
        case 4: return renderGenericStep4()
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

      {renderFlowDetailsDrawer()}

      <Modal
        title="Choose App"
        open={showAppSelectionModal}
        onCancel={() => setShowAppSelectionModal(false)}
        footer={null}
        width={900}
      >
        <Paragraph type="secondary" style={{ marginBottom: 16 }}>
          Chọn app trong modal này. Nếu bạn chọn Service, form domain và access token sẽ hiện ngay ở step hiện tại để tiếp tục cấu hình source.
        </Paragraph>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
          {Object.values(APPS).map(app => (
            <Card
              key={app.id}
              hoverable
              onClick={() => handleAppSelection(app.id)}
              style={{
                border: selectedApp === app.id ? `2px solid ${app.color}` : '1px solid #d9d9d9',
                cursor: 'pointer',
                backgroundColor: selectedApp === app.id ? app.bg : '#fff'
              }}
            >
              <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                <div style={{
                  fontSize: 32,
                  color: app.color,
                  backgroundColor: app.bg,
                  padding: 10,
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
            </Card>
          ))}
        </div>
      </Modal>

      <Modal
        title="Configure Google OAuth"
        open={googleConfigModalOpen}
        onCancel={() => {
          if (googleConfigSaving) return
          setGoogleConfigModalOpen(false)
          setGoogleConfigError('')
        }}
        footer={[
          <Button
            key="cancel"
            onClick={() => {
              setGoogleConfigModalOpen(false)
              setGoogleConfigError('')
            }}
            disabled={googleConfigSaving}
          >
            Cancel
          </Button>,
          <Button
            key="save-connect"
            type="primary"
            loading={googleConfigSaving}
            onClick={handleSaveGoogleConfigAndConnect}
          >
            Save & Connect Google
          </Button>
        ]}
        width={640}
      >
        <Paragraph type="secondary" style={{ marginBottom: 16 }}>
          Google OAuth chưa được cấu hình cho hệ thống này. Bạn có thể nhập trực tiếp <strong>Client ID</strong>, <strong>Client Secret</strong> và <strong>Redirect URI</strong> ngay tại đây rồi kết nối tiếp.
        </Paragraph>

        {googleConfigError && (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 16 }}
            message={googleConfigError}
          />
        )}

        {googleConfigLoading ? (
          <div style={{ textAlign: 'center', padding: 24 }}>
            <Spin />
          </div>
        ) : (
          <Form form={googleConfigForm} layout="vertical">
            <Form.Item
              label="Client ID"
              name="client_id"
              rules={[{ required: true, message: 'Client ID is required' }]}
            >
              <Input placeholder="123456789-abc.apps.googleusercontent.com" />
            </Form.Item>

            <Form.Item
              label="Client Secret"
              name="client_secret"
              extra={googleSecretSet
                ? 'A secret is already stored. Leave this blank to keep the existing one.'
                : 'Stored encrypted in the database.'}
            >
              <Input.Password placeholder={googleSecretSet ? 'Leave blank to keep current secret' : 'GOCSPX-xxxxxxxxxxxxxxxx'} />
            </Form.Item>

            <Form.Item
              label="Redirect URI"
              name="redirect_uri"
              rules={[{ required: true, message: 'Redirect URI is required' }]}
            >
              <Input placeholder={DEFAULT_GOOGLE_REDIRECT} />
            </Form.Item>

            <Alert
              type="info"
              showIcon
              message="Google Cloud Console reminder"
              description={`Authorized redirect URI must include ${googleRedirectUri || DEFAULT_GOOGLE_REDIRECT}`}
            />
          </Form>
        )}
      </Modal>

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

            {isServiceAccountDestinationAuth && (
              <>
                <Divider style={{ margin: '4px 0' }}>Shared to this service account</Divider>

                <Alert
                  type="info"
                  showIcon
                  message="Need a directly shared folder?"
                  description="Paste the Google Drive folder link or search folders shared directly to this service account. Items tagged 'Direct share in My Drive' are browse-only for service-account backups; only items tagged 'Shared Drive' can be used as the final destination."
                />

                <Input.Search
                  value={sharedFolderReference}
                  onChange={e => setSharedFolderReference(e.target.value)}
                  onSearch={handleResolveSharedFolder}
                  enterButton="Use folder"
                  loading={resolvingSharedFolder}
                  placeholder="Paste Google Drive folder link or folder ID"
                />

                <Input.Search
                  value={sharedFolderQuery}
                  onChange={e => setSharedFolderQuery(e.target.value)}
                  onSearch={value => loadSharedFolders(value.trim())}
                  enterButton="Search shared folders"
                  loading={loadingSharedFolders}
                  placeholder="Search by folder name shared to this service account"
                />

                <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 8 }}>
                  {loadingSharedFolders ? (
                    <div style={{ textAlign: 'center', padding: 24, color: '#94a3b8' }}>Loading shared folders...</div>
                  ) : sharedFolders.length === 0 ? (
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description="No directly shared folders found for this service account"
                      style={{ margin: 0, padding: '24px 12px' }}
                    />
                  ) : (
                    sharedFolders.map(folder => (
                      <div
                        key={folder.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          padding: '10px 14px',
                          borderBottom: '1px solid #f1f5f9',
                        }}
                      >
                        <FolderOutlined style={{ color: '#f59e0b', fontSize: 18 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 500 }}>{folder.name}</div>
                          <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                            Drive: {resolveDriveName(folder.drive_id, folder.drive_name || null)}
                          </div>
                          <Space size={6} wrap style={{ marginTop: 4 }}>
                            <Tag color="blue">Direct share</Tag>
                            {folder.drive_id ? <Tag color="green">Shared Drive</Tag> : <Tag color="gold">My Drive only</Tag>}
                          </Space>
                        </div>
                        <Space size={8}>
                          <Button size="small" onClick={() => openFolderLocation(folder)}>Open</Button>
                          {folder.drive_id ? (
                            <Button size="small" type="primary" onClick={() => applyGoogleFolderSelection(folder)}>Use</Button>
                          ) : (
                            <Tooltip title="This folder is directly shared from My Drive, not stored in a Shared Drive, so the service account cannot upload backup files there.">
                              <span>
                                <Button size="small" type="primary" disabled>Use</Button>
                              </span>
                            </Tooltip>
                          )}
                        </Space>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}

            {/* Folder list */}
            <div style={{ maxHeight: isServiceAccountDestinationAuth ? 220 : 320, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 8 }}>
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

      <Modal
        title="Select Services for This Flow"
        open={serviceSelectorModalOpen}
        onCancel={closeServiceSelectorModal}
        width={1200}
        footer={[
          <Button key="refresh" onClick={() => loadServicePreview(draftSelectedServiceIds)} loading={loadingServicePreview}>
            Refresh Source
          </Button>,
          <Button key="cancel" onClick={closeServiceSelectorModal}>
            Cancel
          </Button>,
          <Button
            key="apply"
            type="primary"
            onClick={applyServiceSelectorModal}
            disabled={!servicePreview}
          >
            Apply Selection
          </Button>
        ]}
      >
        <Paragraph type="secondary" style={{ marginBottom: 16 }}>
          Modal này hiển thị full danh sách service lấy từ API để bạn tick chọn đúng scope backup. Khi bấm Apply Selection, lựa chọn sẽ được giữ trong flow và sẽ được gửi theo `service_ids` lúc save hoặc save & run.
        </Paragraph>

        {loadingServicePreview ? (
          <div style={{ textAlign: 'center', padding: 24 }}>
            <Spin />
          </div>
        ) : !servicePreview ? (
          <Empty description="Load Service source preview first to choose services" />
        ) : (
          <>
            <Space size={8} wrap style={{ marginBottom: 16 }}>
              <Tag color="blue">{servicePreviewRows.length} services loaded</Tag>
              <Tag color={draftSelectedServiceIds.length ? 'green' : 'default'}>{draftSelectedServiceIds.length} selected</Tag>
            </Space>

            {!servicePreview.ticket_count_complete && (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 16 }}
                message={`Detailed preview loaded for ${servicePreview.detail_loaded_count || 0} services only`}
                description="Full danh sách service vẫn hiện đầy đủ. Nếu bạn đổi selection, bấm Refresh Source ngay trong modal để nạp lại sample ticket cho đúng nhóm service đang chọn."
              />
            )}

            {servicePreview.partial_error_count > 0 && (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 16 }}
                message={`Some services could not be previewed completely (${servicePreview.partial_error_count})`}
                description="Các service này vẫn có thể được tick chọn, nhưng phần preview stages hoặc tickets có thể chưa đầy đủ."
              />
            )}

            <div
              ref={servicePreviewListRef}
              style={{
                border: '1px solid #e2e8f0',
                borderRadius: 12,
                overflow: 'hidden',
                background: '#fff'
              }}
            >
              <Table
                size="small"
                dataSource={servicePreviewRows}
                rowKey="service_id"
                pagination={false}
                rowSelection={serviceSelectionRowSelection}
                scroll={{ x: 980, y: 460 }}
                columns={[
                  {
                    title: 'Service',
                    dataIndex: 'service_name',
                    key: 'service_name',
                    render: (_, record) => (
                      <div>
                        <div style={{ fontWeight: 700 }}>{record.service_name}</div>
                        <Text type="secondary" style={{ fontSize: 12 }}>ID: {record.service_id}</Text>
                        {record.preview_error && (
                          <div style={{ marginTop: 4 }}>
                            <Text type="warning" style={{ fontSize: 12 }}>{record.preview_error}</Text>
                          </div>
                        )}
                      </div>
                    )
                  },
                  {
                    title: 'Stages',
                    dataIndex: 'stage_count',
                    key: 'stage_count',
                    width: 90,
                    render: value => value ?? '—'
                  },
                  {
                    title: 'Tickets',
                    dataIndex: 'ticket_count',
                    key: 'ticket_count',
                    width: 90,
                    render: value => value ?? '—'
                  },
                  {
                    title: 'Sample Tickets',
                    key: 'sample_tickets',
                    render: (_, record) => (
                      <Space direction="vertical" size={2}>
                        {record.detail_loaded ? (
                          (record.sample_tickets || []).length > 0 ? (
                            (record.sample_tickets || []).map(ticket => (
                              <Text key={ticket.ticket_id} style={{ fontSize: 12 }}>
                                {ticket.ticket_code} - {ticket.ticket_name}
                              </Text>
                            ))
                          ) : (
                            <Text type="secondary" style={{ fontSize: 12 }}>No sample tickets</Text>
                          )
                        ) : (
                          <Text type="secondary" style={{ fontSize: 12 }}>Refresh after selecting this service</Text>
                        )}
                      </Space>
                    )
                  }
                ]}
              />
            </div>
          </>
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
                  setServiceAccountAnalysis(null)
                  setServiceAccountFileName('')
                  setServiceAccountError('')
                  setServiceBackupSetupSaved(false)
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

export default BackupFlowPage



