import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Database, Pencil, Plus, Search, Share2, Trash2 } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'

import api from '@shared/api/client'
import { APPS, DESTINATION_OPTIONS } from '@modules/backup/frontend/constants'
import ShareDialog from '@modules/identity/frontend/components/ShareDialog'
import { hasPermission } from '@modules/identity/frontend/lib/permissions'
import { getListAccessMeta, getResourcePermissions } from '@modules/identity/frontend/lib/resourcePermissions'
import { useAuthStore } from '@modules/identity/frontend/store/authStore'
import BulkActionBar from '@packages/ui/src/components/common/BulkActionBar'
import ConfirmDialog from '@packages/ui/src/components/common/ConfirmDialog'
import OwnerBadge from '@packages/ui/src/components/common/OwnerBadge'
import PageListLayout from '@packages/ui/src/components/common/PageListLayout'
import { Button, FilterTag, IconButton, Select, message } from '@packages/ui/src/components/common/ui'
import AppLayout from '@packages/ui/src/components/layout/AppLayout'

import CredentialModal from '@modules/apps/frontend/components/CredentialModal'


const GOOGLE_APP_IDS = new Set(['gdrive', 'gsheets'])
const APP_CREDENTIAL_RESOURCE_TYPE = 'app_credential'

const ROLE_FILTER_META = {
  source: { label: 'Source', tone: 'info' },
  destination: { label: 'Destination', tone: 'brand' },
}

const SORT_OPTIONS = [
  { value: 'updated', label: 'Recently updated' },
  { value: 'name', label: 'Name A-Z' },
  { value: 'app', label: 'App' },
  { value: 'owner', label: 'Owner' },
]


function resolveAppFilterLabel(appId) {
  if (!appId) return ''
  const destinationOption = DESTINATION_OPTIONS.find((item) => item.id === appId)
  if (destinationOption?.title) return destinationOption.title
  return APPS[appId]?.name || appId
}


function compareText(left, right) {
  return String(left || '').localeCompare(String(right || ''))
}


function getDateValue(value) {
  const parsed = new Date(value || '')
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime()
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


function sortCredentialEntries(entries, sortKey) {
  const items = [...entries]

  items.sort((left, right) => {
    if (sortKey === 'name') {
      return compareText(left.title, right.title)
    }

    if (sortKey === 'app') {
      return compareText(left.appTitle, right.appTitle) || compareText(left.title, right.title)
    }

    if (sortKey === 'owner') {
      return compareText(left.ownerEmail, right.ownerEmail) || compareText(left.title, right.title)
    }

    return getDateValue(right.updatedAt) - getDateValue(left.updatedAt) || compareText(left.title, right.title)
  })

  return items
}


function normalizeCredentialEntry(credential) {
  const preview = credential.preview || {}
  const isGoogle = GOOGLE_APP_IDS.has(credential.app_id)
  const appMeta = APPS[credential.app_id]
  const destinationOption = DESTINATION_OPTIONS.find((item) => item.id === credential.app_id)
  const roleKey = isGoogle ? 'destination' : 'source'
  const roleMeta = ROLE_FILTER_META[roleKey]

  const appTitle = isGoogle
    ? (destinationOption?.title || credential.app_name || credential.app_id)
    : (credential.app_name || appMeta?.name || credential.app_id)
  const color = isGoogle ? (destinationOption?.color || '#64748b') : (appMeta?.color || '#64748b')
  const icon = isGoogle
    ? (destinationOption?.icon || <Database className="h-4 w-4" />)
    : (appMeta?.icon || <Database className="h-4 w-4" />)
  const permissions = getResourcePermissions(credential.user_permission)
  const accessMeta = getListAccessMeta(credential.user_permission)

  if (!isGoogle) {
    return {
      registryKey: `credential-${credential.id}`,
      id: String(credential.id),
      appId: credential.app_id,
      isGoogle: false,
      title: credential.name,
      description: credential.description || '',
      appTitle,
      icon,
      color,
      roleKey,
      roleLabel: roleMeta.label,
      roleTone: roleMeta.tone,
      authLabel: null,
      ownerEmail: credential.owner_email || null,
      userPermission: credential.user_permission || 'none',
      permissions,
      accessMeta,
      primaryMetaLabel: 'Domain',
      primaryMetaValue: preview.domain || 'Not set',
      secondaryMetaLabel: null,
      secondaryMetaValue: null,
      updatedAt: credential.updated_at,
      searchValues: [
        credential.name,
        credential.description,
        credential.app_name,
        credential.app_id,
        preview.domain,
        credential.owner_email,
        credential.user_permission,
        roleKey,
      ],
    }
  }

  const authLabel = credential.auth_mode === 'service_account' ? 'Service account' : 'Google OAuth'
  const locationBits = [preview.folder_name, preview.drive_name].filter(Boolean)
  const connectionLabel = preview.display_name || preview.email || null

  return {
    registryKey: `credential-${credential.id}`,
    id: String(credential.id),
    appId: credential.app_id,
    isGoogle: true,
    title: credential.name,
    description: credential.description || '',
    appTitle,
    icon,
    color,
    roleKey,
    roleLabel: roleMeta.label,
    roleTone: roleMeta.tone,
    authLabel,
    ownerEmail: credential.owner_email || null,
    userPermission: credential.user_permission || 'none',
    permissions,
    accessMeta,
    primaryMetaLabel: 'Connection',
    primaryMetaValue: connectionLabel || appTitle,
    secondaryMetaLabel: locationBits.length > 0 ? 'Location' : 'Auth',
    secondaryMetaValue: locationBits.length > 0 ? locationBits.join(', ') : authLabel,
    updatedAt: credential.updated_at,
    searchValues: [
      credential.name,
      credential.description,
      credential.app_name,
      credential.app_id,
      connectionLabel,
      preview.folder_name,
      preview.drive_name,
      authLabel,
      credential.owner_email,
      credential.user_permission,
      roleKey,
    ],
  }
}


function RegistryEmptyState({ icon: Icon, title, description, action = null }) {
  return (
    <div className="rounded-xl border border-dashed border-[rgb(var(--border-line))] bg-surface-1 px-6 py-12 text-center">
      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-surface-2 text-text-quaternary">
        <Icon className="h-4 w-4" />
      </div>
      <h3 className="mt-4 text-caption font-emphasis text-text-primary">{title}</h3>
      <p className="mx-auto mt-2 max-w-xl text-tiny leading-6 text-text-tertiary">{description}</p>
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  )
}


function CredentialFilterTags({ entry, filters, queryAppId, onToggleFilter }) {
  const appTagActive = queryAppId === entry.appId || filters.app === entry.appId
  const appTagStatic = queryAppId === entry.appId

  return (
    <div className="flex flex-wrap gap-1.5">
      <FilterTag
        tone={entry.isGoogle ? 'brand' : 'info'}
        active={appTagActive}
        {...(appTagStatic
          ? { as: 'span' }
          : { onClick: () => onToggleFilter?.('app', entry.appId) })}
      >
        {entry.appTitle}
      </FilterTag>
      <FilterTag
        tone={entry.roleTone}
        active={filters.role === entry.roleKey}
        onClick={() => onToggleFilter?.('role', entry.roleKey)}
      >
        {entry.roleLabel}
      </FilterTag>
      <FilterTag
        tone={entry.accessMeta.tone}
        active={filters.access === entry.userPermission}
        onClick={() => onToggleFilter?.('access', entry.userPermission)}
      >
        {entry.accessMeta.label}
      </FilterTag>
    </div>
  )
}


function CredentialActionButtons({ entry, onEdit, onDelete, onShare }) {
  return (
    <div className="flex items-center justify-end gap-1">
      {entry.permissions.canShare && (
        <IconButton
          aria-label="Share credential"
          variant="ghost"
          size="xs"
          onClick={() => onShare(entry)}
          title="Share"
        >
          <Share2 className="h-3.5 w-3.5" />
        </IconButton>
      )}
      {entry.permissions.canEdit && (
        <IconButton
          aria-label="Edit credential"
          variant="ghost"
          size="xs"
          onClick={() => onEdit(entry)}
          title="Edit"
        >
          <Pencil className="h-3.5 w-3.5" />
        </IconButton>
      )}
      {entry.permissions.canDelete && (
        <IconButton
          aria-label="Delete credential"
          variant="ghost"
          size="xs"
          onClick={() => onDelete(entry)}
          title="Delete"
          className="text-danger hover:bg-danger/10"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </IconButton>
      )}
    </div>
  )
}


function CredentialCard({ entry, queryAppId, activeFilters, onEdit, onDelete, onShare, onFilterClick }) {
  return (
    <div className="rounded-xl border border-[rgb(var(--border-line))] bg-surface-1 p-5 transition-[border-color,box-shadow] hover:border-brand/30 hover:shadow-linear-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
            style={{ backgroundColor: `${entry.color}18`, color: entry.color }}
          >
            {entry.icon}
          </div>
          <div className="min-w-0">
            <div className="truncate text-caption font-emphasis text-text-primary">{entry.title}</div>
            <div className="mt-0.5 text-tiny text-text-tertiary">{entry.appTitle}</div>
            {entry.description && (
              <p className="mt-1 line-clamp-1 text-tiny leading-6 text-text-tertiary">{entry.description}</p>
            )}
          </div>
        </div>
        <CredentialActionButtons entry={entry} onEdit={onEdit} onDelete={onDelete} onShare={onShare} />
      </div>

      <div className="mt-4">
        <CredentialFilterTags
          entry={entry}
          filters={activeFilters}
          queryAppId={queryAppId}
          onToggleFilter={onFilterClick}
        />
      </div>

      <div className="mt-4 space-y-1 text-caption text-text-secondary">
        <div>
          {entry.primaryMetaLabel}: <span className="text-text-primary">{entry.primaryMetaValue}</span>
        </div>
        {entry.secondaryMetaValue && (
          <div className="text-tiny text-text-tertiary">
            {entry.secondaryMetaLabel}: <span className="text-text-secondary">{entry.secondaryMetaValue}</span>
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-[rgb(var(--border-line))] pt-3">
        <div className="min-w-0">
          {entry.ownerEmail ? (
            <OwnerBadge
              email={entry.ownerEmail}
              active={activeFilters.owner === entry.ownerEmail}
              onClick={() => onFilterClick?.('owner', entry.ownerEmail)}
            />
          ) : (
            <span className="text-tiny text-text-quaternary">No owner</span>
          )}
        </div>
        <span className="text-tiny text-text-tertiary" title={formatDateTitle(entry.updatedAt)}>
          Updated {formatDateLabel(entry.updatedAt)}
        </span>
      </div>
    </div>
  )
}


function CredentialTable({
  entries,
  queryAppId,
  activeFilters,
  onEdit,
  onDelete,
  onShare,
  onFilterClick,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
}) {
  const selectable = Boolean(onToggleSelect)
  const selectableIds = entries.filter((entry) => entry.permissions.canDelete).map((entry) => entry.id)
  const allSelected = selectable && selectableIds.length > 0 && selectableIds.every((id) => selectedIds?.has(id))
  const someSelected = selectable && selectableIds.some((id) => selectedIds?.has(id))

  return (
    <div className="overflow-hidden rounded-xl border border-[rgb(var(--border-line))] bg-surface-1">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-[rgb(var(--border-line))]">
          <thead className="bg-surface-2">
            <tr>
              {selectable && (
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
              )}
              <th className="px-6 py-3 text-left text-tiny font-emphasis uppercase tracking-[0.14em] text-text-quaternary">
                Credential
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
            {entries.map((entry) => (
              <tr key={entry.registryKey} className="hover:bg-surface-2">
                {selectable && (
                  <td className="w-10 px-3 py-4">
                    <input
                      type="checkbox"
                      checked={selectedIds?.has(entry.id) ?? false}
                      onChange={() => onToggleSelect?.(entry.id)}
                      disabled={!entry.permissions.canDelete}
                      className="h-3.5 w-3.5 rounded accent-[rgb(var(--brand))] cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                    />
                  </td>
                )}
                <td className="max-w-[360px] px-6 py-4">
                  <div className="flex items-start gap-3">
                    <div
                      className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md"
                      style={{ backgroundColor: `${entry.color}18`, color: entry.color }}
                    >
                      {entry.icon}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-caption font-emphasis text-text-primary">{entry.title}</div>
                      <div className="mt-0.5 text-tiny text-text-tertiary">{entry.appTitle}</div>
                      {entry.description && (
                        <p className="mt-1 max-w-md line-clamp-1 text-tiny text-text-tertiary">{entry.description}</p>
                      )}
                      <div className="mt-2 space-y-0.5 text-tiny text-text-tertiary">
                        <div>
                          {entry.primaryMetaLabel}: <span className="text-text-secondary">{entry.primaryMetaValue}</span>
                        </div>
                        {entry.secondaryMetaValue && (
                          <div>
                            {entry.secondaryMetaLabel}: <span className="text-text-secondary">{entry.secondaryMetaValue}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <CredentialFilterTags
                    entry={entry}
                    filters={activeFilters}
                    queryAppId={queryAppId}
                    onToggleFilter={onFilterClick}
                  />
                </td>
                <td className="whitespace-nowrap px-6 py-4">
                  {entry.ownerEmail ? (
                    <OwnerBadge
                      email={entry.ownerEmail}
                      active={activeFilters.owner === entry.ownerEmail}
                      onClick={() => onFilterClick?.('owner', entry.ownerEmail)}
                    />
                  ) : (
                    <span className="text-tiny text-text-quaternary">-</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-6 py-4 text-caption text-text-tertiary" title={formatDateTitle(entry.updatedAt)}>
                  {formatDateLabel(entry.updatedAt)}
                </td>
                <td className="whitespace-nowrap px-6 py-4 text-right">
                  <CredentialActionButtons entry={entry} onEdit={onEdit} onDelete={onDelete} onShare={onShare} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}


function AppsPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const permissions = useAuthStore((state) => state.permissions)
  const canCreateCredential = hasPermission(permissions, 'apps', 'edit')

  const [credentials, setCredentials] = useState([])
  const [loading, setLoading] = useState(true)
  const [modalTarget, setModalTarget] = useState(null)
  const [entryToDelete, setEntryToDelete] = useState(null)
  const [shareTarget, setShareTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [isBulkDeleting, setIsBulkDeleting] = useState(false)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [listFilters, setListFilters] = useState({})
  const [sortKey, setSortKey] = useState('updated')

  const appIdFilter = useMemo(() => {
    const params = new URLSearchParams(location.search)
    return params.get('appId') || ''
  }, [location.search])
  const appFilterLabel = useMemo(() => resolveAppFilterLabel(appIdFilter), [appIdFilter])

  const connectedEntries = useMemo(() => credentials.map(normalizeCredentialEntry), [credentials])
  const activeFilterCount = Object.values(listFilters).filter(Boolean).length + (appIdFilter ? 1 : 0)

  const toggleListFilter = useCallback((key, value) => {
    setListFilters((current) => ({
      ...current,
      [key]: current[key] === value ? undefined : value,
    }))
  }, [])

  const clearAllFilters = useCallback(() => {
    setListFilters({})
    if (appIdFilter) {
      navigate('/apps', { replace: true })
    }
  }, [appIdFilter, navigate])

  const clearAppFilter = useCallback(() => {
    navigate('/apps', { replace: true })
  }, [navigate])

  const loadRegistry = useCallback(async () => {
    setLoading(true)
    try {
      const response = await api.get('/api/apps/credentials', {
        params: appIdFilter ? { app_id: appIdFilter } : undefined,
      })
      setCredentials(Array.isArray(response.data) ? response.data : [])
    } catch (error) {
      setCredentials([])
      message.error(error.response?.data?.detail || 'Failed to load Apps registry')
    } finally {
      setLoading(false)
    }
  }, [appIdFilter])

  useEffect(() => {
    void loadRegistry()
  }, [loadRegistry])

  useEffect(() => {
    const validIds = new Set(connectedEntries.map((entry) => entry.id))
    setSelectedIds((current) => {
      const next = new Set([...current].filter((id) => validIds.has(id)))
      const unchanged = next.size === current.size && [...next].every((id) => current.has(id))
      return unchanged ? current : next
    })
  }, [connectedEntries])

  const openCreate = useCallback(() => {
    if (!canCreateCredential) return
    setModalTarget({ appId: appIdFilter || listFilters.app || null, editingId: null })
  }, [appIdFilter, canCreateCredential, listFilters.app])

  const openEdit = useCallback((entry) => {
    if (!entry.permissions.canEdit) return
    setModalTarget({ appId: entry.appId, editingId: entry.id })
  }, [])

  const confirmDelete = useCallback(async () => {
    if (!entryToDelete) return
    setDeleting(true)
    try {
      await api.delete(`/api/apps/credentials/${entryToDelete.id}`)
      message.success('Credential deleted')
      await loadRegistry()
      setEntryToDelete(null)
    } catch (error) {
      message.error(error.response?.data?.detail || 'Failed to delete credential')
    } finally {
      setDeleting(false)
    }
  }, [entryToDelete, loadRegistry])

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
    const confirmed = window.confirm(`Delete ${selectedIds.size} credential(s)? This action cannot be undone.`)
    if (!confirmed) return

    setIsBulkDeleting(true)
    let successCount = 0
    let failCount = 0

    for (const id of selectedIds) {
      try {
        await api.delete(`/api/apps/credentials/${id}`)
        successCount += 1
      } catch {
        failCount += 1
      }
    }

    setSelectedIds(new Set())
    await loadRegistry()
    setIsBulkDeleting(false)

    if (successCount > 0) message.success(`Deleted ${successCount} credential(s)`)
    if (failCount > 0) message.error(`Failed to delete ${failCount} credential(s)`)
  }, [loadRegistry, selectedIds])

  return (
    <AppLayout>
      <PageListLayout
        title="Apps"
        description="Reusable credentials for Automation, Pipeline, and Backup."
        action={canCreateCredential ? (
          <Button
            variant="primary"
            size="sm"
            onClick={openCreate}
            leadingIcon={<Plus className="h-3.5 w-3.5" />}
          >
            Add credential
          </Button>
        ) : null}
        isLoading={loading}
        loadingText="Loading credentials..."
        searchPlaceholder="Search credentials, apps, domains, connections, or owners"
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
            {appIdFilter && (
              <FilterTag tone="brand" active onClick={clearAppFilter}>
                {appFilterLabel}
              </FilterTag>
            )}
            {listFilters.app && listFilters.app !== appIdFilter && (
              <FilterTag tone="neutral" active onClick={() => toggleListFilter('app', listFilters.app)}>
                {resolveAppFilterLabel(listFilters.app)}
              </FilterTag>
            )}
            {listFilters.role && (
              <FilterTag
                tone={ROLE_FILTER_META[listFilters.role]?.tone || 'neutral'}
                active
                onClick={() => toggleListFilter('role', listFilters.role)}
              >
                {ROLE_FILTER_META[listFilters.role]?.label || listFilters.role}
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
            <Button variant="ghost" size="xs" onClick={clearAllFilters}>
              Clear filters
            </Button>
          </>
        ) : null}
      >
        {({ filterText, viewMode }) => {
          const normalizedFilter = filterText.trim().toLowerCase()
          const filteredEntries = connectedEntries.filter((entry) => {
            const matchesSearch = (
              !normalizedFilter
              || entry.searchValues
                .filter(Boolean)
                .some((value) => String(value).toLowerCase().includes(normalizedFilter))
            )

            return (
              matchesSearch
              && (!listFilters.app || entry.appId === listFilters.app)
              && (!listFilters.role || entry.roleKey === listFilters.role)
              && (!listFilters.owner || entry.ownerEmail === listFilters.owner)
              && (!listFilters.access || entry.userPermission === listFilters.access)
            )
          })
          const visibleEntries = sortCredentialEntries(filteredEntries, sortKey)

          if (connectedEntries.length === 0) {
            return (
              <RegistryEmptyState
                icon={Database}
                title="No credentials yet"
                description={appIdFilter
                  ? `No saved credentials for ${appFilterLabel} yet.`
                  : 'Save a credential for any integrated app. Automation, Pipeline, and Backup will reuse it automatically.'}
                action={canCreateCredential ? (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={openCreate}
                    leadingIcon={<Plus className="h-3.5 w-3.5" />}
                  >
                    Add credential
                  </Button>
                ) : null}
              />
            )
          }

          if (visibleEntries.length === 0) {
            return (
              <RegistryEmptyState
                icon={Search}
                title="No credentials match"
                description={normalizedFilter
                  ? `No results for "${filterText}".`
                  : 'No credentials match the current app, role, owner, or access filters.'}
              />
            )
          }

          if (viewMode === 'grid') {
            return (
              <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                {visibleEntries.map((entry) => (
                  <CredentialCard
                    key={entry.registryKey}
                    entry={entry}
                    queryAppId={appIdFilter}
                    activeFilters={listFilters}
                    onEdit={openEdit}
                    onDelete={setEntryToDelete}
                    onShare={setShareTarget}
                    onFilterClick={toggleListFilter}
                  />
                ))}
              </div>
            )
          }

          return (
            <CredentialTable
              entries={visibleEntries}
              queryAppId={appIdFilter}
              activeFilters={listFilters}
              onEdit={openEdit}
              onDelete={setEntryToDelete}
              onShare={setShareTarget}
              onFilterClick={toggleListFilter}
              selectedIds={canCreateCredential ? selectedIds : undefined}
              onToggleSelect={canCreateCredential ? toggleSelect : undefined}
              onToggleSelectAll={canCreateCredential ? toggleSelectAll : undefined}
            />
          )
        }}
      </PageListLayout>

      {canCreateCredential && (
        <BulkActionBar
          selectedCount={selectedIds.size}
          onDelete={handleBulkDelete}
          onClear={() => setSelectedIds(new Set())}
          isDeleting={isBulkDeleting}
        />
      )}

      <CredentialModal
        open={Boolean(modalTarget)}
        appId={modalTarget?.appId ?? null}
        editingId={modalTarget?.editingId ?? null}
        onClose={() => setModalTarget(null)}
        onSaved={loadRegistry}
      />

      <ShareDialog
        open={Boolean(shareTarget)}
        onClose={() => setShareTarget(null)}
        resourceType={APP_CREDENTIAL_RESOURCE_TYPE}
        resourceId={shareTarget?.id}
        resourceName={shareTarget?.title || 'Credential'}
      />

      <ConfirmDialog
        isOpen={Boolean(entryToDelete)}
        onClose={() => { if (!deleting) setEntryToDelete(null) }}
        onConfirm={confirmDelete}
        title="Delete credential?"
        description={entryToDelete
          ? `Delete "${entryToDelete.title}". Any flow using it will need another saved credential.`
          : ''}
        confirmLabel={deleting ? 'Deleting...' : 'Delete credential'}
        cancelLabel="Cancel"
        variant="danger"
        isLoading={deleting}
      />
    </AppLayout>
  )
}

export default AppsPage
