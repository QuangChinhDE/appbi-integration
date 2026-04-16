import React, { useState, useEffect, useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import { Loader2, RefreshCw, Globe, Folder, ChevronRight, FileSpreadsheet, Cloud } from 'lucide-react'
import { Modal, Alert, SpinCenter, Tag, Empty, message } from '@packages/ui/src/components/common/ui'
import AppLayout from '@packages/ui/src/components/layout/AppLayout'

import useBackupFlows from '../hooks/useBackupFlows'
import useWizardState from '../hooks/useWizardState'
import { APPS, DEFAULT_GOOGLE_REDIRECT } from '../constants'

import FlowListView from '../components/FlowListView'
import FlowDetailView from '../components/FlowDetailView'
import FlowWizard from '../components/FlowWizard'
import AppSelectionModal from '../components/shared/AppSelectionModal'
import GoogleConfigModal from '../components/shared/GoogleConfigModal'
import FolderPickerModal from '../components/shared/FolderPickerModal'
import RequestSelectorModal from '../components/shared/RequestSelectorModal'
import ServiceSelectorModal from '../components/shared/ServiceSelectorModal'
import WorkflowSelectorModal from '../components/shared/WorkflowSelectorModal'
import WeworkSelectorModal from '../components/shared/WeworkSelectorModal'

const BackupFlowPage = () => {
  // ── View mode ─────────────────────────────────────────────────────────
  const [viewMode, setViewMode] = useState('list') // list | detail | create | edit

  // ── Detail view extras ────────────────────────────────────────────────
  const [detailsFlowId, setDetailsFlowId] = useState(null)
  const [detailsFlowRecord, setDetailsFlowRecord] = useState(null)
  const [detailsActiveTab, setDetailsActiveTab] = useState('overview')

  // ── Destination modal local state ─────────────────────────────────────
  const [showDestinationModal, setShowDestinationModal] = useState(false)
  const [destinationSearch, setDestinationSearch] = useState('')
  const location = useLocation()

  // ── Hooks ─────────────────────────────────────────────────────────────
  const backupFlows = useBackupFlows()
  const wizard = useWizardState()
  const { setDetailsFlow, setDetailsRuns } = backupFlows
  const { resetAll } = wizard

  const resetToBackupList = useCallback(() => {
    setViewMode('list')
    setDetailsFlowId(null)
    setDetailsFlowRecord(null)
    setDetailsActiveTab('overview')
    setShowDestinationModal(false)
    setDestinationSearch('')
    setDetailsFlow(null)
    setDetailsRuns([])
    resetAll()
  }, [resetAll, setDetailsFlow, setDetailsRuns])

  // ── Fetch flows on mount ──────────────────────────────────────────────
  useEffect(() => { backupFlows.fetchFlows() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!location.state?.resetToListToken) return
    resetToBackupList()
  }, [location.state?.resetToListToken, resetToBackupList])

  useEffect(() => {
    if (!backupFlows.detailsFlow) return
    setDetailsFlowRecord(backupFlows.detailsFlow)
  }, [backupFlows.detailsFlow])

  // ── Sync google config modal fields ───────────────────────────────────
  useEffect(() => {
    if (wizard.googleConfigModalOpen) {
      wizard.setGcClientId('')
      wizard.setGcClientSecret('')
      wizard.setGcRedirectUri(wizard.googleRedirectUri || DEFAULT_GOOGLE_REDIRECT)
    }
  }, [wizard.googleConfigModalOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Service preview scroll reset ──────────────────────────────────────
  useEffect(() => {
    if (wizard.shouldResetServicePreviewScrollRef.current && wizard.servicePreviewListRef.current) {
      wizard.servicePreviewListRef.current.scrollTop = 0
      wizard.shouldResetServicePreviewScrollRef.current = false
    }
  }, [wizard.servicePreview]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (wizard.shouldResetWorkflowPreviewScrollRef.current && wizard.workflowPreviewListRef.current) {
      wizard.workflowPreviewListRef.current.scrollTop = 0
      wizard.shouldResetWorkflowPreviewScrollRef.current = false
    }
  }, [wizard.workflowPreview]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (wizard.shouldResetRequestPreviewScrollRef.current && wizard.requestPreviewListRef.current) {
      wizard.requestPreviewListRef.current.scrollTop = 0
      wizard.shouldResetRequestPreviewScrollRef.current = false
    }
  }, [wizard.requestPreview]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (wizard.shouldResetWeworkPreviewScrollRef.current && wizard.weworkPreviewListRef.current) {
      wizard.weworkPreviewListRef.current.scrollTop = 0
      wizard.shouldResetWeworkPreviewScrollRef.current = false
    }
  }, [wizard.weworkPreview]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived ───────────────────────────────────────────────────────────
  const servicePreviewRows = Array.isArray(wizard.servicePreview?.services)
    ? wizard.servicePreview.services
    : []

  // ── Handlers ──────────────────────────────────────────────────────────

  const handleCreateDraft = async () => {
    resetAll()
    const id = await backupFlows.createDraft()
    if (!id) return
    wizard.setDraftFlowId(id)
    setViewMode('create')
  }

  const handleOpenDetails = async (record) => {
    setDetailsFlowId(record.id)
    setDetailsFlowRecord(record)
    backupFlows.setDetailsFlow(null)
    backupFlows.setDetailsRuns([])
    setDetailsActiveTab('overview')
    setViewMode('detail')
    await backupFlows.fetchFlowDetails(record.id)
  }

  const handleRefreshDetails = async () => {
    if (!detailsFlowId) return
    await backupFlows.fetchFlowDetails(detailsFlowId)
  }

  const handleEditFromDetail = async () => {
    const id = detailsFlowId || detailsFlowRecord?.id
    if (!id) return
    const loaded = await wizard.loadFlowForEdit(id)
    if (loaded) setViewMode('edit')
  }

  const handleRunFromDetail = () => {
    const source = backupFlows.detailsFlow?.source || {}
    backupFlows.runFlow(
      detailsFlowRecord || { id: detailsFlowId, app: source.app, run_blocked_reason: detailsFlowRecord?.run_blocked_reason },
      { onStarted: () => backupFlows.fetchFlowDetails(detailsFlowId || detailsFlowRecord?.id) }
    )
  }

  const handleStopFromDetail = () => {
    const source = backupFlows.detailsFlow?.source || {}
    backupFlows.stopFlow(
      detailsFlowRecord || { id: detailsFlowId, name: backupFlows.detailsFlow?.name, app: source.app },
      { onStopped: () => backupFlows.fetchFlowDetails(detailsFlowId || detailsFlowRecord?.id) }
    )
  }

  const handleDeleteFromDetail = () => {
    backupFlows.deleteFlow(
      detailsFlowRecord || { id: detailsFlowId, name: backupFlows.detailsFlow?.name },
      {
        onDeleted: resetToBackupList,
      }
    )
  }

  const handleBackFromWizard = () => {
    if (viewMode === 'edit' && detailsFlowId) {
      setViewMode('detail')
      return
    }
    resetToBackupList()
  }

  const handleBackFromDetail = () => {
    resetToBackupList()
  }

  const handleSelectDestination = (opt) => {
    wizard.setStorageDestination(opt.id)
    wizard.setGoogleAuth(null)
    wizard.setServiceBackupSetupSaved(false)
    setShowDestinationModal(false)
    setDestinationSearch('')
  }

  const handleWizardSaved = async (result) => {
    const nextFlowId = result?.flowId || result?.flow?.id

    if (result?.runAfterSave && nextFlowId) {
      setDetailsFlowId(nextFlowId)
      setDetailsFlowRecord(result?.flow || null)
      setDetailsActiveTab('overview')
      setViewMode('detail')
      await backupFlows.fetchFlowDetails(nextFlowId)
      return
    }

    await backupFlows.fetchFlows()
    resetToBackupList()
  }

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <AppLayout>
      {viewMode === 'list' ? (
        <div className="p-8">
          <FlowListView
            flows={backupFlows.flows}
            loadingFlows={backupFlows.loadingFlows}
            stoppingFlowId={backupFlows.stoppingFlowId}
            onCreateDraft={handleCreateDraft}
            onOpenDetails={handleOpenDetails}
            onPublish={(record) => backupFlows.publishFlow(record)}
            onEdit={async (record) => {
              const loaded = await wizard.loadFlowForEdit(record.id)
              if (loaded) setViewMode('edit')
            }}
            onRun={(record) => backupFlows.runFlow(record)}
            onStop={(record) => backupFlows.stopFlow(record)}
            onDelete={(record) => backupFlows.deleteFlow(record)}
          />
        </div>
      ) : viewMode === 'detail' ? (
        <FlowDetailView
          detailsFlow={backupFlows.detailsFlow}
          detailsRuns={backupFlows.detailsRuns}
          detailsFlowId={detailsFlowId}
          detailsFlowRecord={detailsFlowRecord}
          loadingFlowDetails={backupFlows.loadingFlowDetails}
          stoppingFlowId={backupFlows.stoppingFlowId}
          onBack={handleBackFromDetail}
          onEdit={handleEditFromDetail}
          onRefresh={handleRefreshDetails}
          onRun={handleRunFromDetail}
          onStop={handleStopFromDetail}
          onDelete={handleDeleteFromDetail}
        />
      ) : (
        <FlowWizard
          wizard={wizard}
          viewMode={viewMode}
          onBack={handleBackFromWizard}
          onSaved={handleWizardSaved}
          backLabel={viewMode === 'edit' && detailsFlowId ? 'Back to details' : 'Back to list'}
        />
      )}

      {/* ── App Selection Modal ── */}
      <AppSelectionModal
        open={wizard.showAppSelectionModal}
        selectedApp={wizard.selectedApp}
        onSelect={wizard.handleAppSelection}
        onCancel={() => wizard.setShowAppSelectionModal(false)}
      />

      {/* ── Google OAuth Config Modal ── */}
      <GoogleConfigModal wizard={wizard} />

      {/* ── Google Folder Picker Modal ── */}
      <FolderPickerModal wizard={wizard} />

      {/* ── Service Selector Modal ── */}
      <ServiceSelectorModal wizard={wizard} />

      {/* ── Request Selector Modal ── */}
      <RequestSelectorModal wizard={wizard} />

      {/* ── Workflow Selector Modal ── */}
      <WorkflowSelectorModal wizard={wizard} />

      {/* ── WeWork Selector Modal ── */}
      <WeworkSelectorModal wizard={wizard} />

      {/* ── Destination Selection Modal ── */}
      <Modal
        title="Select Destination"
        open={showDestinationModal || wizard.showDestinationModal}
        onCancel={() => { setShowDestinationModal(false); wizard.setShowDestinationModal(false); setDestinationSearch('') }}
        width={640}
      >
        <p className="text-sm text-gray-500 mb-4">Choose where to store your backup data.</p>
        <div className="relative mb-4">
          <Cloud className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={destinationSearch}
            onChange={e => setDestinationSearch(e.target.value)}
            placeholder="Search destinations…"
            className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          {[
            { id: 'gsheets', name: 'Google Sheets', icon: <FileSpreadsheet className="w-8 h-8" />, color: '#10b981', types: ['structured'] },
            { id: 'gdrive', name: 'Google Drive', icon: <Globe className="w-8 h-8" />, color: '#4285f4', types: ['unstructured', 'all'] },
          ]
            .filter(opt => !wizard.backupType || opt.types.includes(wizard.backupType))
            .filter(opt => opt.name.toLowerCase().includes(destinationSearch.toLowerCase()))
            .map(opt => (
              <button
                key={opt.id}
                onClick={() => handleSelectDestination(opt)}
                className="flex flex-col items-center gap-2 p-5 border-2 border-gray-200 rounded-xl hover:border-gray-300 hover:shadow-sm transition-all cursor-pointer bg-white"
              >
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
