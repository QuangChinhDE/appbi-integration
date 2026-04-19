import React from 'react'
import {
  ArrowRight, Eye, Pause, Play, Plus,
  Search, Trash2, Workflow,
} from 'lucide-react'

import { Button, FilterTag, IconButton } from '@packages/ui/src/components/common/ui'
import { getAppMeta } from '@modules/apps/frontend/constants'
import {
  PIPELINE_STATUS_VARIANT, PIPELINE_STATUS_LABEL,
  RUN_STATUS_VARIANT, RUN_STATUS_LABEL,
  formatDateLabel,
} from '../constants'


function formatDateTitle(value) {
  const parsed = new Date(value || '')
  if (Number.isNaN(parsed.getTime())) return ''
  return parsed.toLocaleString('en-GB', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  })
}


function PipelineTitleButton({ children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="truncate text-left text-caption font-emphasis text-text-primary transition-colors hover:text-brand"
    >
      {children}
    </button>
  )
}


function PipelineStatusTags({ record, activeFilters, onFilterClick }) {
  const statusVariant = PIPELINE_STATUS_VARIANT[record.status] || 'neutral'
  const bindingCount = (record.bindings || []).length
  const scheduleLabel = record.schedule?.type || 'manual'

  return (
    <div className="flex flex-wrap gap-1.5">
      <FilterTag
        tone={statusVariant}
        active={activeFilters?.status === record.status}
        onClick={() => onFilterClick?.('status', record.status)}
      >
        {PIPELINE_STATUS_LABEL[record.status] || record.status}
      </FilterTag>
      <FilterTag tone="neutral">
        {bindingCount} binding{bindingCount === 1 ? '' : 's'}
      </FilterTag>
      <FilterTag
        tone="neutral"
        active={activeFilters?.schedule === scheduleLabel}
        onClick={() => onFilterClick?.('schedule', scheduleLabel)}
      >
        {scheduleLabel}
      </FilterTag>
    </div>
  )
}


function PipelineSummaryBlock({ record }) {
  const srcMeta = getAppMeta(record.source_connector_key)
  const dstMeta = getAppMeta(record.dest_connector_key)
  const lastRunLabel = record.last_run_at ? formatDateLabel(record.last_run_at) : 'Never'

  return (
    <div className="mt-2 space-y-0.5 text-tiny text-text-tertiary">
      <div className="flex items-center gap-1">
        <span className="text-text-secondary">{srcMeta?.title || record.source_connector_key}</span>
        <ArrowRight className="h-3 w-3 text-text-quaternary" />
        <span className="text-text-secondary">{dstMeta?.title || record.dest_connector_key}</span>
      </div>
      <div>
        Last run: <span className="text-text-secondary">{lastRunLabel}</span>
      </div>
    </div>
  )
}


function PipelineActionButtons({ record, onOpenDetails, onDelete, onStatusChange }) {
  return (
    <div className="flex items-center justify-end gap-1">
      <IconButton aria-label="View details" variant="ghost" size="xs" onClick={() => onOpenDetails(record)} title="Details">
        <Eye className="h-3.5 w-3.5" />
      </IconButton>
      {record.status === 'draft' && (
        <IconButton
          aria-label="Activate"
          variant="ghost"
          size="xs"
          onClick={() => onStatusChange(record, 'active')}
          title="Activate"
          className="text-brand hover:bg-brand/10"
        >
          <Play className="h-3.5 w-3.5" />
        </IconButton>
      )}
      {record.status === 'active' && (
        <IconButton
          aria-label="Pause"
          variant="ghost"
          size="xs"
          onClick={() => onStatusChange(record, 'paused')}
          title="Pause"
          className="text-warning hover:bg-warning/10"
        >
          <Pause className="h-3.5 w-3.5" />
        </IconButton>
      )}
      {record.status === 'paused' && (
        <IconButton
          aria-label="Resume"
          variant="ghost"
          size="xs"
          onClick={() => onStatusChange(record, 'active')}
          title="Resume"
          className="text-brand hover:bg-brand/10"
        >
          <Play className="h-3.5 w-3.5" />
        </IconButton>
      )}
      <IconButton
        aria-label="Delete pipeline"
        variant="ghost"
        size="xs"
        onClick={() => onDelete(record)}
        title="Delete"
        className="text-danger hover:bg-danger/10"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </IconButton>
    </div>
  )
}


function PipelineListView({
  pipelines,
  hasPipelines,
  filterText,
  viewMode,
  activeFilters,
  onFilterClick,
  onCreatePipeline,
  onOpenDetails,
  onDelete,
  onStatusChange,
}) {
  const hasFilterText = filterText.trim().length > 0
  const hasActiveFilters = Boolean(
    activeFilters?.status || activeFilters?.schedule
  )

  if (!hasPipelines) {
    return (
      <div className="rounded-xl border border-dashed border-[rgb(var(--border-line))] bg-surface-1 px-6 py-14 text-center">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-surface-2 text-text-quaternary">
          <Workflow className="h-4 w-4" />
        </div>
        <h3 className="mt-4 text-caption font-emphasis text-text-primary">No pipelines yet</h3>
        <p className="mx-auto mt-2 max-w-md text-tiny leading-6 text-text-tertiary">
          Create your first data pipeline to sync data between apps.
        </p>
        <div className="mt-5 flex justify-center">
          <Button variant="primary" size="md" onClick={onCreatePipeline} leadingIcon={<Plus className="h-4 w-4" />}>
            New pipeline
          </Button>
        </div>
      </div>
    )
  }

  if (pipelines.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[rgb(var(--border-line))] bg-surface-1 px-6 py-12 text-center">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-surface-2 text-text-quaternary">
          <Search className="h-4 w-4" />
        </div>
        <h3 className="mt-4 text-caption font-emphasis text-text-primary">No pipelines match</h3>
        {hasFilterText ? (
          <p className="mt-2 text-tiny text-text-tertiary">
            No results for <span className="font-emphasis text-text-secondary">"{filterText}"</span>.
          </p>
        ) : hasActiveFilters ? (
          <p className="mt-2 text-tiny text-text-tertiary">No pipelines match the current filters.</p>
        ) : (
          <p className="mt-2 text-tiny text-text-tertiary">No pipelines are available in this view.</p>
        )}
      </div>
    )
  }

  if (viewMode === 'grid') {
    return (
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {pipelines.map((record) => {
          const srcMeta = getAppMeta(record.source_connector_key)
          const dstMeta = getAppMeta(record.dest_connector_key)

          return (
            <div key={record.id} className="rounded-xl border border-[rgb(var(--border-line))] bg-surface-1 p-5 transition-[border-color,box-shadow] hover:border-brand/30 hover:shadow-linear-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
                    <Workflow className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <PipelineTitleButton onClick={() => onOpenDetails(record)}>
                      {record.name || 'Untitled pipeline'}
                    </PipelineTitleButton>
                    <div className="mt-0.5 text-tiny text-text-tertiary">
                      {srcMeta?.title || record.source_connector_key} → {dstMeta?.title || record.dest_connector_key}
                    </div>
                    <PipelineSummaryBlock record={record} />
                  </div>
                </div>
                <PipelineActionButtons
                  record={record}
                  onOpenDetails={onOpenDetails}
                  onDelete={onDelete}
                  onStatusChange={onStatusChange}
                />
              </div>

              <div className="mt-4">
                <PipelineStatusTags record={record} activeFilters={activeFilters} onFilterClick={onFilterClick} />
              </div>

              <div className="mt-4 flex items-center justify-between gap-3 border-t border-[rgb(var(--border-line))] pt-3">
                <div className="min-w-0 text-tiny text-text-tertiary">
                  {(record.bindings || []).length} binding(s)
                </div>
                <span className="text-tiny text-text-tertiary" title={formatDateTitle(record.updated_at)}>
                  Updated {formatDateLabel(record.updated_at)}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  // Table view
  return (
    <div className="overflow-hidden rounded-xl border border-[rgb(var(--border-line))] bg-surface-1">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-[rgb(var(--border-line))]">
          <thead className="bg-surface-2">
            <tr>
              <th className="px-6 py-3 text-left text-tiny font-emphasis uppercase tracking-[0.14em] text-text-quaternary">Pipeline</th>
              <th className="px-6 py-3 text-left text-tiny font-emphasis uppercase tracking-[0.14em] text-text-quaternary">Tags</th>
              <th className="px-6 py-3 text-left text-tiny font-emphasis uppercase tracking-[0.14em] text-text-quaternary">Flow</th>
              <th className="px-6 py-3 text-left text-tiny font-emphasis uppercase tracking-[0.14em] text-text-quaternary">Updated</th>
              <th className="px-6 py-3 text-right text-tiny font-emphasis uppercase tracking-[0.14em] text-text-quaternary">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[rgb(var(--border-line))] bg-surface-1">
            {pipelines.map((record) => {
              const srcMeta = getAppMeta(record.source_connector_key)
              const dstMeta = getAppMeta(record.dest_connector_key)

              return (
                <tr key={record.id} className="hover:bg-surface-2">
                  <td className="max-w-[320px] px-6 py-4">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand">
                        <Workflow className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <PipelineTitleButton onClick={() => onOpenDetails(record)}>
                          {record.name || 'Untitled pipeline'}
                        </PipelineTitleButton>
                        {record.description && (
                          <p className="mt-0.5 max-w-md line-clamp-1 text-tiny text-text-tertiary">{record.description}</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <PipelineStatusTags record={record} activeFilters={activeFilters} onFilterClick={onFilterClick} />
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-1 text-caption text-text-secondary">
                      <span>{srcMeta?.title || record.source_connector_key}</span>
                      <ArrowRight className="h-3 w-3 text-text-quaternary" />
                      <span>{dstMeta?.title || record.dest_connector_key}</span>
                    </div>
                    <div className="mt-0.5 text-tiny text-text-tertiary">
                      {(record.bindings || []).length} binding(s)
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-caption text-text-tertiary" title={formatDateTitle(record.updated_at)}>
                      {formatDateLabel(record.updated_at)}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-right">
                    <PipelineActionButtons
                      record={record}
                      onOpenDetails={onOpenDetails}
                      onDelete={onDelete}
                      onStatusChange={onStatusChange}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default PipelineListView
