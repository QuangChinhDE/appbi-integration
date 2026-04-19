import React, { useState, useEffect, useCallback } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { Cloud } from 'lucide-react'
import ShareDialog from '@modules/identity/frontend/components/ShareDialog'
import { getListAccessMeta } from '@modules/identity/frontend/lib/resourcePermissions'
import { Alert, Button, FilterTag, Select, message } from '@packages/ui/src/components/common/ui'
import BulkActionBar from '@packages/ui/src/components/common/BulkActionBar'
import ConfirmDialog from '@packages/ui/src/components/common/ConfirmDialog'
import AppLayout from '@packages/ui/src/components/layout/AppLayout'
import ModuleOverview from '@packages/ui/src/components/common/ModuleOverview'
import OwnerBadge from '@packages/ui/src/components/common/OwnerBadge'
import PaginatedCollection from '@packages/ui/src/components/common/PaginatedCollection'
import PageListLayout from '@packages/ui/src/components/common/PageListLayout'
import { BACKUP_APPS_PERMISSION_MESSAGE, hasPermission } from '@modules/identity/frontend/lib/permissions'
import { useAuthStore } from '@modules/identity/frontend/store/authStore'

import useBackupFlows from '../hooks/useBackupFlows'
import useWizardState from '../hooks/useWizardState'
import { BACKUP_TYPE_TAG, DEFAULT_GOOGLE_REDIRECT } from '../constants'

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

const BACKUP_TYPE_TONE = {
  blue: 'info',
  orange: 'warning',
  purple: 'brand',
}

const SORT_OPTIONS = [
  { value: 'updated', label: 'Recently updated' },
  { value: 'name', label: 'Name A-Z' },
  { value: 'app', label: 'App' },
  { value: 'status', label: 'Status' },
]

const BACKUP_FLOW_RESOURCE_TYPE = 'backup_flow'


function compareText(left, right) {
  return String(left || '').localeCompare(String(right || ''))
}


function getDateValue(value) {
  const parsed = new Date(value || '')
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime()
}


function getFlowStatusRank(record) {
  if (['pending', 'running'].includes(record.last_run_status)) return 0
  if (record.is_published === 1) return 1
  if (record.is_draft === 1) return 3
  return 2
}


function sortBackupFlows(flows, sortKey) {
  const items = [...flows]

  items.sort((left, right) => {
    if (sortKey === 'name') {
      return compareText(left.name || 'Untitled draft', right.name || 'Untitled draft')
    }

    if (sortKey === 'app') {
      return (
        compareText(left.app_name || left.app, right.app_name || right.app)
        || compareText(left.name || 'Untitled draft', right.name || 'Untitled draft')
      )
    }

    if (sortKey === 'status') {
      return (
        getFlowStatusRank(left) - getFlowStatusRank(right)
        || getDateValue(right.updated_at) - getDateValue(left.updated_at)
        || compareText(left.name || 'Untitled draft', right.name || 'Untitled draft')
      )
    }

    return (
      getDateValue(right.updated_at) - getDateValue(left.updated_at)
      || compareText(left.name || 'Untitled draft', right.name || 'Untitled draft')
    )
  })

  return items
}

const BackupFlowPage = () => {
  // ── View mode ─────────────────────────────────────────────────────────
  const [viewMode, setViewMode] = useState('list') // list | detail | create | edit
  const [listFilters, setListFilters] = useState({})
  const [sortKey, setSortKey] = useState('updated')

  // ── Detail view extras ────────────────────────────────────────────────
  const [detailsFlowId, setDetailsFlowId] = useState(null)
  const [detailsFlowRecord, setDetailsFlowRecord] = useState(null)
  const [detailsActiveTab, setDetailsActiveTab] = useState('overview')
  const [shareTarget, setShareTarget] = useState(null)

  const [confirmDialog, setConfirmDialog] = useState(null)
  const [confirmLoading, setConfirmLoading] = useState(false)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [isBulkDeleting, setIsBulkDeleting] = useState(false)
  const { flowId: paramFlowId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const permissions = useAuthStore((state) => state.permissions)
  const canEditBackup = hasPermission(permissions, 'backup', 'edit')

  // ── Hooks ─────────────────────────────────────────────────────────────
  const backupFlows = useBackupFlows()
  const wizard = useWizardState()
  const canConfigureBackup = wizard.canConfigureBackup
  const backupAppsPermissionConflict = wizard.backupAppsPermissionConflict
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
    navigate('/backup', { replace: true })
  }, [resetAll, setDetailsFlow, setDetailsRuns, navigate])

  // ── Fetch flows on mount ──────────────────────────────────────────────
  useEffect(() => { backupFlows.fetchFlows() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── URL-driven detail view (direct link /backup/:flowId) ──────────────
  useEffect(() => {
    if (paramFlowId && viewMode === 'list' && !detailsFlowId) {
      void handleOpenDetails({ id: paramFlowId })
    }
  }, [paramFlowId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!location.state?.resetToListToken) return
    resetToBackupList()
  }, [location.state?.resetToListToken, resetToBackupList])

  useEffect(() => {
    if (!backupFlows.detailsFlow) return
    setDetailsFlowRecord(backupFlows.detailsFlow)
  }, [backupFlows.detailsFlow])

  useEffect(() => {
    const validIds = new Set(backupFlows.flows.map((record) => record.id))
    setSelectedIds((current) => {
      const next = new Set([...current].filter((id) => validIds.has(id)))
      const unchanged = next.size === current.size && [...next].every((id) => current.has(id))
      return unchanged ? current : next
    })
  }, [backupFlows.flows])

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
  const activeListFilterCount = Object.values(listFilters).filter(Boolean).length

  const toggleListFilter = useCallback((key, value) => {
    setListFilters((current) => ({
      ...current,
      [key]: current[key] === value ? undefined : value,
    }))
  }, [])

  const clearListFilters = useCallback(() => {
    setListFilters({})
  }, [])

  // ── Handlers ──────────────────────────────────────────────────────────

  const handleCreateDraft = async () => {
    if (!canConfigureBackup) return
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
    navigate(`/backup/${record.id}`, { replace: true })
    await backupFlows.fetchFlowDetails(record.id)
  }

  const handleRefreshDetails = async () => {
    if (!detailsFlowId) return
    await backupFlows.fetchFlowDetails(detailsFlowId)
  }

  const handleEditFromDetail = async () => {
    if (!canConfigureBackup) return
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
      navigate(`/backup/${detailsFlowId}`, { replace: true })
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
      navigate(`/backup/${nextFlowId}`, { replace: true })
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

  const toggleSelect = useCallback((id) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleSelectAll = useCallback((ids) => {
    setSelectedIds((current) => {
      const allSelected = ids.length > 0 && ids.every((id) => current.has(id))
      if (allSelected) {
        const next = new Set(current)
        ids.forEach((id) => next.delete(id))
        return next
      }
      return new Set([...current, ...ids])
    })
  }, [])

  const handleBulkDelete = useCallback(async () => {
    if (selectedIds.size === 0) return
    const confirmed = window.confirm(`Delete ${selectedIds.size} flow(s)? This action cannot be undone.`)
    if (!confirmed) return

    setIsBulkDeleting(true)
    let successCount = 0
    let failCount = 0

    for (const id of selectedIds) {
      const deleted = await backupFlows.deleteFlow({ id }, { silent: true, skipReload: true })
      if (deleted) {
        successCount += 1
      } else {
        failCount += 1
      }
    }

    setSelectedIds(new Set())
    await backupFlows.fetchFlows()
    setIsBulkDeleting(false)

    if (successCount > 0) {
      message.success(`Deleted ${successCount} flow(s)`)
    }
    if (failCount > 0) {
      message.error(`Failed to delete ${failCount} flow(s)`)
    }
  }, [backupFlows, selectedIds])

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <AppLayout>
      {viewMode === 'list' ? (
        <PageListLayout
          title="Backup Flows"
          description="Create, publish, and run backup flows."
          overview={(
            <ModuleOverview
              icon={Cloud}
              title="Backup operations"
              description="Draft, connect, publish, and monitor backup executions."
              badges={['Draft-first', 'Reusable sources', 'Execution tracking']}
              stats={[
                { label: 'Flows', value: totalFlows, helper: 'Total configured.' },
                { label: 'Published', value: publishedFlows, helper: 'Ready to run.' },
                { label: 'Running', value: activeRunFlows, helper: 'Active now.' },
              ]}
            />
          )}
          action={canEditBackup ? (
            <Button
              variant="primary"
              size="md"
              onClick={handleCreateDraft}
              disabled={!canConfigureBackup}
              title={!canConfigureBackup ? BACKUP_APPS_PERMISSION_MESSAGE : undefined}
              leadingIcon={<Cloud className="h-4 w-4" />}
            >
              New flow
            </Button>
          ) : null}
          isLoading={backupFlows.loadingFlows}
          loadingText="Loading backup flows..."
          searchPlaceholder="Search flows, apps, destinations, owners, or access"
          defaultView="list"
          toolbarExtra={(
            <div className="min-w-[180px]">
              <Select size="sm" value={sortKey} onChange={(event) => setSortKey(event.target.value)}>
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    Sort: {option.label}
                  </option>
                ))}
              </Select>
            </div>
          )}
          activeFilters={activeListFilterCount > 0 ? (
            <>
              {listFilters.state && (
                <FilterTag
                  tone={listFilters.state === 'draft' ? 'warning' : 'info'}
                  active
                  onClick={() => toggleListFilter('state', listFilters.state)}
                >
                  {listFilters.state === 'draft' ? 'Draft' : 'Ready'}
                </FilterTag>
              )}
              {listFilters.publish && (
                <FilterTag
                  tone={listFilters.publish === 'published' ? 'success' : 'neutral'}
                  active
                  onClick={() => toggleListFilter('publish', listFilters.publish)}
                >
                  {listFilters.publish === 'published' ? 'Published' : 'Unpublished'}
                </FilterTag>
              )}
              {listFilters.backupType && (
                <FilterTag
                  tone={BACKUP_TYPE_TONE[BACKUP_TYPE_TAG[listFilters.backupType]?.color] || 'neutral'}
                  active
                  onClick={() => toggleListFilter('backupType', listFilters.backupType)}
                >
                  {BACKUP_TYPE_TAG[listFilters.backupType]?.label || listFilters.backupType}
                </FilterTag>
              )}
              {listFilters.access && (
                <FilterTag
                  tone={getListAccessMeta(listFilters.access).tone}
                  active
                  onClick={() => toggleListFilter('access', listFilters.access)}
                >
                  {getListAccessMeta(listFilters.access).label}
                </FilterTag>
              )}
              {listFilters.owner && (
                <OwnerBadge
                  email={listFilters.owner}
                  active
                  onClick={() => toggleListFilter('owner', listFilters.owner)}
                />
              )}
              <Button variant="ghost" size="xs" onClick={clearListFilters}>
                Clear filters
              </Button>
            </>
          ) : null}
        >
          {({ viewMode: pageViewMode, filterText }) => (
            <div className="space-y-6">
              {(() => {
                const needle = filterText.trim().toLowerCase()
                const filteredFlows = backupFlows.flows.filter((record) => {
                  const stateValue = record.is_draft === 1 ? 'draft' : 'ready'
                  const publishValue = record.is_published === 1 ? 'published' : 'unpublished'
                  const matchesSearch = (
                    needle.length === 0 ||
                    [
                      record.name,
                      record.app,
                      record.app_name,
                      record.destination_name,
                      record.destination_type,
                      record.last_run_status,
                      record.owner_email,
                      record.user_permission,
                      BACKUP_TYPE_TAG[record.backup_type]?.label,
                    ]
                      .filter(Boolean)
                      .some((value) => String(value).toLowerCase().includes(needle))
                  )

                  return (
                    matchesSearch &&
                    (!listFilters.state || stateValue === listFilters.state) &&
                    (!listFilters.publish || publishValue === listFilters.publish) &&
                    (!listFilters.backupType || record.backup_type === listFilters.backupType) &&
                    (!listFilters.access || record.user_permission === listFilters.access) &&
                    (!listFilters.owner || record.owner_email === listFilters.owner)
                  )
                })
                const visibleFlows = sortBackupFlows(filteredFlows, sortKey)

                return (
                  <PaginatedCollection
                    items={visibleFlows}
                    viewMode={pageViewMode}
                    resetKey={JSON.stringify({ filterText, pageViewMode, listFilters, sortKey })}
                  >
                    {({ pageItems, pagination }) => (
                      <div className="space-y-6">
              {backupAppsPermissionConflict && (
                <Alert
                  type="warning"
                  message="Apps view required to configure flows"
                  description={BACKUP_APPS_PERMISSION_MESSAGE}
                />
              )}

              {!canEditBackup && (
                <Alert
                  type="info"
                  message="Read-only access"
                  description="You can inspect flows and run history."
                />
              )}

              <FlowListView
                flows={pageItems}
                hasFlows={backupFlows.flows.length > 0}
                filterText={filterText}
                viewMode={pageViewMode}
                canEdit={canEditBackup}
                canConfigure={canConfigureBackup}
                configurationBlockedMessage={BACKUP_APPS_PERMISSION_MESSAGE}
                activeFilters={listFilters}
                onFilterClick={toggleListFilter}
                stoppingFlowId={backupFlows.stoppingFlowId}
                onCreateDraft={handleCreateDraft}
                onOpenDetails={handleOpenDetails}
                onPublish={(record) => backupFlows.publishFlow(record)}
                onEdit={async (record) => {
                  if (!canConfigureBackup) return
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
                onShare={(record) => setShareTarget(record)}
                selectedIds={canEditBackup ? selectedIds : undefined}
                onToggleSelect={canEditBackup ? toggleSelect : undefined}
                onToggleSelectAll={canEditBackup ? toggleSelectAll : undefined}
              />

              {pagination}
                      </div>
                    )}
                  </PaginatedCollection>
                )
              })()}
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
          onShare={() => setShareTarget(backupFlows.detailsFlow || detailsFlowRecord)}
          canEdit={canEditBackup}
          canConfigure={canConfigureBackup}
          configurationBlockedMessage={BACKUP_APPS_PERMISSION_MESSAGE}
        />
      ) : canConfigureBackup ? (
        <FlowWizard
          wizard={wizard}
          viewMode={viewMode}
          onBack={handleBackFromWizard}
          onSaved={handleWizardSaved}
          backLabel={viewMode === 'edit' && detailsFlowId ? 'Back to details' : 'Back to list'}
        />
      ) : canEditBackup ? (
        <div className="px-8 py-6">
          <Alert
            type="warning"
            message="Apps view required to configure flows"
            description={BACKUP_APPS_PERMISSION_MESSAGE}
          />
        </div>
      ) : (
        <div className="px-8 py-6">
          <Alert
            type="warning"
            message="Backup edit access required"
            description="This account cannot create or edit backup flows."
          />
          <div className="mt-4">
            <Button variant="secondary" size="md" onClick={resetToBackupList}>
              Back to list
            </Button>
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

      <ShareDialog
        open={Boolean(shareTarget)}
        onClose={() => setShareTarget(null)}
        resourceType={BACKUP_FLOW_RESOURCE_TYPE}
        resourceId={shareTarget?.id}
        resourceName={shareTarget?.name || 'Backup flow'}
      />

      {canEditBackup && (
        <BulkActionBar
          selectedCount={selectedIds.size}
          onDelete={handleBulkDelete}
          onClear={() => setSelectedIds(new Set())}
          isDeleting={isBulkDeleting}
        />
      )}

    </AppLayout>
  )
}

export default BackupFlowPage
