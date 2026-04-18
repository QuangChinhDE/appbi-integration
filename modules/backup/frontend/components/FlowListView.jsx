import React from 'react'
import {
  Plus, Eye, Pencil, Play, Rocket, Square, Trash2, Cloud, Search,
  Inbox, FolderKanban, Building2, Headphones, FileSpreadsheet, Globe, Loader2,
} from 'lucide-react'
import { Button, FilterTag, IconButton } from '@packages/ui/src/components/common/ui'
import { APP_META, BACKUP_TYPE_TAG } from '../constants'

const BACKUP_TYPE_TONE = {
  blue: 'info',
  orange: 'warning',
  purple: 'brand',
}

const APP_ICONS = {
  request:  <Inbox className="h-4 w-4" />,
  workflow: <FolderKanban className="h-4 w-4" />,
  wework:   <Building2 className="h-4 w-4" />,
  service:  <Headphones className="h-4 w-4" />,
}

const FlowListView = ({
  flows,
  hasFlows,
  filterText,
  viewMode,
  canEdit,
  canConfigure,
  configurationBlockedMessage,
  activeFilters,
  onFilterClick,
  onCreateDraft,
  onOpenDetails,
  onPublish,
  onEdit,
  onRun,
  onStop,
  onDelete,
  stoppingFlowId,
}) => {
  const hasFilterText = filterText.trim().length > 0
  const hasActiveFilters = Boolean(activeFilters?.state || activeFilters?.publish || activeFilters?.backupType)

  if (!hasFlows) {
    return (
      <div className="rounded-xl border border-dashed border-[rgb(var(--border-line))] bg-surface-1 px-6 py-14 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-brand/10 text-brand">
          <Cloud className="h-5 w-5" />
        </div>
        <h3 className="mt-4 text-small font-strong text-text-primary">No backup flows yet</h3>
        <p className="mx-auto mt-2 max-w-md text-caption text-text-tertiary">
          {canEdit
            ? (canConfigure ? 'Create your first draft flow.' : configurationBlockedMessage || 'Read-only access.')
            : 'No flows available.'}
        </p>
        {canConfigure && (
          <div className="mt-5 flex justify-center">
            <Button variant="primary" size="md" onClick={onCreateDraft} leadingIcon={<Plus className="h-4 w-4" />}>
              New flow
            </Button>
          </div>
        )}
      </div>
    )
  }

  if (flows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[rgb(var(--border-line))] bg-surface-1 px-6 py-12 text-center">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-surface-2 text-text-quaternary">
          <Search className="h-4 w-4" />
        </div>
        <h3 className="mt-4 text-caption font-strong text-text-primary">No flows match</h3>
        {hasFilterText ? (
          <p className="mt-2 text-tiny text-text-tertiary">
            No results for <span className="font-emphasis text-text-secondary">"{filterText}"</span>.
          </p>
        ) : hasActiveFilters ? (
          <p className="mt-2 text-tiny text-text-tertiary">
            No flows match the current filters.
          </p>
        ) : (
          <p className="mt-2 text-tiny text-text-tertiary">
            No flows are available in this view.
          </p>
        )}
      </div>
    )
  }

  const renderStatusTags = (record) => {
    const bt = BACKUP_TYPE_TAG[record.backup_type]
    const stateValue = record.is_draft === 1 ? 'draft' : 'ready'
    const publishValue = record.is_published === 1 ? 'published' : 'unpublished'
    return (
      <>
        <FilterTag
          tone={record.is_draft === 1 ? 'warning' : 'info'}
          active={activeFilters?.state === stateValue}
          onClick={() => onFilterClick?.('state', stateValue)}
        >
          {record.is_draft === 1 ? 'Draft' : 'Ready'}
        </FilterTag>
        <FilterTag
          tone={record.is_published === 1 ? 'success' : 'neutral'}
          active={activeFilters?.publish === publishValue}
          onClick={() => onFilterClick?.('publish', publishValue)}
        >
          {record.is_published === 1 ? 'Published' : 'Unpublished'}
        </FilterTag>
        {bt && (
          <FilterTag
            tone={BACKUP_TYPE_TONE[bt.color] || 'neutral'}
            active={activeFilters?.backupType === record.backup_type}
            onClick={() => onFilterClick?.('backupType', record.backup_type)}
          >
            {bt.label}
          </FilterTag>
        )}
      </>
    )
  }

  const renderActions = (record) => {
    const supportsRun = ['request', 'service', 'workflow', 'wework'].includes(record.app)
    const hasActiveRun = ['pending', 'running'].includes(record.last_run_status)
    const isStopping = stoppingFlowId === record.id
    return (
      <div className="flex items-center justify-end gap-1">
        <IconButton aria-label="View details" variant="ghost" size="xs" onClick={() => onOpenDetails(record)} title="Details">
          <Eye className="h-3.5 w-3.5" />
        </IconButton>
        {canEdit && record.is_published === 0 && (
          <IconButton aria-label="Publish flow" variant="ghost" size="xs" onClick={() => onPublish(record)} title="Publish" className="text-brand hover:bg-brand/10">
            <Rocket className="h-3.5 w-3.5" />
          </IconButton>
        )}
        {canConfigure && (
          <IconButton aria-label="Edit flow" variant="ghost" size="xs" onClick={() => onEdit(record)} title="Edit">
            <Pencil className="h-3.5 w-3.5" />
          </IconButton>
        )}
        {canEdit && record.is_published === 1 && supportsRun && hasActiveRun ? (
          <IconButton
            aria-label="Stop run"
            variant="ghost"
            size="xs"
            onClick={() => onStop(record)}
            disabled={isStopping}
            title={isStopping ? 'Stopping…' : 'Stop'}
            className="text-danger hover:bg-danger/10"
          >
            {isStopping ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
          </IconButton>
        ) : canEdit && record.is_published === 1 && supportsRun && (
          <IconButton
            aria-label="Run now"
            variant="ghost"
            size="xs"
            onClick={() => onRun(record)}
            disabled={Boolean(record.run_blocked_reason)}
            title={record.run_blocked_reason || 'Run'}
            className="text-brand hover:bg-brand/10"
          >
            <Play className="h-3.5 w-3.5" />
          </IconButton>
        )}
        {canEdit && (
          <IconButton aria-label="Delete flow" variant="ghost" size="xs" onClick={() => onDelete(record)} title="Delete" className="text-danger hover:bg-danger/10">
            <Trash2 className="h-3.5 w-3.5" />
          </IconButton>
        )}
      </div>
    )
  }

  if (viewMode === 'grid') {
    return (
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {flows.map((record) => {
          const meta = APP_META[record.app] || { color: '#64748b' }
          const icon = APP_ICONS[record.app] || <Cloud className="h-4 w-4" />
          return (
            <div key={record.id} className="rounded-xl border border-[rgb(var(--border-line))] bg-surface-1 p-5 transition-all hover:border-brand/30 hover:shadow-linear-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: `${meta.color}18`, color: meta.color }}>
                    {icon}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-caption font-strong text-text-primary">{record.name || 'Untitled draft'}</div>
                    <div className="mt-0.5 text-tiny text-text-tertiary">{record.app_name || record.app || 'Unknown'}</div>
                  </div>
                </div>
                {renderActions(record)}
              </div>

              <div className="mt-4 flex flex-wrap gap-1.5">
                {renderStatusTags(record)}
              </div>

              <div className="mt-4 space-y-1.5 text-caption text-text-tertiary">
                <div>Destination: <span className="text-text-secondary">{record.destination_name || 'Not set'}</span></div>
                <div>Last run: <span className="text-text-secondary">{record.last_run_at || 'Never'}</span></div>
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-[rgb(var(--border-line))] bg-surface-1">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-[rgb(var(--border-line))]">
          <thead className="bg-surface-2">
            <tr>
              <th className="px-6 py-3 text-left text-tiny font-emphasis uppercase tracking-[0.14em] text-text-quaternary">App / Flow</th>
              <th className="px-6 py-3 text-left text-tiny font-emphasis uppercase tracking-[0.14em] text-text-quaternary">Status</th>
              <th className="px-6 py-3 text-left text-tiny font-emphasis uppercase tracking-[0.14em] text-text-quaternary">Destination</th>
              <th className="px-6 py-3 text-left text-tiny font-emphasis uppercase tracking-[0.14em] text-text-quaternary">Last run</th>
              <th className="px-6 py-3 text-right text-tiny font-emphasis uppercase tracking-[0.14em] text-text-quaternary">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[rgb(var(--border-line))]">
            {flows.map((record) => {
              const meta = APP_META[record.app] || { color: '#64748b' }
              const icon = APP_ICONS[record.app] || <Cloud className="h-4 w-4" />
              return (
                <tr key={record.id} className="hover:bg-surface-2">
                  <td className="px-6 py-4">
                    <button
                      type="button"
                      onClick={() => onOpenDetails(record)}
                      className="flex items-center gap-3 text-left"
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md" style={{ backgroundColor: `${meta.color}18`, color: meta.color }}>
                        {icon}
                      </div>
                      <div className="min-w-0">
                        <div className="text-caption font-emphasis text-text-primary transition-colors hover:text-brand">
                          {record.name || 'Untitled draft'}
                        </div>
                        <div className="text-tiny text-text-tertiary">{record.app_name || record.app || '—'}</div>
                      </div>
                    </button>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap gap-1.5">
                      {renderStatusTags(record)}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-caption">
                    {record.destination_name ? (
                      <div className="flex items-center gap-1.5 text-text-secondary">
                        {record.destination_type === 'gsheets'
                          ? <FileSpreadsheet className="h-4 w-4 text-success" />
                          : <Globe className="h-4 w-4 text-info" />}
                        <span>{record.destination_name}</span>
                      </div>
                    ) : <span className="text-text-quaternary">—</span>}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-tiny text-text-tertiary">
                    {record.last_run_at || 'Never'}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-right">
                    {renderActions(record)}
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

export default FlowListView
