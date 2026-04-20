import React from 'react'
import {
  Building2,
  Cloud,
  Eye,
  FolderKanban,
  Headphones,
  Inbox,
  Loader2,
  Pencil,
  Play,
  Plus,
  Rocket,
  Search,
  Share2,
  Square,
  Trash2,
} from 'lucide-react'

import { Button, FilterTag, IconButton } from '@packages/ui/src/components/common/ui'
import OwnerBadge from '@packages/ui/src/components/common/OwnerBadge'
import { getListAccessMeta, getResourcePermissions } from '@modules/identity/frontend/lib/resourcePermissions'

import { APP_META, BACKUP_TYPE_TAG } from '../constants'


const BACKUP_TYPE_TONE = {
  blue: 'info',
  orange: 'warning',
  purple: 'brand',
}

const APP_ICONS = {
  request: <Inbox className="h-4 w-4" />,
  workflow: <FolderKanban className="h-4 w-4" />,
  wework: <Building2 className="h-4 w-4" />,
  service: <Headphones className="h-4 w-4" />,
}


function formatDateLabel(value) {
  const parsed = new Date(value || '')
  if (Number.isNaN(parsed.getTime())) return '-'
  return parsed.toLocaleDateString('en-GB')
}


function formatDateTitle(value) {
  const parsed = new Date(value || '')
  if (Number.isNaN(parsed.getTime())) return ''
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


function FlowTitleButton({ children, onClick }) {
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


function FlowStatusTags({ record, activeFilters, onFilterClick }) {
  const accessMeta = getListAccessMeta(record.user_permission)
  const backupTypeMeta = BACKUP_TYPE_TAG[record.backup_type]
  const stateValue = record.is_draft === 1 ? 'draft' : 'ready'
  const publishValue = record.is_published === 1 ? 'published' : 'unpublished'

  return (
    <div className="flex flex-wrap gap-1.5">
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
      {backupTypeMeta && (
        <FilterTag
          tone={BACKUP_TYPE_TONE[backupTypeMeta.color] || 'neutral'}
          active={activeFilters?.backupType === record.backup_type}
          onClick={() => onFilterClick?.('backupType', record.backup_type)}
        >
          {backupTypeMeta.label}
        </FilterTag>
      )}
      <FilterTag
        tone={accessMeta.tone}
        active={activeFilters?.access === record.user_permission}
        onClick={() => onFilterClick?.('access', record.user_permission)}
      >
        {accessMeta.label}
      </FilterTag>
    </div>
  )
}


function FlowOwnerCell({ record, activeFilters, onFilterClick }) {
  if (!record.owner_email) {
    return <span className="text-tiny text-text-quaternary">-</span>
  }

  return (
    <OwnerBadge
      email={record.owner_email}
      active={activeFilters?.owner === record.owner_email}
      onClick={() => onFilterClick?.('owner', record.owner_email)}
    />
  )
}


function FlowActionButtons({
  record,
  canConfigure,
  configurationBlockedMessage,
  onOpenDetails,
  onPublish,
  onEdit,
  onRun,
  onStop,
  onDelete,
  onShare,
  stoppingFlowId,
}) {
  const perms = getResourcePermissions(record.user_permission)
  const supportsRun = ['request', 'service', 'workflow', 'wework'].includes(record.app)
  const hasActiveRun = ['pending', 'running'].includes(record.last_run_status)
  const isStopping = stoppingFlowId === record.id

  return (
    <div className="flex items-center justify-end gap-1">
      <IconButton aria-label="View details" variant="ghost" size="xs" onClick={() => onOpenDetails(record)} title="Details">
        <Eye className="h-3.5 w-3.5" />
      </IconButton>
      {perms.canShare && (
        <IconButton aria-label="Share flow" variant="ghost" size="xs" onClick={() => onShare(record)} title="Share">
          <Share2 className="h-3.5 w-3.5" />
        </IconButton>
      )}
      {perms.canEdit && record.is_published === 0 && (
        <IconButton
          aria-label="Publish flow"
          variant="ghost"
          size="xs"
          onClick={() => onPublish(record)}
          title="Publish"
          className="text-brand hover:bg-brand/10"
        >
          <Rocket className="h-3.5 w-3.5" />
        </IconButton>
      )}
      {perms.canEdit && (
        <IconButton
          aria-label="Edit flow"
          variant="ghost"
          size="xs"
          onClick={() => onEdit(record)}
          title={canConfigure ? 'Edit' : configurationBlockedMessage || 'Edit'}
          disabled={!canConfigure}
        >
          <Pencil className="h-3.5 w-3.5" />
        </IconButton>
      )}
      {perms.canEdit && record.is_published === 1 && supportsRun && hasActiveRun ? (
        <IconButton
          aria-label="Stop run"
          variant="ghost"
          size="xs"
          onClick={() => onStop(record)}
          disabled={isStopping}
          title={isStopping ? 'Stopping...' : 'Stop'}
          className="text-danger hover:bg-danger/10"
        >
          {isStopping ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
        </IconButton>
      ) : perms.canEdit && record.is_published === 1 && supportsRun && (
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
      {perms.canDelete && (
        <IconButton
          aria-label="Delete flow"
          variant="ghost"
          size="xs"
          onClick={() => onDelete(record)}
          title="Delete"
          className="text-danger hover:bg-danger/10"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </IconButton>
      )}
    </div>
  )
}


function FlowSummaryBlock({ record }) {
  const lastRunLabel = record.last_run_at ? formatDateLabel(record.last_run_at) : 'Never'

  return (
    <div className="mt-2 space-y-0.5 text-tiny text-text-tertiary">
      <div>
        Destination: <span className="text-text-secondary">{record.destination_name || 'Not set'}</span>
      </div>
      <div>
        Last run: <span className="text-text-secondary">{lastRunLabel}</span>
      </div>
      {record.run_blocked_reason && (
        <div className="text-warning">{record.run_blocked_reason}</div>
      )}
    </div>
  )
}


function shouldIgnoreOpenDetails(event) {
  const target = event.target
  return Boolean(target instanceof Element && target.closest('button, a, input, label, [role="button"], [data-no-open-details="true"]'))
}


function FlowListView({
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
  onShare,
  stoppingFlowId,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
}) {
  const hasFilterText = filterText.trim().length > 0
  const hasActiveFilters = Boolean(
    activeFilters?.state
    || activeFilters?.publish
    || activeFilters?.backupType
    || activeFilters?.owner
    || activeFilters?.access
  )
  const selectable = Boolean(onToggleSelect)

  if (!hasFlows) {
    return (
      <div className="rounded-xl border border-dashed border-[rgb(var(--border-line))] bg-surface-1 px-6 py-14 text-center">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-surface-2 text-text-quaternary">
          <Cloud className="h-4 w-4" />
        </div>
        <h3 className="mt-4 text-caption font-emphasis text-text-primary">No backup flows yet</h3>
        <p className="mx-auto mt-2 max-w-md text-tiny leading-6 text-text-tertiary">
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
        <h3 className="mt-4 text-caption font-emphasis text-text-primary">No flows match</h3>
        {hasFilterText ? (
          <p className="mt-2 text-tiny text-text-tertiary">
            No results for <span className="font-emphasis text-text-secondary">"{filterText}"</span>.
          </p>
        ) : hasActiveFilters ? (
          <p className="mt-2 text-tiny text-text-tertiary">No flows match the current filters.</p>
        ) : (
          <p className="mt-2 text-tiny text-text-tertiary">No flows are available in this view.</p>
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
            <div
              key={record.id}
              onClick={(event) => {
                if (shouldIgnoreOpenDetails(event)) return
                onOpenDetails(record)
              }}
              className="cursor-pointer rounded-xl border border-[rgb(var(--border-line))] bg-surface-1 p-5 transition-[border-color,box-shadow] hover:border-brand/30 hover:shadow-linear-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <div
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                    style={{ backgroundColor: `${meta.color}18`, color: meta.color }}
                  >
                    {icon}
                  </div>
                  <div className="min-w-0">
                    <FlowTitleButton onClick={() => onOpenDetails(record)}>
                      {record.name || 'Untitled draft'}
                    </FlowTitleButton>
                    <div className="mt-0.5 text-tiny text-text-tertiary">{record.app_name || record.app || 'Unknown'}</div>
                    <FlowSummaryBlock record={record} />
                  </div>
                </div>
                <FlowActionButtons
                  record={record}
                  canConfigure={canConfigure}
                  configurationBlockedMessage={configurationBlockedMessage}
                  onOpenDetails={onOpenDetails}
                  onPublish={onPublish}
                  onEdit={onEdit}
                  onRun={onRun}
                  onStop={onStop}
                  onDelete={onDelete}
                  onShare={onShare}
                  stoppingFlowId={stoppingFlowId}
                />
              </div>

              <div className="mt-4">
                <FlowStatusTags record={record} activeFilters={activeFilters} onFilterClick={onFilterClick} />
              </div>

              <div className="mt-4 flex items-center justify-between gap-3 border-t border-[rgb(var(--border-line))] pt-3">
                <div className="min-w-0">
                  <FlowOwnerCell record={record} activeFilters={activeFilters} onFilterClick={onFilterClick} />
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

  return (
    <div className="overflow-hidden rounded-xl border border-[rgb(var(--border-line))] bg-surface-1">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-[rgb(var(--border-line))]">
          <thead className="bg-surface-2">
            <tr>
              {selectable && (() => {
                const selectableIds = flows
                  .filter((record) => getResourcePermissions(record.user_permission).canDelete)
                  .map((record) => record.id)
                const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds?.has(id))
                const someSelected = selectableIds.some((id) => selectedIds?.has(id))

                return (
                  <th className="w-10 px-3 py-3">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={(element) => {
                        if (element) element.indeterminate = someSelected && !allSelected
                      }}
                      onChange={() => onToggleSelectAll?.(selectableIds)}
                      className="h-3.5 w-3.5 rounded accent-[rgb(var(--brand))] cursor-pointer"
                    />
                  </th>
                )
              })()}
              <th className="px-6 py-3 text-left text-tiny font-emphasis uppercase tracking-[0.14em] text-text-quaternary">
                Flow
              </th>
              <th className="px-6 py-3 text-left text-tiny font-emphasis uppercase tracking-[0.14em] text-text-quaternary">
                Tags
              </th>
              <th className="px-6 py-3 text-left text-tiny font-emphasis uppercase tracking-[0.14em] text-text-quaternary">
                Owner
              </th>
              <th className="px-6 py-3 text-left text-tiny font-emphasis uppercase tracking-[0.14em] text-text-quaternary">
                Updated
              </th>
              <th className="px-6 py-3 text-right text-tiny font-emphasis uppercase tracking-[0.14em] text-text-quaternary">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[rgb(var(--border-line))] bg-surface-1">
            {flows.map((record) => {
              const meta = APP_META[record.app] || { color: '#64748b' }
              const icon = APP_ICONS[record.app] || <Cloud className="h-4 w-4" />
              const canDelete = getResourcePermissions(record.user_permission).canDelete

              return (
                <tr
                  key={record.id}
                  onClick={(event) => {
                    if (shouldIgnoreOpenDetails(event)) return
                    onOpenDetails(record)
                  }}
                  className="cursor-pointer hover:bg-surface-2"
                >
                  {selectable && (
                    <td className="w-10 px-3 py-4">
                      <input
                        type="checkbox"
                        checked={selectedIds?.has(record.id) ?? false}
                        onChange={() => onToggleSelect?.(record.id)}
                        disabled={!canDelete}
                        className="h-3.5 w-3.5 rounded accent-[rgb(var(--brand))] cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                      />
                    </td>
                  )}
                  <td className="max-w-[360px] px-6 py-4">
                    <div className="flex items-start gap-3">
                      <div
                        className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md"
                        style={{ backgroundColor: `${meta.color}18`, color: meta.color }}
                      >
                        {icon}
                      </div>
                      <div className="min-w-0">
                        <FlowTitleButton onClick={() => onOpenDetails(record)}>
                          {record.name || 'Untitled draft'}
                        </FlowTitleButton>
                        <div className="mt-0.5 text-tiny text-text-tertiary">{record.app_name || record.app || 'Unknown'}</div>
                        <FlowSummaryBlock record={record} />
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <FlowStatusTags record={record} activeFilters={activeFilters} onFilterClick={onFilterClick} />
                  </td>
                  <td className="whitespace-nowrap px-6 py-4">
                    <FlowOwnerCell record={record} activeFilters={activeFilters} onFilterClick={onFilterClick} />
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-caption text-text-tertiary" title={formatDateTitle(record.updated_at)}>
                    {formatDateLabel(record.updated_at)}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-right">
                    <FlowActionButtons
                      record={record}
                      canConfigure={canConfigure}
                      configurationBlockedMessage={configurationBlockedMessage}
                      onOpenDetails={onOpenDetails}
                      onPublish={onPublish}
                      onEdit={onEdit}
                      onRun={onRun}
                      onStop={onStop}
                      onDelete={onDelete}
                      onShare={onShare}
                      stoppingFlowId={stoppingFlowId}
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

export default FlowListView
