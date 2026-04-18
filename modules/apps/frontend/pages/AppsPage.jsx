import React, { useEffect, useMemo, useState } from 'react'
import { Database, Pencil, Plus, Trash2 } from 'lucide-react'

import api from '@shared/api/client'
import { APPS, DESTINATION_OPTIONS, formatDateTime } from '@modules/backup/frontend/constants'
import { hasPermission } from '@modules/identity/frontend/lib/permissions'
import { useAuthStore } from '@modules/identity/frontend/store/authStore'
import ConfirmDialog from '@packages/ui/src/components/common/ConfirmDialog'
import PageListLayout from '@packages/ui/src/components/common/PageListLayout'
import { Button, FilterTag, IconButton, message } from '@packages/ui/src/components/common/ui'
import AppLayout from '@packages/ui/src/components/layout/AppLayout'

import CredentialModal from '@modules/apps/frontend/components/CredentialModal'


const GOOGLE_APP_IDS = new Set(['gdrive', 'gsheets'])


function normalizeCredentialEntry(credential) {
  const preview = credential.preview || {}
  const isGoogle = GOOGLE_APP_IDS.has(credential.app_id)
  const appMeta = APPS[credential.app_id]
  const destinationOption = DESTINATION_OPTIONS.find((item) => item.id === credential.app_id)
  const roleLabel = isGoogle ? 'Destination' : 'Source'

  const appTitle = isGoogle
    ? (destinationOption?.title || credential.app_name || credential.app_id)
    : (credential.app_name || appMeta?.name || credential.app_id)
  const color = isGoogle ? (destinationOption?.color || '#64748b') : (appMeta?.color || '#64748b')
  const icon = isGoogle ? (destinationOption?.icon || <Database className="h-4 w-4" />) : (appMeta?.icon || <Database className="h-4 w-4" />)

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
      roleLabel,
      authLabel: null,
      primaryMetaLabel: 'Domain',
      primaryMetaValue: preview.domain || '—',
      secondaryMetaLabel: null,
      secondaryMetaValue: null,
      updatedAt: credential.updated_at,
      searchValues: [credential.name, credential.description, credential.app_name, credential.app_id, preview.domain, 'source'],
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
    roleLabel,
    authLabel,
    primaryMetaLabel: 'Connection',
    primaryMetaValue: connectionLabel || appTitle,
    secondaryMetaLabel: locationBits.length > 0 ? 'Location' : null,
    secondaryMetaValue: locationBits.length > 0 ? locationBits.join(' · ') : null,
    updatedAt: credential.updated_at,
    searchValues: [credential.name, credential.description, credential.app_name, credential.app_id, connectionLabel, preview.folder_name, preview.drive_name, authLabel, 'destination'],
  }
}


function CredentialCard({ entry, canEdit, onEdit, onDelete }) {
  return (
    <div className="rounded-md border border-[rgb(var(--border-line))] bg-surface-1 p-4 transition-colors hover:border-brand/30">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md"
            style={{ backgroundColor: `${entry.color}18`, color: entry.color }}
          >
            {entry.icon}
          </div>
          <div className="min-w-0">
            <div className="truncate text-caption font-emphasis text-text-primary">{entry.title}</div>
            {entry.description && (
              <p className="mt-0.5 text-tiny text-text-tertiary line-clamp-1">{entry.description}</p>
            )}
          </div>
        </div>
        {canEdit && (
          <div className="flex items-center gap-1">
            <IconButton aria-label="Edit" variant="ghost" size="xs" onClick={onEdit} title="Edit">
              <Pencil className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton aria-label="Delete" variant="ghost" size="xs" onClick={onDelete} title="Delete" className="text-danger hover:bg-danger/10">
              <Trash2 className="h-3.5 w-3.5" />
            </IconButton>
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <FilterTag tone="neutral" as="span">{entry.appTitle}</FilterTag>
        <FilterTag tone={entry.isGoogle ? 'brand' : 'info'} as="span">{entry.roleLabel}</FilterTag>
        {entry.authLabel && (
          <FilterTag tone={entry.authLabel === 'Service account' ? 'warning' : 'info'} as="span">{entry.authLabel}</FilterTag>
        )}
      </div>

      <div className="mt-3 space-y-0.5 text-tiny text-text-tertiary">
        <div>{entry.primaryMetaLabel}: <span className="text-text-secondary">{entry.primaryMetaValue}</span></div>
        {entry.secondaryMetaValue && (
          <div>{entry.secondaryMetaLabel}: <span className="text-text-secondary">{entry.secondaryMetaValue}</span></div>
        )}
        <div>Updated {formatDateTime(entry.updatedAt)}</div>
      </div>
    </div>
  )
}


function CredentialTable({ entries, canEdit, onEdit, onDelete }) {
  return (
    <div className="overflow-hidden rounded-md border border-[rgb(var(--border-line))] bg-surface-1">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-[rgb(var(--border-line))]">
          <thead className="bg-surface-2">
            <tr>
              <th className="px-5 py-2.5 text-left text-tiny font-emphasis uppercase tracking-[0.12em] text-text-quaternary">Credential</th>
              <th className="px-5 py-2.5 text-left text-tiny font-emphasis uppercase tracking-[0.12em] text-text-quaternary">App</th>
              <th className="px-5 py-2.5 text-left text-tiny font-emphasis uppercase tracking-[0.12em] text-text-quaternary">Role</th>
              <th className="px-5 py-2.5 text-left text-tiny font-emphasis uppercase tracking-[0.12em] text-text-quaternary">Details</th>
              <th className="px-5 py-2.5 text-left text-tiny font-emphasis uppercase tracking-[0.12em] text-text-quaternary">Updated</th>
              <th className="px-5 py-2.5 text-right text-tiny font-emphasis uppercase tracking-[0.12em] text-text-quaternary">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[rgb(var(--border-line))]">
            {entries.map((entry) => (
              <tr key={entry.registryKey} className="hover:bg-surface-2">
                <td className="px-5 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md" style={{ backgroundColor: `${entry.color}18`, color: entry.color }}>
                      {entry.icon}
                    </div>
                    <div className="min-w-0">
                      <div className="text-caption font-emphasis text-text-primary">{entry.title}</div>
                      {entry.description && <div className="text-tiny text-text-tertiary line-clamp-1">{entry.description}</div>}
                    </div>
                  </div>
                </td>
                <td className="px-5 py-3 text-caption text-text-secondary">{entry.appTitle}</td>
                <td className="px-5 py-3">
                  <FilterTag tone={entry.isGoogle ? 'brand' : 'info'} as="span">{entry.roleLabel}</FilterTag>
                </td>
                <td className="px-5 py-3 text-caption text-text-secondary">{entry.primaryMetaValue}</td>
                <td className="whitespace-nowrap px-5 py-3 text-caption text-text-tertiary">{formatDateTime(entry.updatedAt)}</td>
                <td className="whitespace-nowrap px-5 py-3 text-right">
                  {canEdit && (
                    <div className="flex items-center justify-end gap-1">
                      <IconButton aria-label="Edit" variant="ghost" size="xs" onClick={() => onEdit(entry)} title="Edit">
                        <Pencil className="h-3.5 w-3.5" />
                      </IconButton>
                      <IconButton aria-label="Delete" variant="ghost" size="xs" onClick={() => onDelete(entry)} title="Delete" className="text-danger hover:bg-danger/10">
                        <Trash2 className="h-3.5 w-3.5" />
                      </IconButton>
                    </div>
                  )}
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
  const permissions = useAuthStore((state) => state.permissions)
  const canManageApps = hasPermission(permissions, 'apps', 'edit')
  const [credentials, setCredentials] = useState([])
  const [loading, setLoading] = useState(true)
  const [modalTarget, setModalTarget] = useState(null)
  // modalTarget shape: { appId: string | null, editingId: string | null } | null
  const [entryToDelete, setEntryToDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const connectedEntries = useMemo(() => {
    return credentials
      .map(normalizeCredentialEntry)
      .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
  }, [credentials])

  const loadRegistry = async () => {
    setLoading(true)
    try {
      const response = await api.get('/api/apps/credentials')
      setCredentials(Array.isArray(response.data) ? response.data : [])
    } catch {
      setCredentials([])
      message.error('Failed to load Apps registry')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadRegistry() }, [])

  const openCreate = () => {
    if (!canManageApps) return
    setModalTarget({ appId: null, editingId: null })
  }
  const openEdit = (entry) => {
    if (!canManageApps) return
    setModalTarget({ appId: entry.appId, editingId: entry.id })
  }
  const closeModal = () => setModalTarget(null)

  const confirmDelete = async () => {
    if (!entryToDelete) return
    setDeleting(true)
    try {
      await api.delete(`/api/apps/credentials/${entryToDelete.id}`)
      message.success('Credential deleted')
      await loadRegistry()
      setEntryToDelete(null)
    } catch (err) {
      message.error(err.response?.data?.detail || 'Failed to delete credential')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <AppLayout>
      <PageListLayout
        title="Apps"
        description="Reusable credentials. Backup picks which one plays source or destination per flow."
        action={canManageApps ? (
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
        loadingText="Loading credentials…"
        searchPlaceholder="Search by name, app, domain, email, folder…"
        defaultView="list"
      >
        {({ filterText, viewMode }) => {
          const normalizedFilter = filterText.trim().toLowerCase()
          const visibleEntries = connectedEntries.filter((entry) => {
            if (!normalizedFilter) return true
            return entry.searchValues
              .filter(Boolean)
              .some((value) => String(value).toLowerCase().includes(normalizedFilter))
          })

          if (visibleEntries.length === 0) {
            return (
              <div className="rounded-md border border-dashed border-[rgb(var(--border-line))] bg-surface-1 px-6 py-12 text-center">
                <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-full bg-surface-2 text-text-quaternary">
                  <Plus className="h-3.5 w-3.5" />
                </div>
                <h3 className="mt-3 text-caption font-emphasis text-text-primary">
                  {connectedEntries.length === 0 ? 'No credentials yet' : 'No credentials match your search'}
                </h3>
                <p className="mx-auto mt-1 max-w-md text-tiny text-text-tertiary">
                  {connectedEntries.length === 0
                    ? 'Save a credential for any integrated app; Backup will pick it up automatically.'
                    : `No results for “${filterText}”.`}
                </p>
                {connectedEntries.length === 0 && canManageApps && (
                  <div className="mt-4 flex justify-center">
                    <Button variant="primary" size="sm" onClick={openCreate} leadingIcon={<Plus className="h-3.5 w-3.5" />}>
                      Add credential
                    </Button>
                  </div>
                )}
              </div>
            )
          }

          if (viewMode === 'grid') {
            return (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {visibleEntries.map((entry) => (
                  <CredentialCard
                    key={entry.registryKey}
                    entry={entry}
                    canEdit={canManageApps}
                    onEdit={() => openEdit(entry)}
                    onDelete={() => setEntryToDelete(entry)}
                  />
                ))}
              </div>
            )
          }
          return (
            <CredentialTable
              entries={visibleEntries}
              canEdit={canManageApps}
              onEdit={openEdit}
              onDelete={setEntryToDelete}
            />
          )
        }}
      </PageListLayout>

      <CredentialModal
        open={Boolean(modalTarget)}
        appId={modalTarget?.appId ?? null}
        editingId={modalTarget?.editingId ?? null}
        onClose={closeModal}
        onSaved={loadRegistry}
      />

      <ConfirmDialog
        isOpen={Boolean(entryToDelete)}
        onClose={() => { if (!deleting) setEntryToDelete(null) }}
        onConfirm={confirmDelete}
        title="Delete credential?"
        description={entryToDelete
          ? `Delete “${entryToDelete.title}”. Any backup flow using it will need to reconnect or choose another saved credential.`
          : ''}
        confirmLabel={deleting ? 'Deleting…' : 'Delete credential'}
        cancelLabel="Cancel"
        variant="danger"
        isLoading={deleting}
      />
    </AppLayout>
  )
}

export default AppsPage
