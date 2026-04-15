import { useState, useCallback, useRef, useEffect } from 'react'
import api from '@shared/api/client'
import { message } from '@packages/ui/src/components/common/ui'
import { APPS, APP_CONNECTION_CONFIG, MOCK_FIELDS, DEFAULT_GOOGLE_REDIRECT, SERVICE_ACCOUNT_SHARED_DRIVE_MESSAGE } from '../constants'

/**
 * All wizard form state + validation + autosave + finish.
 * Keeps the same API contract so backend works untouched.
 */
export default function useWizardState() {
  // ── Core ────────────────────────────────────────────────────────────────
  const [currentStep, setCurrentStep] = useState(0)
  const [draftFlowId, setDraftFlowId] = useState(null)
  const [editFlowId, setEditFlowId] = useState(null)
  const [flowName, setFlowName] = useState('')

  // ── App ─────────────────────────────────────────────────────────────────
  const [selectedApp, setSelectedApp] = useState(null)

  // ── Source ──────────────────────────────────────────────────────────────
  const [domain, setDomain] = useState('')
  const [accessTokenV2, setAccessTokenV2] = useState('')
  const [showTokenV2, setShowTokenV2] = useState(false)
  const [accessToken, setAccessToken] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [selectedObjects, setSelectedObjects] = useState([])

  // ── Backup config ─────────────────────────────────────────────────────
  const [backupType, setBackupType] = useState(null)
  const [storageDestination, setStorageDestination] = useState(null)

  // ── Google auth ───────────────────────────────────────────────────────
  const [googleAuthMethod, setGoogleAuthMethod] = useState('oauth')
  const [googleAuth, setGoogleAuth] = useState(null)
  const [platformServiceAccount, setPlatformServiceAccount] = useState(null)
  const [savedGoogleConnections, setSavedGoogleConnections] = useState([])
  const [loadingSavedGoogleConnections, setLoadingSavedGoogleConnections] = useState(false)

  // ── Service account ───────────────────────────────────────────────────
  const [serviceAccountAnalysis, setServiceAccountAnalysis] = useState(null)
  const [serviceAccountAnalysisLoading, setServiceAccountAnalysisLoading] = useState(false)
  const [serviceAccountFileName, setServiceAccountFileName] = useState('')
  const [serviceAccountError, setServiceAccountError] = useState('')

  // ── Custom fields ─────────────────────────────────────────────────────
  const [selectedFieldIds, setSelectedFieldIds] = useState([])
  const [exportFormats, setExportFormats] = useState({})

  // ── Service preview ───────────────────────────────────────────────────
  const [servicePreview, setServicePreview] = useState(null)
  const [loadingServicePreview, setLoadingServicePreview] = useState(false)
  const [selectedServiceIds, setSelectedServiceIds] = useState([])
  const [draftSelectedServiceIds, setDraftSelectedServiceIds] = useState([])
  const [serviceSourceSetupSaved, setServiceSourceSetupSaved] = useState(false)
  const [serviceBackupSetupSaved, setServiceBackupSetupSaved] = useState(false)
  const servicePreviewListRef = useRef(null)
  const shouldResetServicePreviewScrollRef = useRef(false)

  // ── Modals ────────────────────────────────────────────────────────────
  const [showAppSelectionModal, setShowAppSelectionModal] = useState(false)
  const [showDestinationModal, setShowDestinationModal] = useState(false)
  const [serviceSelectorModalOpen, setServiceSelectorModalOpen] = useState(false)

  // ── Google folder picker ──────────────────────────────────────────────
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

  // ── Google config modal ───────────────────────────────────────────────
  const [googleConfigModalOpen, setGoogleConfigModalOpen] = useState(false)
  const [googleConfigLoading, setGoogleConfigLoading] = useState(false)
  const [googleConfigSaving, setGoogleConfigSaving] = useState(false)
  const [googleSecretSet, setGoogleSecretSet] = useState(false)
  const [googleRedirectUri, setGoogleRedirectUri] = useState(DEFAULT_GOOGLE_REDIRECT)
  const [googleConfigError, setGoogleConfigError] = useState('')
  const [gcClientId, setGcClientId] = useState('')
  const [gcClientSecret, setGcClientSecret] = useState('')
  const [gcRedirectUri, setGcRedirectUri] = useState(DEFAULT_GOOGLE_REDIRECT)

  // ── Derived ───────────────────────────────────────────────────────────
  const currentApp = selectedApp ? APPS[selectedApp] : null
  const isRequestApp = currentApp?.isSpecial
  const isServiceApp = currentApp?.id === 'service'
  const connectionConfig = selectedApp ? APP_CONNECTION_CONFIG[selectedApp] : null

  const buildPlatformServiceAccountState = useCallback((overrides = {}) => {
    const serviceAccountEmail = platformServiceAccount?.service_account_email || platformServiceAccount?.email || null
    return {
      auth_mode: 'service_account',
      auth_method: 'service_account',
      uses_platform_service_account: true,
      service_account_email: serviceAccountEmail,
      email: serviceAccountEmail,
      display_name: serviceAccountEmail || 'Platform Service Account',
      picture_url: '',
      folder_id: overrides.folder_id ?? null,
      folder_name: overrides.folder_name ?? null,
      drive_id: overrides.drive_id ?? null,
      drive_name: overrides.drive_name ?? null,
      project_id: overrides.project_id ?? null,
      service_account_json_encrypted: overrides.service_account_json_encrypted ?? null,
    }
  }, [platformServiceAccount])

  const resolvedGoogleAuthMethod =
    googleAuth?.auth_mode === 'service_account' || googleAuth?.auth_method === 'service_account'
      ? 'service_account'
      : googleAuth?.auth_mode === 'google_oauth' || googleAuth?.auth_method === 'oauth'
        ? 'oauth'
        : googleAuthMethod
  const isServiceAccountDestinationAuth =
    resolvedGoogleAuthMethod === 'service_account'
    || Boolean(googleAuth?.service_account_json)
    || Boolean(googleAuth?.service_account_json_encrypted)
    || Boolean(googleAuth?.credentials_json)
    || Boolean(googleAuth?.uses_platform_service_account)

  const usesCondensedServiceWizard = isServiceApp
  const hasServiceAccountStep = googleAuthMethod === 'service_account'
  const totalSteps = usesCondensedServiceWizard ? 3 : (hasServiceAccountStep ? 5 : 4)

  const loadPlatformServiceAccount = useCallback(async () => {
    try {
      const res = await api.get('/api/google/platform-service-account')
      setPlatformServiceAccount({
        available: Boolean(res.data?.platform_credential_available),
        email: res.data?.service_account_email || null,
        service_account_email: res.data?.service_account_email || null,
      })
    } catch {
      setPlatformServiceAccount({ available: false, email: null, service_account_email: null })
    }
  }, [])

  const loadSavedGoogleConnections = useCallback(async () => {
    setLoadingSavedGoogleConnections(true)
    try {
      const res = await api.get('/api/google/connections')
      setSavedGoogleConnections(Array.isArray(res.data) ? res.data : [])
    } catch {
      setSavedGoogleConnections([])
    } finally {
      setLoadingSavedGoogleConnections(false)
    }
  }, [])

  useEffect(() => {
    void loadPlatformServiceAccount()
    void loadSavedGoogleConnections()
  }, [loadPlatformServiceAccount, loadSavedGoogleConnections])

  useEffect(() => {
    if (googleAuthMethod !== 'service_account') return
    if (!platformServiceAccount?.available) return
    if (googleAuth && (googleAuth.auth_mode === 'service_account' || googleAuth.auth_method === 'service_account')) return
    setGoogleAuth(buildPlatformServiceAccountState())
  }, [googleAuthMethod, platformServiceAccount?.available, googleAuth, buildPlatformServiceAccountState])

  // ── Reset ─────────────────────────────────────────────────────────────
  const resetAll = useCallback(() => {
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
  }, [])

  // ── App selection ─────────────────────────────────────────────────────
  const handleAppSelection = useCallback((appId) => {
    setSelectedApp(appId)
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
  }, [])

  // ── Object selection ──────────────────────────────────────────────────
  const handleObjectToggle = useCallback((obj) => {
    setSelectedObjects(prev => prev.includes(obj) ? prev.filter(o => o !== obj) : [...prev, obj])
  }, [])

  const handleSelectAllObjects = useCallback(() => {
    if (!currentApp) return
    setSelectedObjects(prev =>
      prev.length === currentApp.objects.length ? [] : [...currentApp.objects]
    )
  }, [currentApp])

  // ── Custom fields ─────────────────────────────────────────────────────
  const getAvailableFields = useCallback(() => {
    if (!selectedApp || isRequestApp) return []
    if (selectedApp === 'service') return []
    const allFields = MOCK_FIELDS[selectedApp] || []
    return allFields.filter(f => selectedObjects.includes(f.object))
  }, [selectedApp, isRequestApp, selectedObjects])

  const handleFieldToggle = useCallback((fieldId) => {
    setSelectedFieldIds(prev => prev.includes(fieldId) ? prev.filter(f => f !== fieldId) : [...prev, fieldId])
  }, [])

  const handleSelectAllFields = useCallback(() => {
    const available = getAvailableFields()
    setSelectedFieldIds(prev =>
      prev.length === available.length ? [] : available.map(f => f.id)
    )
  }, [getAvailableFields])

  // ── Destination ───────────────────────────────────────────────────────
  const selectDestination = useCallback((dest) => {
    setStorageDestination(dest)
    setGoogleAuth(null)
    setGoogleAuthMethod('oauth')
    setServiceAccountAnalysis(null)
    setServiceAccountFileName('')
    setServiceAccountError('')
    setSharedFolders([])
    setSharedFolderQuery('')
    setSharedFolderReference('')
    setShowDestinationModal(false)
  }, [])

  const selectSavedGoogleConnection = useCallback((connection) => {
    if (!connection) return
    const connectionId = String(connection.id)
    setGoogleAuthMethod('oauth')
    setServiceBackupSetupSaved(false)
    setGoogleAuth({
      auth_mode: 'google_oauth',
      auth_method: 'oauth',
      connection_id: connectionId,
      google_oauth_connection_id: connectionId,
      email: connection.email,
      google_oauth_email: connection.email,
      display_name: connection.display_name || connection.email,
      picture_url: connection.picture_url || '',
      folder_id: null,
      folder_name: null,
      drive_id: null,
      drive_name: null,
    })
    message.success(`Using saved Google connection: ${connection.email}`)
  }, [])

  // ── Google auth helpers ───────────────────────────────────────────────
  const buildGoogleDestinationAuth = useCallback((
    googleAuthState = googleAuth,
    authMethod = resolvedGoogleAuthMethod,
    saAnalysis = serviceAccountAnalysis,
  ) => {
    const resolved =
      googleAuthState?.auth_mode === 'service_account'
      || googleAuthState?.auth_method === 'service_account'
      || authMethod === 'service_account'
        ? 'service_account'
        : 'google_oauth'
    if (resolved === 'service_account') {
      const effectiveServiceAccount = googleAuthState || (platformServiceAccount?.available ? buildPlatformServiceAccountState() : null)
      const credentialsJson = effectiveServiceAccount?.service_account_json || effectiveServiceAccount?.credentials_json || null
      const encryptedCredentials = effectiveServiceAccount?.service_account_json_encrypted || null
      const usingPlatformCredential = Boolean(platformServiceAccount?.available && !credentialsJson && !encryptedCredentials)
      return {
        auth_mode: 'service_account',
        auth_method: 'service_account',
        credentials_json: credentialsJson,
        service_account_json_encrypted: encryptedCredentials,
        uses_platform_service_account: usingPlatformCredential,
        service_account_email: effectiveServiceAccount?.service_account_email || effectiveServiceAccount?.email || saAnalysis?.client_email || platformServiceAccount?.email || null,
        project_id: effectiveServiceAccount?.project_id || saAnalysis?.project_id || null,
        service_account_file_name: serviceAccountFileName || null,
        folder_id: effectiveServiceAccount?.folder_id || null,
        folder_name: effectiveServiceAccount?.folder_name || null,
        drive_id: effectiveServiceAccount?.drive_id || null,
        drive_name: effectiveServiceAccount?.drive_name || null,
      }
    }
    const connectionId = googleAuthState?.google_oauth_connection_id || googleAuthState?.connection_id || null
    const connectionEmail = googleAuthState?.google_oauth_email || googleAuthState?.email || null
    return {
      auth_mode: 'google_oauth',
      auth_method: 'oauth',
      google_oauth_connection_id: connectionId,
      connection_id: connectionId,
      google_oauth_email: connectionEmail,
      email: connectionEmail,
      display_name: googleAuthState?.display_name || connectionEmail,
      picture_url: googleAuthState?.picture_url || '',
      folder_id: googleAuthState?.folder_id || null,
      folder_name: googleAuthState?.folder_name || null,
      drive_id: googleAuthState?.drive_id || null,
      drive_name: googleAuthState?.drive_name || null,
    }
  }, [googleAuth, resolvedGoogleAuthMethod, serviceAccountAnalysis, serviceAccountFileName, platformServiceAccount, buildPlatformServiceAccountState])

  const hasReadyServiceAccountAuth = useCallback((
    googleAuthState = googleAuth,
    saAnalysis = serviceAccountAnalysis,
  ) => {
    const auth = buildGoogleDestinationAuth(googleAuthState, 'service_account', saAnalysis)
    return auth.auth_mode === 'service_account' && Boolean(
      auth.credentials_json
      || auth.service_account_json_encrypted
      || (platformServiceAccount?.available && auth.service_account_email)
    )
  }, [googleAuth, serviceAccountAnalysis, buildGoogleDestinationAuth, platformServiceAccount])

  const resolveDriveName = useCallback((driveId, explicitDriveName = null) => {
    if (explicitDriveName) return explicitDriveName
    if (!driveId) return 'My Drive'
    return drives.find(item => item.id === driveId)?.name || 'Shared Drive'
  }, [drives])

  const getGoogleDriveRunBlockedReason = useCallback((
    googleAuthState = googleAuth,
    authMethod = resolvedGoogleAuthMethod,
    saAnalysis = serviceAccountAnalysis,
    destinationType = storageDestination,
  ) => {
    if (destinationType !== 'gdrive') return null
    const destAuth = buildGoogleDestinationAuth(googleAuthState, authMethod, saAnalysis)
    if (destAuth?.auth_method === 'service_account' && !destAuth?.drive_id) {
      return SERVICE_ACCOUNT_SHARED_DRIVE_MESSAGE
    }
    return null
  }, [googleAuth, resolvedGoogleAuthMethod, serviceAccountAnalysis, storageDestination, buildGoogleDestinationAuth])

  // ── Autosave destination ──────────────────────────────────────────────
  const autosaveDestinationAuth = useCallback(async (
    googleAuthState = googleAuth,
    authMethod = googleAuthMethod,
    saAnalysis = serviceAccountAnalysis,
  ) => {
    if (!draftFlowId || !storageDestination) return
    await api.patch(`/api/backup-flows/${draftFlowId}/autosave`, {
      destination: {
        type: storageDestination,
        name: storageDestination === 'gsheets' ? 'Google Sheets' : 'Google Drive',
        auth: buildGoogleDestinationAuth(googleAuthState, authMethod, saAnalysis),
      },
    }).catch(() => {})
  }, [draftFlowId, storageDestination, googleAuth, googleAuthMethod, serviceAccountAnalysis, buildGoogleDestinationAuth])

  // ── Build autosave payload per step ───────────────────────────────────
  const buildAutosavePayload = useCallback((step) => {
    if (isServiceApp && totalSteps === 3) {
      if (step === 0) {
        return {
          name: flowName.trim() || undefined,
          source: selectedApp ? { app: selectedApp, app_name: currentApp?.name, domain, access_token: accessToken } : undefined,
          structure: { objects: selectedObjects, service_ids: selectedServiceIds },
        }
      }
      if (step === 1) {
        return {
          backup_type: backupType,
          destination: {
            type: storageDestination,
            name: storageDestination === 'gsheets' ? 'Google Sheets' : 'Google Drive',
            auth: buildGoogleDestinationAuth(),
          },
        }
      }
    }

    if (step === 0) {
      return {
        name: flowName.trim() || undefined,
        source: selectedApp ? { app: selectedApp, app_name: currentApp?.name } : undefined,
      }
    }
    if (isRequestApp) {
      if (step === 1) return { source: { app: 'request', app_name: 'Request', domain, access_token: accessTokenV2 } }
      if (step === 2) {
        return {
          backup_type: backupType,
          destination: {
            type: storageDestination,
            name: storageDestination === 'gdrive' ? 'Google Drive' : 'Google Sheets',
            auth: buildGoogleDestinationAuth(),
          },
        }
      }
    } else {
      if (step === 1) return { structure: { objects: selectedObjects } }
      if (step === 2) {
        if (isServiceApp) {
          return {
            source: { app: selectedApp, app_name: currentApp?.name, domain, access_token: accessToken },
            backup_type: backupType,
            destination: {
              type: storageDestination,
              name: storageDestination === 'gsheets' ? 'Google Sheets' : 'Google Drive',
              auth: buildGoogleDestinationAuth(),
            },
          }
        }
        return {
          source: { app: selectedApp, app_name: currentApp?.name, domain: isServiceApp ? domain : selectedApp, access_token: accessToken },
        }
      }
    }
    return {}
  }, [isServiceApp, totalSteps, flowName, selectedApp, currentApp, domain, accessToken, selectedObjects, selectedServiceIds, backupType, storageDestination, buildGoogleDestinationAuth, isRequestApp, accessTokenV2])

  // ── Navigation ────────────────────────────────────────────────────────
  const next = useCallback(async () => {
    // Step 0 validation
    if (currentStep === 0) {
      if (!flowName.trim()) { message.warning('Please enter a name for this backup flow'); return }
      if (!selectedApp) { message.warning('Please select an application'); return }
    }

    // Condensed service wizard
    if (isServiceApp && totalSteps === 3) {
      if (currentStep === 0) {
        if (!domain || !accessToken) { message.warning('Please provide Service domain and access token'); return }
        if (selectedObjects.length === 0) { message.warning('Please select at least one object'); return }
        if (!servicePreview) { message.warning('Please load Service preview and choose the Services for this flow'); return }
        if (Array.isArray(servicePreview.services) && servicePreview.services.length > 0 && selectedServiceIds.length === 0) {
          message.warning('Please select at least one Service for this flow'); return
        }
      }
      if (currentStep === 1) {
        if (!backupType || !storageDestination || !googleAuthMethod) { message.warning('Please choose backup type, destination, and Google auth method'); return }
        if (googleAuthMethod === 'oauth' && !googleAuth) { message.warning('Please connect with Google'); return }
        if (googleAuthMethod === 'service_account' && !hasReadyServiceAccountAuth()) { message.warning(platformServiceAccount?.available ? 'Select the shared platform service account or upload a service account JSON key' : 'Please upload and analyze a Google service account JSON file'); return }
      }
    } else if (isRequestApp) {
      if (currentStep === 1 && (!domain || !accessTokenV2)) { message.warning('Please provide domain and access token'); return }
      if (currentStep === 2) {
        if (!backupType || !storageDestination || !googleAuthMethod) { message.warning('Please select backup type, destination, and Google auth method'); return }
        if (googleAuthMethod === 'oauth' && !googleAuth) { message.warning('Please connect with Google'); return }
      }
      if (hasServiceAccountStep && currentStep === 3 && !hasReadyServiceAccountAuth()) {
        message.warning(platformServiceAccount?.available ? 'Select the shared platform service account or upload a service account JSON key' : 'Please upload and analyze a Google service account JSON file'); return
      }
    } else {
      if (currentStep === 1 && selectedObjects.length === 0) { message.warning('Please select at least one object'); return }
      if (currentStep === 2 && isServiceApp && (!domain || !accessToken || !backupType || !storageDestination || !googleAuthMethod)) {
        message.warning('Please provide Service credentials, backup type, destination, and Google auth method'); return
      }
      if (currentStep === 2 && isServiceApp && googleAuthMethod === 'oauth' && !googleAuth) { message.warning('Please connect with Google'); return }
      if (hasServiceAccountStep && currentStep === 3 && !hasReadyServiceAccountAuth()) {
        message.warning(platformServiceAccount?.available ? 'Select the shared platform service account or upload a service account JSON key' : 'Please upload and analyze a Google service account JSON file'); return
      }
      if (currentStep === 2 && !isServiceApp && !accessToken) { message.warning('Please provide access token'); return }
    }

    // Autosave
    if (draftFlowId) {
      const payload = buildAutosavePayload(currentStep)
      await api.patch(`/api/backup-flows/${draftFlowId}/autosave`, payload).catch(() => {})
    }

    setCurrentStep(prev => prev + 1)
  }, [currentStep, flowName, selectedApp, isServiceApp, totalSteps, domain, accessToken, selectedObjects, backupType, storageDestination, googleAuthMethod, googleAuth, isRequestApp, accessTokenV2, hasServiceAccountStep, draftFlowId, buildAutosavePayload, servicePreview, selectedServiceIds, hasReadyServiceAccountAuth, platformServiceAccount])

  const prev = useCallback(() => setCurrentStep(s => s - 1), [])

  // ── Finish (save/publish) ─────────────────────────────────────────────
  const handleFinish = useCallback(async (runAfterSave = false, viewMode = 'create') => {
    if (!draftFlowId) { message.error('No draft flow found. Please try again.'); return }

    if (hasServiceAccountStep && !hasReadyServiceAccountAuth()) {
      message.warning(platformServiceAccount?.available ? 'Select the shared platform service account or upload a service account JSON key first' : 'Please upload and analyze a Google service account JSON file first'); return
    }

    if (isServiceApp && !servicePreview) {
      message.warning('Please load the current Service source preview before saving this flow'); return
    }

    if (isServiceApp && Array.isArray(servicePreview?.services) && servicePreview.services.length > 0 && selectedServiceIds.length === 0) {
      message.warning('Please select at least one Service for this test flow'); return
    }

    if (runAfterSave) {
      const blocked = getGoogleDriveRunBlockedReason()
      if (blocked) { message.error(blocked); return }
    }

    const savePayload = isRequestApp ? {
      name: flowName.trim() || undefined,
      source: { app: 'request', app_name: 'Request', domain, access_token: accessTokenV2 },
      backup_type: backupType,
      destination: {
        type: storageDestination,
        name: storageDestination === 'gdrive' ? 'Google Drive' : 'Google Sheets',
        auth: buildGoogleDestinationAuth(),
      },
      structure: { objects: ['group', 'request'] },
      updated_by: 'current_user',
    } : {
      name: flowName.trim() || undefined,
      source: {
        app: selectedApp,
        app_name: currentApp.name,
        domain: isServiceApp ? domain : selectedApp,
        access_token: accessToken,
      },
      backup_type: isServiceApp ? backupType : 'all',
      destination: isServiceApp ? {
        type: storageDestination,
        name: storageDestination === 'gsheets' ? 'Google Sheets' : 'Google Drive',
        auth: buildGoogleDestinationAuth(),
      } : {
        type: 'gdrive',
        name: 'Google Drive',
        auth: { email: 'user@gmail.com' },
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
          include_activity_logs: false,
        } : {}),
      },
      updated_by: 'current_user',
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
      if (runAfterSave) await api.post(`/api/backup-flows/${draftFlowId}/run`)
      message.success({ content: successLabel, key: 'save' })
    } catch (err) {
      const detail = err.response?.data?.detail
      const errorContent = runAfterSave && saveCompleted
        ? (detail || 'Backup flow was saved but could not be started.')
        : (detail || `Failed to ${isEdit ? 'update' : 'save'} backup flow.`)
      message.error({ content: errorContent, key: 'save' })
      console.error(err)
      return false
    }

    resetAll()
    return true
  }, [draftFlowId, hasServiceAccountStep, googleAuth, isServiceApp, servicePreview, selectedServiceIds, getGoogleDriveRunBlockedReason, isRequestApp, flowName, domain, accessTokenV2, backupType, storageDestination, buildGoogleDestinationAuth, selectedApp, currentApp, accessToken, selectedObjects, selectedFieldIds, exportFormats, resetAll, hasReadyServiceAccountAuth, platformServiceAccount])

  // ── Load flow for editing ─────────────────────────────────────────────
  const loadFlowForEdit = useCallback(async (flowId) => {
    try {
      const res = await api.get(`/api/backup-flows/${flowId}`)
      const f = res.data

      resetAll()

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
        if (auth.auth_mode === 'service_account' || auth.auth_method === 'service_account' || auth.service_account_json_encrypted || auth.uses_platform_service_account) {
          setGoogleAuthMethod('service_account')
          setGoogleAuth({
            auth_mode: 'service_account',
            auth_method: 'service_account',
            uses_platform_service_account: !!auth.uses_platform_service_account,
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
          setServiceAccountFileName(auth.service_account_json_encrypted ? (auth.service_account_file_name || 'saved-service-account.json') : '')
        } else if (auth.connection_id) {
          setGoogleAuth({
            auth_mode: 'google_oauth',
            auth_method: 'oauth',
            connection_id: auth.connection_id,
            google_oauth_connection_id: auth.google_oauth_connection_id || auth.connection_id,
            email: auth.email || '',
            google_oauth_email: auth.google_oauth_email || auth.email || '',
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
        if (Array.isArray(struct.objects)) setSelectedObjects(struct.objects)
        if (Array.isArray(struct.custom_fields)) setSelectedFieldIds(struct.custom_fields)
        if (struct.export_formats && typeof struct.export_formats === 'object') setExportFormats(struct.export_formats)
        if (Array.isArray(struct.service_ids)) setSelectedServiceIds(struct.service_ids)
        const auth = dest.auth || {}
        if (auth.auth_mode === 'service_account' || auth.auth_method === 'service_account' || auth.service_account_json_encrypted || auth.uses_platform_service_account) {
          setGoogleAuthMethod('service_account')
          setGoogleAuth({
            auth_mode: 'service_account',
            auth_method: 'service_account',
            uses_platform_service_account: !!auth.uses_platform_service_account,
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
          setServiceAccountFileName(auth.service_account_json_encrypted ? (auth.service_account_file_name || 'saved-service-account.json') : '')
        } else if (auth.connection_id) {
          setGoogleAuthMethod('oauth')
          setGoogleAuth({
            auth_mode: 'google_oauth',
            auth_method: 'oauth',
            connection_id: auth.connection_id,
            google_oauth_connection_id: auth.google_oauth_connection_id || auth.connection_id,
            email: auth.email || '',
            google_oauth_email: auth.google_oauth_email || auth.email || '',
            display_name: auth.display_name || auth.email || '',
            picture_url: auth.picture_url || '',
            folder_id: auth.folder_id || null,
            folder_name: auth.folder_name || (auth.folder_id ? 'Saved folder' : null),
            drive_id: auth.drive_id || null,
            drive_name: auth.drive_name || null,
          })
        }

        if (src.app === 'service' && src.domain && src.access_token) setServiceSourceSetupSaved(true)
        if (src.app === 'service' && f.backup_type && dest.type && (dest.auth?.connection_id || dest.auth?.service_account_json_encrypted || dest.auth?.service_account_email)) {
          setServiceBackupSetupSaved(true)
        }
      }

      setEditFlowId(flowId)
      setDraftFlowId(flowId)
      return true
    } catch (err) {
      message.error('Failed to load backup flow for editing')
      console.error(err)
      return false
    }
  }, [resetAll])

  // ── Service preview ───────────────────────────────────────────────────
  const loadServicePreview = useCallback(async (serviceIdsOverride = selectedServiceIds) => {
    if (!domain || !accessToken) { message.warning('Please enter Service domain and access token first'); return }
    shouldResetServicePreviewScrollRef.current = true
    setLoadingServicePreview(true)
    try {
      const res = await api.post('/api/connectors/service/preview', {
        domain,
        access_token: accessToken,
        ticket_sample_limit: 2,
        service_ids: serviceIdsOverride.length ? serviceIdsOverride : undefined,
        detail_service_limit: serviceIdsOverride.length ? Math.min(serviceIdsOverride.length, 10) : 2,
      })
      setServicePreview(res.data)
      if (!selectedServiceIds.length && Array.isArray(res.data?.services)) {
        const defaultIds = res.data.services.slice(0, 2).map(item => item.service_id)
        setSelectedServiceIds(defaultIds)
        setDraftSelectedServiceIds(defaultIds)
      }
      message.success('Loaded Service source preview')
    } catch (err) {
      message.error(err.response?.data?.detail || 'Failed to load Service source preview')
    } finally {
      setLoadingServicePreview(false)
    }
  }, [domain, accessToken, selectedServiceIds])

  // ── Google OAuth popup ────────────────────────────────────────────────
  const startGoogleOAuthPopup = useCallback((url) => new Promise((resolve, reject) => {
    const w = 520, h = 660
    const popup = window.open(url, 'google-oauth',
      `width=${w},height=${h},top=${Math.round((window.screen.height - h) / 2)},left=${Math.round((window.screen.width - w) / 2)}`)
    if (!popup) { reject(new Error('Popup blocked. Please allow popups for this site.')); return }
    const onMessage = (event) => {
      if (!event.data || typeof event.data !== 'object') return
      if (event.data.success === true && event.data.connection_id) {
        window.removeEventListener('message', onMessage)
        popup.close()
        resolve(event.data)
      } else if (event.data.success === false) {
        window.removeEventListener('message', onMessage)
        popup.close()
        reject(new Error(event.data.error || 'Unknown Google OAuth error'))
      }
    }
    window.addEventListener('message', onMessage)
  }), [])

  // ── Google connect / disconnect ───────────────────────────────────────
  const openGoogleConfigModal = useCallback(async () => {
    setGoogleConfigModalOpen(true)
    setGoogleConfigError('')
    setGoogleConfigLoading(true)
    try {
      const res = await api.get('/api/settings/google')
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
  }, [])

  const handleGoogleConnect = useCallback(async () => {
    try {
      const res = await api.get('/api/google/auth-url')
      const data = await startGoogleOAuthPopup(res.data.url)
      setGoogleAuthMethod('oauth')
      setServiceBackupSetupSaved(false)
      setGoogleAuth({
        auth_mode: 'google_oauth',
        auth_method: 'oauth',
        connection_id: data.connection_id,
        google_oauth_connection_id: data.connection_id,
        email: data.email,
        google_oauth_email: data.email,
        display_name: data.display_name || data.email,
        picture_url: data.picture_url || '',
        folder_id: null, folder_name: null, drive_id: null,
      })
      await loadSavedGoogleConnections()
      message.success(`Connected as ${data.email}`)
    } catch (err) {
      if (err.response?.status === 503) {
        await openGoogleConfigModal()
      } else {
        message.error(err.response?.data?.detail || err.message || 'Failed to start Google authentication')
      }
      console.error(err)
    }
  }, [startGoogleOAuthPopup, openGoogleConfigModal, loadSavedGoogleConnections])

  const handleGoogleDisconnect = useCallback(() => {
    const nextGoogleAuth = googleAuthMethod === 'service_account' && platformServiceAccount?.available
      ? buildPlatformServiceAccountState()
      : null
    setGoogleAuth(nextGoogleAuth)
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
    message.info(nextGoogleAuth ? 'Cleared custom service account override' : 'Disconnected from Google')
  }, [buildPlatformServiceAccountState, googleAuthMethod, platformServiceAccount, isServiceAccountDestinationAuth])

  // ── Service account file upload ───────────────────────────────────────
  const handleServiceAccountFileUpload = useCallback(async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    setServiceBackupSetupSaved(false)
    setGoogleAuthMethod('service_account')
    setServiceAccountAnalysisLoading(true)
    setServiceAccountError('')
    try {
      const rawText = await file.text()
      const parsed = JSON.parse(rawText)
      const res = await api.post('/api/google/service-account/analyze', { service_account_json: parsed })
      const nextGoogleAuth = {
        auth_mode: 'service_account',
        auth_method: 'service_account',
        service_account_json: parsed,
        service_account_json_encrypted: googleAuth?.service_account_json_encrypted || null,
        uses_platform_service_account: false,
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
  }, [googleAuth, autosaveDestinationAuth])

  // ── Folder picker ─────────────────────────────────────────────────────
  const fetchSubFolders = useCallback(async (parentId, driveId) => {
    setLoadingFolders(true)
    try {
      const res = isServiceAccountDestinationAuth
        ? await api.post('/api/google/service-account/folders', { auth: buildGoogleDestinationAuth(), parent_id: parentId, drive_id: driveId || null })
        : await api.get('/api/google/folders', { params: { connection_id: googleAuth.connection_id, parent_id: parentId, ...(driveId ? { drive_id: driveId } : {}) } })
      setFolders(res.data)
    } catch { message.error('Failed to load folders') }
    finally { setLoadingFolders(false) }
  }, [isServiceAccountDestinationAuth, buildGoogleDestinationAuth, googleAuth])

  const handleDriveChange = useCallback(async (driveId, drivesList = drives) => {
    setCurrentDriveId(driveId)
    const driveName = (drivesList.find(d => d.id === driveId) || {}).name || 'Drive'
    const rootParent = driveId === 'root' ? 'root' : driveId
    setFolderPath([{ id: rootParent, name: driveName, driveId: driveId === 'root' ? null : driveId, isDriveRoot: true }])
    await fetchSubFolders(rootParent, driveId === 'root' ? null : driveId)
  }, [drives, fetchSubFolders])

  const loadSharedFolders = useCallback(async (query = '') => {
    if (!isServiceAccountDestinationAuth || !googleAuth) return
    setLoadingSharedFolders(true)
    try {
      const res = await api.post('/api/google/service-account/shared-folders', { auth: buildGoogleDestinationAuth(), query })
      setSharedFolders(res.data)
    } catch (err) {
      message.error(err.response?.data?.detail || 'Failed to load folders shared with this service account')
    } finally { setLoadingSharedFolders(false) }
  }, [isServiceAccountDestinationAuth, googleAuth, buildGoogleDestinationAuth])

  const handleOpenFolderPicker = useCallback(async () => {
    if (!googleAuth) return
    setGoogleFolderModal(true)
    setLoadingDrives(true)
    setSharedFolderReference('')
    try {
      const res = isServiceAccountDestinationAuth
        ? await api.post('/api/google/service-account/drives', { auth: buildGoogleDestinationAuth() })
        : await api.get('/api/google/drives', { params: { connection_id: googleAuth.connection_id } })
      setDrives(res.data)
      if (res.data.length > 0) await handleDriveChange(res.data[0].id, res.data)
      if (isServiceAccountDestinationAuth) await loadSharedFolders('')
    } catch { message.error('Failed to load Google Drives') }
    finally { setLoadingDrives(false) }
  }, [googleAuth, isServiceAccountDestinationAuth, buildGoogleDestinationAuth, handleDriveChange, loadSharedFolders])

  const handleOpenSubFolder = useCallback(async (folder) => {
    const driveId = currentDriveId !== 'root' ? currentDriveId : null
    setFolderPath(prev => [...prev, { id: folder.id, name: folder.name, driveId, isDriveRoot: false }])
    await fetchSubFolders(folder.id, driveId)
  }, [currentDriveId, fetchSubFolders])

  const handleBreadcrumbNav = useCallback(async (index) => {
    const item = folderPath[index]
    setFolderPath(prev => prev.slice(0, index + 1))
    await fetchSubFolders(item.id, item.driveId)
  }, [folderPath, fetchSubFolders])

  const applyGoogleFolderSelection = useCallback(async (folder, options = {}) => {
    if (!folder) return
    if (isServiceAccountDestinationAuth && !folder.drive_id) {
      message.error(SERVICE_ACCOUNT_SHARED_DRIVE_MESSAGE); return
    }
    const nextAuth = {
      ...(googleAuth || {}),
      folder_id: folder.id || null,
      folder_name: folder.name || null,
      drive_id: folder.drive_id || null,
      drive_name: resolveDriveName(folder.drive_id, folder.drive_name || null),
    }
    setGoogleAuth(nextAuth)
    await autosaveDestinationAuth(nextAuth)
    if (options.closeModal !== false) setGoogleFolderModal(false)
    message.success(`Folder selected: ${folder.name} (${resolveDriveName(folder.drive_id, folder.drive_name || null)})`)
  }, [isServiceAccountDestinationAuth, googleAuth, resolveDriveName, autosaveDestinationAuth])

  const handleSelectCurrentFolder = useCallback(async () => {
    const current = folderPath[folderPath.length - 1]
    if (!current) return
    const isRoot = Boolean(current.isDriveRoot)
    if (isServiceAccountDestinationAuth && !current.driveId) {
      message.error(SERVICE_ACCOUNT_SHARED_DRIVE_MESSAGE); return
    }
    const nextAuth = {
      ...(googleAuth || {}),
      folder_id: isRoot ? null : current.id,
      folder_name: current.name,
      drive_id: current.driveId || null,
      drive_name: resolveDriveName(current.driveId, current.isDriveRoot ? current.name : null),
    }
    setGoogleAuth(nextAuth)
    await autosaveDestinationAuth(nextAuth)
    setGoogleFolderModal(false)
    message.success(`Folder selected: ${current.name} (${resolveDriveName(current.driveId, current.isDriveRoot ? current.name : null)})`)
  }, [folderPath, isServiceAccountDestinationAuth, googleAuth, resolveDriveName, autosaveDestinationAuth])

  const handleResolveSharedFolder = useCallback(async () => {
    const ref = sharedFolderReference.trim()
    if (!ref) { message.warning('Paste a Google Drive folder link or folder ID first'); return }
    setResolvingSharedFolder(true)
    try {
      const res = await api.post('/api/google/service-account/folder-info', { auth: buildGoogleDestinationAuth(), folder_id_or_url: ref })
      const resolved = res.data
      setSharedFolderReference('')
      setSharedFolders(prev => prev.some(item => item.id === resolved.id) ? prev : [resolved, ...prev])
      await applyGoogleFolderSelection(resolved)
    } catch (err) {
      message.error(err.response?.data?.detail || 'Failed to resolve the Google Drive folder')
    } finally { setResolvingSharedFolder(false) }
  }, [sharedFolderReference, buildGoogleDestinationAuth, applyGoogleFolderSelection])

  const openFolderLocation = useCallback(async (folder) => {
    const driveId = folder?.drive_id || null
    setCurrentDriveId(driveId || 'root')
    setFolderPath([{ id: folder.id, name: folder.name, driveId, isDriveRoot: false }])
    await fetchSubFolders(folder.id, driveId)
  }, [fetchSubFolders])

  // ── Google config save ────────────────────────────────────────────────
  const handleSaveGoogleConfigAndConnect = useCallback(async () => {
    if (!gcClientId.trim()) { message.error('Client ID is required'); return }
    if (!gcClientSecret.trim() && !googleSecretSet) { setGoogleConfigError('Client Secret is required'); return }
    setGoogleConfigSaving(true)
    setGoogleConfigError('')
    try {
      await api.put('/api/settings/google', {
        client_id: gcClientId.trim(),
        client_secret: gcClientSecret.trim() || '__KEEP__',
        redirect_uri: gcRedirectUri.trim() || DEFAULT_GOOGLE_REDIRECT,
      })
      const authRes = await api.get('/api/google/auth-url')
      const data = await startGoogleOAuthPopup(authRes.data.url)
      setGoogleAuthMethod('oauth')
      setGoogleAuth({
        auth_mode: 'google_oauth', auth_method: 'oauth', connection_id: data.connection_id,
        google_oauth_connection_id: data.connection_id, email: data.email,
        google_oauth_email: data.email,
        display_name: data.display_name || data.email, picture_url: data.picture_url || '',
        folder_id: null, folder_name: null, drive_id: null,
      })
      await loadSavedGoogleConnections()
      setGoogleConfigModalOpen(false)
      setGoogleSecretSet(true)
      message.success(`Connected as ${data.email}`)
    } catch (err) {
      setGoogleConfigError(err.response?.data?.detail || err.message || 'Failed to configure Google OAuth')
    } finally { setGoogleConfigSaving(false) }
  }, [gcClientId, gcClientSecret, googleSecretSet, gcRedirectUri, startGoogleOAuthPopup, loadSavedGoogleConnections])

  // ── Service selector modal helpers ────────────────────────────────────
  const openServiceSelectorModal = useCallback(() => {
    if (!servicePreview && !loadingServicePreview) loadServicePreview()
    setDraftSelectedServiceIds(selectedServiceIds)
    setServiceSelectorModalOpen(true)
  }, [servicePreview, loadingServicePreview, selectedServiceIds, loadServicePreview])

  const closeServiceSelectorModal = useCallback(() => {
    setDraftSelectedServiceIds(selectedServiceIds)
    setServiceSelectorModalOpen(false)
  }, [selectedServiceIds])

  const applyServiceSelectorModal = useCallback(async () => {
    setSelectedServiceIds(draftSelectedServiceIds)
    setServiceSelectorModalOpen(false)
    if (draftFlowId) {
      await api.patch(`/api/backup-flows/${draftFlowId}/autosave`, {
        structure: { objects: selectedObjects, service_ids: draftSelectedServiceIds },
      }).catch(() => {})
    }
  }, [draftSelectedServiceIds, draftFlowId, selectedObjects])

  // ── Drive folder summary helper ───────────────────────────────────────
  const getGoogleDriveFolderSummary = useCallback((
    googleAuthState = googleAuth,
    authMethod = resolvedGoogleAuthMethod,
    destinationType = storageDestination,
  ) => {
    if (destinationType !== 'gdrive') return null
    const resolved = googleAuthState?.auth_method || authMethod
    const driveName = resolveDriveName(googleAuthState?.drive_id, googleAuthState?.drive_name)
    if (googleAuthState?.drive_id) {
      return { tag: 'Shared Drive folder', color: 'green', driveName, help: 'This folder belongs to a Shared Drive and can be used with the current Google service account.' }
    }
    if (resolved === 'service_account') {
      return { tag: 'Direct share in My Drive', color: 'gold', driveName, help: 'This folder is visible because it is shared to the service account, but it is still a regular My Drive folder, not a Shared Drive.' }
    }
    return { tag: 'My Drive folder', color: 'blue', driveName, help: 'This folder belongs to regular My Drive.' }
  }, [googleAuth, resolvedGoogleAuthMethod, storageDestination, resolveDriveName])

  // ── Step labels ───────────────────────────────────────────────────────
  const getStepLabels = useCallback(() => {
    if (usesCondensedServiceWizard) {
      return [
        { title: 'Source & Connection' },
        { title: 'Storage Setup' },
        { title: 'Review & Create' },
      ]
    }
    if (isRequestApp) {
      return [
        { title: 'Name & App' },
        { title: 'Connection Info' },
        { title: 'Backup & Storage' },
        ...(hasServiceAccountStep ? [{ title: 'Google Auth' }] : []),
        { title: 'Review & Create' },
      ]
    }
    return [
      { title: 'Name & App' },
      { title: 'Select Data' },
      { title: 'Connect Source' },
      ...(hasServiceAccountStep ? [{ title: 'Google Auth' }] : []),
      { title: 'Review & Create' },
    ]
  }, [usesCondensedServiceWizard, isRequestApp, hasServiceAccountStep])

  const getStepDescriptions = useCallback(() => {
    if (usesCondensedServiceWizard) {
      return ['Name your flow, connect Service, and choose services', 'Configure backup storage', 'Confirm & create your flow']
    }
    if (isRequestApp) {
      return ['Name & choose application', 'Connection information', 'Backup type & storage', ...(hasServiceAccountStep ? ['Google authentication'] : []), 'Review & create']
    }
    return ['Name & choose application', 'Select data to backup', 'Connect & configure', ...(hasServiceAccountStep ? ['Google authentication'] : []), 'Review & create']
  }, [usesCondensedServiceWizard, isRequestApp, hasServiceAccountStep])

  return {
    // Core
    currentStep, setCurrentStep, draftFlowId, setDraftFlowId, editFlowId, setEditFlowId, flowName, setFlowName,
    // App
    selectedApp, setSelectedApp, currentApp, isRequestApp, isServiceApp, connectionConfig,
    // Source
    domain, setDomain, accessTokenV2, setAccessTokenV2, showTokenV2, setShowTokenV2,
    accessToken, setAccessToken, showToken, setShowToken, selectedObjects, setSelectedObjects,
    // Backup config
    backupType, setBackupType, storageDestination, setStorageDestination,
    // Google auth
    googleAuthMethod, setGoogleAuthMethod, googleAuth, setGoogleAuth,
    platformServiceAccount, savedGoogleConnections, loadingSavedGoogleConnections,
    resolvedGoogleAuthMethod, isServiceAccountDestinationAuth,
    // Service account
    serviceAccountAnalysis, setServiceAccountAnalysis, serviceAccountAnalysisLoading,
    serviceAccountFileName, setServiceAccountFileName, serviceAccountError, setServiceAccountError,
    // Custom fields
    selectedFieldIds, setSelectedFieldIds, exportFormats, setExportFormats,
    // Service preview
    servicePreview, setServicePreview, loadingServicePreview, selectedServiceIds, setSelectedServiceIds,
    draftSelectedServiceIds, setDraftSelectedServiceIds,
    serviceSourceSetupSaved, setServiceSourceSetupSaved,
    serviceBackupSetupSaved, setServiceBackupSetupSaved,
    servicePreviewListRef, shouldResetServicePreviewScrollRef,
    // Modals
    showAppSelectionModal, setShowAppSelectionModal,
    showDestinationModal, setShowDestinationModal,
    serviceSelectorModalOpen, setServiceSelectorModalOpen,
    // Folder picker
    googleFolderModal, setGoogleFolderModal,
    drives, loadingDrives, currentDriveId, folders, folderPath, loadingFolders,
    sharedFolders, loadingSharedFolders, sharedFolderQuery, setSharedFolderQuery,
    sharedFolderReference, setSharedFolderReference, resolvingSharedFolder,
    // Google config modal
    googleConfigModalOpen, setGoogleConfigModalOpen,
    googleConfigLoading, googleConfigSaving, googleSecretSet,
    googleRedirectUri, googleConfigError, setGoogleConfigError,
    gcClientId, setGcClientId, gcClientSecret, setGcClientSecret, gcRedirectUri, setGcRedirectUri,
    // Derived
    usesCondensedServiceWizard, hasServiceAccountStep, totalSteps,
    // Actions
    resetAll, handleAppSelection, handleObjectToggle, handleSelectAllObjects,
    getAvailableFields, handleFieldToggle, handleSelectAllFields,
    selectDestination, buildGoogleDestinationAuth, resolveDriveName,
    getGoogleDriveRunBlockedReason, getGoogleDriveFolderSummary,
    autosaveDestinationAuth,
    loadSavedGoogleConnections, selectSavedGoogleConnection,
    next, prev, handleFinish, loadFlowForEdit,
    loadServicePreview, handleServiceAccountFileUpload,
    handleGoogleConnect, handleGoogleDisconnect,
    openGoogleConfigModal, handleSaveGoogleConfigAndConnect,
    handleOpenFolderPicker, handleDriveChange, handleOpenSubFolder, handleBreadcrumbNav,
    handleSelectCurrentFolder, handleResolveSharedFolder,
    applyGoogleFolderSelection, openFolderLocation, loadSharedFolders,
    openServiceSelectorModal, closeServiceSelectorModal, applyServiceSelectorModal,
    getStepLabels, getStepDescriptions,
  }
}
