import React, { useEffect } from 'react'
import {
  Check, CheckCircle, Folder, FileSpreadsheet, Link2, RefreshCw,
} from 'lucide-react'
import { Tag, Alert, Spinner } from '@packages/ui/src/components/common/ui'
import { BACKUP_TYPE_OPTIONS } from '../../constants'
import SearchablePickerCard from './SearchablePickerCard'

/**
 * Backup type selector, destination picker, Google auth method selector,
 * OAuth connect/disconnect, service account upload, folder picker trigger.
 * Shared between condensed Service wizard step 2 and Request step 3.
 */
const BackupSetupSection = ({ wizard }) => {
  const {
    isWorkflowApp,
    backupType, setBackupType,
    storageDestination,
    destinationProfileId,
    savedDestinationProfiles, loadingSavedDestinationProfiles,
    loadSavedDestinationProfiles, applyDestinationProfile,
    googleAuthMethod, googleAuth,
    setServiceBackupSetupSaved,
    handleOpenFolderPicker,
    getGoogleDriveRunBlockedReason,
    getGoogleDriveFolderSummary,
  } = wizard
  const appliedProfile = savedDestinationProfiles.find(profile => String(profile.id) === String(destinationProfileId)) || null

  const folderSummary = getGoogleDriveFolderSummary()
  const blockedReason = getGoogleDriveRunBlockedReason()
  const availableBackupTypes = isWorkflowApp
    ? BACKUP_TYPE_OPTIONS.filter(type => type.id !== 'unstructured')
    : BACKUP_TYPE_OPTIONS
  const visibleDestinationProfiles = savedDestinationProfiles.filter(profile => (
    backupType !== 'unstructured' || profile.destination_type === 'gdrive'
  ))
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
      <section className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-gray-400">Backup mode</p>
            <h3 className="mt-2 text-sm font-semibold text-gray-900">Choose how this flow should write data</h3>
            <p className="mt-1 text-xs leading-6 text-gray-500">Pick the output style first, then search a saved destination profile that matches it.</p>
          </div>
          {backupType && (
            <div className="shrink-0 rounded-full bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700">
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
              className="flex h-full items-center gap-4 p-3.5 rounded-2xl border-2 cursor-pointer transition-all hover:shadow-sm"
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
                  <span className="font-bold text-sm" style={{ color: backupType === type.id ? type.color : '#1f2937' }}>{type.title}</span>
                  {type.badge && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ backgroundColor: `${type.color}20`, color: type.color }}>
                      {type.badge}
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 leading-relaxed">{type.desc}</p>
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
          <button
            type="button"
            onClick={() => loadSavedDestinationProfiles(null)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Sync now
          </button>
        )}
        emptyState={(
          <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-4 py-5 text-sm text-gray-500">
            {visibleDestinationProfiles.length === 0
              ? (backupType === 'unstructured'
                  ? 'No Google Drive destination profiles are available for this backup type yet.'
                  : 'No saved destination profiles yet. Create one in the Apps module, then come back here to reuse it.')
              : 'No saved destination matches your search. Try another keyword.'}
          </div>
        )}
        footer={storageDestination && (
          <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-600">
            Selected destination type: {storageDestination === 'gsheets' ? 'Google Sheets' : 'Google Drive'}
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
                  className={`rounded-2xl border px-4 py-3 text-left transition-all ${
                    isActive
                      ? 'border-blue-300 bg-blue-50 shadow-sm'
                      : 'border-gray-200 bg-white hover:border-blue-200 hover:bg-blue-50/40'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className={`truncate text-sm font-semibold ${isActive ? 'text-blue-700' : 'text-gray-800'}`}>{profile.name}</div>
                      <div className="mt-1 text-xs text-gray-500">{profile.connection_label || (profile.auth_mode === 'service_account' ? 'Platform service account' : 'Google OAuth')}</div>
                    </div>
                    {isActive && <CheckCircle className="mt-0.5 w-4 h-4 text-blue-600 shrink-0" />}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-gray-400">
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-600">{profile.destination_name}</span>
                    {profile.folder_name && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-600">{profile.folder_name}</span>}
                    {profile.drive_name && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-600">{profile.drive_name}</span>}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      </SearchablePickerCard>

      {storageDestination && (
        <div>
          <label className="block text-sm font-semibold text-gray-800 mb-1">Applied destination profile</label>
          {!destinationProfileId ? (
            <Alert
              type="warning"
              message="Select a saved destination profile"
              description="Create or edit reusable Google destinations in the Apps module, then pick one here for this backup flow."
            />
          ) : (
            <div className="rounded-2xl border border-gray-200 bg-white p-4 space-y-3">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                  {storageDestination === 'gsheets' ? <FileSpreadsheet className="h-5 w-5" /> : <Folder className="h-5 w-5" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-gray-900">{appliedProfile?.name || 'Selected destination profile'}</div>
                  <div className="mt-1 text-xs text-gray-500">
                    {appliedProfile?.connection_label || googleAuth?.display_name || googleAuth?.email || 'Managed from the Apps module'}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Tag color={googleAuthMethod === 'service_account' ? 'purple' : 'blue'}>
                      {googleAuthMethod === 'service_account' ? 'Service account' : 'Google OAuth'}
                    </Tag>
                    {folderSummary && <Tag color={folderSummary.color}>{folderSummary.tag}</Tag>}
                    {folderSummary && <Tag color="default">{folderSummary.driveName}</Tag>}
                  </div>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-xl bg-gray-50 px-3 py-3 text-sm text-gray-600">
                  <div className="text-xs font-medium uppercase tracking-wide text-gray-400">Owner</div>
                  <div className="mt-1">{appliedProfile?.owner_email || 'Unknown'}</div>
                </div>
                <div className="rounded-xl bg-gray-50 px-3 py-3 text-sm text-gray-600">
                  <div className="text-xs font-medium uppercase tracking-wide text-gray-400">Folder</div>
                  <div className="mt-1">{googleAuth?.folder_name || appliedProfile?.folder_name || 'Drive root / default folder'}</div>
                </div>
              </div>

              <div className="flex flex-col gap-2 rounded-xl border border-dashed border-blue-200 bg-blue-50/60 px-3 py-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="text-sm font-semibold text-blue-800">Override folder path for this flow</div>
                  <div className="mt-1 text-xs text-blue-700">
                    Browse the Drive tree, search visible folders, or paste a folder link or ID. This keeps the selected destination profile and only changes where this backup writes data.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleOpenFolderPicker}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-blue-200 bg-white px-4 py-2 text-sm font-semibold text-blue-700 transition-colors hover:bg-blue-50"
                >
                  <Folder className="h-4 w-4" />
                  Choose folder
                </button>
              </div>
            </div>
          )}
          {folderSummary && (
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              <Tag color={folderSummary.color}>{folderSummary.tag}</Tag>
              <Tag color="default">{folderSummary.driveName}</Tag>
              <span className="text-xs text-gray-400 self-center">{folderSummary.help}</span>
            </div>
          )}
          {blockedReason && <Alert type="warning" message="This folder cannot be used for running backups" description={blockedReason} className="mt-2" />}
        </div>
      )}
    </div>
  )
}

export default BackupSetupSection
