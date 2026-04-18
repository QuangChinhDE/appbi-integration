import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Database, Eye, Link2, Search, Trash2, Workflow } from 'lucide-react'
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

const KIND_FILTER_META = {
  source: { tone: 'info', label: 'Source' },
  destination: { tone: 'brand', label: 'Destination' },
}

const BINDING_FILTER_META = {
  apps: { tone: 'brand', label: 'Apps' },
  planned: { tone: 'neutral', label: 'Planned' },
}

const SORT_OPTIONS = [
  { value: 'priority', label: 'Priority' },
  { value: 'bindings', label: 'Most bindings' },
  { value: 'kind', label: 'Kind' },
  { value: 'name', label: 'Name A-Z' },
]

const TOKEN_LABELS = {
  apps: 'Apps registry',
  google_oauth: 'Google OAuth',
  service_account: 'Service account',
  full_refresh: 'Full refresh',
  catalog_preview: 'Catalog preview',
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


function compareText(left, right) {
  return String(left || '').localeCompare(String(right || ''))
}


function getStatusRank(status) {
  return status === 'ready' ? 0 : 1
}


function getBindingRank(bindingSource) {
  return bindingSource === 'apps' ? 0 : 1
}


function getKindRank(kind) {
  return kind === 'source' ? 0 : 1
}


function sortPipelineEntries(entries, sortKey) {
  const items = [...entries]

  items.sort((left, right) => {
    if (sortKey === 'bindings') {
      return (
        right.credentialCount - left.credentialCount
        || getStatusRank(left.status) - getStatusRank(right.status)
        || compareText(left.title, right.title)
      )
    }

    if (sortKey === 'kind') {
      return (
        getKindRank(left.kind) - getKindRank(right.kind)
        || getStatusRank(left.status) - getStatusRank(right.status)
        || compareText(left.title, right.title)
      )
    }

    if (sortKey === 'name') {
      return compareText(left.title, right.title)
    }

    return (
      getStatusRank(left.status) - getStatusRank(right.status)
      || getBindingRank(left.bindingSource) - getBindingRank(right.bindingSource)
      || right.credentialCount - left.credentialCount
      || getKindRank(left.kind) - getKindRank(right.kind)
      || compareText(left.title, right.title)
    )
  })

  return items
}


function buildPipelineEntries(overview) {
  const sources = Array.isArray(overview?.sources) ? overview.sources : []
  const destinations = Array.isArray(overview?.destinations) ? overview.destinations : []

  const sourceEntries = sources.map((item) => {
    const status = item.status || 'planned'
    const bindingSource = item.binding_source || 'planned'
    const credentialCount = Number(item.credential_count || 0)

    return {
      registryKey: `source-${item.key}`,
      key: item.key,
      kind: 'source',
      kindLabel: filterLabel(KIND_FILTER_META, 'source', 'Source'),
      title: item.app_name || item.app_id || item.key,
      appId: item.app_id || 'unknown',
      description: item.summary || 'Source reader available in the shared registry.',
      status,
      statusLabel: filterLabel(STATUS_FILTER_META, status, formatToken(status)),
      bindingSource,
      bindingLabel: filterLabel(BINDING_FILTER_META, bindingSource, formatToken(bindingSource)),
      credentialCount,
      modeLabel: 'Modes',
      modeSummary: summarizeValues(item.sync_modes, { empty: 'Not declared' }),
      detailLabel: 'Discovery',
      detailValue: formatToken(item.discovery?.mode) || 'Not declared',
      contractLabel: item.selection_label || 'Select a saved Apps credential before discovery.',
      secondarySummary: item.discovery?.summary || '',
      notes: Array.isArray(item.notes) ? item.notes.filter(Boolean) : [],
      searchValues: createSearchValues([
        item.app_name,
        item.app_id,
        item.summary,
        item.selection_label,
        item.discovery?.summary,
        item.discovery?.mode,
        item.sync_modes,
        item.binding_fields,
        item.notes,
        status,
        bindingSource,
        item.key,
        'source',
      ]),
    }
  })

  const destinationEntries = destinations.map((item) => {
    const status = item.status || 'planned'
    const bindingSource = item.binding_source || 'planned'
    const credentialCount = Number(item.credential_count || 0)
    const notes = Array.isArray(item.notes) ? item.notes.filter(Boolean) : []

    return {
      registryKey: `destination-${item.key}`,
      key: item.key,
      kind: 'destination',
      kindLabel: filterLabel(KIND_FILTER_META, 'destination', 'Destination'),
      title: item.app_name || item.app_id || item.key,
      appId: item.app_id || 'unknown',
      description: item.summary || 'Destination writer available in the shared registry.',
      status,
      statusLabel: filterLabel(STATUS_FILTER_META, status, formatToken(status)),
      bindingSource,
      bindingLabel: filterLabel(BINDING_FILTER_META, bindingSource, formatToken(bindingSource)),
      credentialCount,
      modeLabel: 'Modes',
      modeSummary: summarizeValues(item.auth_modes, { empty: 'Not declared' }),
      detailLabel: 'Binding',
      detailValue: filterLabel(BINDING_FILTER_META, bindingSource, formatToken(bindingSource)),
      contractLabel: item.selection_label || 'Select a destination binding before runtime setup.',
      secondarySummary: notes[0] || '',
      notes,
      searchValues: createSearchValues([
        item.app_name,
        item.app_id,
        item.summary,
        item.selection_label,
        item.auth_modes,
        item.notes,
        status,
        bindingSource,
        item.key,
        'destination',
      ]),
    }
  })

  return [...sourceEntries, ...destinationEntries]
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


function PipelineFilterTags({ entry, filters, onToggleFilter }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <FilterTag
        tone={KIND_FILTER_META[entry.kind]?.tone || 'neutral'}
        active={filters.kind === entry.kind}
        onClick={() => onToggleFilter('kind', entry.kind)}
      >
        {entry.kindLabel}
      </FilterTag>
      <FilterTag
        tone={STATUS_FILTER_META[entry.status]?.tone || 'neutral'}
        active={filters.status === entry.status}
        onClick={() => onToggleFilter('status', entry.status)}
      >
        {entry.statusLabel}
      </FilterTag>
      <FilterTag
        tone={BINDING_FILTER_META[entry.bindingSource]?.tone || 'neutral'}
        active={filters.binding === entry.bindingSource}
        onClick={() => onToggleFilter('binding', entry.bindingSource)}
      >
        {entry.bindingLabel}
      </FilterTag>
    </div>
  )
}


function PipelineBindingsCell({ entry }) {
  return (
    <div className="space-y-0.5">
      <div className="text-caption text-text-secondary">
        {formatCount(entry.credentialCount, 'binding')}
      </div>
      <div className="text-tiny text-text-tertiary">{entry.bindingLabel}</div>
    </div>
  )
}


function PipelineCoverageCell({ entry }) {
  return (
    <div className="space-y-0.5">
      <div className="text-caption text-text-secondary">{entry.modeSummary}</div>
      <div className="text-tiny text-text-tertiary">
        {entry.detailLabel}: {entry.detailValue}
      </div>
    </div>
  )
}


function PipelineActionButtons({ entry, onOpenDetails, onOpenBindings }) {
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


function PipelineCapabilityCard({ entry, filters, onToggleFilter, onOpenDetails, onOpenBindings }) {
  const Icon = entry.kind === 'source' ? Workflow : Database
  const iconClassName = entry.kind === 'source' ? 'bg-info/10 text-info' : 'bg-brand/10 text-brand'

  return (
    <div className="rounded-xl border border-[rgb(var(--border-line))] bg-surface-1 p-5 transition-[border-color,box-shadow] hover:border-brand/30 hover:shadow-linear-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${iconClassName}`}>
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <TitleButton onClick={() => onOpenDetails(entry)}>{entry.title}</TitleButton>
            <div className="mt-0.5 text-tiny text-text-tertiary">{entry.appId}</div>
            <p className="mt-1 line-clamp-2 text-tiny leading-6 text-text-tertiary">{entry.description}</p>
          </div>
        </div>
        <PipelineActionButtons
          entry={entry}
          onOpenDetails={onOpenDetails}
          onOpenBindings={onOpenBindings}
        />
      </div>

      <div className="mt-4">
        <PipelineFilterTags entry={entry} filters={filters} onToggleFilter={onToggleFilter} />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <div className="text-[10px] font-emphasis uppercase tracking-[0.14em] text-text-quaternary">Bindings</div>
          <div className="mt-1">
            <PipelineBindingsCell entry={entry} />
          </div>
        </div>
        <div>
          <div className="text-[10px] font-emphasis uppercase tracking-[0.14em] text-text-quaternary">Coverage</div>
          <div className="mt-1">
            <PipelineCoverageCell entry={entry} />
          </div>
        </div>
      </div>

      <div className="mt-4 border-t border-[rgb(var(--border-line))] pt-3">
        <p className="truncate text-tiny text-text-tertiary">
          {entry.secondarySummary || entry.contractLabel}
        </p>
      </div>
    </div>
  )
}


function PipelineCapabilityTable({ entries, filters, onToggleFilter, onOpenDetails, onOpenBindings }) {
  return (
    <div className="overflow-hidden rounded-xl border border-[rgb(var(--border-line))] bg-surface-1">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-[rgb(var(--border-line))]">
          <thead className="bg-surface-2">
            <tr>
              <th className="px-6 py-3 text-left text-tiny font-emphasis uppercase tracking-[0.14em] text-text-quaternary">
                Capability
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
            {entries.map((entry) => {
              const Icon = entry.kind === 'source' ? Workflow : Database
              const iconClassName = entry.kind === 'source' ? 'bg-info/10 text-info' : 'bg-brand/10 text-brand'

              return (
                <tr key={entry.registryKey} className="hover:bg-surface-2">
                  <td className="max-w-[320px] px-6 py-4">
                    <div className="flex items-start gap-3">
                      <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${iconClassName}`}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <TitleButton onClick={() => onOpenDetails(entry)}>{entry.title}</TitleButton>
                        <div className="mt-0.5 text-tiny text-text-tertiary">{entry.appId}</div>
                        <p className="mt-1 max-w-md line-clamp-1 text-tiny text-text-tertiary">{entry.description}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <PipelineFilterTags entry={entry} filters={filters} onToggleFilter={onToggleFilter} />
                  </td>
                  <td className="px-6 py-4">
                    <PipelineBindingsCell entry={entry} />
                  </td>
                  <td className="px-6 py-4">
                    <PipelineCoverageCell entry={entry} />
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-right">
                    <PipelineActionButtons
                      entry={entry}
                      onOpenDetails={onOpenDetails}
                      onOpenBindings={onOpenBindings}
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


const PipelinePage = () => {
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
        const { data } = await api.get('/api/pipeline/overview')
        if (cancelled) return
        setOverview(data)
      } catch (err) {
        if (cancelled) return
        setError(err.response?.data?.detail || 'Failed to load pipeline module overview.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const entries = useMemo(() => buildPipelineEntries(overview), [overview])
  const totalSavedBindings = (overview?.source_credential_count || 0) + (overview?.destination_credential_count || 0)
  const capabilityCountLabel = `${entries.length} pipeline capabilit${entries.length === 1 ? 'y' : 'ies'}`
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
    navigate(`/pipeline/${entry.kind}/${encodeURIComponent(entry.key)}`)
  }, [navigate])

  const openBindings = useCallback((entry) => {
    navigate(`/apps?appId=${encodeURIComponent(entry.appId)}`)
  }, [navigate])

  return (
    <AppLayout>
      <PageListLayout
        title="Pipeline"
        description={capabilityCountLabel}
        overview={(
          <ModuleOverview
            icon={Workflow}
            title="Pipeline contracts"
            description="Review reusable source readers and destination writers before execution workflows ship."
            badges={['Catalog', 'Apps-backed', 'Execution pending']}
            stats={[
              {
                label: 'Sources',
                value: String(overview?.source_count || 0),
                helper: 'Reader contracts ready to bind through Apps.',
              },
              {
                label: 'Destinations',
                value: String(overview?.destination_count || 0),
                helper: 'Writer contracts available for future pipeline setup.',
              },
              {
                label: 'Saved bindings',
                value: String(totalSavedBindings),
                helper: 'Credentials already reusable from Apps.',
              },
            ]}
          />
        )}
        isLoading={loading}
        loadingText="Loading pipeline workspace..."
        searchPlaceholder="Search apps, modes, contracts, or status"
        defaultView="list"
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
            {listFilters.kind && (
              <FilterTag
                tone={KIND_FILTER_META[listFilters.kind]?.tone || 'neutral'}
                active
                onClick={() => toggleListFilter('kind', listFilters.kind)}
              >
                {KIND_FILTER_META[listFilters.kind]?.label || formatToken(listFilters.kind)}
              </FilterTag>
            )}
            {listFilters.status && (
              <FilterTag
                tone={STATUS_FILTER_META[listFilters.status]?.tone || 'neutral'}
                active
                onClick={() => toggleListFilter('status', listFilters.status)}
              >
                {STATUS_FILTER_META[listFilters.status]?.label || formatToken(listFilters.status)}
              </FilterTag>
            )}
            {listFilters.binding && (
              <FilterTag
                tone={BINDING_FILTER_META[listFilters.binding]?.tone || 'neutral'}
                active
                onClick={() => toggleListFilter('binding', listFilters.binding)}
              >
                {BINDING_FILTER_META[listFilters.binding]?.label || formatToken(listFilters.binding)}
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
                message="Pipeline workspace unavailable"
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
              (!listFilters.kind || entry.kind === listFilters.kind) &&
              (!listFilters.status || entry.status === listFilters.status) &&
              (!listFilters.binding || entry.bindingSource === listFilters.binding)
            )
          })
          const visibleEntries = sortPipelineEntries(filteredEntries, sortKey)

          if (entries.length === 0) {
            return (
              <CatalogEmptyState
                icon={Workflow}
                title="No pipeline contracts available"
                description="This module is enabled, but no source or destination contracts are registered yet."
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
                    title="No pipeline contracts match"
                    description={normalizedFilter.length > 0
                      ? `No results for "${filterText}".`
                      : 'No contracts match the current filters.'}
                  />
                ) : (
                  <div className="space-y-6">
                    {viewMode === 'grid' ? (
                      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                        {pageItems.map((entry) => (
                          <PipelineCapabilityCard
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
                      <PipelineCapabilityTable
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

export default PipelinePage
