import React, { useState, useEffect, useRef } from 'react'
import api from '@shared/api/client'
import {
  Inbox, FolderKanban, Building2, Headphones,
  Cloud, Check, Eye, EyeOff,
  FileSpreadsheet, Folder, Database,
  Lock, Rocket, Plus,
  ArrowLeft, Play, Pencil, Trash2,
  Clock, RefreshCw, Loader2, X,
  ChevronRight, Info, CheckCircle, Globe
} from 'lucide-react'
import { Tag, Alert, Spinner, SpinCenter, Progress, Modal, Drawer, Tabs, Empty, message } from '@packages/ui/src/components/common/ui'
import AppLayout from '@packages/ui/src/components/layout/AppLayout'

// App definitions
const APPS = {
  request: {
    id: 'request',
    name: 'Request',
    icon: <Inbox className="w-5 h-5" />,
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
    icon: <FolderKanban className="w-5 h-5" />,
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
    icon: <Building2 className="w-5 h-5" />,
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
    icon: <Headphones className="w-5 h-5" />,
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

const DEFAULT_GOOGLE_REDIRECT = `${window.location.origin}/api/google/callback`
const SERVICE_ACCOUNT_SHARED_DRIVE_MESSAGE = 'This folder is shared with the service account, but it still belongs to regular My Drive, not a Shared Drive. Google service accounts can browse directly shared My Drive folders, but they cannot upload backup files there because they have no storage quota. Choose a folder inside a Shared Drive or switch this destination to OAuth User authentication.'

const BackupFlowPage = () => {
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
      const res = await api.get(`/api/backup-flows`)
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
      const res = await api.get(`/api/backup-flows/${flowId}`)
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
  const [gcClientId, setGcClientId] = useState('')
  const [gcClientSecret, setGcClientSecret] = useState('')
  const [gcRedirectUri, setGcRedirectUri] = useState(DEFAULT_GOOGLE_REDIRECT)
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
        { title: 'Nguồn & Kết nối' },
        { title: 'Cấu hình lưu trữ' },
        { title: 'Xem lại & Tạo' }
      ]
    }

    if (isRequestApp) {
      return [
        { title: 'Đặt tên & Chọn App' },
        { title: 'Thông tin kết nối' },
        { title: 'Backup & Lưu trữ' },
        ...(hasServiceAccountStep ? [{ title: 'Xác thực Google' }] : []),
        { title: 'Xem lại & Tạo' }
      ]
    } else if (isServiceApp) {
      return [
        { title: 'Đặt tên & Chọn App' },
        { title: 'Chọn dữ liệu' },
        { title: 'Backup & Lưu trữ' },
        ...(hasServiceAccountStep ? [{ title: 'Xác thực Google' }] : []),
        { title: 'Xem lại & Tạo' }
      ]
    } else {
      return [
        { title: 'Đặt tên & Chọn App' },
        { title: 'Chọn dữ liệu' },
        { title: 'Kết nối nguồn' },
        { title: 'Xem lại & Tạo' }
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
      await api.patch(`/api/backup-flows/${draftFlowId}/autosave`, payload).catch(() => {})
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
      await api.post(`/api/backup-flows/${draftFlowId}/save`, savePayload)
      saveCompleted = true
      if (runAfterSave) {
        await api.post(`/api/backup-flows/${draftFlowId}/run`)
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
      <div className="flex flex-wrap gap-1.5 mt-1.5">
        <Tag color={summary.color}>{summary.tag}</Tag>
        <Tag color="default">{summary.driveName}</Tag>
        <span className="text-xs text-gray-400 self-center">{summary.help}</span>
      </div>
    )
  }

  const renderServiceRootArchiveNotice = (appId, destinationType = 'gdrive') => {
    if (appId !== 'service' || destinationType !== 'gdrive') return null
    return (
      <Alert
        type="info"
        message="Rerun sẽ đưa Base Service cũ vào Trash"
        description="Mỗi lần chạy backup Service mới, hệ thống sẽ chuyển folder Base Service cũ vào Google Drive Trash trước khi tạo lại cây Base Service mới."
        className="mb-3"
      />
    )
  }

  const autosaveDestinationAuth = async (
    googleAuthState = googleAuth,
    authMethod = googleAuthMethod,
    serviceAccountAnalysisState = serviceAccountAnalysis,
  ) => {
    if (!draftFlowId || !storageDestination) return

    await api.patch(`/api/backup-flows/${draftFlowId}/autosave`, {
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
      const res = await api.post(`/api/google/service-account/analyze`, {
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
      const res = await api.post(`/api/connectors/service/preview`, {
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
      const res = await api.get(`/api/settings/google`)
      const data = res.data || {}
      const redirectUri = data.redirect_uri || DEFAULT_GOOGLE_REDIRECT
      setGoogleRedirectUri(redirectUri)
      setGoogleSecretSet(!!(data.client_secret && data.client_secret !== ''))
      setGcClientId(data.client_id || '')
      setGcClientSecret('')
      setGcRedirectUri(redirectUri)
    } catch {
      setGoogleRedirectUri(DEFAULT_GOOGLE_REDIRECT)
      setGoogleSecretSet(false)
      setGcClientId('')
      setGcClientSecret('')
      setGcRedirectUri(DEFAULT_GOOGLE_REDIRECT)
    } finally {
      setGoogleConfigLoading(false)
    }
  }

  const handleGoogleConnect = async () => {
    try {
      const res = await api.get(`/api/google/auth-url`)
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
      const res = await api.post(`/api/google/service-account/shared-folders`, {
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
      const res = await api.post(`/api/google/service-account/folder-info`, {
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
        ? await api.post(`/api/google/service-account/drives`, {
            auth: buildGoogleDestinationAuth()
          })
        : await api.get(`/api/google/drives`, {
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
        ? await api.post(`/api/google/service-account/folders`, {
            auth: buildGoogleDestinationAuth(),
            parent_id: parentId,
            drive_id: driveId || null,
          })
        : await api.get(`/api/google/folders`, {
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
    <span
      title={content}
      className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-gray-300 text-gray-500 text-[10px] font-bold cursor-help bg-white shrink-0"
    >
      !
    </span>
  )

  const renderStep1 = () => {
    if (usesCondensedServiceWizard) {
      return (
        <div className="max-w-2xl space-y-8">
          {/* Flow name */}
          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-1">
              Tên luồng backup <span className="text-red-500">*</span>
            </label>
            <p className="text-xs text-gray-400 mb-2">Đặt tên để dễ nhận biết sau này, ví dụ: "Backup hàng ngày - Service IT"</p>
            <input
              className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
              placeholder="VD: Backup hàng ngày - Service IT"
              value={flowName}
              onChange={e => setFlowName(e.target.value)}
              maxLength={120}
            />
          </div>

          {/* App picker */}
          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-1">
              Ứng dụng nguồn <span className="text-red-500">*</span>
            </label>
            <p className="text-xs text-gray-400 mb-3">Chọn ứng dụng mà bạn muốn sao lưu dữ liệu từ đó</p>
            <button
              onClick={() => setShowAppSelectionModal(true)}
              className={`w-full flex items-center gap-4 px-4 py-4 rounded-xl border-2 text-left transition-all ${
                currentApp
                  ? 'border-solid shadow-sm'
                  : 'border-dashed border-gray-200 hover:border-blue-300 bg-white'
              }`}
              style={currentApp ? { borderColor: currentApp.color, backgroundColor: currentApp.bg } : {}}
            >
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ backgroundColor: currentApp ? `${currentApp.color}20` : '#f3f4f6', color: currentApp?.color || '#9ca3af' }}
              >
                {currentApp?.icon || <Cloud className="w-5 h-5" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-semibold ${currentApp ? '' : 'text-gray-400'}`}
                  style={currentApp ? { color: currentApp.color } : {}}>
                  {currentApp ? currentApp.name : 'Nhấn để chọn ứng dụng…'}
                </p>
                {currentApp
                  ? <p className="text-xs mt-0.5" style={{ color: `${currentApp.color}99` }}>{currentApp.description}</p>
                  : <p className="text-xs text-gray-400 mt-0.5">Request, Workflow, WeWork, Service…</p>}
              </div>
              {currentApp
                ? <CheckCircle className="w-5 h-5 shrink-0" style={{ color: currentApp.color }} />
                : <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />}
            </button>
          </div>

          {/* Service credentials */}
          {selectedApp === 'service' && (
            <>
              <div className="border border-blue-100 rounded-2xl p-5 bg-blue-50/50 space-y-5">
                <div className="flex items-center gap-2">
                  <Globe className="w-4 h-4 text-blue-600" />
                  <h4 className="text-sm font-bold text-blue-800">Thông tin kết nối Service</h4>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    Địa chỉ website (Domain) <span className="text-red-500">*</span>
                  </label>
                  <p className="text-xs text-gray-400 mb-2">
                    Đây là địa chỉ truy cập hệ thống Service của bạn, ví dụ: <code className="bg-white px-1 rounded">congty.base.com.vn</code>
                  </p>
                  <input
                    className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    placeholder="VD: congty.base.com.vn"
                    value={domain}
                    onChange={(e) => { setServiceSourceSetupSaved(false); setDomain(e.target.value); setServicePreview(null) }}
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    Mã truy cập API (Access Token) <span className="text-red-500">*</span>
                  </label>
                  <p className="text-xs text-gray-400 mb-2">
                    Lấy từ Service → <strong>Cài đặt</strong> → <strong>API Keys</strong> → chọn token loại <em>access_token_v2</em> của Base Account
                  </p>
                  <div className="relative">
                    <input
                      type={showToken ? 'text' : 'password'}
                      className="w-full border border-gray-300 rounded-xl px-4 py-3 pr-12 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                      placeholder="Dán mã truy cập vào đây…"
                      value={accessToken}
                      onChange={(e) => { setServiceSourceSetupSaved(false); setAccessToken(e.target.value); setServicePreview(null) }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowToken(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1"
                      title={showToken ? 'Ẩn mã' : 'Hiện mã'}
                    >
                      {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Objects selection */}
              {(domain.trim() && accessToken.trim()) && (
                <div>
                  <label className="block text-sm font-semibold text-gray-800 mb-1">
                    Dữ liệu cần sao lưu <span className="text-red-500">*</span>
                  </label>
                  <p className="text-xs text-gray-400 mb-3">Chọn loại dữ liệu bạn muốn đưa vào bản backup này</p>
                  <div className="space-y-2">
                    <div
                      onClick={handleSelectAllObjects}
                      className="border-2 border-dashed border-gray-200 rounded-xl px-4 py-3 cursor-pointer hover:border-blue-300 hover:bg-blue-50/30 flex items-center gap-3 transition-all"
                    >
                      <div className={`w-5 h-5 rounded flex items-center justify-center border-2 transition-all ${
                        selectedObjects.length === currentApp.objects.length
                          ? 'bg-blue-600 border-blue-600'
                          : 'border-gray-300'
                      }`}>
                        {selectedObjects.length === currentApp.objects.length && <Check className="w-3 h-3 text-white" />}
                      </div>
                      <span className="font-semibold text-sm text-gray-700">Chọn tất cả</span>
                      <span className="text-xs text-gray-400 ml-auto">{currentApp.objects.length} loại dữ liệu</span>
                    </div>
                    {currentApp.objects.map(obj => (
                      <div
                        key={obj}
                        onClick={() => handleObjectToggle(obj)}
                        className="border-2 rounded-xl px-4 py-3.5 cursor-pointer transition-all flex items-center gap-3"
                        style={{
                          borderColor: selectedObjects.includes(obj) ? currentApp.color : '#e5e7eb',
                          backgroundColor: selectedObjects.includes(obj) ? currentApp.bg : '#fff',
                        }}
                      >
                        <div className={`w-5 h-5 rounded flex items-center justify-center border-2 transition-all shrink-0`}
                          style={{
                            backgroundColor: selectedObjects.includes(obj) ? currentApp.color : 'transparent',
                            borderColor: selectedObjects.includes(obj) ? currentApp.color : '#d1d5db',
                          }}>
                          {selectedObjects.includes(obj) && <Check className="w-3 h-3 text-white" />}
                        </div>
                        <div className="flex-1">
                          <div className="font-semibold text-sm" style={{ color: selectedObjects.includes(obj) ? currentApp.color : '#374151' }}>
                            {currentApp.objectLabels[obj]}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Continue button */}
              <div className="pt-2">
                <button
                  onClick={next}
                  disabled={!flowName.trim() || !domain.trim() || !accessToken.trim() || selectedObjects.length === 0}
                  className="flex items-center gap-2 px-8 py-3 text-sm bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-semibold shadow-sm shadow-blue-200"
                >
                  Tiếp theo <ChevronRight className="w-4 h-4" />
                </button>
                {(!flowName.trim() || !domain.trim() || !accessToken.trim() || selectedObjects.length === 0) && (
                  <p className="text-xs text-amber-600 mt-2">
                    Vui lòng điền đầy đủ tên luồng, địa chỉ website, mã truy cập và chọn ít nhất 1 loại dữ liệu
                  </p>
                )}
              </div>
            </>
          )}

          {selectedApp && selectedApp !== 'service' && (
            <Alert type="info" message="Luồng này dùng giao diện chuẩn" description="Nhấn Tiếp theo ở thanh dưới để tiếp tục cấu hình." />
          )}
        </div>
      )
    }

    // Standard wizard (Request, Workflow, WeWork, Service non-condensed)
    return (
      <div className="max-w-2xl space-y-8">
        {/* Flow name */}
        <div>
          <label className="block text-sm font-semibold text-gray-800 mb-1">
            Tên luồng backup <span className="text-red-500">*</span>
          </label>
          <p className="text-xs text-gray-400 mb-2">Đặt tên dễ nhận biết, ví dụ: "Backup Request - Hàng tuần"</p>
          <input
            className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            placeholder="VD: Backup Request - Hàng tuần"
            value={flowName}
            onChange={e => setFlowName(e.target.value)}
            maxLength={120}
          />
        </div>

        {/* App selection */}
        <div>
          <label className="block text-sm font-semibold text-gray-800 mb-1">
            Chọn ứng dụng nguồn <span className="text-red-500">*</span>
          </label>
          <p className="text-xs text-gray-400 mb-4">Bạn muốn sao lưu dữ liệu từ ứng dụng nào?</p>

          <div className="grid grid-cols-2 gap-4">
            {Object.values(APPS).map(app => (
              <div
                key={app.id}
                onClick={() => handleAppSelection(app.id)}
                className="relative border-2 rounded-2xl p-5 cursor-pointer transition-all hover:shadow-md"
                style={{
                  borderColor: selectedApp === app.id ? app.color : '#e5e7eb',
                  backgroundColor: selectedApp === app.id ? app.bg : '#fff',
                }}
              >
                {selectedApp === app.id && (
                  <div className="absolute top-3 right-3">
                    <CheckCircle className="w-5 h-5" style={{ color: app.color }} />
                  </div>
                )}
                <div className="flex items-start gap-4">
                  <div
                    className="rounded-xl p-3 flex items-center justify-center shrink-0"
                    style={{ color: app.color, backgroundColor: `${app.color}18`, width: 52, height: 52 }}
                  >
                    {app.icon}
                  </div>
                  <div className="flex-1 min-w-0 pr-4">
                    <div className="font-bold text-sm mb-1" style={{ color: app.color }}>{app.name}</div>
                    <p className="text-xs text-gray-500 mb-3 leading-relaxed">{app.description}</p>
                    <div className="flex flex-wrap gap-1">
                      {app.objects.map(obj => (
                        <span
                          key={obj}
                          className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold"
                          style={{ backgroundColor: `${app.color}18`, color: app.color }}
                        >
                          {app.objectLabels[obj]}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // Shared backup setup UI (used by both service condensed step 2 AND request step 3)
  const renderBackupSetupSection = ({ onBackupTypeChange } = {}) => {
    const analysis = serviceAccountAnalysis || {}
    const availableDrives = Array.isArray(analysis.drives) ? analysis.drives : []
    const serviceAccountEmail = analysis.client_email || googleAuth?.service_account_email || googleAuth?.email
    const projectId = analysis.project_id || googleAuth?.project_id

    const BACKUP_TYPE_OPTIONS = [
      {
        id: 'structured',
        title: 'Bảng tính (Dữ liệu có cấu trúc)',
        desc: 'Xuất dữ liệu dạng bảng Excel/Spreadsheet — phù hợp để xem và phân tích',
        color: '#0284c7',
        icon: <FileSpreadsheet className="w-5 h-5" />,
        badge: 'Phổ biến',
      },
      {
        id: 'unstructured',
        title: 'File & Đính kèm',
        desc: 'Sao lưu file, hình ảnh, tài liệu đính kèm trong các ticket và yêu cầu',
        color: '#d97706',
        icon: <Folder className="w-5 h-5" />,
        badge: null,
      },
      {
        id: 'all',
        title: 'Toàn bộ (Khuyến nghị)',
        desc: 'Bao gồm cả bảng tính lẫn toàn bộ file đính kèm — bản backup đầy đủ nhất',
        color: '#7c3aed',
        icon: <Database className="w-5 h-5" />,
        badge: 'Đầy đủ nhất',
      },
    ]

    return (
      <div className="space-y-8">
        {/* Backup Type */}
        <div>
          <label className="block text-sm font-semibold text-gray-800 mb-1">
            Bạn muốn sao lưu dạng nào? <span className="text-red-500">*</span>
          </label>
          <p className="text-xs text-gray-400 mb-3">Chọn định dạng phù hợp với nhu cầu sử dụng sau này</p>
          <div className="space-y-2.5">
            {BACKUP_TYPE_OPTIONS.map(type => (
              <div
                key={type.id}
                onClick={() => {
                  setBackupType(type.id)
                  setServiceBackupSetupSaved(false)
                  if (onBackupTypeChange) onBackupTypeChange(type.id)
                }}
                className="flex items-center gap-4 p-4 rounded-2xl border-2 cursor-pointer transition-all"
                style={{
                  borderColor: backupType === type.id ? type.color : '#e5e7eb',
                  backgroundColor: backupType === type.id ? `${type.color}0f` : '#fff',
                }}
              >
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
                  style={{ backgroundColor: `${type.color}18`, color: type.color }}
                >
                  {type.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-bold text-sm" style={{ color: backupType === type.id ? type.color : '#1f2937' }}>
                      {type.title}
                    </span>
                    {type.badge && (
                      <span
                        className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold"
                        style={{ backgroundColor: `${type.color}20`, color: type.color }}
                      >
                        {type.badge}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 leading-relaxed">{type.desc}</p>
                </div>
                <div
                  className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all`}
                  style={{
                    borderColor: backupType === type.id ? type.color : '#d1d5db',
                    backgroundColor: backupType === type.id ? type.color : 'transparent',
                  }}
                >
                  {backupType === type.id && <Check className="w-3 h-3 text-white" />}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Destination */}
        <div>
          <label className="block text-sm font-semibold text-gray-800 mb-1">
            Lưu backup về đâu? <span className="text-red-500">*</span>
          </label>
          <p className="text-xs text-gray-400 mb-3">Chọn nơi lưu trữ bản backup trong Google</p>
          <div className="grid grid-cols-2 gap-3">
            {[
              {
                id: 'gdrive',
                title: 'Google Drive',
                desc: 'Lưu vào thư mục Drive — hỗ trợ mọi định dạng file',
                icon: <Folder className="w-5 h-5" />,
                color: '#1a73e8',
                best: backupType !== 'structured',
              },
              {
                id: 'gsheets',
                title: 'Google Sheets',
                desc: 'Tạo bảng tính trực tiếp trong Sheets',
                icon: <FileSpreadsheet className="w-5 h-5" />,
                color: '#0f9d58',
                best: backupType === 'structured',
              },
            ].filter(d => backupType !== 'unstructured' || d.id === 'gdrive').map(dest => (
              <div
                key={dest.id}
                onClick={() => selectDestination(dest.id)}
                className="relative border-2 rounded-2xl p-4 cursor-pointer transition-all"
                style={{
                  borderColor: storageDestination === dest.id ? dest.color : '#e5e7eb',
                  backgroundColor: storageDestination === dest.id ? `${dest.color}0d` : '#fff',
                }}
              >
                {dest.best && backupType && (
                  <span
                    className="absolute -top-2 left-3 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-white border"
                    style={{ borderColor: dest.color, color: dest.color }}
                  >
                    Phù hợp nhất
                  </span>
                )}
                <div className="flex items-start gap-3">
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                    style={{ backgroundColor: `${dest.color}18`, color: dest.color }}
                  >
                    {dest.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm mb-0.5" style={{ color: storageDestination === dest.id ? dest.color : '#1f2937' }}>
                      {dest.title}
                    </p>
                    <p className="text-xs text-gray-400 leading-relaxed">{dest.desc}</p>
                  </div>
                </div>
                {storageDestination === dest.id && (
                  <div className="absolute top-3 right-3">
                    <CheckCircle className="w-4 h-4" style={{ color: dest.color }} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Google Account */}
        {storageDestination && (
          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-1">
              Kết nối tài khoản Google <span className="text-red-500">*</span>
            </label>
            <p className="text-xs text-gray-400 mb-3">
              Cần kết nối Google để hệ thống có quyền ghi dữ liệu vào {storageDestination === 'gsheets' ? 'Google Sheets' : 'Google Drive'} của bạn
            </p>

            <div className="space-y-2.5">
              {[
                {
                  id: 'oauth',
                  title: 'Tài khoản Google cá nhân',
                  desc: 'Đăng nhập bằng tài khoản Google của bạn qua cửa sổ bật lên — cách đơn giản nhất',
                  color: '#2563eb',
                  recommended: true,
                },
                {
                  id: 'service_account',
                  title: 'Tài khoản dịch vụ (Service Account)',
                  desc: 'Dùng file JSON từ Google Cloud Console — phù hợp cho doanh nghiệp và tự động hóa',
                  color: '#7c3aed',
                  recommended: false,
                },
              ].map(method => (
                <div
                  key={method.id}
                  onClick={() => { setGoogleAuthMethod(method.id); setGoogleAuth(null); setServiceAccountAnalysis(null); setServiceAccountFileName(''); setServiceAccountError(''); setServiceBackupSetupSaved(false) }}
                  className="flex items-center gap-4 p-4 rounded-2xl border-2 cursor-pointer transition-all"
                  style={{
                    borderColor: googleAuthMethod === method.id ? method.color : '#e5e7eb',
                    backgroundColor: googleAuthMethod === method.id ? `${method.color}0d` : '#fff',
                  }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-bold text-sm" style={{ color: googleAuthMethod === method.id ? method.color : '#1f2937' }}>
                        {method.title}
                      </span>
                      {method.recommended && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700">
                          Dễ nhất
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 leading-relaxed">{method.desc}</p>
                  </div>
                  <div
                    className="w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0"
                    style={{
                      borderColor: googleAuthMethod === method.id ? method.color : '#d1d5db',
                      backgroundColor: googleAuthMethod === method.id ? method.color : 'transparent',
                    }}
                  >
                    {googleAuthMethod === method.id && <Check className="w-3 h-3 text-white" />}
                  </div>
                </div>
              ))}
            </div>

            {/* OAuth connect */}
            {googleAuthMethod === 'oauth' && (
              <div className="mt-4">
                {googleAuth ? (
                  <div className="bg-green-50 border border-green-200 rounded-2xl px-4 py-4 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      {googleAuth.picture_url
                        ? <img src={googleAuth.picture_url} alt="" className="w-10 h-10 rounded-full border-2 border-green-300" />
                        : <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center"><CheckCircle className="w-5 h-5 text-green-600" /></div>}
                      <div>
                        <div className="text-[10px] font-bold text-green-700 uppercase tracking-wide mb-0.5">Đã kết nối</div>
                        <div className="text-sm font-bold text-green-800">{googleAuth.display_name || googleAuth.email}</div>
                        <div className="text-xs text-green-600">{googleAuth.email}</div>
                      </div>
                    </div>
                    <button
                      onClick={handleGoogleDisconnect}
                      className="text-xs px-3 py-1.5 border border-red-300 text-red-600 rounded-lg hover:bg-red-50 transition-colors font-medium"
                    >
                      Ngắt kết nối
                    </button>
                  </div>
                ) : (
                  <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 space-y-3">
                    <p className="text-xs text-blue-600">
                      Nhấn nút bên dưới để đăng nhập Google. Một cửa sổ nhỏ sẽ hiện lên — hãy chọn tài khoản Google bạn muốn dùng để lưu backup.
                    </p>
                    <div className="flex gap-2 flex-wrap">
                      <button
                        onClick={handleGoogleConnect}
                        className="flex items-center gap-2 px-4 py-2.5 text-sm bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-semibold"
                      >
                        <Globe className="w-4 h-4" /> Đăng nhập Google
                      </button>
                      <button
                        onClick={openGoogleConfigModal}
                        className="px-4 py-2.5 text-sm border border-gray-300 text-gray-600 rounded-xl hover:bg-gray-50 transition-colors"
                      >
                        Cấu hình OAuth Client
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Service Account upload */}
            {googleAuthMethod === 'service_account' && (
              <div className="mt-4 space-y-3">
                <div className="border-2 border-dashed border-gray-200 rounded-2xl p-5 hover:border-purple-300 transition-colors">
                  <p className="text-sm font-semibold text-gray-700 mb-1">Tải lên file JSON Service Account</p>
                  <p className="text-xs text-gray-400 mb-3">
                    Tải file <code className="bg-gray-100 px-1 rounded">.json</code> từ Google Cloud Console → IAM & Admin → Service Accounts → Keys
                  </p>
                  <input
                    type="file"
                    accept=".json,application/json"
                    onChange={handleServiceAccountFileUpload}
                    className="text-sm text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border file:border-gray-300 file:text-xs file:font-medium file:bg-white file:text-gray-700 hover:file:bg-gray-50"
                  />
                  {serviceAccountFileName && (
                    <div className="flex items-center gap-1.5 mt-2 text-xs text-gray-500">
                      <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                      <span>Đã tải: {serviceAccountFileName}</span>
                    </div>
                  )}
                </div>

                {serviceAccountError && <Alert type="error" message={serviceAccountError} />}

                {serviceAccountAnalysisLoading && (
                  <div className="flex items-center gap-2 py-4 text-sm text-gray-500">
                    <Spinner /> <span>Đang phân tích file…</span>
                  </div>
                )}

                {serviceAccountEmail && !serviceAccountAnalysisLoading && (
                  <div className="bg-purple-50 border border-purple-200 rounded-2xl p-4 space-y-2">
                    <div className="flex items-center gap-2 mb-1">
                      <CheckCircle className="w-4 h-4 text-purple-600" />
                      <span className="text-sm font-bold text-purple-800">Xác nhận Service Account</span>
                    </div>
                    <div className="space-y-1.5 text-sm">
                      <div className="flex gap-2">
                        <span className="text-xs text-gray-400 w-20 shrink-0 pt-0.5">Email</span>
                        <span className="font-semibold text-gray-800 break-all">{serviceAccountEmail}</span>
                      </div>
                      <div className="flex gap-2">
                        <span className="text-xs text-gray-400 w-20 shrink-0 pt-0.5">Project</span>
                        <span className="font-semibold text-gray-800">{projectId || '—'}</span>
                      </div>
                      {availableDrives.length > 0 && (
                        <div className="flex gap-2">
                          <span className="text-xs text-gray-400 w-20 shrink-0 pt-0.5">Shared Drives</span>
                          <div className="flex flex-wrap gap-1">
                            {availableDrives.map(drive => <Tag key={drive.id} color="default">{drive.name}</Tag>)}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Folder picker */}
        {storageDestination === 'gdrive' && googleAuth && (
          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-1">
              Thư mục lưu trữ <span className="text-xs text-gray-400 font-normal">(tùy chọn)</span>
            </label>
            <p className="text-xs text-gray-400 mb-2">Chọn thư mục cụ thể trong Google Drive để lưu bản backup. Nếu không chọn, sẽ lưu vào My Drive.</p>
            <button
              onClick={handleOpenFolderPicker}
              className="w-full border-2 border-dashed border-gray-200 rounded-xl px-4 py-3.5 text-sm flex items-center gap-3 hover:border-blue-400 hover:bg-blue-50/30 transition-all text-left"
            >
              <Folder className={`w-5 h-5 shrink-0 ${googleAuth.folder_name ? 'text-amber-500' : 'text-gray-400'}`} />
              <span className={googleAuth.folder_name ? 'font-medium text-gray-800' : 'text-gray-400'}>
                {googleAuth.folder_name ? `📁 ${googleAuth.folder_name}` : 'Nhấn để chọn thư mục…'}
              </span>
              {!googleAuth.folder_name && <span className="ml-auto text-xs text-gray-400">Tùy chọn</span>}
            </button>
            {renderGoogleDriveFolderSummary()}
            {getGoogleDriveRunBlockedReason() && (
              <Alert type="warning" message="Thư mục này chưa thể sử dụng để chạy backup" description={getGoogleDriveRunBlockedReason()} className="mt-2" />
            )}
          </div>
        )}
      </div>
    )
  }

  const renderGenericStep3 = () => {
    if (isServiceApp && totalSteps === 3) {
      return renderBackupSetupSection()
    }

    // Generic (non-service condensed) — access token step
    return (
      <div className="max-w-xl space-y-6">
        <div className="border border-blue-100 rounded-2xl p-6 bg-blue-50/40 space-y-5">
          <div className="flex items-center gap-2">
            <Lock className="w-5 h-5 text-blue-600" />
            <h4 className="text-sm font-bold text-blue-800">
              {connectionConfig?.stepTitle || `Kết nối ${currentApp?.name}`}
            </h4>
          </div>

          {connectionConfig?.requiresDomain && (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                {connectionConfig.domainLabel || 'Địa chỉ website'} <span className="text-red-500">*</span>
              </label>
              <p className="text-xs text-gray-400 mb-2">{connectionConfig.domainHelp}</p>
              <input
                className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                placeholder={connectionConfig.domainPlaceholder}
                value={domain}
                onChange={(e) => { setDomain(e.target.value); if (isServiceApp) setServicePreview(null) }}
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">
              {connectionConfig?.tokenLabel || 'Mã truy cập API'} <span className="text-red-500">*</span>
            </label>
            <p className="text-xs text-gray-400 mb-2">
              {connectionConfig?.tokenHelp || `Lấy từ ${currentApp?.name} → Cài đặt → API Keys`}
            </p>
            <div className="relative">
              <input
                type={showToken ? 'text' : 'password'}
                className="w-full border border-gray-300 rounded-xl px-4 py-3 pr-12 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                placeholder="Dán mã truy cập vào đây…"
                value={accessToken}
                onChange={(e) => { setAccessToken(e.target.value); if (isServiceApp) setServicePreview(null) }}
              />
              <button
                type="button"
                onClick={() => setShowToken(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1"
              >
                {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const buildServiceTreeLines = () => {
    const root = googleAuth?.folder_name || 'My Drive'
    const hasTickets = backupType === 'unstructured' || backupType === 'all'
    const hasStructured = backupType === 'structured' || backupType === 'all'

    const lines = [
      { indent: 0, icon: '📁', text: root, color: '#e2e8f0' },
      { indent: 1, icon: '📁', text: 'Base Service', color: '#10b981' },
      { indent: 2, icon: '📁', text: '01. Danh mục', color: '#60a5fa' },
    ]

    if (hasStructured) {
      lines.push({ indent: 3, icon: '📊', text: 'danh_sach_loai_ticket.xlsx', color: '#4ade80' })
      lines.push({ indent: 3, icon: '📊', text: 'danh_sach_nguon_ticket.xlsx', color: '#4ade80' })
      lines.push({ indent: 3, icon: '📊', text: 'danh_sach_trang_thai.xlsx', color: '#4ade80' })
    }

    lines.push({ indent: 2, icon: '📁', text: 'Tên Service A', color: '#60a5fa' })

    if (hasStructured) {
      lines.push({ indent: 3, icon: '📊', text: 'Danh sách ticket.xlsx', color: '#4ade80' })
      lines.push({ indent: 3, icon: '📊', text: 'Danh sách stage.xlsx', color: '#4ade80' })
    }

    if (hasTickets) {
      lines.push({ indent: 3, icon: '📁', text: 'Tickets', color: '#a78bfa' })
      lines.push({ indent: 4, icon: '📁', text: '[TICKET-001] Tên ticket 1', color: '#93c5fd' })
      lines.push({ indent: 5, icon: '📋', text: 'ticket.json', color: '#94a3b8' })
      lines.push({ indent: 5, icon: '📊', text: 'Thông tin ticket.xlsx', color: '#94a3b8' })
      lines.push({ indent: 5, icon: '📁', text: 'Tệp đính kèm/', color: '#94a3b8' })
      lines.push({ indent: 6, icon: '📄', text: 'file.pdf', color: '#64748b' })
      lines.push({ indent: 6, icon: '🖼️', text: 'image.png', color: '#64748b' })
      lines.push({ indent: 4, icon: '📁', text: '[TICKET-002] Tên ticket 2', color: '#93c5fd' })
      lines.push({ indent: 5, icon: '…', text: '(tương tự)', color: '#64748b' })
    }

    lines.push({ indent: 2, icon: '📁', text: 'Tên Service B', color: '#60a5fa' })
    lines.push({ indent: 3, icon: '…', text: '(tương tự)', color: '#64748b' })

    return lines
  }

  const renderGenericStep4 = () => {
    const isEdit = viewMode === 'edit'

    if (isServiceApp) {
      const backupTypeLabels = { structured: 'Bảng tính (Dữ liệu có cấu trúc)', unstructured: 'File & Đính kèm', all: 'Toàn bộ' }
      const backupTypeColors = { structured: '#0284c7', unstructured: '#d97706', all: '#7c3aed' }

      // Vertical label-value layout: label on top, value below — no width conflict
      const SummaryField = ({ label, children }) => (
        <div className="py-2.5 border-b border-gray-50 last:border-0">
          <div className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mb-0.5">{label}</div>
          <div className="text-sm text-gray-800 break-words">{children ?? <span className="text-gray-300 text-xs">—</span>}</div>
        </div>
      )

      const treeLines = buildServiceTreeLines()

      const _serviceBlockedReason = getGoogleDriveRunBlockedReason()
      const _serviceArchiveNotice = renderServiceRootArchiveNotice(currentApp?.id || selectedApp, storageDestination)

      return (
        <div className="h-full flex flex-col gap-4">
          {/* Ready banner — includes inline warning if any */}
          <div className={`shrink-0 rounded-2xl px-5 py-4 flex items-center gap-4 ${_serviceBlockedReason ? 'bg-amber-50 border border-amber-200' : 'bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200'}`}>
            <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${_serviceBlockedReason ? 'bg-amber-100' : 'bg-green-100'}`}>
              {_serviceBlockedReason
                ? <Info className="w-5 h-5 text-amber-600" />
                : <CheckCircle className="w-5 h-5 text-green-600" />}
            </div>
            <div className="flex-1 min-w-0">
              {_serviceBlockedReason ? (
                <>
                  <h3 className="text-sm font-bold text-amber-800">Lưu ý trước khi tạo</h3>
                  <p className="text-xs text-amber-700 mt-0.5 leading-relaxed">{_serviceBlockedReason}</p>
                  {_serviceArchiveNotice && <p className="text-xs text-amber-600 mt-1 leading-relaxed">{_serviceArchiveNotice}</p>}
                </>
              ) : (
                <>
                  <h3 className="text-sm font-bold text-green-800">Sẵn sàng tạo luồng backup!</h3>
                  <p className="text-xs text-green-600 mt-0.5">Kiểm tra lại cấu hình bên dưới rồi nhấn xác nhận</p>
                </>
              )}
            </div>
            <div className="ml-auto flex items-center gap-2 shrink-0">
              <button
                onClick={() => handleFinish(true)}
                className="flex items-center gap-1.5 px-4 py-2 text-sm border border-green-400 text-green-700 bg-white rounded-xl hover:bg-green-50 transition-colors font-medium"
              >
                <Play className="w-3.5 h-3.5" />
                {isEdit ? 'Lưu & Chạy' : 'Tạo & Chạy'}
              </button>
              <button
                onClick={() => handleFinish(false)}
                className="flex items-center gap-1.5 px-5 py-2 text-sm bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-semibold shadow-sm"
              >
                <Rocket className="w-3.5 h-3.5" />
                {isEdit ? 'Lưu thay đổi' : 'Tạo luồng'}
              </button>
            </div>
          </div>

          {/* 2-column layout — 50/50 */}
          <div className="flex gap-5 flex-1 min-h-0">

            {/* LEFT — Summary */}
            <div className="flex-1 min-w-0 flex flex-col gap-3 overflow-y-auto pr-1">

              {/* Source card */}
              <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
                <div className="px-4 py-2.5 bg-green-50 border-b border-green-100 flex items-center gap-2">
                  <Headphones className="w-3.5 h-3.5 text-green-600" />
                  <span className="text-[11px] font-bold text-green-700 uppercase tracking-wide">Nguồn dữ liệu</span>
                </div>
                <div className="px-4 py-0.5">
                  <SummaryField label="Ứng dụng">
                    <span className="font-semibold text-green-700">Service</span>
                  </SummaryField>
                  <SummaryField label="Địa chỉ">
                    <span className="font-mono text-xs text-gray-700">{domain || <span className="text-red-400">Chưa nhập</span>}</span>
                  </SummaryField>
                  <SummaryField label="Dữ liệu">
                    <div className="flex flex-wrap gap-1 mt-0.5">
                      {selectedObjects.map(obj => (
                        <span key={obj} className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-green-100 text-green-700">{currentApp?.objectLabels[obj]}</span>
                      ))}
                    </div>
                  </SummaryField>
                </div>
              </div>

              {/* Destination card */}
              <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
                <div className="px-4 py-2.5 bg-blue-50 border-b border-blue-100 flex items-center gap-2">
                  <Cloud className="w-3.5 h-3.5 text-blue-500" />
                  <span className="text-[11px] font-bold text-blue-700 uppercase tracking-wide">Lưu trữ</span>
                </div>
                <div className="px-4 py-0.5">
                  <SummaryField label="Loại backup">
                    {backupType
                      ? <span className="font-semibold text-sm" style={{ color: backupTypeColors[backupType] }}>{backupTypeLabels[backupType]}</span>
                      : <span className="text-red-400 text-xs">Chưa chọn</span>}
                  </SummaryField>
                  <SummaryField label="Lưu vào">
                    <span className="font-semibold">{storageDestination === 'gsheets' ? 'Google Sheets' : 'Google Drive'}</span>
                  </SummaryField>
                  <SummaryField label="Tài khoản Google">
                    <span className="text-xs text-gray-700 break-all">{googleAuth?.email || <span className="text-red-400">Chưa kết nối</span>}</span>
                  </SummaryField>
                  <SummaryField label="Thư mục lưu trữ">
                    <span className="text-xs text-gray-700">{googleAuth?.folder_name || <span className="text-gray-400">My Drive (mặc định)</span>}</span>
                  </SummaryField>
                </div>
              </div>

              {/* Service count card */}
              <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
                <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Headphones className="w-3.5 h-3.5 text-gray-500" />
                    <span className="text-[11px] font-bold text-gray-600 uppercase tracking-wide">Dịch vụ được chọn</span>
                  </div>
                  <button
                    onClick={openServiceSelectorModal}
                    className="text-[11px] text-blue-600 hover:text-blue-800 font-semibold"
                  >
                    Xem &amp; chọn
                  </button>
                </div>
                <div className="px-4 py-3 flex gap-3">
                  <div className="flex-1 bg-gray-50 rounded-xl p-3 text-center">
                    <div className="text-2xl font-bold text-gray-800">{servicePreview?.service_count || 0}</div>
                    <div className="text-[11px] text-gray-400 mt-0.5">Tổng số</div>
                  </div>
                  <div className="flex-1 bg-blue-50 rounded-xl p-3 text-center">
                    <div className="text-2xl font-bold text-blue-700">{selectedServiceIds.length || 0}</div>
                    <div className="text-[11px] text-blue-500 mt-0.5">Đã chọn backup</div>
                  </div>
                </div>
                {loadingServicePreview && (
                  <div className="px-4 pb-3 flex items-center gap-2 text-xs text-gray-400"><Spinner /><span>Đang tải…</span></div>
                )}
                {!loadingServicePreview && servicePreview && !servicePreview.ticket_count_complete && (
                  <div className="px-4 pb-3">
                    <Alert type="warning" message={`Đã tải ${servicePreview.detail_loaded_count || 0} Service. Mở danh sách và làm mới để cập nhật.`} />
                  </div>
                )}
              </div>

            </div>

            {/* RIGHT — Output tree */}
            <div className="flex-1 min-w-0 flex flex-col min-h-0">
              {renderFileTree(treeLines)}
              <div className="mt-3 shrink-0">
                <p className="text-[11px] text-gray-400 leading-relaxed">
                  <span className="text-green-500 font-bold">📊 .xlsx</span> — Dữ liệu dạng bảng tính &nbsp;·&nbsp;
                  {(backupType === 'unstructured' || backupType === 'all') && (
                    <><span className="text-purple-400 font-bold">📁 Tickets/</span> — Thư mục ticket chứa file & đính kèm &nbsp;·&nbsp;</>
                  )}
                  <span className="text-blue-400 font-bold">📋 ticket.json</span> — Toàn bộ dữ liệu ticket thô
                </p>
                {backupType === 'structured' && (
                  <p className="text-[11px] text-amber-600 mt-1.5">
                    Với loại backup <strong>Bảng tính</strong>, chỉ có file .xlsx được tạo — không có thư mục Tickets hay file đính kèm.
                  </p>
                )}
                {backupType === 'unstructured' && (
                  <p className="text-[11px] text-amber-600 mt-1.5">
                    Với loại backup <strong>File & Đính kèm</strong>, chỉ có thư mục Tickets với file JSON và đính kèm — không có file .xlsx tổng hợp.
                  </p>
                )}
              </div>
            </div>

          </div>
        </div>
      )
    }

    // Generic non-service (Workflow / WeWork): custom fields + 2-column summary
    const availableFields = getAvailableFields()
    const fieldsByObject = availableFields.reduce((acc, field) => {
      if (!acc[field.object]) acc[field.object] = []
      acc[field.object].push(field)
      return acc
    }, {})
    const specialFields = availableFields.filter(f =>
      selectedFieldIds.includes(f.id) && (f.type === 'input-table' || f.type === 'select-master')
    )

    const SummaryField = ({ label, children }) => (
      <div className="py-2.5 border-b border-gray-50 last:border-0">
        <div className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mb-0.5">{label}</div>
        <div className="text-sm text-gray-800 break-words">{children}</div>
      </div>
    )

    const genericTreeLines = [
      { indent: 0, icon: '📁', text: googleAuth?.folder_name || 'My Drive', color: '#e2e8f0' },
      { indent: 1, icon: '📁', text: currentApp?.name || 'Ứng dụng', color: '#10b981' },
      { indent: 2, icon: '📊', text: 'data_export.xlsx', color: '#4ade80' },
      { indent: 2, icon: '📁', text: 'attachments/', color: '#60a5fa' },
      { indent: 3, icon: '📄', text: 'file.pdf', color: '#64748b' },
      { indent: 2, icon: '…', text: '(cấu trúc chi tiết phụ thuộc vào dữ liệu thực tế)', color: '#64748b' },
    ]

    return (
      <div className="h-full flex flex-col gap-5">
        {/* Ready banner */}
        <div className="shrink-0 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-2xl px-5 py-4 flex items-center gap-4">
          <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
            <CheckCircle className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-blue-800">Cấu hình hoàn tất!</h3>
            <p className="text-xs text-blue-600 mt-0.5">Kiểm tra lại rồi nhấn xác nhận để tạo luồng</p>
          </div>
          <div className="ml-auto flex items-center gap-2 shrink-0">
            <button
              onClick={() => handleFinish(true)}
              className="flex items-center gap-1.5 px-4 py-2 text-sm border border-blue-400 text-blue-700 bg-white rounded-xl hover:bg-blue-50 transition-colors font-medium"
            >
              <Play className="w-3.5 h-3.5" />
              {isEdit ? 'Lưu & Chạy' : 'Tạo & Chạy'}
            </button>
            <button
              onClick={() => handleFinish(false)}
              className="flex items-center gap-1.5 px-5 py-2 text-sm bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-semibold shadow-sm"
            >
              <Rocket className="w-3.5 h-3.5" />
              {isEdit ? 'Lưu thay đổi' : 'Tạo luồng'}
            </button>
          </div>
        </div>

        {/* 2-column layout */}
        <div className="flex gap-5 flex-1 min-h-0">

          {/* LEFT — Summary + custom fields */}
          <div className="flex-1 min-w-0 flex flex-col gap-3 overflow-y-auto pr-1">

            {/* Source summary */}
            <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
              <div className="px-4 py-2.5 bg-orange-50 border-b border-orange-100 flex items-center gap-2">
                <Inbox className="w-3.5 h-3.5 text-orange-500" />
                <span className="text-[11px] font-bold text-orange-700 uppercase tracking-wide">Nguồn dữ liệu</span>
              </div>
              <div className="px-4 py-0.5">
                <SummaryField label="Ứng dụng">
                  <span className="font-semibold" style={{ color: currentApp?.color }}>{currentApp?.name}</span>
                </SummaryField>
                <SummaryField label="Dữ liệu backup">
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {selectedObjects.map(obj => (
                      <span key={obj} className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ backgroundColor: currentApp?.bg, color: currentApp?.color }}>{currentApp?.objectLabels[obj]}</span>
                    ))}
                  </div>
                </SummaryField>
                {connectionConfig?.requiresDomain && (
                  <SummaryField label="Địa chỉ">
                    <span className="font-mono text-xs text-gray-700">{domain || <span className="text-red-400">Chưa nhập</span>}</span>
                  </SummaryField>
                )}
                <SummaryField label="Mã truy cập">
                  <span className="font-mono text-gray-500 text-xs">
                    {accessToken ? `••••${accessToken.slice(-4)}` : <span className="text-red-400">Chưa nhập</span>}
                  </span>
                </SummaryField>
              </div>
            </div>

            {/* Destination summary */}
            <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
              <div className="px-4 py-2.5 bg-blue-50 border-b border-blue-100 flex items-center gap-2">
                <Cloud className="w-3.5 h-3.5 text-blue-500" />
                <span className="text-[11px] font-bold text-blue-700 uppercase tracking-wide">Lưu trữ</span>
              </div>
              <div className="px-4 py-0.5">
                <SummaryField label="Lưu vào">
                  <span className="font-semibold">{storageDestination === 'gsheets' ? 'Google Sheets' : 'Google Drive'}</span>
                </SummaryField>
                <SummaryField label="Tài khoản Google">
                  <span className="text-xs text-gray-700 break-all">{googleAuth?.email || <span className="text-red-400">Chưa kết nối</span>}</span>
                </SummaryField>
                <SummaryField label="Thư mục lưu trữ">
                  <span className="text-xs text-gray-700">{googleAuth?.folder_name || <span className="text-gray-400">My Drive (mặc định)</span>}</span>
                </SummaryField>
                {selectedFieldIds.length > 0 && (
                  <SummaryField label="Trường tùy chỉnh">
                    <span className="font-semibold">{selectedFieldIds.length} trường đã chọn</span>
                  </SummaryField>
                )}
              </div>
            </div>

            {/* Custom fields (if any) */}
            {availableFields.length > 0 && (
              <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
                <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                  <span className="text-[11px] font-bold text-gray-600 uppercase tracking-wide">Trường tùy chỉnh</span>
                  <button onClick={handleSelectAllFields} className="text-[11px] text-blue-600 hover:text-blue-800 font-medium">
                    {selectedFieldIds.length === availableFields.length ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
                  </button>
                </div>
                <div className="px-3 py-2 space-y-1 max-h-48 overflow-y-auto">
                  {availableFields.map(field => (
                    <div
                      key={field.id}
                      onClick={() => handleFieldToggle(field.id)}
                      className="flex items-center gap-2.5 px-2 py-2 rounded-lg cursor-pointer transition-colors hover:bg-gray-50"
                    >
                      <div
                        className="w-4 h-4 rounded flex items-center justify-center border-2 transition-all shrink-0"
                        style={{
                          backgroundColor: selectedFieldIds.includes(field.id) ? currentApp?.color : 'transparent',
                          borderColor: selectedFieldIds.includes(field.id) ? currentApp?.color : '#d1d5db',
                        }}
                      >
                        {selectedFieldIds.includes(field.id) && <Check className="w-2.5 h-2.5 text-white" />}
                      </div>
                      <span className="text-xs font-medium text-gray-700 flex-1">{field.name}</span>
                      <span className="text-[10px] text-gray-400 bg-gray-100 px-1 rounded">{field.type}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Export format for special fields */}
            {specialFields.length > 0 && (
              <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
                <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100">
                  <span className="text-[11px] font-bold text-gray-600 uppercase tracking-wide">Định dạng xuất</span>
                </div>
                <div className="px-3 py-2 space-y-2">
                  {specialFields.map(field => (
                    <div key={field.id}>
                      <p className="text-[11px] text-gray-500 mb-1 px-1">{field.name}</p>
                      <div className="flex gap-1.5">
                        {[
                          { id: 'json', label: 'JSON', emoji: '📄' },
                          { id: 'excel', label: 'Excel', emoji: '📊' },
                        ].map(fmt => (
                          <div
                            key={fmt.id}
                            onClick={() => setExportFormats({ ...exportFormats, [field.id]: fmt.id })}
                            className="flex-1 border-2 rounded-xl p-2 cursor-pointer transition-all flex items-center gap-1.5"
                            style={{
                              borderColor: exportFormats[field.id] === fmt.id ? '#3b82f6' : '#e5e7eb',
                              backgroundColor: exportFormats[field.id] === fmt.id ? '#eff6ff' : '#fff',
                            }}
                          >
                            <span className="text-sm">{fmt.emoji}</span>
                            <span className="text-xs font-semibold">{fmt.label}</span>
                            {exportFormats[field.id] === fmt.id && <Check className="w-3 h-3 text-blue-600 ml-auto" />}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>

          {/* RIGHT — Output tree */}
          <div className="flex-1 flex flex-col min-w-0 min-h-0">
            {renderFileTree(genericTreeLines)}
            <div className="mt-3 shrink-0">
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex gap-2">
                <Info className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-[11px] text-amber-700 leading-relaxed">
                  Cấu trúc thư mục output cho <strong>{currentApp?.name}</strong> sẽ được xác định khi chạy backup lần đầu, tùy thuộc vào dữ liệu thực tế của bạn.
                </p>
              </div>
            </div>
          </div>

        </div>
      </div>
    )
  }

  // Render list of backup flows
  const APP_META = {
    request:  { color: '#ea580c', icon: <Inbox className="w-4 h-4" /> },
    workflow: { color: '#7c3aed', icon: <FolderKanban className="w-4 h-4" /> },
    wework:   { color: '#2563eb', icon: <Building2 className="w-4 h-4" /> },
    service:  { color: '#059669', icon: <Headphones className="w-4 h-4" /> },
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
      return <span className="text-gray-400">{fallback}</span>
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
      return <span className="text-gray-400">—</span>
    }

    const visibleItems = items.slice(0, max)
    const hiddenCount = items.length - visibleItems.length

    return (
      <div className="flex flex-wrap gap-1.5">
        {visibleItems.map(item => (
          <Tag key={String(item)} color={color}>{item}</Tag>
        ))}
        {hiddenCount > 0 && <Tag>+{hiddenCount} more</Tag>}
      </div>
    )
  }

  const fetchFlowDetails = async (flowId, summaryRecord = null) => {
    setLoadingFlowDetails(true)
    try {
      const [flowResult, runsResult] = await Promise.allSettled([
        api.get(`/api/backup-flows/${flowId}`),
        api.get(`/api/backup-flows/${flowId}/runs`, { params: { limit: 20 } }),
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
    setViewMode('detail')
    await fetchFlowDetails(record.id, record)
  }

  const handleRefreshFlowDetails = async () => {
    if (!detailsFlowId) return
    await fetchFlowDetails(detailsFlowId, detailsFlowRecord)
  }

  const renderDetailView = () => {
    const source = detailsFlow?.source || {}
    const destination = detailsFlow?.destination || {}
    const auth = destination.auth || {}
    const structure = detailsFlow?.structure || {}
    const schedule = detailsFlow?.schedule || {}
    const appMeta = APP_META[source.app] || { color: '#64748b', icon: <Cloud className="w-4 h-4" /> }
    const appConfig = APPS[source.app] || {}
    const objectLabels = appConfig.objectLabels || {}
    const detailObjects = Array.isArray(structure.objects) ? structure.objects.map(id => objectLabels[id] || id) : []
    const supportsRun = ['request', 'service'].includes(detailsFlowRecord?.app || source.app)
    const isPublished = detailsFlowRecord?.is_published === 1 || detailsFlow?.is_published === 1
    const runBlockedReason = detailsFlowRecord?.run_blocked_reason
    const runDisabled = !supportsRun || !isPublished || Boolean(runBlockedReason)
    const lastRunMeta = detailsFlow?.last_run_status ? RUN_STATUS_TAG[detailsFlow.last_run_status] : null
    const isDraft = detailsFlow?.is_draft === 1

    const InfoField = ({ label, children }) => (
      <div className="py-2.5 border-b border-gray-50 last:border-0">
        <div className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mb-0.5">{label}</div>
        <div className="text-sm text-gray-800 break-words flex flex-wrap gap-1 items-center">
          {children ?? <span className="text-gray-300 text-xs">—</span>}
        </div>
      </div>
    )

    const SideCard = ({ title, icon: CardIcon, color = '#64748b', children }) => (
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2" style={{ background: `${color}08` }}>
          {CardIcon && <CardIcon className="w-3.5 h-3.5" style={{ color }} />}
          <h4 className="text-[11px] font-bold uppercase tracking-wide" style={{ color }}>{title}</h4>
        </div>
        <div className="px-4 py-0.5">{children}</div>
      </div>
    )

    const runStatusColors = { completed: '#16a34a', failed: '#dc2626', running: '#2563eb', pending: '#d97706' }
    const runStatusLabels = { completed: 'Hoàn thành', failed: 'Lỗi', running: 'Đang chạy', pending: 'Đang chờ' }
    const runStatusBg = { completed: '#f0fdf4', failed: '#fef2f2', running: '#eff6ff', pending: '#fffbeb' }

    const runOnClick = () => handleRunFlow(
      detailsFlowRecord || { id: detailsFlowId, app: source.app, run_blocked_reason: runBlockedReason },
      { onStarted: async () => { await fetchFlowDetails(detailsFlowId || detailsFlowRecord?.id, detailsFlowRecord) } }
    )

    return (
      <div className="min-h-[calc(100vh-4rem)] bg-gray-50 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-6 py-6 flex flex-col gap-5">

          {/* ── Breadcrumb nav ── */}
          <button
            onClick={() => { setViewMode('list'); setDetailsFlow(null); setDetailsRuns([]) }}
            className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-700 transition-colors self-start"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Quay lại danh sách</span>
          </button>

          {loadingFlowDetails ? (
            <div className="flex items-center justify-center py-20"><SpinCenter text="Đang tải…" /></div>
          ) : (
            <>
              {/* ── PHẦN TRÊN: Tổng quan ── */}
              <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">

                {/* Hero header */}
                <div className="px-6 pt-5 pb-4 border-b border-gray-100"
                  style={{ background: `linear-gradient(135deg, ${appMeta.color}08 0%, white 70%)` }}>
                  <div className="flex items-start justify-between gap-4 flex-wrap">

                    {/* Left: icon + title */}
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
                        style={{ backgroundColor: `${appMeta.color}1a`, color: appMeta.color }}>
                        <span className="scale-150">{appMeta.icon}</span>
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <h2 className="text-lg font-bold text-gray-900 leading-tight">
                            {detailsFlow?.name || <span className="italic text-gray-400">Untitled draft</span>}
                          </h2>
                          {isDraft
                            ? <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-700">Draft</span>
                            : <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-cyan-100 text-cyan-700">Ready</span>}
                          {isPublished
                            ? <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-green-100 text-green-700">Đã kích hoạt</span>
                            : <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-gray-100 text-gray-500">Chưa kích hoạt</span>}
                          {detailsFlow?.backup_type && (
                            <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-purple-100 text-purple-700">
                              {{ structured: 'Bảng tính', unstructured: 'File & Đính kèm', all: 'Toàn bộ' }[detailsFlow.backup_type] || detailsFlow.backup_type}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-500">
                          <span style={{ color: appMeta.color }} className="font-medium">{source.app_name || source.app || '—'}</span>
                          {source.domain && <span className="ml-2 text-gray-400 font-mono text-xs">· {source.domain}</span>}
                        </p>
                      </div>
                    </div>

                    {/* Right: action buttons */}
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={async () => { const id = detailsFlowId || detailsFlowRecord?.id; if (id) await loadFlowForEdit(id) }}
                        className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 transition-colors"
                      >
                        <Pencil className="w-3.5 h-3.5" /> Chỉnh sửa
                      </button>
                      <button
                        onClick={handleRefreshFlowDetails}
                        disabled={loadingFlowDetails}
                        className="px-3 py-2 border border-gray-300 text-gray-500 rounded-xl hover:bg-gray-50 disabled:opacity-50 transition-colors"
                        title="Làm mới"
                      >
                        {loadingFlowDetails ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                      </button>
                      <button
                        disabled={runDisabled}
                        onClick={runOnClick}
                        title={runBlockedReason || (!supportsRun ? 'Loại app này chưa hỗ trợ chạy' : !isPublished ? 'Cần kích hoạt luồng trước' : undefined)}
                        className="flex items-center gap-2 px-5 py-2 text-sm font-semibold bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
                      >
                        <Play className="w-4 h-4" /> Chạy Backup Ngay
                      </button>
                    </div>
                  </div>

                  {/* Run blocked warning — inline, compact */}
                  {runBlockedReason && (
                    <div className="mt-3 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
                      <Info className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                      <p className="text-xs text-amber-700 leading-relaxed">{runBlockedReason}</p>
                    </div>
                  )}
                </div>

                {/* Config grid: 4 cards in a row */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-0 divide-x divide-y divide-gray-100">

                  {/* Source */}
                  <div className="px-5 py-4">
                    <div className="flex items-center gap-1.5 mb-3">
                      <Globe className="w-3.5 h-3.5 text-orange-500" />
                      <span className="text-[10px] font-bold text-orange-600 uppercase tracking-wider">Nguồn dữ liệu</span>
                    </div>
                    <div className="space-y-2">
                      <div>
                        <div className="text-[10px] text-gray-400 mb-0.5">Ứng dụng</div>
                        <div className="text-sm font-semibold" style={{ color: appMeta.color }}>{source.app_name || source.app || '—'}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-gray-400 mb-0.5">Địa chỉ</div>
                        <div className="text-xs font-mono text-gray-700 break-all">{source.domain || '—'}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-gray-400 mb-1">Dữ liệu backup</div>
                        <div className="flex flex-wrap gap-1">
                          {detailObjects.length > 0
                            ? detailObjects.map(o => <span key={o} className="px-1.5 py-0.5 rounded text-[11px] font-semibold bg-blue-100 text-blue-700">{o}</span>)
                            : <span className="text-xs text-gray-400">—</span>}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Destination */}
                  <div className="px-5 py-4">
                    <div className="flex items-center gap-1.5 mb-3">
                      <Cloud className="w-3.5 h-3.5 text-blue-500" />
                      <span className="text-[10px] font-bold text-blue-600 uppercase tracking-wider">Lưu trữ</span>
                    </div>
                    <div className="space-y-2">
                      <div>
                        <div className="text-[10px] text-gray-400 mb-0.5">Loại backup</div>
                        <div className="text-sm font-semibold text-gray-800">
                          {{ structured: 'Bảng tính', unstructured: 'File & Đính kèm', all: 'Toàn bộ' }[detailsFlow?.backup_type] || detailsFlow?.backup_type || '—'}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-gray-400 mb-0.5">Lưu vào</div>
                        <div className="text-sm text-gray-700">{destination.name || destination.type || '—'}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-gray-400 mb-0.5">Tài khoản</div>
                        <div className="text-xs text-gray-700 break-all">{getDestinationIdentityLabel(auth) || '—'}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-gray-400 mb-0.5">Thư mục</div>
                        <div className="text-xs text-gray-700">{auth.folder_name || auth.folder_id || <span className="text-gray-400">My Drive (mặc định)</span>}</div>
                      </div>
                    </div>
                  </div>

                  {/* Schedule */}
                  <div className="px-5 py-4">
                    <div className="flex items-center gap-1.5 mb-3">
                      <Clock className="w-3.5 h-3.5 text-purple-500" />
                      <span className="text-[10px] font-bold text-purple-600 uppercase tracking-wider">Lịch chạy</span>
                    </div>
                    <div className="space-y-2">
                      <div>
                        <div className="text-[10px] text-gray-400 mb-0.5">Loại lịch</div>
                        <div className="text-sm font-semibold text-gray-800">{schedule.type || <span className="text-gray-400 font-normal text-xs">Thủ công</span>}</div>
                      </div>
                      {schedule.type && (
                        <div>
                          <div className="text-[10px] text-gray-400 mb-0.5">Thời gian</div>
                          <div className="text-sm text-gray-700">{schedule.time || '—'}</div>
                        </div>
                      )}
                      <div>
                        <div className="text-[10px] text-gray-400 mb-1">Trạng thái</div>
                        {schedule.enabled === false
                          ? <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-gray-100 text-gray-500">Đã tắt</span>
                          : <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-green-100 text-green-700">Đang bật</span>}
                      </div>
                    </div>
                  </div>

                  {/* Meta */}
                  <div className="px-5 py-4">
                    <div className="flex items-center gap-1.5 mb-3">
                      <FolderKanban className="w-3.5 h-3.5 text-gray-400" />
                      <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Thông tin</span>
                    </div>
                    <div className="space-y-2">
                      <div>
                        <div className="text-[10px] text-gray-400 mb-0.5">Tạo lúc</div>
                        <div className="text-xs text-gray-700">{formatDateTime(detailsFlow.created_at) || '—'}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-gray-400 mb-0.5">Cập nhật</div>
                        <div className="text-xs text-gray-700">{formatDateTime(detailsFlow.updated_at) || '—'}</div>
                      </div>
                      {detailsFlow.last_run_at && (
                        <div>
                          <div className="text-[10px] text-gray-400 mb-0.5">Chạy lần cuối</div>
                          <div className="text-xs text-gray-700">{formatDateTime(detailsFlow.last_run_at)}</div>
                        </div>
                      )}
                      <button
                        disabled={!(detailsFlowRecord?.id || detailsFlowId)}
                        onClick={() => handleDeleteFlowConfirm(
                          detailsFlowRecord || { id: detailsFlowId, name: detailsFlow?.name },
                          { onDeleted: () => { setViewMode('list'); setDetailsFlowId(null); setDetailsFlowRecord(null); setDetailsFlow(null); setDetailsRuns([]) } }
                        )}
                        className="flex items-center gap-1 text-xs text-red-400 hover:text-red-600 transition-colors mt-1"
                      >
                        <Trash2 className="w-3 h-3" /> Xóa luồng
                      </button>
                    </div>
                  </div>

                </div>
              </div>

              {/* ── PHẦN DƯỚI: Lịch sử chạy ── */}
              <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-gray-900">Lịch sử chạy backup</h3>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {detailsRuns.length > 0 ? `${detailsRuns.length} lần chạy gần nhất` : 'Chưa có lần chạy nào'}
                      {detailsFlow?.last_run_at && <span className="ml-2">· Lần cuối: {formatDateTime(detailsFlow.last_run_at)}</span>}
                    </p>
                  </div>
                  {renderServiceRootArchiveNotice(detailsFlowRecord?.app || source.app, destination.type)}
                </div>

                {detailsRuns.length === 0 ? (
                  <div className="py-16"><Empty description="Chưa có lần chạy nào được ghi lại" /></div>
                ) : (
                  <div className="divide-y divide-gray-50">
                    {detailsRuns.map((run, idx) => {
                      const pct = getHistoryRunProgressPercent(run)
                      const isLatest = idx === 0
                      const statusColor = runStatusColors[run.status] || '#64748b'
                      const statusBg = runStatusBg[run.status] || '#f9fafb'
                      return (
                        <div key={run.id}
                          className="px-6 py-4 hover:bg-gray-50/70 transition-colors flex items-start gap-4"
                          style={isLatest ? { borderLeft: `3px solid ${statusColor}` } : { borderLeft: '3px solid transparent' }}>

                          {/* Status icon */}
                          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5" style={{ background: statusBg }}>
                            {run.status === 'completed' && <CheckCircle style={{ width: 18, height: 18, color: '#16a34a' }} />}
                            {run.status === 'failed' && <Info style={{ width: 18, height: 18, color: '#dc2626' }} />}
                            {run.status === 'running' && <Loader2 style={{ width: 18, height: 18, color: '#2563eb' }} className="animate-spin" />}
                            {run.status === 'pending' && <Clock style={{ width: 18, height: 18, color: '#d97706' }} />}
                          </div>

                          {/* Center: timestamps + progress + details */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-1.5">
                              <span className="text-sm font-semibold" style={{ color: statusColor }}>
                                {runStatusLabels[run.status] || run.status}
                              </span>
                              {isLatest && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-600 uppercase">Mới nhất</span>}
                              <span className="text-xs text-gray-400">{formatDateTime(run.started_at)}</span>
                              {run.completed_at && <span className="text-xs text-gray-400">→ {formatDateTime(run.completed_at)}</span>}
                            </div>

                            {/* Progress bar */}
                            <div className="flex items-center gap-3 mb-1.5">
                              <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                <div className="h-full rounded-full transition-all duration-500"
                                  style={{ width: `${pct}%`, background: run.status === 'failed' ? '#ef4444' : run.status === 'running' ? '#3b82f6' : '#22c55e' }} />
                              </div>
                              <span className="text-xs font-semibold shrink-0 w-8 text-right" style={{ color: statusColor }}>{pct}%</span>
                            </div>

                            {/* Step + summary */}
                            <div className="flex flex-wrap gap-x-4 text-xs">
                              <span className="font-medium text-gray-600">{getHistoryRunStepLabel(run)}</span>
                              {getHistoryRunSummary(run) && <span className="text-gray-400">{getHistoryRunSummary(run)}</span>}
                            </div>

                            {/* Error */}
                            {run.error_message && (
                              <div className="mt-2 flex items-start gap-1.5 bg-red-50 rounded-lg px-3 py-2">
                                <Info style={{ width: 13, height: 13, color: '#f87171', flexShrink: 0, marginTop: 1 }} />
                                <span className="text-xs text-red-600 leading-relaxed">{run.error_message}</span>
                              </div>
                            )}
                          </div>

                          {/* Right: trigger + run id */}
                          <div className="shrink-0 text-right space-y-1">
                            <div className="text-[11px] text-gray-400">{run.triggered_by || 'manual'}</div>
                            <div className="text-[10px] text-gray-300">#{run.id}</div>
                          </div>

                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

            </>
          )}
        </div>
      </div>
    )
  }

  const renderFlowDetailsDrawer = () => {
    // Drawer kept for backward compat but no longer used (detail is now full-page)
    return null
  }

  const handleDeleteFlow = (record, options = {}) => {
    handleDeleteFlowConfirm(record, options)
  }

  const handlePublishFlow = async (record) => {
    try {
      await api.post(`/api/backup-flows/${record.id}/publish`)
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
      await api.post(`/api/backup-flows/${record.id}/run`)
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
    return (
      <>
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Backup Flows</h2>
            <p className="text-sm text-gray-500 mt-0.5">Manage and monitor your backup configurations</p>
          </div>
          <button
            onClick={async () => {
              try {
                const res = await api.post(`/api/backup-flows/draft`, {})
                setDraftFlowId(res.data.id)
                message.success('Draft created')
              } catch (err) {
                message.error('Failed to create draft. Is the backend running?')
                console.error(err)
                return
              }
              setViewMode('create')
            }}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-md transition-colors"
          >
            <Plus className="w-4 h-4" /> New Backup Flow
          </button>
        </div>

        {/* Table card */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          {loadingFlows ? (
            <SpinCenter text="Loading backup flows…" />
          ) : flows.length === 0 ? (
            <Empty description='No backup flows yet. Click "New Backup Flow" to create one.' />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">App / Flow</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Backup Type</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Destination</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Last Run</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {flows.map(record => {
                    const meta = APP_META[record.app] || { color: '#64748b', icon: <Cloud className="w-4 h-4" /> }
                    const bt = BACKUP_TYPE_TAG[record.backup_type]
                    return (
                      <tr key={record.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: `${meta.color}18`, color: meta.color }}>
                              {meta.icon}
                            </div>
                            <div>
                              <div className="font-semibold text-gray-900">{record.app_name || <span className="text-gray-400">—</span>}</div>
                              <div className="text-xs text-gray-400">{record.name || 'Untitled draft'}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {bt ? <Tag color={bt.color}>{bt.label}</Tag> : <span className="text-gray-400">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          {record.destination_name ? (
                            <div className="flex items-center gap-1.5">
                              {record.destination_type === 'gsheets'
                                ? <FileSpreadsheet className="w-4 h-4 text-green-600" />
                                : <Globe className="w-4 h-4 text-blue-500" />}
                              <span className="text-gray-700">{record.destination_name}</span>
                            </div>
                          ) : <span className="text-gray-400">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {record.is_draft === 1 ? <Tag color="gold">Draft</Tag> : <Tag color="cyan">Ready</Tag>}
                            {record.is_published === 1 ? <Tag color="green">Published</Tag> : <Tag color="default">Unpublished</Tag>}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs text-gray-400">{record.last_run_at || 'Never run'}</span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1.5 flex-wrap">
                            <button onClick={() => handleOpenFlowDetails(record)} className="flex items-center gap-1 px-2.5 py-1.5 text-xs border border-gray-300 rounded-md hover:bg-gray-50 transition-colors">
                              <Eye className="w-3.5 h-3.5" /> Details
                            </button>
                            {record.is_published === 0 && (
                              <button onClick={() => handlePublishFlow(record)} className="flex items-center gap-1 px-2.5 py-1.5 text-xs border border-blue-300 text-blue-600 rounded-md hover:bg-blue-50 transition-colors">
                                <Rocket className="w-3.5 h-3.5" /> Publish
                              </button>
                            )}
                            <button onClick={() => loadFlowForEdit(record.id)} className="flex items-center gap-1 px-2.5 py-1.5 text-xs border border-gray-300 rounded-md hover:bg-gray-50 transition-colors">
                              <Pencil className="w-3.5 h-3.5" /> Edit
                            </button>
                            {record.is_published === 1 && ['request', 'service'].includes(record.app) && (
                              <button
                                onClick={() => handleRunFlow(record)}
                                disabled={Boolean(record.run_blocked_reason)}
                                title={record.run_blocked_reason || undefined}
                                className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                              >
                                <Play className="w-3.5 h-3.5" /> Run
                              </button>
                            )}
                            <button onClick={() => handleDeleteFlowConfirm(record)} className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </>
    )
  }

  const renderCreateView = () => {
    const isEdit = viewMode === 'edit'
    const progressPercent = totalSteps > 1 ? Math.round((currentStep / (totalSteps - 1)) * 100) : 0

    // Friendly step descriptions for sidebar
    const stepDescriptions = usesCondensedServiceWizard
      ? ['Đặt tên & chọn nguồn dữ liệu', 'Cấu hình lưu trữ backup', 'Xác nhận & tạo luồng']
      : isRequestApp
        ? ['Đặt tên & chọn ứng dụng', 'Thông tin kết nối', 'Loại backup & lưu trữ', ...(hasServiceAccountStep ? ['Xác thực Google'] : []), 'Xem lại & tạo']
        : ['Đặt tên & chọn ứng dụng', 'Chọn dữ liệu cần backup', 'Kết nối & lưu trữ', ...(hasServiceAccountStep ? ['Xác thực Google'] : []), 'Xem lại & tạo']

    return (
      <div className="flex h-full min-h-[calc(100vh-4rem)] bg-gray-50">
        {/* ── Left sidebar ── */}
        <div className="w-64 shrink-0 bg-white border-r border-gray-200 flex flex-col shadow-sm">
          {/* Header */}
          <div className="px-5 py-5 border-b border-gray-100">
            <button
              onClick={() => { setViewMode('list'); setCurrentStep(0); setSelectedApp(null); setFlowName(''); setDraftFlowId(null); setEditFlowId(null) }}
              className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-700 transition-colors mb-4"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Quay lại danh sách</span>
            </button>

            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shrink-0">
                <Cloud className="w-4 h-4 text-white" />
              </div>
              <div>
                <p className="text-[11px] font-medium text-blue-600 uppercase tracking-wide">
                  {isEdit ? 'Chỉnh sửa' : 'Tạo mới'}
                </p>
                <h2 className="text-sm font-bold text-gray-900 leading-tight">
                  Luồng Backup
                </h2>
              </div>
            </div>

            {flowName && (
              <div className="mt-3 px-3 py-2 bg-gray-50 rounded-lg border border-gray-100">
                <p className="text-[11px] text-gray-400 mb-0.5">Tên luồng</p>
                <p className="text-sm font-medium text-gray-700 truncate">{flowName}</p>
              </div>
            )}
          </div>

          {/* Progress bar */}
          <div className="px-5 py-3 border-b border-gray-100">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] text-gray-400">Tiến độ</span>
              <span className="text-[11px] font-semibold text-blue-600">{progressPercent}%</span>
            </div>
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-500"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

          {/* Steps nav */}
          <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
            {steps.map((step, idx) => {
              const isDone = idx < currentStep
              const isActive = idx === currentStep
              const isPending = idx > currentStep
              return (
                <div
                  key={idx}
                  className={`flex items-start gap-3 px-3 py-3 rounded-xl transition-all ${
                    isActive ? 'bg-blue-50 border border-blue-100' : isPending ? 'opacity-50' : 'hover:bg-gray-50'
                  }`}
                >
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 transition-all ${
                    isDone ? 'bg-green-500 text-white' : isActive ? 'bg-blue-600 text-white shadow-sm shadow-blue-200' : 'bg-gray-100 text-gray-400'
                  }`}>
                    {isDone ? <Check className="w-3.5 h-3.5" /> : idx + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-semibold leading-tight ${isActive ? 'text-blue-700' : isDone ? 'text-green-700' : 'text-gray-400'}`}>
                      {step.title}
                    </p>
                    {stepDescriptions[idx] && (
                      <p className={`text-[11px] mt-0.5 leading-snug ${isActive ? 'text-blue-500' : isDone ? 'text-green-500' : 'text-gray-300'}`}>
                        {stepDescriptions[idx]}
                      </p>
                    )}
                  </div>
                </div>
              )
            })}
          </nav>

          {/* Sidebar summary card */}
          {currentStep > 0 && (selectedApp || googleAuth) && (
            <div className="mx-3 mb-4 p-3 bg-gray-50 rounded-xl border border-gray-100 space-y-2">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Đã cấu hình</p>
              {currentApp && (
                <div className="flex items-center gap-2">
                  <span style={{ color: currentApp.color }}>
                    {currentApp.icon && React.cloneElement(currentApp.icon, { className: 'w-3.5 h-3.5' })}
                  </span>
                  <span className="text-xs font-semibold" style={{ color: currentApp.color }}>{currentApp.name}</span>
                </div>
              )}
              {domain && (
                <div className="flex items-center gap-1.5 text-[11px] text-gray-500 truncate">
                  <Globe className="w-3 h-3 shrink-0 text-gray-400" />
                  <span className="truncate">{domain}</span>
                </div>
              )}
              {backupType && (
                <div className="flex items-center gap-1.5">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                    backupType === 'structured' ? 'bg-blue-100 text-blue-700' :
                    backupType === 'unstructured' ? 'bg-amber-100 text-amber-700' :
                    'bg-purple-100 text-purple-700'
                  }`}>
                    {backupType === 'structured' ? 'Dữ liệu có cấu trúc' : backupType === 'unstructured' ? 'File & đính kèm' : 'Toàn bộ'}
                  </span>
                </div>
              )}
              {storageDestination && (
                <div className="flex items-center gap-1.5 text-[11px] text-gray-500">
                  {storageDestination === 'gsheets'
                    ? <FileSpreadsheet className="w-3 h-3 text-green-500 shrink-0" />
                    : <Folder className="w-3 h-3 text-blue-500 shrink-0" />}
                  <span>{storageDestination === 'gsheets' ? 'Google Sheets' : 'Google Drive'}</span>
                </div>
              )}
              {googleAuth?.email && (
                <div className="flex items-center gap-1.5 text-[11px] text-gray-500 truncate">
                  <CheckCircle className="w-3 h-3 text-green-500 shrink-0" />
                  <span className="truncate">{googleAuth.email}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Right: step content ── */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Step header */}
          <div className="shrink-0 bg-white border-b border-gray-200 px-10 py-5">
            <div className="flex items-center gap-2 text-xs text-gray-400 mb-1">
              <span>Bước {currentStep + 1} / {totalSteps}</span>
            </div>
            <h1 className="text-xl font-bold text-gray-900">
              {steps[currentStep]?.title || ''}
            </h1>
            {stepDescriptions[currentStep] && (
              <p className="text-sm text-gray-500 mt-0.5">{stepDescriptions[currentStep]}</p>
            )}
          </div>

          {/* Content area */}
          <div className="flex-1 overflow-y-auto px-10 py-8">
            {renderStepContent()}
          </div>

          {/* Bottom nav bar */}
          {!(usesCondensedServiceWizard && currentStep === 0) && (
            <div className="shrink-0 border-t border-gray-200 bg-white px-10 py-4 flex items-center justify-between">
              <button
                disabled={currentStep === 0}
                onClick={prev}
                className="flex items-center gap-2 px-5 py-2.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium"
              >
                <ArrowLeft className="w-4 h-4" /> Quay lại
              </button>
              <div className="flex items-center gap-3">
                {currentStep < totalSteps - 1 && (
                  <button
                    onClick={next}
                    className="flex items-center gap-2 px-6 py-2.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold shadow-sm shadow-blue-200"
                  >
                    Tiếp theo <ChevronRight className="w-4 h-4" />
                  </button>
                )}
                {currentStep === totalSteps - 1 && (
                  <>
                    <button
                      onClick={() => handleFinish(false)}
                      className="flex items-center gap-2 px-6 py-2.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold shadow-sm shadow-blue-200"
                    >
                      {isEdit
                        ? <><Pencil className="w-4 h-4" /> Lưu thay đổi</>
                        : <><Rocket className="w-4 h-4" /> Tạo luồng backup</>}
                    </button>
                    {['request', 'service'].includes(currentApp?.id || '') && (
                      <button
                        onClick={() => handleFinish(true)}
                        className="flex items-center gap-2 px-5 py-2.5 text-sm border border-green-300 text-green-700 bg-green-50 rounded-lg hover:bg-green-100 transition-colors font-medium"
                      >
                        <Play className="w-4 h-4" />
                        {isEdit ? 'Lưu & Chạy ngay' : 'Tạo & Chạy ngay'}
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Generic step 2: object selection (workflow / wework apps) ────────────────
  const renderGenericStep2 = () => {
    if (!currentApp) return null
    return (
      <div className="max-w-xl space-y-6">
        <div>
          <label className="block text-sm font-semibold text-gray-800 mb-1">
            Chọn loại dữ liệu cần sao lưu <span className="text-red-500">*</span>
          </label>
          <p className="text-xs text-gray-400 mb-4">
            Chọn những loại dữ liệu từ <strong>{currentApp.name}</strong> mà bạn muốn đưa vào bản backup
          </p>

          <div className="space-y-2.5">
            <div
              onClick={handleSelectAllObjects}
              className="border-2 border-dashed border-gray-200 rounded-xl px-4 py-3.5 cursor-pointer hover:border-blue-300 hover:bg-blue-50/30 flex items-center gap-3 transition-all"
            >
              <div className={`w-5 h-5 rounded flex items-center justify-center border-2 transition-all ${
                selectedObjects.length === currentApp.objects.length
                  ? 'bg-blue-600 border-blue-600'
                  : 'border-gray-300'
              }`}>
                {selectedObjects.length === currentApp.objects.length && <Check className="w-3 h-3 text-white" />}
              </div>
              <span className="font-semibold text-sm text-gray-700">Chọn tất cả loại dữ liệu</span>
              <span className="text-xs text-gray-400 ml-auto">{currentApp.objects.length} loại</span>
            </div>

            {currentApp.objects.map(obj => (
              <div
                key={obj}
                onClick={() => handleObjectToggle(obj)}
                className="border-2 rounded-xl px-4 py-4 cursor-pointer transition-all flex items-center gap-3"
                style={{
                  borderColor: selectedObjects.includes(obj) ? currentApp.color : '#e5e7eb',
                  backgroundColor: selectedObjects.includes(obj) ? currentApp.bg : '#fff',
                }}
              >
                <div
                  className="w-5 h-5 rounded flex items-center justify-center border-2 transition-all shrink-0"
                  style={{
                    backgroundColor: selectedObjects.includes(obj) ? currentApp.color : 'transparent',
                    borderColor: selectedObjects.includes(obj) ? currentApp.color : '#d1d5db',
                  }}
                >
                  {selectedObjects.includes(obj) && <Check className="w-3 h-3 text-white" />}
                </div>
                <div className="flex-1">
                  <div className="font-semibold text-sm" style={{ color: selectedObjects.includes(obj) ? currentApp.color : '#374151' }}>
                    {currentApp.objectLabels[obj]}
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">{currentApp.name} › {currentApp.objectLabels[obj]}</div>
                </div>
                {selectedObjects.includes(obj) && (
                  <CheckCircle className="w-4 h-4 shrink-0" style={{ color: currentApp.color }} />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // ── Request app: step 2 — connection info ─────────────────────────────────
  const renderRequestStep2 = () => (
    <div className="max-w-xl space-y-6">
      <div className="border border-blue-100 rounded-2xl p-6 bg-blue-50/40 space-y-5">
        <div className="flex items-center gap-2">
          <Globe className="w-5 h-5 text-blue-600" />
          <h4 className="text-sm font-bold text-blue-800">Thông tin kết nối hệ thống Request</h4>
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">
            Địa chỉ website (Domain) <span className="text-red-500">*</span>
          </label>
          <p className="text-xs text-gray-400 mb-2">
            Địa chỉ truy cập hệ thống của bạn, ví dụ: <code className="bg-white px-1 rounded border border-gray-200">congty.base.com.vn</code>
          </p>
          <input
            className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            placeholder="VD: congty.base.com.vn"
            value={domain}
            onChange={e => setDomain(e.target.value)}
          />
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">
            Mã truy cập API (Access Token) <span className="text-red-500">*</span>
          </label>
          <p className="text-xs text-gray-400 mb-2">
            Lấy từ hệ thống: vào <strong>Cài đặt</strong> → <strong>API Keys</strong> → sao chép giá trị <em>access_token_v2</em> của Base Account
          </p>
          <div className="relative">
            <input
              type={showTokenV2 ? 'text' : 'password'}
              className="w-full border border-gray-300 rounded-xl px-4 py-3 pr-12 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              placeholder="Dán mã truy cập vào đây…"
              value={accessTokenV2}
              onChange={e => setAccessTokenV2(e.target.value)}
            />
            <button
              type="button"
              onClick={() => setShowTokenV2(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1"
              title={showTokenV2 ? 'Ẩn mã' : 'Hiện mã'}
            >
              {showTokenV2 ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-3">
        <Info className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
        <div className="text-xs text-amber-700 leading-relaxed">
          <strong>Lưu ý bảo mật:</strong> Mã truy cập này được mã hóa và lưu trữ an toàn. Không chia sẻ mã này với người khác.
        </div>
      </div>
    </div>
  )

  // ── Request app: step 3 — backup type + destination + auth ────────────────
  const renderRequestStep3 = () => {
    return (
      <div className="max-w-2xl">
        {renderBackupSetupSection()}
      </div>
    )
  }

  // ── Shared: renders the dark-panel file-tree ─────────────────────────────
  const renderFileTree = (lines) => (
    <div className="rounded-2xl overflow-hidden flex-1 flex flex-col min-h-0" style={{ background: '#0f172a', border: '1px solid #1e293b' }}>
      <div className="px-4 py-3 border-b flex items-center gap-2 shrink-0" style={{ borderColor: '#1e293b' }}>
        <Folder className="w-3.5 h-3.5 text-emerald-400" />
        <span className="text-xs font-bold text-white tracking-wide">Ví dụ cấu trúc thư mục output</span>
      </div>
      <div className="px-4 py-4 overflow-y-auto text-xs font-mono leading-relaxed space-y-0.5" style={{ color: '#94a3b8' }}>
        {lines.map((line, i) => (
          <div key={i} style={{ color: line.color || '#94a3b8', paddingLeft: line.indent * 16 }}>
            {line.icon} {line.text}
          </div>
        ))}
      </div>
    </div>
  )

  // ── Shared: builds tree lines for Request app ─────────────────────────────
  const buildRequestTreeLines = () => {
    const root = googleAuth?.folder_name || 'My Drive'
    const lines = [
      { indent: 0, icon: '📁', text: root, color: '#e2e8f0' },
      { indent: 1, icon: '📁', text: 'Requests', color: '#10b981' },
      { indent: 2, icon: '📁', text: '[001] Nhóm yêu cầu A', color: '#60a5fa' },
      { indent: 3, icon: '📊', text: 'thong_tin_requests.xlsx', color: '#4ade80' },
      { indent: 3, icon: '📁', text: '[1234] Tên yêu cầu 1', color: '#60a5fa' },
      { indent: 4, icon: '📊', text: 'Thông tin trường tùy chỉnh.xlsx', color: '#94a3b8' },
      { indent: 4, icon: '📝', text: 'post_and_comment.txt', color: '#94a3b8' },
      { indent: 4, icon: '📊', text: '[tên bảng].xlsx', color: '#94a3b8' },
      { indent: 4, icon: '📁', text: 'Tệp đính kèm/', color: '#94a3b8' },
      { indent: 5, icon: '📄', text: 'file1.pdf', color: '#64748b' },
      { indent: 5, icon: '🖼️', text: 'image.png', color: '#64748b' },
      { indent: 3, icon: '📁', text: '[1235] Tên yêu cầu 2', color: '#60a5fa' },
      { indent: 4, icon: '…', text: '(tương tự)', color: '#64748b' },
      { indent: 2, icon: '📁', text: '[002] Nhóm yêu cầu B', color: '#60a5fa' },
      { indent: 3, icon: '…', text: '(tương tự)', color: '#64748b' },
      { indent: 2, icon: '📁', text: '[direct] Đề xuất trực tiếp', color: '#60a5fa' },
      { indent: 3, icon: '…', text: '(yêu cầu không thuộc nhóm)', color: '#64748b' },
    ]
    return lines
  }

  // ── Request app: step 4 — review ─────────────────────────────────────────
  const renderRequestStep4 = () => {
    const isEdit = viewMode === 'edit'
    const destinationLabel = storageDestination === 'gsheets' ? 'Google Sheets' : 'Google Drive'
    const backupTypeLabels = {
      structured: 'Bảng tính (Dữ liệu có cấu trúc)',
      unstructured: 'File & Đính kèm',
      all: 'Toàn bộ',
    }
    const backupTypeColors = { structured: '#0284c7', unstructured: '#d97706', all: '#7c3aed' }

    // Vertical layout: label on top, value below — tránh bị cắt chữ
    const SummaryField = ({ label, children }) => (
      <div className="py-2.5 border-b border-gray-50 last:border-0">
        <div className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mb-0.5">{label}</div>
        <div className="text-sm text-gray-800 break-words">{children}</div>
      </div>
    )

    const treeLines = buildRequestTreeLines()

    const _reqBlockedReason = getGoogleDriveRunBlockedReason()
    const _reqArchiveNotice = renderServiceRootArchiveNotice(selectedApp, storageDestination)

    return (
      <div className="h-full flex flex-col gap-4">
        {/* Ready banner — includes inline warning if any */}
        <div className={`shrink-0 rounded-2xl px-5 py-4 flex items-center gap-4 ${_reqBlockedReason ? 'bg-amber-50 border border-amber-200' : 'bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200'}`}>
          <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${_reqBlockedReason ? 'bg-amber-100' : 'bg-green-100'}`}>
            {_reqBlockedReason
              ? <Info className="w-5 h-5 text-amber-600" />
              : <CheckCircle className="w-5 h-5 text-green-600" />}
          </div>
          <div className="flex-1 min-w-0">
            {_reqBlockedReason ? (
              <>
                <h3 className="text-sm font-bold text-amber-800">Lưu ý trước khi tạo</h3>
                <p className="text-xs text-amber-700 mt-0.5 leading-relaxed">{_reqBlockedReason}</p>
                {_reqArchiveNotice && <p className="text-xs text-amber-600 mt-1 leading-relaxed">{_reqArchiveNotice}</p>}
              </>
            ) : (
              <>
                <h3 className="text-sm font-bold text-green-800">Sẵn sàng tạo luồng backup!</h3>
                <p className="text-xs text-green-600 mt-0.5">Kiểm tra lại cấu hình bên dưới rồi nhấn xác nhận</p>
              </>
            )}
          </div>
          {/* CTA inline */}
          <div className="ml-auto flex items-center gap-2 shrink-0">
            <button
              onClick={() => handleFinish(true)}
              className="flex items-center gap-1.5 px-4 py-2 text-sm border border-green-400 text-green-700 bg-white rounded-xl hover:bg-green-50 transition-colors font-medium"
            >
              <Play className="w-3.5 h-3.5" />
              {isEdit ? 'Lưu & Chạy' : 'Tạo & Chạy'}
            </button>
            <button
              onClick={() => handleFinish(false)}
              className="flex items-center gap-1.5 px-5 py-2 text-sm bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-semibold shadow-sm"
            >
              <Rocket className="w-3.5 h-3.5" />
              {isEdit ? 'Lưu thay đổi' : 'Tạo luồng'}
            </button>
          </div>
        </div>

        {/* 2-column layout */}
        <div className="flex gap-5 flex-1 min-h-0">

          {/* LEFT — Summary */}
          <div className="flex-1 min-w-0 flex flex-col gap-3 overflow-y-auto pr-1">

            {/* Source card */}
            <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
              <div className="px-4 py-2.5 bg-orange-50 border-b border-orange-100 flex items-center gap-2">
                <Inbox className="w-3.5 h-3.5 text-orange-500" />
                <span className="text-[11px] font-bold text-orange-700 uppercase tracking-wide">Nguồn dữ liệu</span>
              </div>
              <div className="px-4 py-0.5">
                <SummaryField label="Ứng dụng">
                  <span className="font-semibold" style={{ color: currentApp?.color }}>{currentApp?.name}</span>
                </SummaryField>
                <SummaryField label="Địa chỉ">
                  <span className="font-mono text-xs text-gray-700">{domain || <span className="text-red-400">Chưa nhập</span>}</span>
                </SummaryField>
                <SummaryField label="Token xác thực">
                  <span className="font-mono text-gray-500 text-xs">
                    {accessTokenV2 ? `••••${accessTokenV2.slice(-4)}` : <span className="text-red-400">Chưa nhập</span>}
                  </span>
                </SummaryField>
              </div>
            </div>

            {/* Destination card */}
            <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
              <div className="px-4 py-2.5 bg-blue-50 border-b border-blue-100 flex items-center gap-2">
                <Cloud className="w-3.5 h-3.5 text-blue-500" />
                <span className="text-[11px] font-bold text-blue-700 uppercase tracking-wide">Lưu trữ</span>
              </div>
              <div className="px-4 py-0.5">
                <SummaryField label="Loại backup">
                  {backupType
                    ? <span className="font-semibold" style={{ color: backupTypeColors[backupType] }}>{backupTypeLabels[backupType]}</span>
                    : <span className="text-red-400 text-xs">Chưa chọn</span>}
                </SummaryField>
                <SummaryField label="Lưu vào">
                  <span className="font-semibold">{destinationLabel || <span className="text-red-400 text-xs">Chưa chọn</span>}</span>
                </SummaryField>
                <SummaryField label="Tài khoản Google">
                  <span className="text-xs text-gray-700 break-all">{googleAuth?.email || <span className="text-red-400">Chưa kết nối</span>}</span>
                </SummaryField>
                <SummaryField label="Thư mục lưu trữ">
                  <span className="text-xs text-gray-700">{googleAuth?.folder_name || <span className="text-gray-400">My Drive (mặc định)</span>}</span>
                </SummaryField>
              </div>
            </div>

            {/* Note: Request ignores backup_type */}
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
              <div className="flex gap-2">
                <Info className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-[11px] text-amber-700 leading-relaxed">
                  <strong>Lưu ý:</strong> Với ứng dụng Request, hệ thống luôn backup toàn bộ dữ liệu (bảng tính + file đính kèm) bất kể loại backup được chọn.
                </p>
              </div>
            </div>
          </div>

          {/* RIGHT — Output tree */}
          <div className="flex-1 flex flex-col min-w-0 min-h-0">
            {renderFileTree(treeLines)}
            <div className="mt-3 space-y-1 shrink-0">
              <p className="text-[11px] text-gray-400 leading-relaxed">
                <span className="text-green-500 font-bold">📊 .xlsx</span> — Danh sách request và trường tùy chỉnh &nbsp;·&nbsp;
                <span className="text-blue-400 font-bold">📝 .txt</span> — Bài đăng & bình luận &nbsp;·&nbsp;
                <span className="text-gray-400 font-bold">📁 Tệp đính kèm/</span> — File gốc hoặc metadata nếu không tải được
              </p>
            </div>
          </div>

        </div>
      </div>
    )
  }

  // ── Service account step (used when googleAuthMethod === 'service_account') ─
  const renderServiceAccountStep = () => {
    const analysis = serviceAccountAnalysis || {}
    const availableDrives = Array.isArray(analysis.drives) ? analysis.drives : []
    const serviceAccountEmail = analysis.client_email || googleAuth?.service_account_email || googleAuth?.email
    const projectId = analysis.project_id || googleAuth?.project_id

    return (
      <div className="max-w-xl space-y-6">
        <div className="border-2 border-dashed border-gray-200 rounded-2xl p-6 hover:border-purple-300 transition-colors">
          <div className="flex items-center gap-2 mb-1">
            <Lock className="w-4 h-4 text-purple-600" />
            <p className="text-sm font-bold text-gray-800">Tải lên file JSON Tài khoản Dịch vụ Google</p>
          </div>
          <p className="text-xs text-gray-400 mb-4 leading-relaxed">
            Vào <strong>Google Cloud Console</strong> → <strong>IAM & Admin</strong> → <strong>Service Accounts</strong> → chọn tài khoản → tab <strong>Keys</strong> → <strong>Add Key</strong> → tải file <code className="bg-gray-100 px-1 rounded">.json</code>
          </p>
          <input
            type="file"
            accept=".json,application/json"
            onChange={handleServiceAccountFileUpload}
            className="text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border file:border-gray-300 file:text-xs file:font-semibold file:bg-white file:text-gray-700 hover:file:bg-gray-50"
          />
          {serviceAccountFileName && (
            <div className="flex items-center gap-1.5 mt-3 text-xs text-gray-500">
              <CheckCircle className="w-3.5 h-3.5 text-green-500" />
              <span>Đã tải: {serviceAccountFileName}</span>
            </div>
          )}
        </div>

        {serviceAccountError && <Alert type="error" message={serviceAccountError} />}

        {serviceAccountAnalysisLoading && (
          <div className="flex items-center gap-2 py-4 text-sm text-gray-500"><Spinner /> Đang phân tích file…</div>
        )}

        {serviceAccountEmail && !serviceAccountAnalysisLoading && (
          <div className="bg-purple-50 border border-purple-200 rounded-2xl p-5 space-y-3">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-purple-600" />
              <span className="text-sm font-bold text-purple-800">Xác nhận tài khoản dịch vụ</span>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex gap-3">
                <span className="text-xs text-gray-400 w-20 shrink-0 pt-0.5">Email</span>
                <span className="font-semibold text-gray-800 break-all">{serviceAccountEmail}</span>
              </div>
              <div className="flex gap-3">
                <span className="text-xs text-gray-400 w-20 shrink-0 pt-0.5">Project</span>
                <span className="font-semibold text-gray-800">{projectId || '—'}</span>
              </div>
              {availableDrives.length > 0 && (
                <div className="flex gap-3">
                  <span className="text-xs text-gray-400 w-20 shrink-0 pt-0.5">Shared Drives</span>
                  <div className="flex flex-wrap gap-1">
                    {availableDrives.map(d => <Tag key={d.id} color="default">{d.name}</Tag>)}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {storageDestination === 'gdrive' && googleAuth && (
          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-1">
              Thư mục lưu trữ <span className="text-xs text-gray-400 font-normal">(tùy chọn)</span>
            </label>
            <p className="text-xs text-gray-400 mb-2">Chọn thư mục trong Google Drive để lưu bản backup. Chỉ thư mục trong Shared Drive mới được hỗ trợ với Service Account.</p>
            <button
              onClick={handleOpenFolderPicker}
              className="w-full border-2 border-dashed border-gray-200 rounded-xl px-4 py-3.5 text-sm flex items-center gap-3 hover:border-purple-400 hover:bg-purple-50/30 transition-all text-left"
            >
              <Folder className={`w-5 h-5 shrink-0 ${googleAuth.folder_name ? 'text-amber-500' : 'text-gray-400'}`} />
              <span className={googleAuth.folder_name ? 'font-medium text-gray-800' : 'text-gray-400'}>
                {googleAuth.folder_name ? `📁 ${googleAuth.folder_name}` : 'Nhấn để chọn thư mục…'}
              </span>
            </button>
            {renderGoogleDriveFolderSummary()}
            {getGoogleDriveRunBlockedReason() && (
              <Alert type="warning" message="Thư mục này chưa thể sử dụng" description={getGoogleDriveRunBlockedReason()} className="mt-2" />
            )}
          </div>
        )}
      </div>
    )
  }

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

  // Sync form fields when modal opens
  useEffect(() => {
    if (googleConfigModalOpen) {
      setGcClientId('')
      setGcClientSecret('')
      setGcRedirectUri(googleRedirectUri || DEFAULT_GOOGLE_REDIRECT)
    }
  }, [googleConfigModalOpen, googleRedirectUri])

  const handleSaveGoogleConfigAndConnectNew = async () => {
    if (!gcClientId.trim()) { message.error('Client ID is required'); return }
    if (!gcClientSecret.trim() && !googleSecretSet) { setGoogleConfigError('Client Secret is required'); return }
    setGoogleConfigSaving(true)
    setGoogleConfigError('')
    try {
      await api.put(`/api/settings/google`, {
        client_id: gcClientId.trim(),
        client_secret: gcClientSecret.trim() || '__KEEP__',
        redirect_uri: gcRedirectUri.trim() || DEFAULT_GOOGLE_REDIRECT,
      })
      const authRes = await api.get(`/api/google/auth-url`)
      const data = await startGoogleOAuthPopup(authRes.data.url)
      setGoogleAuthMethod('oauth')
      setGoogleAuth({ auth_method: 'oauth', connection_id: data.connection_id, email: data.email, display_name: data.display_name || data.email, picture_url: data.picture_url || '', folder_id: null, folder_name: null, drive_id: null })
      setGoogleConfigModalOpen(false)
      setGoogleSecretSet(true)
      message.success(`Connected as ${data.email}`)
    } catch (err) {
      setGoogleConfigError(err.response?.data?.detail || err.message || 'Failed to configure Google OAuth')
    } finally {
      setGoogleConfigSaving(false)
    }
  }

  const handleDeleteFlowConfirm = (record, options = {}) => {
    if (window.confirm(`Delete "${record.name || 'Draft'}"?\n\nThis action cannot be undone.`)) {
      api.delete(`/api/backup-flows/${record.id}`)
        .then(() => { message.success('Backup flow deleted'); fetchFlows(); options.onDeleted?.() })
        .catch(() => message.error('Failed to delete'))
    }
  }

  return (
    <AppLayout>
      {viewMode === 'list' ? (
        <div className="p-8">{renderListView()}</div>
      ) : viewMode === 'detail' ? (
        renderDetailView()
      ) : (
        renderCreateView()
      )}

      {renderFlowDetailsDrawer()}

      {/* ── Choose App Modal ── */}
      <Modal title="Choose Application" open={showAppSelectionModal} onCancel={() => setShowAppSelectionModal(false)} width={820}>
        <p className="text-sm text-gray-500 mb-4">Select the app whose data you want to back up.</p>
        <div className="grid grid-cols-2 gap-4">
          {Object.values(APPS).map(app => (
            <button
              key={app.id}
              onClick={() => handleAppSelection(app.id)}
              className={`flex gap-4 items-start p-4 rounded-lg border-2 text-left transition-all hover:shadow-md ${
                selectedApp === app.id ? 'border-current shadow-sm' : 'border-gray-200 hover:border-gray-300'
              }`}
              style={selectedApp === app.id ? { borderColor: app.color, backgroundColor: app.bg } : {}}
            >
              <div className="p-2.5 rounded-lg shrink-0" style={{ backgroundColor: app.bg, color: app.color }}>
                {app.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm mb-1" style={{ color: app.color }}>{app.name}</div>
                <p className="text-xs text-gray-500 mb-2">{app.description}</p>
                <div className="flex flex-wrap gap-1">
                  {app.objects.map(obj => (
                    <span key={obj} className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium" style={{ backgroundColor: app.bg, color: app.color }}>
                      {app.objectLabels[obj]}
                    </span>
                  ))}
                </div>
              </div>
              {selectedApp === app.id && <Check className="w-4 h-4 shrink-0 mt-0.5" style={{ color: app.color }} />}
            </button>
          ))}
        </div>
      </Modal>

      {/* ── Google OAuth Config Modal ── */}
      <Modal
        title="Configure Google OAuth"
        open={googleConfigModalOpen}
        onCancel={() => { if (googleConfigSaving) return; setGoogleConfigModalOpen(false); setGoogleConfigError('') }}
        width={600}
        footer={
          <>
            <button onClick={() => { setGoogleConfigModalOpen(false); setGoogleConfigError('') }} disabled={googleConfigSaving} className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50">Cancel</button>
            <button onClick={handleSaveGoogleConfigAndConnectNew} disabled={googleConfigSaving} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
              {googleConfigSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Save & Connect Google
            </button>
          </>
        }
      >
        <p className="text-sm text-gray-500 mb-4">Enter <strong>Client ID</strong>, <strong>Client Secret</strong> and <strong>Redirect URI</strong> then connect.</p>
        {googleConfigError && <Alert type="error" message={googleConfigError} className="mb-4" />}
        {googleConfigLoading ? <SpinCenter /> : (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Client ID <span className="text-red-500">*</span></label>
              <input value={gcClientId} onChange={e => setGcClientId(e.target.value)} placeholder="123456789-abc.apps.googleusercontent.com" className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Client Secret</label>
              <input type="password" value={gcClientSecret} onChange={e => setGcClientSecret(e.target.value)} placeholder={googleSecretSet ? 'Leave blank to keep current secret' : 'GOCSPX-xxxxxxxxxxxxxxxx'} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <p className="text-xs text-gray-400 mt-1">{googleSecretSet ? 'A secret is already stored. Leave blank to keep it.' : 'Stored encrypted in the database.'}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Redirect URI <span className="text-red-500">*</span></label>
              <input value={gcRedirectUri} onChange={e => setGcRedirectUri(e.target.value)} placeholder={DEFAULT_GOOGLE_REDIRECT} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <Alert type="info" message="Google Cloud Console reminder" description={`Authorized redirect URI must include ${googleRedirectUri || DEFAULT_GOOGLE_REDIRECT}`} />
          </div>
        )}
      </Modal>

      {/* ── Google Folder Picker Modal ── */}
      <Modal
        title={<span className="flex items-center gap-2"><Globe className="w-4 h-4 text-blue-500" /> Select Google Drive Folder</span>}
        open={googleFolderModal}
        onCancel={() => setGoogleFolderModal(false)}
        width={540}
        footer={
          <>
            <button onClick={() => setGoogleFolderModal(false)} className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50">Cancel</button>
            <button onClick={handleSelectCurrentFolder} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 flex items-center gap-2">
              <Folder className="w-3.5 h-3.5" /> Select Current Location
            </button>
          </>
        }
      >
        {loadingDrives ? <SpinCenter text="Loading drives…" /> : (
          <div className="space-y-3">
            {drives.length > 1 && (
              <select value={currentDriveId} onChange={e => handleDriveChange(e.target.value)} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                {drives.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            )}
            {/* Breadcrumb */}
            <div className="bg-gray-50 rounded-md px-3 py-2 flex flex-wrap gap-1 items-center text-xs">
              {folderPath.map((item, idx) => (
                <span key={item.id} className="flex items-center gap-1">
                  {idx > 0 && <ChevronRight className="w-3 h-3 text-gray-400" />}
                  <span onClick={() => idx < folderPath.length - 1 && handleBreadcrumbNav(idx)}
                    className={idx === folderPath.length - 1 ? 'font-semibold text-gray-900' : 'text-blue-600 cursor-pointer hover:underline'}>
                    {item.name}
                  </span>
                </span>
              ))}
            </div>

            {isServiceAccountDestinationAuth && (
              <div className="space-y-2">
                <div className="border-t border-gray-200 pt-2">
                  <p className="text-xs font-medium text-gray-500 mb-2">Shared to this service account</p>
                  <Alert type="info" message="Need a directly shared folder?" description="Paste a folder link or search below. Only 'Shared Drive' folders can be used as backup destination." className="mb-2" />
                  <div className="flex gap-2 mb-2">
                    <input value={sharedFolderReference} onChange={e => setSharedFolderReference(e.target.value)} placeholder="Paste Google Drive folder link or ID" className="flex-1 border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <button onClick={handleResolveSharedFolder} disabled={resolvingSharedFolder} className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1">
                      {resolvingSharedFolder ? <Loader2 className="w-3 h-3 animate-spin" /> : null} Use folder
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <input value={sharedFolderQuery} onChange={e => setSharedFolderQuery(e.target.value)} placeholder="Search shared folders…" className="flex-1 border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <button onClick={() => loadSharedFolders(sharedFolderQuery.trim())} disabled={loadingSharedFolders} className="px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50">Search</button>
                  </div>
                </div>
                <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg">
                  {loadingSharedFolders ? <SpinCenter text="Loading…" /> : sharedFolders.length === 0 ? <Empty description="No directly shared folders found" /> : sharedFolders.map(folder => (
                    <div key={folder.id} className="flex items-center gap-3 px-3 py-2.5 border-b border-gray-100 last:border-0">
                      <Folder className="w-4 h-4 text-amber-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{folder.name}</div>
                        <div className="text-xs text-gray-500">Drive: {resolveDriveName(folder.drive_id, folder.drive_name || null)}</div>
                        <div className="flex gap-1 mt-1">
                          <Tag color="blue">Direct share</Tag>
                          {folder.drive_id ? <Tag color="green">Shared Drive</Tag> : <Tag color="gold">My Drive only</Tag>}
                        </div>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <button onClick={() => openFolderLocation(folder)} className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50">Open</button>
                        {folder.drive_id
                          ? <button onClick={() => applyGoogleFolderSelection(folder)} className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700">Use</button>
                          : <button disabled title="Cannot use My Drive folder with service account" className="px-2 py-1 text-xs bg-blue-200 text-white rounded opacity-50 cursor-not-allowed">Use</button>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Folder list */}
            <div className={`overflow-y-auto border border-gray-200 rounded-lg ${isServiceAccountDestinationAuth ? 'max-h-48' : 'max-h-72'}`}>
              {loadingFolders ? <SpinCenter text="Loading folders…" /> : folders.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-gray-400">
                  <Folder className="w-8 h-8 mb-2 opacity-30" />
                  <p className="text-sm">No sub-folders here</p>
                </div>
              ) : folders.map(folder => (
                <button key={folder.id} onClick={() => handleOpenSubFolder(folder)} className="w-full flex items-center gap-3 px-3 py-2.5 border-b border-gray-100 last:border-0 hover:bg-gray-50 transition-colors text-left">
                  <Folder className="w-4 h-4 text-amber-500 shrink-0" />
                  <span className="flex-1 text-sm">{folder.name}</span>
                  <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
                </button>
              ))}
            </div>
          </div>
        )}
      </Modal>

      {/* ── Select Services Modal ── */}
      <Modal
        title="Select Services for This Flow"
        open={serviceSelectorModalOpen}
        onCancel={closeServiceSelectorModal}
        width={960}
        footer={
          <>
            <button onClick={() => loadServicePreview(draftSelectedServiceIds)} disabled={loadingServicePreview} className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 flex items-center gap-2">
              {loadingServicePreview ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Refresh Source
            </button>
            <button onClick={closeServiceSelectorModal} className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50">Cancel</button>
            <button onClick={applyServiceSelectorModal} disabled={!servicePreview} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50">Apply Selection</button>
          </>
        }
      >
        <p className="text-sm text-gray-500 mb-4">Select services to include in this backup flow.</p>
        {loadingServicePreview ? <SpinCenter /> : !servicePreview ? <Empty description="Load Service source preview first to choose services" /> : (
          <div className="space-y-3">
            <div className="flex gap-2 flex-wrap">
              <Tag color="blue">{servicePreviewRows.length} services loaded</Tag>
              <Tag color={draftSelectedServiceIds.length ? 'green' : 'default'}>{draftSelectedServiceIds.length} selected</Tag>
            </div>
            {!servicePreview.ticket_count_complete && <Alert type="warning" message={`Detailed preview loaded for ${servicePreview.detail_loaded_count || 0} services only`} description="Click Refresh Source to reload with your current selection." />}
            {servicePreview.partial_error_count > 0 && <Alert type="warning" message={`Some services could not be previewed completely (${servicePreview.partial_error_count})`} />}
            <div ref={servicePreviewListRef} className="border border-gray-200 rounded-lg overflow-hidden">
              <div className="overflow-x-auto max-h-96 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase w-8">
                        <input type="checkbox" checked={draftSelectedServiceIds.length === servicePreviewRows.length && servicePreviewRows.length > 0} onChange={e => setDraftSelectedServiceIds(e.target.checked ? servicePreviewRows.map(r => r.service_id) : [])} className="rounded" />
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Service</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase w-20">Stages</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase w-20">Tickets</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Sample Tickets</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {servicePreviewRows.map(record => (
                      <tr key={record.service_id} className={`hover:bg-gray-50 ${draftSelectedServiceIds.includes(record.service_id) ? 'bg-blue-50/50' : ''}`}>
                        <td className="px-3 py-2.5">
                          <input type="checkbox" checked={draftSelectedServiceIds.includes(record.service_id)} onChange={e => setDraftSelectedServiceIds(prev => e.target.checked ? [...prev, record.service_id] : prev.filter(id => id !== record.service_id))} className="rounded" />
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="font-semibold">{record.service_name}</div>
                          <div className="text-xs text-gray-400">ID: {record.service_id}</div>
                          {record.preview_error && <div className="text-xs text-yellow-600 mt-0.5">{record.preview_error}</div>}
                        </td>
                        <td className="px-3 py-2.5 text-gray-600">{record.stage_count ?? '—'}</td>
                        <td className="px-3 py-2.5 text-gray-600">{record.ticket_count ?? '—'}</td>
                        <td className="px-3 py-2.5">
                          {record.detail_loaded
                            ? (record.sample_tickets || []).length > 0
                              ? (record.sample_tickets || []).map(t => <div key={t.ticket_id} className="text-xs text-gray-600">{t.ticket_code} - {t.ticket_name}</div>)
                              : <span className="text-xs text-gray-400">No sample tickets</span>
                            : <span className="text-xs text-gray-400">Refresh after selecting</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Destination Selection Modal ── */}
      <Modal title="Select Destination" open={showDestinationModal} onCancel={() => { setShowDestinationModal(false); setDestinationSearch('') }} width={640}>
        <p className="text-sm text-gray-500 mb-4">Choose where to store your backup data.</p>
        <div className="relative mb-4">
          <Cloud className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input value={destinationSearch} onChange={e => setDestinationSearch(e.target.value)} placeholder="Search destinations…" className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          {[
            { id: 'gsheets', name: 'Google Sheets', icon: <FileSpreadsheet className="w-8 h-8" />, color: '#10b981', types: ['structured'] },
            { id: 'gdrive', name: 'Google Drive', icon: <Globe className="w-8 h-8" />, color: '#4285f4', types: ['unstructured', 'all'] },
          ]
            .filter(opt => !backupType || opt.types.includes(backupType))
            .filter(opt => opt.name.toLowerCase().includes(destinationSearch.toLowerCase()))
            .map(opt => (
              <button key={opt.id} onClick={() => { setStorageDestination(opt.id); setGoogleAuth(null); setServiceAccountAnalysis(null); setServiceAccountFileName(''); setServiceAccountError(''); setServiceBackupSetupSaved(false); setShowDestinationModal(false); setDestinationSearch('') }}
                className="flex flex-col items-center gap-2 p-5 border-2 border-gray-200 rounded-xl hover:border-gray-300 hover:shadow-sm transition-all cursor-pointer bg-white">
                <span style={{ color: opt.color }}>{opt.icon}</span>
                <span className="text-sm font-semibold text-gray-900">{opt.name}</span>
              </button>
            ))}
        </div>
      </Modal>
    </AppLayout>
  )
}

export default BackupFlowPage



