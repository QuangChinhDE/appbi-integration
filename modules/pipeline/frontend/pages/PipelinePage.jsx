import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Workflow } from 'lucide-react'

import ModuleOverview from '@packages/ui/src/components/common/ModuleOverview'
import PaginatedCollection from '@packages/ui/src/components/common/PaginatedCollection'
import PageListLayout from '@packages/ui/src/components/common/PageListLayout'
import ConfirmDialog from '@packages/ui/src/components/common/ConfirmDialog'
import { Button, FilterTag, Select, message } from '@packages/ui/src/components/common/ui'
import AppLayout from '@packages/ui/src/components/layout/AppLayout'

import usePipelines from '../hooks/usePipelines'
import { PIPELINE_STATUS_LABEL } from '../constants'
import PipelineListView from '../components/PipelineListView'
import PipelineDetailView from '../components/PipelineDetailView'
import PipelineWizard from '../components/PipelineWizard'


const SORT_OPTIONS = [
  { value: 'updated', label: 'Recently updated' },
  { value: 'name', label: 'Name A-Z' },
  { value: 'status', label: 'Status' },
]

const STATUS_FILTER_TONE = {
  draft: 'warning',
  active: 'success',
  paused: 'warning',
  archived: 'neutral',
}


function compareText(left, right) {
  return String(left || '').localeCompare(String(right || ''))
}

function getDateValue(value) {
  const parsed = new Date(value || '')
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime()
}

function getStatusRank(status) {
  if (status === 'active') return 0
  if (status === 'paused') return 1
  if (status === 'draft') return 2
  return 3
}

function sortPipelines(pipelines, sortKey) {
  const items = [...pipelines]
  items.sort((left, right) => {
    if (sortKey === 'name') {
      return compareText(left.name || '', right.name || '')
    }
    if (sortKey === 'status') {
      return (
        getStatusRank(left.status) - getStatusRank(right.status)
        || getDateValue(right.updated_at) - getDateValue(left.updated_at)
      )
    }
    // default: recently updated
    return (
      getDateValue(right.updated_at) - getDateValue(left.updated_at)
      || compareText(left.name || '', right.name || '')
    )
  })
  return items
}


const PipelinePage = () => {
  // ── View mode ─────────────────────────────────────────────────────────
  const [viewMode, setViewMode] = useState('list') // list | detail | create
  const [listFilters, setListFilters] = useState({})
  const [sortKey, setSortKey] = useState('updated')

  // ── Detail view extras ────────────────────────────────────────────────
  const [detailsPipelineId, setDetailsPipelineId] = useState(null)
  const [detailsPipelineRecord, setDetailsPipelineRecord] = useState(null)

  const [confirmDialog, setConfirmDialog] = useState(null)
  const [confirmLoading, setConfirmLoading] = useState(false)

  // ── Hooks ─────────────────────────────────────────────────────────────
  const pipelinesHook = usePipelines()

  const resetToList = useCallback(() => {
    setViewMode('list')
    setDetailsPipelineId(null)
    setDetailsPipelineRecord(null)
  }, [])

  // ── Fetch on mount ────────────────────────────────────────────────────
  useEffect(() => { pipelinesHook.fetchPipelines() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (pipelinesHook.detailsPipeline) {
      setDetailsPipelineRecord(pipelinesHook.detailsPipeline)
    }
  }, [pipelinesHook.detailsPipeline])

  // ── Derived ───────────────────────────────────────────────────────────
  const totalPipelines = pipelinesHook.pipelines.length
  const activePipelines = pipelinesHook.pipelines.filter((p) => p.status === 'active').length
  const draftPipelines = pipelinesHook.pipelines.filter((p) => p.status === 'draft').length
  const activeFilterCount = Object.values(listFilters).filter(Boolean).length

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

  const handleCreate = () => {
    setViewMode('create')
  }

  const handleOpenDetails = async (record) => {
    setDetailsPipelineId(record.id)
    setDetailsPipelineRecord(record)
    setViewMode('detail')
    await pipelinesHook.fetchPipelineDetails(record.id)
  }

  const handleRefreshDetails = async () => {
    if (!detailsPipelineId) return
    await pipelinesHook.fetchPipelineDetails(detailsPipelineId)
  }

  const handleStatusChange = useCallback(async (recordOrNull, newStatus) => {
    const record = recordOrNull || detailsPipelineRecord
    if (!record?.id) return
    const updated = await pipelinesHook.updatePipeline(record.id, { status: newStatus })
    if (updated) {
      await pipelinesHook.fetchPipelines()
      if (viewMode === 'detail') {
        await pipelinesHook.fetchPipelineDetails(record.id)
      }
    }
  }, [detailsPipelineRecord, pipelinesHook, viewMode])

  const handleDeleteFromDetail = () => {
    const record = detailsPipelineRecord || { id: detailsPipelineId }
    requestDeletePipeline(record, { onDeleted: resetToList })
  }

  const handleDeleteFromList = (record) => {
    requestDeletePipeline(record, {
      onDeleted: () => pipelinesHook.fetchPipelines(),
    })
  }

  const handleWizardSaved = async () => {
    await pipelinesHook.fetchPipelines()
    resetToList()
  }

  // ── Confirm dialog ────────────────────────────────────────────────────

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

  const requestDeletePipeline = useCallback((record, options = {}) => {
    openConfirmDialog({
      title: 'Delete pipeline?',
      description: `Delete "${record.name || 'this pipeline'}". This action cannot be undone.`,
      confirmLabel: 'Delete pipeline',
      variant: 'danger',
      onConfirm: async () => {
        await pipelinesHook.deletePipeline(record.id)
        if (typeof options.onDeleted === 'function') options.onDeleted()
      },
    })
  }, [pipelinesHook, openConfirmDialog])

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <AppLayout>
      {viewMode === 'list' ? (
        <PageListLayout
          title="Pipeline"
          description="Create and manage data pipelines."
          overview={(
            <ModuleOverview
              icon={Workflow}
              title="Data pipelines"
              description="Sync data between apps with configurable source, destination, and schedule."
              badges={['Source → Dest', 'Scheduled', 'Field mapping']}
              stats={[
                { label: 'Total', value: String(totalPipelines), helper: 'All pipelines.' },
                { label: 'Active', value: String(activePipelines), helper: 'Currently active.' },
                { label: 'Draft', value: String(draftPipelines), helper: 'Not yet activated.' },
              ]}
            />
          )}
          action={(
            <Button
              variant="primary"
              size="md"
              onClick={handleCreate}
              leadingIcon={<Plus className="h-4 w-4" />}
            >
              New pipeline
            </Button>
          )}
          isLoading={pipelinesHook.loadingPipelines}
          loadingText="Loading pipelines..."
          searchPlaceholder="Search pipelines by name, source, or destination"
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
          activeFilters={activeFilterCount > 0 ? (
            <>
              {listFilters.status && (
                <FilterTag
                  tone={STATUS_FILTER_TONE[listFilters.status] || 'neutral'}
                  active
                  onClick={() => toggleListFilter('status', listFilters.status)}
                >
                  {PIPELINE_STATUS_LABEL[listFilters.status] || listFilters.status}
                </FilterTag>
              )}
              {listFilters.write_mode && (
                <FilterTag tone="neutral" active onClick={() => toggleListFilter('write_mode', listFilters.write_mode)}>
                  {listFilters.write_mode}
                </FilterTag>
              )}
              {listFilters.schedule && (
                <FilterTag tone="neutral" active onClick={() => toggleListFilter('schedule', listFilters.schedule)}>
                  {listFilters.schedule}
                </FilterTag>
              )}
              <Button variant="ghost" size="xs" onClick={clearListFilters}>
                Clear filters
              </Button>
            </>
          ) : null}
        >
          {({ viewMode: pageViewMode, filterText }) => {
            const needle = filterText.trim().toLowerCase()
            const filteredPipelines = pipelinesHook.pipelines.filter((record) => {
              const matchesSearch = (
                needle.length === 0
                || [record.name, record.source_connector_key, record.dest_connector_key, record.dest_stream_key, record.write_mode, record.status]
                    .filter(Boolean)
                    .some((value) => String(value).toLowerCase().includes(needle))
              )
              return (
                matchesSearch
                && (!listFilters.status || record.status === listFilters.status)
                && (!listFilters.write_mode || record.write_mode === listFilters.write_mode)
                && (!listFilters.schedule || (record.schedule?.type || 'manual') === listFilters.schedule)
              )
            })
            const visiblePipelines = sortPipelines(filteredPipelines, sortKey)

            return (
              <PaginatedCollection
                items={visiblePipelines}
                viewMode={pageViewMode}
                resetKey={JSON.stringify({ filterText, pageViewMode, listFilters, sortKey })}
              >
                {({ pageItems, pagination }) => (
                  <div className="space-y-6">
                    <PipelineListView
                      pipelines={pageItems}
                      hasPipelines={pipelinesHook.pipelines.length > 0}
                      filterText={filterText}
                      viewMode={pageViewMode}
                      activeFilters={listFilters}
                      onFilterClick={toggleListFilter}
                      onCreatePipeline={handleCreate}
                      onOpenDetails={handleOpenDetails}
                      onDelete={handleDeleteFromList}
                      onStatusChange={(record, newStatus) => handleStatusChange(record, newStatus)}
                    />
                    {pagination}
                  </div>
                )}
              </PaginatedCollection>
            )
          }}
        </PageListLayout>
      ) : viewMode === 'detail' ? (
        <PipelineDetailView
          detailsPipeline={pipelinesHook.detailsPipeline}
          detailsRuns={pipelinesHook.detailsRuns}
          detailsRecord={detailsPipelineRecord}
          loadingDetails={pipelinesHook.loadingDetails}
          onBack={resetToList}
          onRefresh={handleRefreshDetails}
          onDelete={handleDeleteFromDetail}
          onStatusChange={(newStatus) => handleStatusChange(null, newStatus)}
        />
      ) : (
        <PipelineWizard
          onBack={resetToList}
          onSaved={handleWizardSaved}
        />
      )}

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

export default PipelinePage