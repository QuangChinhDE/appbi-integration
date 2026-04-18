import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Eye, Link2, Search, Trash2, Zap } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import api from '@shared/api/client'
import ModuleOverview from '@packages/ui/src/components/common/ModuleOverview'
import PaginatedCollection from '@packages/ui/src/components/common/PaginatedCollection'
import PageListLayout from '@packages/ui/src/components/common/PageListLayout'
import { Alert, Button, FilterTag, IconButton, Select } from '@packages/ui/src/components/common/ui'
import AppLayout from '@packages/ui/src/components/layout/AppLayout'


const STATUS_FILTER_META = {
  ready: { tone: 'success', label: 'Ready' },
  planned: { tone: 'warning', label: 'Planned' },
}

const TRIGGER_FILTER_META = {
  with_triggers: { tone: 'info', label: 'Triggers' },
  no_triggers: { tone: 'neutral', label: 'Manual' },
}

const SAVED_FILTER_META = {
  saved: { tone: 'success', label: 'Bound' },
  empty: { tone: 'warning', label: 'Unbound' },
}

const SORT_OPTIONS = [
  { value: 'priority', label: 'Priority' },
  { value: 'bindings', label: 'Most bindings' },
  { value: 'coverage', label: 'Most coverage' },
  { value: 'name', label: 'Name A-Z' },
]

const TOKEN_LABELS = {
  apps: 'Apps registry',
  incoming_webhook: 'Incoming webhook',
}


function formatCount(value, singular, plural = `${singular}s`) {
  return `${value} ${value === 1 ? singular : plural}`
}


function formatToken(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return ''
  if (TOKEN_LABELS[normalized]) return TOKEN_LABELS[normalized]

  return normalized
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ')
}


function summarizeValues(values, { max = 3, empty = 'Not declared' } = {}) {
  const normalized = [...new Set((values || []).map(formatToken).filter(Boolean))]
  if (!normalized.length) return empty
  if (normalized.length <= max) return normalized.join(', ')
  return `${normalized.slice(0, max).join(', ')} +${normalized.length - max}`
}


function createSearchValues(parts) {
  return parts
    .flatMap((part) => (Array.isArray(part) ? part : [part]))
    .filter(Boolean)
    .map((value) => String(value))
}


function filterLabel(metaMap, key, fallback) {
  return metaMap[key]?.label || fallback
}


function getStatusRank(status) {
  return status === 'ready' ? 0 : 1
}


function getSavedRank(savedState) {
  return savedState === 'saved' ? 0 : 1
}


function compareText(left, right) {
  return String(left || '').localeCompare(String(right || ''))
}


function sortAutomationEntries(entries, sortKey) {
  const items = [...entries]

  items.sort((left, right) => {
    if (sortKey === 'bindings') {
      return (
        right.credentialCount - left.credentialCount
        || getStatusRank(left.status) - getStatusRank(right.status)
        || compareText(left.title, right.title)
      )
    }

    if (sortKey === 'coverage') {
      return (
        right.operationCount - left.operationCount
        || right.resourceCount - left.resourceCount
        || right.triggerCount - left.triggerCount
        || compareText(left.title, right.title)
      )
    }

    if (sortKey === 'name') {
      return compareText(left.title, right.title)
    }

    return (
      getStatusRank(left.status) - getStatusRank(right.status)
      || getSavedRank(left.savedState) - getSavedRank(right.savedState)
      || right.credentialCount - left.credentialCount
      || right.operationCount - left.operationCount
      || compareText(left.title, right.title)
    )
  })

  return items
}


function buildAutomationEntries(overview) {
  const connectors = Array.isArray(overview?.connectors) ? overview.connectors : []

  return connectors.map((item) => {
    const resources = Array.isArray(item.resources) ? item.resources : []
    const operations = Array.isArray(item.operations) ? item.operations : []
    const triggers = Array.isArray(item.triggers) ? item.triggers : []
    const resourceNames = resources.map((resource) => formatToken(resource.key))
    const operationNames = operations.map((operation) => formatToken(operation.key))
    const status = item.status || 'planned'
    const triggerState = triggers.length > 0 ? 'with_triggers' : 'no_triggers'
    const credentialCount = Number(item.credential_count || 0)
    const savedState = credentialCount > 0 ? 'saved' : 'empty'
    const operationCount = Number(item.operation_count || operations.length || 0)
    const triggerCount = Number(item.trigger_count || triggers.length || 0)
    const resourceCount = resources.length

    return {
      registryKey: item.key,
      key: item.key,
      title: item.app_name || item.app_id || item.key,
      appId: item.app_id || 'unknown',
      description: item.summary || 'Automation connector available in the shared registry.',
      bindingSource: item.binding_source || 'apps',
      status,
      statusLabel: filterLabel(STATUS_FILTER_META, status, formatToken(status)),
      triggerState,
      triggerLabel: filterLabel(TRIGGER_FILTER_META, triggerState, triggerCount > 0 ? 'Triggers' : 'Manual'),
      savedState,
      savedLabel: filterLabel(SAVED_FILTER_META, savedState, credentialCount > 0 ? 'Bound' : 'Unbound'),
      credentialCount,
      operationCount,
      triggerCount,
      resourceCount,
      resourceSummary: summarizeValues(resourceNames, { empty: 'No resources' }),
      operationPreview: summarizeValues(operationNames, { max: 3, empty: 'No operations' }),
      contractLabel: item.selection_label || 'Select a saved Apps credential before configuring automation.',
      notes: Array.isArray(item.notes) ? item.notes.filter(Boolean) : [],
      searchValues: createSearchValues([
        item.app_name,
        item.app_id,
        item.summary,
        item.selection_label,
        item.binding_source,
        item.notes,
        triggers,
        resourceNames,
        operationNames,
        status,
        triggerState,
        savedState,
        item.key,
        'automation',
      ]),
    }
  })
}


function CatalogEmptyState({ icon: Icon, title, description }) {
  return (
    <div className="rounded-xl border border-dashed border-[rgb(var(--border-line))] bg-surface-1 px-6 py-12 text-center">
      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-surface-2 text-text-quaternary">
        <Icon className="h-4 w-4" />
      </div>
      <h3 className="mt-4 text-caption font-emphasis text-text-primary">{title}</h3>
      <p className="mx-auto mt-2 max-w-xl text-tiny leading-6 text-text-tertiary">{description}</p>
    </div>
  )
}


function TitleButton({ children, onClick }) {
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


function AutomationFilterTags({ entry, filters, onToggleFilter }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <FilterTag
        tone={STATUS_FILTER_META[entry.status]?.tone || 'neutral'}
        active={filters.status === entry.status}
        onClick={() => onToggleFilter('status', entry.status)}
      >
        {entry.statusLabel}
      </FilterTag>
      <FilterTag
        tone={SAVED_FILTER_META[entry.savedState]?.tone || 'neutral'}
        active={filters.saved === entry.savedState}
        onClick={() => onToggleFilter('saved', entry.savedState)}
      >
        {entry.savedLabel}
      </FilterTag>
      <FilterTag
        tone={TRIGGER_FILTER_META[entry.triggerState]?.tone || 'neutral'}
        active={filters.trigger === entry.triggerState}
        onClick={() => onToggleFilter('trigger', entry.triggerState)}
      >
        {entry.triggerLabel}
      </FilterTag>
    </div>
  )
}


function AutomationBindingsCell({ entry }) {
  return (
    <div className="space-y-0.5">
      <div className="text-caption text-text-secondary">
        {formatCount(entry.credentialCount, 'binding')}
      </div>
      <div className="text-tiny text-text-tertiary">{entry.savedLabel}</div>
    </div>
  )
}


function AutomationCoverageCell({ entry }) {
  return (
    <div className="space-y-0.5">
      <div className="text-caption text-text-secondary">
        {formatCount(entry.resourceCount, 'resource')} / {formatCount(entry.operationCount, 'operation')}
      </div>
      <div className="text-tiny text-text-tertiary">
        {formatCount(entry.triggerCount, 'trigger')}
      </div>
    </div>
  )
}


function AutomationActionButtons({ entry, onOpenDetails, onOpenBindings }) {
  const canOpenBindings = entry.bindingSource === 'apps'

  return (
    <div className="flex items-center justify-end gap-1">
      {canOpenBindings && (
        <IconButton
          aria-label="Open bindings"
          variant="ghost"
          size="xs"
          onClick={() => onOpenBindings(entry)}
          title="Bindings"
          className="text-brand hover:bg-brand/10"
        >
          <Link2 className="h-3.5 w-3.5" />
        </IconButton>
      )}
      <IconButton
        aria-label="View details"
        variant="ghost"
        size="xs"
        onClick={() => onOpenDetails(entry)}
        title="Details"
      >
        <Eye className="h-3.5 w-3.5" />
      </IconButton>
      <IconButton
        aria-label="Delete unavailable"
        variant="ghost"
        size="xs"
        title="Catalog entries are read-only"
        disabled
      >
        <Trash2 className="h-3.5 w-3.5" />
      </IconButton>
    </div>
  )
}


function AutomationConnectorCard({ entry, filters, onToggleFilter, onOpenDetails, onOpenBindings }) {
  return (
    <div className="rounded-xl border border-[rgb(var(--border-line))] bg-surface-1 p-5 transition-[border-color,box-shadow] hover:border-brand/30 hover:shadow-linear-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
            <Zap className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <TitleButton onClick={() => onOpenDetails(entry)}>{entry.title}</TitleButton>
            <div className="mt-0.5 text-tiny text-text-tertiary">{entry.appId}</div>
            <p className="mt-1 line-clamp-2 text-tiny leading-6 text-text-tertiary">{entry.description}</p>
          </div>
        </div>
        <AutomationActionButtons
          entry={entry}
          onOpenDetails={onOpenDetails}
          onOpenBindings={onOpenBindings}
        />
      </div>

      <div className="mt-4">
        <AutomationFilterTags entry={entry} filters={filters} onToggleFilter={onToggleFilter} />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <div className="text-[10px] font-emphasis uppercase tracking-[0.14em] text-text-quaternary">Bindings</div>
          <div className="mt-1">
            <AutomationBindingsCell entry={entry} />
          </div>
        </div>
        <div>
          <div className="text-[10px] font-emphasis uppercase tracking-[0.14em] text-text-quaternary">Coverage</div>
          <div className="mt-1">
            <AutomationCoverageCell entry={entry} />
          </div>
        </div>
      </div>

      <div className="mt-4 border-t border-[rgb(var(--border-line))] pt-3">
        <p className="truncate text-tiny text-text-tertiary">
          Operations: <span className="text-text-secondary">{entry.operationPreview}</span>
        </p>
      </div>
    </div>
  )
}


function AutomationConnectorTable({ entries, filters, onToggleFilter, onOpenDetails, onOpenBindings }) {
  return (
    <div className="overflow-hidden rounded-xl border border-[rgb(var(--border-line))] bg-surface-1">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-[rgb(var(--border-line))]">
          <thead className="bg-surface-2">
            <tr>
              <th className="px-6 py-3 text-left text-tiny font-emphasis uppercase tracking-[0.14em] text-text-quaternary">
                Connector
              </th>
              <th className="px-6 py-3 text-left text-tiny font-emphasis uppercase tracking-[0.14em] text-text-quaternary">
                Tags
              </th>
              <th className="px-6 py-3 text-left text-tiny font-emphasis uppercase tracking-[0.14em] text-text-quaternary">
                Bindings
              </th>
              <th className="px-6 py-3 text-left text-tiny font-emphasis uppercase tracking-[0.14em] text-text-quaternary">
                Coverage
              </th>
              <th className="px-6 py-3 text-right text-tiny font-emphasis uppercase tracking-[0.14em] text-text-quaternary">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[rgb(var(--border-line))] bg-surface-1">
            {entries.map((entry) => (
              <tr key={entry.registryKey} className="hover:bg-surface-2">
                <td className="max-w-[320px] px-6 py-4">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand">
                      <Zap className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <TitleButton onClick={() => onOpenDetails(entry)}>{entry.title}</TitleButton>
                      <div className="mt-0.5 text-tiny text-text-tertiary">{entry.appId}</div>
                      <p className="mt-1 max-w-md line-clamp-1 text-tiny text-text-tertiary">{entry.description}</p>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <AutomationFilterTags entry={entry} filters={filters} onToggleFilter={onToggleFilter} />
                </td>
                <td className="px-6 py-4">
                  <AutomationBindingsCell entry={entry} />
                </td>
                <td className="px-6 py-4">
                  <AutomationCoverageCell entry={entry} />
                </td>
                <td className="whitespace-nowrap px-6 py-4 text-right">
                  <AutomationActionButtons
                    entry={entry}
                    onOpenDetails={onOpenDetails}
                    onOpenBindings={onOpenBindings}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}


const AutomationPage = () => {
  const navigate = useNavigate()
  const [overview, setOverview] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [listFilters, setListFilters] = useState({})
  const [sortKey, setSortKey] = useState('priority')

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      setLoading(true)
      setError('')
      try {
        const { data } = await api.get('/api/automation/overview')
        if (cancelled) return
        setOverview(data)
      } catch (err) {
        if (cancelled) return
        setError(err.response?.data?.detail || 'Failed to load automation module overview.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const entries = useMemo(() => buildAutomationEntries(overview), [overview])
  const connectorCountLabel = `${entries.length} automation connector${entries.length === 1 ? '' : 's'}`
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

  const openDetails = useCallback((entry) => {
    navigate(`/automation/${encodeURIComponent(entry.key)}`)
  }, [navigate])

  const openBindings = useCallback((entry) => {
    navigate(`/apps?appId=${encodeURIComponent(entry.appId)}`)
  }, [navigate])

  return (
    <AppLayout>
      <PageListLayout
        title="Automation"
        description={connectorCountLabel}
        isLoading={loading}
        loadingText="Loading automation workspace..."
        searchPlaceholder="Search connectors, resources, operations, or triggers"
        defaultView="list"
        overview={(
          <ModuleOverview
            icon={Zap}
            title="Automation contracts"
            description="Review reusable connectors, action contracts, and trigger hooks before builder and runtime workflows ship."
            badges={['Catalog', 'Apps-backed', 'Runtime pending']}
            stats={[
              {
                label: 'Connectors',
                value: String(overview?.connector_count || 0),
                helper: 'Connectors currently exposed to the automation catalog.',
              },
              {
                label: 'Operations',
                value: String(overview?.operation_count || 0),
                helper: 'Serializable actions ready for future automation steps.',
              },
              {
                label: 'Saved bindings',
                value: String(overview?.saved_binding_count || 0),
                helper: 'Credentials already reusable from Apps.',
              },
            ]}
          />
        )}
        toolbarExtra={(
          <div className="min-w-[160px]">
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
                tone={STATUS_FILTER_META[listFilters.status]?.tone || 'neutral'}
                active
                onClick={() => toggleListFilter('status', listFilters.status)}
              >
                {STATUS_FILTER_META[listFilters.status]?.label || formatToken(listFilters.status)}
              </FilterTag>
            )}
            {listFilters.saved && (
              <FilterTag
                tone={SAVED_FILTER_META[listFilters.saved]?.tone || 'neutral'}
                active
                onClick={() => toggleListFilter('saved', listFilters.saved)}
              >
                {SAVED_FILTER_META[listFilters.saved]?.label || formatToken(listFilters.saved)}
              </FilterTag>
            )}
            {listFilters.trigger && (
              <FilterTag
                tone={TRIGGER_FILTER_META[listFilters.trigger]?.tone || 'neutral'}
                active
                onClick={() => toggleListFilter('trigger', listFilters.trigger)}
              >
                {TRIGGER_FILTER_META[listFilters.trigger]?.label || formatToken(listFilters.trigger)}
              </FilterTag>
            )}
            <Button variant="ghost" size="xs" onClick={clearListFilters}>
              Clear filters
            </Button>
          </>
        ) : null}
      >
        {({ filterText, viewMode }) => {
          if (error) {
            return (
              <Alert
                type="error"
                message="Automation workspace unavailable"
                description={error}
              />
            )
          }

          const normalizedFilter = filterText.trim().toLowerCase()
          const filteredEntries = entries.filter((entry) => {
            const matchesSearch = (
              normalizedFilter.length === 0 ||
              entry.searchValues.some((value) => value.toLowerCase().includes(normalizedFilter))
            )

            return (
              matchesSearch &&
              (!listFilters.status || entry.status === listFilters.status) &&
              (!listFilters.trigger || entry.triggerState === listFilters.trigger) &&
              (!listFilters.saved || entry.savedState === listFilters.saved)
            )
          })
          const visibleEntries = sortAutomationEntries(filteredEntries, sortKey)

          if (entries.length === 0) {
            return (
              <CatalogEmptyState
                icon={Zap}
                title="No automation connectors available"
                description="This module is enabled, but no automation connector manifests are registered yet."
              />
            )
          }

          return (
            <PaginatedCollection
              items={visibleEntries}
              viewMode={viewMode}
              resetKey={JSON.stringify({ filterText, viewMode, listFilters, sortKey })}
            >
              {({ pageItems, pagination }) => (
                visibleEntries.length === 0 ? (
                  <CatalogEmptyState
                    icon={Search}
                    title="No automation connectors match"
                    description={normalizedFilter.length > 0
                      ? `No results for "${filterText}".`
                      : 'No connectors match the current filters.'}
                  />
                ) : (
                  <div className="space-y-6">
                    {viewMode === 'grid' ? (
                      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                        {pageItems.map((entry) => (
                          <AutomationConnectorCard
                            key={entry.registryKey}
                            entry={entry}
                            filters={listFilters}
                            onToggleFilter={toggleListFilter}
                            onOpenDetails={openDetails}
                            onOpenBindings={openBindings}
                          />
                        ))}
                      </div>
                    ) : (
                      <AutomationConnectorTable
                        entries={pageItems}
                        filters={listFilters}
                        onToggleFilter={toggleListFilter}
                        onOpenDetails={openDetails}
                        onOpenBindings={openBindings}
                      />
                    )}
                    {pagination}
                  </div>
                )
              )}
            </PaginatedCollection>
          )
        }}
      </PageListLayout>
    </AppLayout>
  )
}

export default AutomationPage
