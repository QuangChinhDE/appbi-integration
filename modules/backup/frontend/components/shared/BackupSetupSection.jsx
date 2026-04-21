import React, { useEffect } from 'react'
import {
  Check, CheckCircle, Folder, Link2, RefreshCw,
} from 'lucide-react'
import { Tag, Alert, Button } from '@packages/ui/src/components/common/ui'
import { BACKUP_TYPE_OPTIONS, getBackupDestinationLabel } from '../../constants'
import SearchablePickerCard from './SearchablePickerCard'

/**
 * Backup type selector, destination picker, Google auth method selector,
 * OAuth connect/disconnect, service account upload, folder picker trigger.
 * Shared between condensed Service wizard step 2 and Request step 3.
 */
const BackupSetupSection = ({ wizard }) => {
  const {
    isWorkflowApp,
    backupAppsPermissionConflict,
    backupAppsPermissionMessage,
    backupType, setBackupType,
    storageDestination,
    destinationProfileId,
    savedDestinationProfiles, loadingSavedDestinationProfiles,
    savedDestinationProfilesError,
    loadSavedDestinationProfiles, applyDestinationProfile,
    googleAuthMethod, googleAuth,
    setServiceBackupSetupSaved,
    handleOpenFolderPicker,
    getCompatibilityBlockedReason,
    getGoogleDriveRunBlockedReason,
    getGoogleDriveFolderSummary,
  } = wizard
  const appliedProfile = savedDestinationProfiles.find(profile => String(profile.id) === String(destinationProfileId)) || null

  const folderSummary = getGoogleDriveFolderSummary()
  const blockedReason = getCompatibilityBlockedReason() || getGoogleDriveRunBlockedReason()
  const availableBackupTypes = isWorkflowApp
    ? BACKUP_TYPE_OPTIONS.filter(type => type.id !== 'unstructured')
    : BACKUP_TYPE_OPTIONS
  const visibleDestinationProfiles = savedDestinationProfiles
  const [destinationSearch, setDestinationSearch] = React.useState('')

  const filteredDestinationProfiles = React.useMemo(() => {
    const normalizedQuery = destinationSearch.trim().toLowerCase()
    const filtered = visibleDestinationProfiles.filter((profile) => {
      if (!normalizedQuery) return true
      return [
        profile.name,
        profile.destination_name,
        profile.connection_label,
        profile.folder_name,
        profile.drive_name,
        profile.owner_email,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedQuery))
    })

    return [...filtered].sort((left, right) => {
      const leftActive = String(left.id) === String(destinationProfileId)
      const rightActive = String(right.id) === String(destinationProfileId)
      if (leftActive !== rightActive) return leftActive ? -1 : 1

      const leftMatchesDestination = storageDestination && left.destination_type === storageDestination
      const rightMatchesDestination = storageDestination && right.destination_type === storageDestination
      if (leftMatchesDestination !== rightMatchesDestination) return leftMatchesDestination ? -1 : 1

      return String(left.name || '').localeCompare(String(right.name || ''))
    })
  }, [visibleDestinationProfiles, destinationSearch, destinationProfileId, storageDestination])

  const handleDestinationSearchFocus = React.useCallback(() => {
    if (!loadingSavedDestinationProfiles) {
      void loadSavedDestinationProfiles(null)
    }
  }, [loadingSavedDestinationProfiles, loadSavedDestinationProfiles])

  const destinationSummaryText = visibleDestinationProfiles.length > 0
    ? `${filteredDestinationProfiles.length}/${visibleDestinationProfiles.length} profile${visibleDestinationProfiles.length > 1 ? 's' : ''}`
    : 'No saved destinations'

  useEffect(() => {
    if (isWorkflowApp && backupType === 'unstructured') {
      setBackupType(null)
    }
  }, [isWorkflowApp, backupType, setBackupType])

  return (
    <div className="w-full min-w-0 space-y-6">

      {/* ── Backup Type ────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-[rgb(var(--border-line))] bg-surface-1 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-micro font-emphasis uppercase tracking-[0.14em] text-text-quaternary">Backup mode</p>
            <h3 className="mt-2 text-h3 font-strong text-text-primary">Choose how this flow should write data</h3>
            <p className="mt-1.5 text-small leading-6 text-text-tertiary">Pick the output style first, then search a saved destination profile that matches it.</p>
          </div>
          {backupType && (
            <div className="shrink-0 rounded-full bg-brand/10 px-3 py-1.5 text-micro font-emphasis text-brand">
              {availableBackupTypes.find((type) => type.id === backupType)?.title || backupType}
            </div>
          )}
        </div>

        {isWorkflowApp && (
          <Alert type="info" message="Workflow v1 supports Structured and Complete backup only" description="The current Workflow APIs do not provide a separate unstructured read path yet, so Files & Attachments is hidden for this app." className="mt-4" />
        )}

        <div className="mt-5 grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {availableBackupTypes.map(type => (
            <div
              key={type.id}
              onClick={() => { setBackupType(type.id); setServiceBackupSetupSaved(false) }}
              className="flex h-full items-center gap-4 rounded-xl border p-4 cursor-pointer transition-all"
              style={{
                borderColor: backupType === type.id ? type.color : '#e5e7eb',
                backgroundColor: backupType === type.id ? `${type.color}0f` : '#fff',
              }}
            >
              <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: `${type.color}18`, color: type.color }}>
                {type.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-small font-emphasis" style={{ color: backupType === type.id ? type.color : '#1f2937' }}>{type.title}</span>
                  {type.badge && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-micro font-emphasis" style={{ backgroundColor: `${type.color}20`, color: type.color }}>
                      {type.badge}
                    </span>
                  )}
                </div>
                <p className="text-caption text-text-tertiary leading-6">{type.desc}</p>
              </div>
              <div className="w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all"
                style={{ borderColor: backupType === type.id ? type.color : '#d1d5db', backgroundColor: backupType === type.id ? type.color : 'transparent' }}>
                {backupType === type.id && <Check className="w-3 h-3 text-white" />}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Destination Profiles ──────────────────────────────────────── */}
      <SearchablePickerCard
        icon={<Link2 className="h-5 w-5" />}
        title="Pick a saved destination"
        description="Search by destination name, Google account, folder, or drive. Focusing the search box will sync the latest saved destination profiles automatically."
        searchValue={destinationSearch}
        onSearchChange={setDestinationSearch}
        onSearchFocus={handleDestinationSearchFocus}
        searchPlaceholder="Search saved destinations…"
        summary={destinationSummaryText}
        loading={loadingSavedDestinationProfiles}
        loadingText="Loading saved destinations…"
        isEmpty={filteredDestinationProfiles.length === 0}
        action={(
          <Button
            variant="secondary"
            size="sm"
            onClick={() => loadSavedDestinationProfiles(null)}
            disabled={backupAppsPermissionConflict}
            leadingIcon={<RefreshCw className="w-3.5 h-3.5" />}
          >
            Sync now
          </Button>
        )}
        emptyState={(
          <div className="rounded-xl border border-dashed border-[rgb(var(--border-line))] bg-surface-2 px-4 py-5 text-caption text-text-tertiary">
            {savedDestinationProfilesError || backupAppsPermissionConflict
              ? (savedDestinationProfilesError || backupAppsPermissionMessage)
              : visibleDestinationProfiles.length === 0
              ? 'No saved Google Drive destination profiles yet. Create one in the Apps module, then come back here to reuse it.'
              : 'No saved destination matches your search. Try another keyword.'}
          </div>
        )}
        footer={storageDestination && (
          <div className="rounded-xl border border-[rgb(var(--border-line))] bg-surface-2 px-3 py-3 text-caption text-text-secondary">
            Selected destination type: {getBackupDestinationLabel(storageDestination)}
          </div>
        )}
      >
        <div className="max-h-[28rem] overflow-y-auto pr-1">
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {filteredDestinationProfiles.map(profile => {
              const isActive = destinationProfileId === String(profile.id)
              return (
                <button
                  key={profile.id}
                  type="button"
                  onClick={() => applyDestinationProfile(profile.id)}
                  className={`rounded-xl border px-4 py-3 text-left transition-all ${
                    isActive
                      ? 'border-brand/20 bg-brand/10'
                      : 'border-[rgb(var(--border-line))] bg-surface-1 hover:border-brand/30 hover:bg-brand/10'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className={`truncate text-small font-emphasis ${isActive ? 'text-brand' : 'text-text-primary'}`}>{profile.name}</div>
                      <div className="mt-1 text-caption text-text-tertiary">{profile.connection_label || (profile.auth_mode === 'service_account' ? 'Platform service account' : 'Sign in')}</div>
                    </div>
                    {isActive && <CheckCircle className="mt-0.5 w-4 h-4 text-brand shrink-0" />}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5 text-micro text-text-quaternary">
                    <span className="rounded-full bg-surface-2 px-2 py-0.5 text-text-secondary">{profile.destination_name}</span>
                    {profile.folder_name && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-text-secondary">{profile.folder_name}</span>}
                    {profile.drive_name && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-text-secondary">{profile.drive_name}</span>}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      </SearchablePickerCard>

      {storageDestination && (
        <div>
          <label className="mb-1 block text-label font-emphasis text-text-primary">Applied destination profile</label>
          {!destinationProfileId ? (
            <Alert
              type="warning"
              message="Select a saved destination profile"
              description="Create or edit reusable Google destinations in the Apps module, then pick one here for this backup flow."
            />
          ) : (
            <div className="rounded-xl border border-[rgb(var(--border-line))] bg-surface-1 p-5 space-y-4">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
                  <Folder className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-small font-emphasis text-text-primary">{appliedProfile?.name || 'Selected destination profile'}</div>
                  <div className="mt-1 text-caption text-text-tertiary">
                    {appliedProfile?.connection_label || googleAuth?.display_name || googleAuth?.email || 'Managed from the Apps module'}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Tag color={googleAuthMethod === 'service_account' ? 'purple' : 'blue'}>
                      {googleAuthMethod === 'service_account' ? 'Service account' : 'Sign in'}
                    </Tag>
                    {folderSummary && <Tag color={folderSummary.color}>{folderSummary.tag}</Tag>}
                    {folderSummary && <Tag color="default">{folderSummary.driveName}</Tag>}
                  </div>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-xl bg-surface-2 px-3 py-3 text-small text-text-secondary">
                  <div className="text-micro font-emphasis uppercase tracking-[0.14em] text-text-quaternary">Owner</div>
                  <div className="mt-1 leading-6">{appliedProfile?.owner_email || 'Unknown'}</div>
                </div>
                <div className="rounded-xl bg-surface-2 px-3 py-3 text-small text-text-secondary">
                  <div className="text-micro font-emphasis uppercase tracking-[0.14em] text-text-quaternary">Folder</div>
                  <div className="mt-1 leading-6">{googleAuth?.folder_name || appliedProfile?.folder_name || 'Drive root / default folder'}</div>
                </div>
              </div>

              <div className="flex flex-col gap-2 rounded-xl border border-dashed border-brand/20 bg-brand/10 px-3 py-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="text-small font-emphasis text-brand">Override folder path for this flow</div>
                  <div className="mt-1 text-caption text-brand">
                    Browse the Drive tree, search visible folders, or paste a folder link or ID. This keeps the selected destination profile and only changes where this backup writes data.
                  </div>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleOpenFolderPicker}
                  leadingIcon={<Folder className="h-4 w-4" />}
                  className="border-brand/20 bg-surface-1 text-brand hover:bg-brand/10"
                >
                  Choose folder
                </Button>
              </div>
            </div>
          )}
          {folderSummary && (
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              <Tag color={folderSummary.color}>{folderSummary.tag}</Tag>
              <Tag color="default">{folderSummary.driveName}</Tag>
              <span className="self-center text-caption text-text-quaternary">{folderSummary.help}</span>
            </div>
          )}
          {blockedReason && <Alert type="warning" message="This flow cannot run with the current configuration" description={blockedReason} className="mt-2" />}
        </div>
      )}
    </div>
  )
}

export default BackupSetupSection
