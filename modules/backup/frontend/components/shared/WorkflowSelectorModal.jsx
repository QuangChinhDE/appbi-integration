import React, { useMemo, useState } from 'react'
import { FolderKanban, RefreshCw, Loader2, Search, X } from 'lucide-react'
import AppModalShell from '@packages/ui/src/components/common/AppModalShell'
import { SpinCenter, Empty, Alert, Tag } from '@packages/ui/src/components/common/ui'

const FILTER_ALL_OPTION = '__all__'

function stringifyFilterValue(value) {
  if (value == null) return ''
  if (Array.isArray(value)) return value.map((item) => stringifyFilterValue(item)).join(' ')
  if (typeof value === 'object') return Object.values(value).map((item) => stringifyFilterValue(item)).join(' ')
  return String(value)
}

const WorkflowSelectorModal = ({ wizard }) => {
  const {
    workflowSelectorModalOpen,
    closeWorkflowSelectorModal,
    applyWorkflowSelectorModal,
    loadWorkflowPreview,
    loadingWorkflowPreview,
    workflowPreview,
    draftSelectedWorkflowIds, setDraftSelectedWorkflowIds,
    workflowPreviewListRef,
  } = wizard

  const rows = Array.isArray(workflowPreview?.workflows) ? workflowPreview.workflows : []
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedFilterKey, setSelectedFilterKey] = useState(FILTER_ALL_OPTION)

  const filterOptions = useMemo(() => {
    const rawKeys = new Set()
    rows.forEach((record) => {
      if (!record || typeof record !== 'object') return
      const workflowData = record.workflow_data
      if (!workflowData || typeof workflowData !== 'object' || Array.isArray(workflowData)) return
      Object.keys(workflowData).forEach((key) => rawKeys.add(key))
    })

    const sortedRawKeys = Array.from(rawKeys).sort((left, right) => left.localeCompare(right))
    return [
      { value: FILTER_ALL_OPTION, label: 'All keys' },
      { value: 'workflow_name', label: 'workflow_name' },
      { value: 'workflow_id', label: 'workflow_id' },
      ...sortedRawKeys
        .filter((key) => key !== 'workflow_name' && key !== 'workflow_id')
        .map((key) => ({ value: key, label: key })),
    ]
  }, [rows])

  const effectiveFilterKey = filterOptions.some((option) => option.value === selectedFilterKey)
    ? selectedFilterKey
    : FILTER_ALL_OPTION

  const getFilterValue = (record, key) => {
    if (!record || typeof record !== 'object') return ''
    if (key === 'workflow_name' || key === 'workflow_id' || Object.prototype.hasOwnProperty.call(record, key)) {
      return stringifyFilterValue(record[key])
    }
    const workflowData = record.workflow_data
    if (workflowData && typeof workflowData === 'object' && !Array.isArray(workflowData)) {
      return stringifyFilterValue(workflowData[key])
    }
    return ''
  }

  const normalizedSearchTerm = searchTerm.trim().toLowerCase()
  const filteredRows = useMemo(() => {
    if (!normalizedSearchTerm) return rows
    return rows.filter((record) => {
      if (effectiveFilterKey !== FILTER_ALL_OPTION) {
        return getFilterValue(record, effectiveFilterKey).toLowerCase().includes(normalizedSearchTerm)
      }

      return filterOptions
        .filter((option) => option.value !== FILTER_ALL_OPTION)
        .some((option) => getFilterValue(record, option.value).toLowerCase().includes(normalizedSearchTerm))
    })
  }, [rows, normalizedSearchTerm, effectiveFilterKey, filterOptions])

  const filteredWorkflowIds = filteredRows
    .map((record) => record.workflow_id)
    .filter(Boolean)
  const selectedFilteredCount = filteredWorkflowIds.filter((workflowId) => draftSelectedWorkflowIds.includes(workflowId)).length
  const allFilteredSelected = filteredWorkflowIds.length > 0 && selectedFilteredCount === filteredWorkflowIds.length

  const handleToggleAllFiltered = (checked) => {
    if (checked) {
      setDraftSelectedWorkflowIds((prev) => Array.from(new Set([...prev, ...filteredWorkflowIds])))
      return
    }
    setDraftSelectedWorkflowIds((prev) => prev.filter((workflowId) => !filteredWorkflowIds.includes(workflowId)))
  }

  return (
    workflowSelectorModalOpen ? (
    <AppModalShell
      title="Select workflows"
      description="Choose workflow spaces to include."
      icon={<FolderKanban className="h-5 w-5" />}
      iconClassName="bg-surface-2 text-text-secondary"
      onClose={closeWorkflowSelectorModal}
      maxWidthClass="max-w-[960px]"
      footer={
        <>
          <button onClick={() => loadWorkflowPreview(draftSelectedWorkflowIds)} disabled={loadingWorkflowPreview}
            className="flex items-center gap-2 rounded-md border border-[rgb(var(--border-strong))] px-4 py-2 text-label font-emphasis text-text-secondary transition-colors hover:bg-surface-2 disabled:opacity-50">
            {loadingWorkflowPreview ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Refresh Source
          </button>
          <button onClick={closeWorkflowSelectorModal} className="rounded-md border border-[rgb(var(--border-strong))] px-4 py-2 text-label font-emphasis text-text-secondary transition-colors hover:bg-surface-2">Cancel</button>
          <button onClick={applyWorkflowSelectorModal} disabled={!workflowPreview}
            className="rounded-md bg-brand px-4 py-2 text-label font-emphasis text-white transition-colors hover:bg-brand-hover disabled:opacity-50">Apply Selection</button>
        </>
      }
    >
      {loadingWorkflowPreview ? <SpinCenter /> : !workflowPreview ? <Empty description="Load Workflow source preview first to choose workflows" /> : (
        <div className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            <Tag color="blue">{rows.length} workflows loaded</Tag>
            <Tag color="default">{filteredRows.length} visible</Tag>
            <Tag color={draftSelectedWorkflowIds.length ? 'green' : 'default'}>{draftSelectedWorkflowIds.length} selected</Tag>
          </div>
          <div className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
            <div>
              <select
                value={effectiveFilterKey}
                onChange={(event) => setSelectedFilterKey(event.target.value)}
                className="w-full rounded-md border border-[rgb(var(--border-strong))] bg-surface-0 px-3 py-2 text-caption text-text-primary focus:border-brand focus:shadow-focus-brand focus:outline-none transition-colors"
              >
                {filterOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-quaternary" />
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder={effectiveFilterKey === FILTER_ALL_OPTION ? 'Filter workflows across all keys...' : `Filter by ${effectiveFilterKey}...`}
                className="w-full rounded-md border border-[rgb(var(--border-strong))] bg-surface-0 py-2 pl-9 pr-10 text-caption text-text-primary placeholder:text-text-quaternary focus:border-brand focus:shadow-focus-brand focus:outline-none transition-colors"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-text-quaternary transition-colors hover:bg-surface-2 hover:text-text-secondary"
                  aria-label="Clear workflow filter"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
          {!workflowPreview.job_count_complete && <Alert type="warning" message={`Detailed preview loaded for ${workflowPreview.detail_loaded_count || 0} workflows only`} description="Click Refresh Source to reload with your current selection." />}
          {workflowPreview.partial_error_count > 0 && <Alert type="warning" message={`Some workflows could not be previewed completely (${workflowPreview.partial_error_count})`} />}
          <div ref={workflowPreviewListRef} className="border border-[rgb(var(--border-line))] rounded-md overflow-hidden">
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <table className="w-full text-caption">
                <thead className="bg-surface-2 sticky top-0">
                  <tr>
                    <th className="w-8 px-3 py-2 text-left text-label font-emphasis uppercase tracking-[0.14em] text-text-tertiary">
                      <input type="checkbox"
                        checked={allFilteredSelected}
                        onChange={e => handleToggleAllFiltered(e.target.checked)}
                        className="rounded" />
                    </th>
                    <th className="px-3 py-2 text-left text-label font-emphasis uppercase tracking-[0.14em] text-text-tertiary">Workflow</th>
                    <th className="w-20 px-3 py-2 text-left text-label font-emphasis uppercase tracking-[0.14em] text-text-tertiary">Stages</th>
                    <th className="w-20 px-3 py-2 text-left text-label font-emphasis uppercase tracking-[0.14em] text-text-tertiary">Jobs</th>
                    <th className="px-3 py-2 text-left text-label font-emphasis uppercase tracking-[0.14em] text-text-tertiary">Sample Jobs</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[rgb(var(--border-line))]">
                  {filteredRows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-caption text-text-quaternary">
                        No workflows match the current filter.
                      </td>
                    </tr>
                  ) : filteredRows.map(record => (
                    <tr key={record.workflow_id} className={`hover:bg-surface-2 ${draftSelectedWorkflowIds.includes(record.workflow_id) ? 'bg-brand/10' : ''}`}>
                      <td className="px-3 py-2.5">
                        <input type="checkbox" checked={draftSelectedWorkflowIds.includes(record.workflow_id)}
                          onChange={e => setDraftSelectedWorkflowIds(prev => e.target.checked ? [...prev, record.workflow_id] : prev.filter(id => id !== record.workflow_id))}
                          className="rounded" />
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="font-strong">{record.workflow_name}</div>
                        <div className="text-caption text-text-quaternary">ID: {record.workflow_id}</div>
                        {record.preview_error && <div className="mt-0.5 text-caption text-warning">{record.preview_error}</div>}
                      </td>
                      <td className="px-3 py-2.5 text-text-secondary">{record.stage_count ?? '—'}</td>
                      <td className="px-3 py-2.5 text-text-secondary">{record.job_count ?? '—'}</td>
                      <td className="px-3 py-2.5">
                        {record.detail_loaded
                          ? (record.sample_jobs || []).length > 0
                            ? (record.sample_jobs || []).map(job => <div key={job.job_id || job.job_code} className="text-caption text-text-secondary">{job.job_code} - {job.job_name}</div>)
                            : <span className="text-caption text-text-quaternary">No sample jobs</span>
                          : <span className="text-caption text-text-quaternary">Refresh after selecting</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </AppModalShell>
    ) : null
  )
}

export default WorkflowSelectorModal