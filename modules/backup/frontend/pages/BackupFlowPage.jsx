import React, { useState, useEffect, useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import { Cloud } from 'lucide-react'
import { Alert } from '@packages/ui/src/components/common/ui'
import ConfirmDialog from '@packages/ui/src/components/common/ConfirmDialog'
import AppLayout from '@packages/ui/src/components/layout/AppLayout'
import ModuleOverview from '@packages/ui/src/components/common/ModuleOverview'
import PageListLayout from '@packages/ui/src/components/common/PageListLayout'
import { hasPermission } from '@modules/identity/frontend/lib/permissions'
import { useAuthStore } from '@modules/identity/frontend/store/authStore'

import useBackupFlows from '../hooks/useBackupFlows'
import useWizardState from '../hooks/useWizardState'
import { DEFAULT_GOOGLE_REDIRECT } from '../constants'

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

  const [confirmDialog, setConfirmDialog] = useState(null)
  const [confirmLoading, setConfirmLoading] = useState(false)
  const location = useLocation()
  const permissions = useAuthStore((state) => state.permissions)
  const canEditBackup = hasPermission(permissions, 'backup', 'edit')

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
  const totalFlows = backupFlows.flows.length
  const publishedFlows = backupFlows.flows.filter((item) => item.is_published === 1).length
  const activeRunFlows = backupFlows.flows.filter((item) => ['pending', 'running'].includes(item.last_run_status)).length

  // ── Handlers ──────────────────────────────────────────────────────────

  const handleCreateDraft = async () => {
    if (!canEditBackup) return
    resetAll()
    const id = await backupFlows.createDraft()
    if (!id) return
    wizard.setDraftFlowId(id)
    void wizard.loadSavedSourceConnections(null)
    void wizard.loadSavedDestinationProfiles(null)
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
    if (!canEditBackup) return
    const id = detailsFlowId || detailsFlowRecord?.id
    if (!id) return
    const loaded = await wizard.loadFlowForEdit(id)
    if (loaded) {
      void wizard.loadSavedSourceConnections(null)
      void wizard.loadSavedDestinationProfiles(null)
      setViewMode('edit')
    }
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
    requestStopFlow(
      detailsFlowRecord || { id: detailsFlowId, name: backupFlows.detailsFlow?.name, app: source.app },
      { onStopped: () => backupFlows.fetchFlowDetails(detailsFlowId || detailsFlowRecord?.id) },
    )
  }

  const handleDeleteFromDetail = () => {
    requestDeleteFlow(
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

  const openConfirmDialog = useCallback((config) => {
    setConfirmDialog(config)
  }, [])

  const closeConfirmDialog = useCallback(() => {
    if (confirmLoading) return
    setConfirmDialog(null)
  }, [confirmLoading])

  const handleConfirmDialog = useCallback(async () => {
    if (!confirmDialog?.onConfirm) return
    setConfirmLoading(true)
    try {
      await confirmDialog.onConfirm()
      setConfirmDialog(null)
    } finally {
      setConfirmLoading(false)
    }
  }, [confirmDialog])

  const requestDeleteFlow = useCallback((record, options = {}) => {
    openConfirmDialog({
      title: 'Delete backup flow?',
      description: `Delete "${record.name || 'Draft'}". This action cannot be undone and the flow configuration will be removed from the workspace.`,
      confirmLabel: 'Delete flow',
      variant: 'danger',
      onConfirm: async () => {
        await backupFlows.deleteFlow(record, options)
      },
    })
  }, [backupFlows, openConfirmDialog])

  const requestStopFlow = useCallback((record, options = {}) => {
    openConfirmDialog({
      title: 'Stop running backup?',
      description: `Stop the running backup for "${record.name || 'this flow'}". The current execution will be interrupted and may produce incomplete output.`,
      confirmLabel: 'Stop backup',
      variant: 'warning',
      onConfirm: async () => {
        await backupFlows.stopFlow(record, options)
      },
    })
  }, [backupFlows, openConfirmDialog])

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <AppLayout>
      {viewMode === 'list' ? (
        <PageListLayout
          title="Backup Flows"
          description="Build, publish, and operate backup flows with the same list-page structure used across AppBI AI modules."
          overview={(
            <ModuleOverview
              icon={Cloud}
              title="Backup operations hub"
              description="Draft a flow, connect a reusable source and destination, then publish and monitor executions from one standardized page shell."
              badges={['Draft-first flow', 'Reusable sources', 'Execution tracking']}
              stats={[
                {
                  label: 'Flows',
                  value: totalFlows,
                  helper: 'Total backup flows currently configured.',
                },
                {
                  label: 'Published',
                  value: publishedFlows,
                  helper: 'Flows ready for scheduled or manual runs.',
                },
                {
                  label: 'Running now',
                  value: activeRunFlows,
                  helper: 'Flows with an active or queued execution.',
                },
              ]}
            />
          )}
          action={canEditBackup ? (
            <button
              onClick={handleCreateDraft}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
            >
              <Cloud className="h-4 w-4" />
              New Backup Flow
            </button>
          ) : null}
          isLoading={backupFlows.loadingFlows}
          loadingText="Loading backup flows…"
          searchPlaceholder="Search flows, apps, destinations, or status"
          defaultView="list"
        >
          {({ viewMode: pageViewMode, filterText }) => (
            <div className="space-y-6">
              <Alert
                type="info"
                message="Draft first, publish when the flow is ready"
                description={canEditBackup
                  ? 'The landing page now follows the same overview, toolbar, and collection states used in AppBI AI while keeping the existing create, detail, and run flows intact.'
                  : 'Your account currently has read-only access in Backup. You can inspect flow details and run history, but cannot change configurations.'}
              />

              <FlowListView
                flows={backupFlows.flows}
                filterText={filterText}
                viewMode={pageViewMode}
                canEdit={canEditBackup}
                stoppingFlowId={backupFlows.stoppingFlowId}
                onCreateDraft={handleCreateDraft}
                onOpenDetails={handleOpenDetails}
                onPublish={(record) => backupFlows.publishFlow(record)}
                onEdit={async (record) => {
                  const loaded = await wizard.loadFlowForEdit(record.id)
                  if (loaded) {
                    void wizard.loadSavedSourceConnections(null)
                    void wizard.loadSavedDestinationProfiles(null)
                    setViewMode('edit')
                  }
                }}
                onRun={(record) => backupFlows.runFlow(record)}
                onStop={(record) => requestStopFlow(record)}
                onDelete={(record) => requestDeleteFlow(record)}
              />
            </div>
          )}
        </PageListLayout>
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
          canEdit={canEditBackup}
        />
      ) : canEditBackup ? (
        <FlowWizard
          wizard={wizard}
          viewMode={viewMode}
          onBack={handleBackFromWizard}
          onSaved={handleWizardSaved}
          backLabel={viewMode === 'edit' && detailsFlowId ? 'Back to details' : 'Back to list'}
        />
      ) : (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-6 py-5">
          <Alert
            type="warning"
            message="Backup edit access is required"
            description="This account can view backup data but cannot create or edit backup flows."
          />
          <div className="mt-4">
            <button
              type="button"
              onClick={resetToBackupList}
              className="inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-white px-4 py-2 text-sm font-medium text-amber-800 transition-colors hover:bg-amber-100"
            >
              Back to backup list
            </button>
          </div>
        </div>
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

      <ConfirmDialog
        isOpen={Boolean(confirmDialog)}
        onClose={closeConfirmDialog}
        onConfirm={() => { void handleConfirmDialog() }}
        title={confirmDialog?.title || ''}
        description={confirmDialog?.description || ''}
        confirmLabel={confirmLoading ? 'Working…' : (confirmDialog?.confirmLabel || 'Confirm')}
        cancelLabel="Cancel"
        variant={confirmDialog?.variant || 'danger'}
        isLoading={confirmLoading}
      />

    </AppLayout>
  )
}

export default BackupFlowPage
