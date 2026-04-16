import React, { useEffect } from 'react'
import {
  Globe, Eye, EyeOff, Check, CheckCircle, Lock,
  Folder, FileSpreadsheet, ChevronRight, Link2, RefreshCw,
} from 'lucide-react'
import { Tag, Alert, Spinner, SpinCenter } from '@packages/ui/src/components/common/ui'
import { BACKUP_TYPE_OPTIONS, DESTINATION_OPTIONS } from '../../constants'

/**
 * Backup type selector, destination picker, Google auth method selector,
 * OAuth connect/disconnect, service account upload, folder picker trigger.
 * Shared between condensed Service wizard step 2 and Request step 3.
 */
const BackupSetupSection = ({ wizard }) => {
  const {
    isWorkflowApp,
    backupType, setBackupType,
    storageDestination, selectDestination,
    destinationProfileId,
    savedDestinationProfiles, loadingSavedDestinationProfiles,
    loadSavedDestinationProfiles, applyDestinationProfile, clearAppliedDestinationProfile,
    googleAuthMethod, setGoogleAuthMethod, googleAuth, setGoogleAuth,
    platformServiceAccount,
    savedGoogleConnections, loadingSavedGoogleConnections,
    selectSavedGoogleConnection,
    setServiceAccountAnalysis, setServiceAccountFileName, setServiceAccountError,
    serviceAccountAnalysis, serviceAccountAnalysisLoading, serviceAccountFileName, serviceAccountError,
    setServiceBackupSetupSaved,
    handleGoogleConnect, handleGoogleDisconnect,
    openGoogleConfigModal,
    handleServiceAccountFileUpload,
    handleOpenFolderPicker,
    getGoogleDriveRunBlockedReason,
    getGoogleDriveFolderSummary,
    resolvedGoogleAuthMethod,
  } = wizard

  const analysis = serviceAccountAnalysis || {}
  const availableDrives = Array.isArray(analysis.drives) ? analysis.drives : []
  const serviceAccountEmail = analysis.client_email || googleAuth?.service_account_email || googleAuth?.email
  const projectId = analysis.project_id || googleAuth?.project_id

  const folderSummary = getGoogleDriveFolderSummary()
  const blockedReason = getGoogleDriveRunBlockedReason()
  const availableBackupTypes = isWorkflowApp
    ? BACKUP_TYPE_OPTIONS.filter(type => type.id !== 'unstructured')
    : BACKUP_TYPE_OPTIONS

  useEffect(() => {
    if (isWorkflowApp && backupType === 'unstructured') {
      setBackupType(null)
    }
  }, [isWorkflowApp, backupType, setBackupType])

  return (
    <div className="w-full max-w-4xl space-y-6">

      {/* ── Backup Type ────────────────────────────────────────────────── */}
      <div>
        <label className="block text-sm font-semibold text-gray-800 mb-1">
          What type of backup do you need? <span className="text-red-500">*</span>
        </label>
        <p className="text-xs text-gray-400 mb-3">Choose the format that best fits your future needs</p>
        {isWorkflowApp && (
          <Alert type="info" message="Workflow v1 supports Structured and Complete backup only" description="The current Workflow APIs do not provide a separate unstructured read path yet, so Files & Attachments is hidden for this app." className="mb-3" />
        )}
        <div className="space-y-2.5">
          {availableBackupTypes.map(type => (
            <div
              key={type.id}
              onClick={() => { setBackupType(type.id); setServiceBackupSetupSaved(false) }}
              className="flex items-center gap-4 p-3.5 rounded-2xl border-2 cursor-pointer transition-all hover:shadow-sm"
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
      </div>

      {/* ── Destination ────────────────────────────────────────────────── */}
      <div>
        <label className="block text-sm font-semibold text-gray-800 mb-1">
          Where to save the backup? <span className="text-red-500">*</span>
        </label>
        <p className="text-xs text-gray-400 mb-3">Choose your Google storage destination</p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {DESTINATION_OPTIONS
            .filter(d => backupType !== 'unstructured' || d.id === 'gdrive')
            .map(dest => {
              const bestFor = dest.id === 'gsheets' ? backupType === 'structured' : backupType !== 'structured'
              return (
                <div
                  key={dest.id}
                  onClick={() => selectDestination(dest.id)}
                  className="relative border-2 rounded-2xl p-3.5 cursor-pointer transition-all hover:shadow-sm"
                  style={{
                    borderColor: storageDestination === dest.id ? dest.color : '#e5e7eb',
                    backgroundColor: storageDestination === dest.id ? `${dest.color}0d` : '#fff',
                  }}
                >
                  {bestFor && backupType && (
                    <span className="absolute -top-2 left-3 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-white border"
                      style={{ borderColor: dest.color, color: dest.color }}>
                      Best fit
                    </span>
                  )}
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: `${dest.color}18`, color: dest.color }}>
                      {dest.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-sm mb-0.5" style={{ color: storageDestination === dest.id ? dest.color : '#1f2937' }}>{dest.title}</p>
                      <p className="text-xs text-gray-400 leading-relaxed">{dest.desc}</p>
                    </div>
                  </div>
                  {storageDestination === dest.id && (
                    <div className="absolute top-3 right-3"><CheckCircle className="w-4 h-4" style={{ color: dest.color }} /></div>
                  )}
                </div>
              )
            })}
        </div>
      </div>

      {storageDestination && (
        <div>
          <label className="block text-sm font-semibold text-gray-800 mb-1">Reuse a saved destination</label>
          <p className="text-xs text-gray-400 mb-3">Apply a reusable Google Drive or Google Sheets destination profile, then tweak the account or folder below if this flow needs a small override.</p>

          <div className="rounded-2xl border border-gray-200 bg-white p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2">
                <Link2 className="w-4 h-4 text-blue-600 mt-0.5" />
                <div>
                  <div className="text-sm font-semibold text-gray-800">Saved destination profiles</div>
                  <div className="text-xs text-gray-400 mt-1">Only profiles matching the selected destination type are shown here.</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => loadSavedDestinationProfiles(storageDestination)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Refresh
              </button>
            </div>

            {destinationProfileId && (
              <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                This flow is currently using a saved destination profile. Changing auth mode, account, or folder below will detach it from that profile.
              </div>
            )}

            {loadingSavedDestinationProfiles ? (
              <div className="flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-3 text-sm text-gray-500">
                <Spinner />
                <span>Loading saved destinations…</span>
              </div>
            ) : savedDestinationProfiles.length > 0 ? (
              <div className="grid gap-2 md:grid-cols-2">
                {savedDestinationProfiles.map(profile => {
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
                      <div className="flex items-center justify-between gap-2">
                        <span className={`text-sm font-semibold ${isActive ? 'text-blue-700' : 'text-gray-800'}`}>{profile.name}</span>
                        {isActive && <CheckCircle className="w-4 h-4 text-blue-600 shrink-0" />}
                      </div>
                      <div className="mt-1 text-xs text-gray-500">{profile.connection_label || (profile.auth_mode === 'service_account' ? 'Platform service account' : 'Google OAuth')}</div>
                      <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-gray-400">
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-600">{profile.destination_name}</span>
                        {profile.folder_name && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-600">{profile.folder_name}</span>}
                        {profile.drive_name && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-600">{profile.drive_name}</span>}
                      </div>
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-gray-200 px-4 py-4 text-sm text-gray-500">
                No saved destination profiles yet for {storageDestination === 'gsheets' ? 'Google Sheets' : 'Google Drive'}.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Google Account ─────────────────────────────────────────────── */}
      {storageDestination && (
        <div>
          <label className="block text-sm font-semibold text-gray-800 mb-1">
            Connect Google Account <span className="text-red-500">*</span>
          </label>
          <p className="text-xs text-gray-400 mb-3">
            Sign in once with the Google email that should write backup data to {storageDestination === 'gsheets' ? 'Google Sheets' : 'Google Drive'}.
          </p>

          <div className="space-y-2.5">
            {[
              { id: 'oauth', title: 'Google OAuth', desc: 'Connect a Google account once and reuse it for both Google Drive and Google Sheets', color: '#2563eb', recommended: true },
              { id: 'service_account', title: 'Service account', desc: 'Use the shared platform credential or upload your own JSON key for this flow', color: '#7c3aed', recommended: false },
            ].map(method => (
              <div
                key={method.id}
                onClick={() => { clearAppliedDestinationProfile(); setGoogleAuthMethod(method.id); setGoogleAuth(null); setServiceAccountAnalysis(null); setServiceAccountFileName(''); setServiceAccountError(''); setServiceBackupSetupSaved(false) }}
                className="flex items-center gap-4 p-3.5 rounded-2xl border-2 cursor-pointer transition-all hover:shadow-sm"
                style={{
                  borderColor: googleAuthMethod === method.id ? method.color : '#e5e7eb',
                  backgroundColor: googleAuthMethod === method.id ? `${method.color}0d` : '#fff',
                }}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-bold text-sm" style={{ color: googleAuthMethod === method.id ? method.color : '#1f2937' }}>{method.title}</span>
                    {method.recommended && <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700">Easiest</span>}
                  </div>
                  <p className="text-xs text-gray-500 leading-relaxed">{method.desc}</p>
                </div>
                <div className="w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0"
                  style={{ borderColor: googleAuthMethod === method.id ? method.color : '#d1d5db', backgroundColor: googleAuthMethod === method.id ? method.color : 'transparent' }}>
                  {googleAuthMethod === method.id && <Check className="w-3 h-3 text-white" />}
                </div>
              </div>
            ))}
          </div>

          {/* OAuth connect */}
          {googleAuthMethod === 'oauth' && (
            <div className="mt-4">
              {googleAuth ? (
                <div className="bg-green-50 border border-green-200 rounded-2xl px-4 py-4 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    {googleAuth.picture_url
                      ? <img src={googleAuth.picture_url} alt="" className="w-10 h-10 rounded-full border-2 border-green-300" />
                      : <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center"><CheckCircle className="w-5 h-5 text-green-600" /></div>}
                    <div>
                      <div className="text-[10px] font-bold text-green-700 uppercase tracking-wide mb-0.5">Connected</div>
                      <div className="text-sm font-bold text-green-800">{googleAuth.display_name || googleAuth.email}</div>
                      <div className="text-xs text-green-600">{googleAuth.email}</div>
                    </div>
                  </div>
                  <button onClick={handleGoogleDisconnect}
                    className="text-xs px-3 py-1.5 border border-red-300 text-red-600 rounded-lg hover:bg-red-50 transition-colors font-medium">
                    Disconnect
                  </button>
                </div>
              ) : (
                <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 space-y-3">
                  <p className="text-xs text-blue-600">Google OAuth in appbi-ai is a reusable connection. Pick an existing saved Google account below, or connect a new one.</p>
                  {loadingSavedGoogleConnections && (
                    <div className="flex items-center gap-2 rounded-xl border border-blue-200 bg-white/80 px-3 py-2 text-xs text-blue-700">
                      <Spinner />
                      <span>Loading saved Google connections…</span>
                    </div>
                  )}
                  {!loadingSavedGoogleConnections && savedGoogleConnections.length > 0 && (
                    <div className="rounded-2xl border border-blue-200 bg-white/80 p-3 space-y-2">
                      <div className="text-xs font-semibold text-gray-700">Saved Google connections</div>
                      {savedGoogleConnections.map(conn => (
                        <button
                          key={conn.id}
                          onClick={() => selectSavedGoogleConnection(conn)}
                          className="w-full rounded-xl border border-gray-200 px-3 py-2 text-left transition-colors hover:border-blue-300 hover:bg-blue-50"
                        >
                          <div className="text-sm font-semibold text-gray-800">{conn.display_name || conn.email}</div>
                          <div className="text-xs text-gray-500">{conn.email}</div>
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2 flex-wrap">
                    <button onClick={handleGoogleConnect}
                      className="flex items-center gap-2 px-4 py-2.5 text-sm bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-semibold">
                      <Globe className="w-4 h-4" /> Connect Google OAuth
                    </button>
                    <button onClick={openGoogleConfigModal}
                      className="px-4 py-2.5 text-sm border border-gray-300 text-gray-600 rounded-xl hover:bg-gray-50 transition-colors">
                      Configure OAuth Client
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Service Account upload */}
          {googleAuthMethod === 'service_account' && (
            <div className="mt-4 space-y-3">
              {platformServiceAccount?.available ? (
                <div className="bg-violet-50 border border-violet-200 rounded-2xl p-4 space-y-2">
                  <div className="flex items-center gap-2 mb-1">
                    <CheckCircle className="w-4 h-4 text-violet-600" />
                    <span className="text-sm font-bold text-violet-800">Platform credential active</span>
                  </div>
                  <p className="text-xs text-violet-700 leading-relaxed">
                    Like appbi-ai, this shared service account can be reused for both Google Drive and Google Sheets.
                    Share the destination with <span className="font-semibold">{platformServiceAccount.email}</span>.
                  </p>
                  <p className="text-xs text-violet-600">You can still upload another service account JSON below to override this flow only, or manage the shared credential from `.env` with `GCP_SERVICE_ACCOUNT_*` fields.</p>
                </div>
              ) : (
                <Alert type="warning" message="Shared platform credential is not configured" description="Set `GCP_SERVICE_ACCOUNT_*` in `.env` or upload a Google service account JSON key to continue with service account mode." />
              )}

              <div className="border-2 border-dashed border-gray-200 rounded-2xl p-5 hover:border-purple-300 transition-colors">
                <p className="text-sm font-semibold text-gray-700 mb-1">{platformServiceAccount?.available ? 'Optional service account JSON override' : 'Upload service account JSON file'}</p>
                <p className="text-xs text-gray-400 mb-3">
                  {platformServiceAccount?.available
                    ? 'Upload a different Google Cloud service account key only if this flow should not use the shared platform credential.'
                    : 'Download the .json key file from Google Cloud Console → IAM & Admin → Service Accounts → Keys.'}
                </p>
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={handleServiceAccountFileUpload}
                  className="text-sm text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border file:border-gray-300 file:text-xs file:font-medium file:bg-white file:text-gray-700 hover:file:bg-gray-50"
                />
                {serviceAccountFileName && (
                  <div className="flex items-center gap-1.5 mt-2 text-xs text-gray-500">
                    <CheckCircle className="w-3.5 h-3.5 text-green-500" /><span>Uploaded: {serviceAccountFileName}</span>
                  </div>
                )}
              </div>

              {serviceAccountError && <Alert type="error" message={serviceAccountError} />}
              {serviceAccountAnalysisLoading && <div className="flex items-center gap-2 py-4 text-sm text-gray-500"><Spinner /><span>Analyzing file…</span></div>}

              {serviceAccountEmail && !serviceAccountAnalysisLoading && (
                <div className="bg-purple-50 border border-purple-200 rounded-2xl p-4 space-y-2">
                  <div className="flex items-center gap-2 mb-1">
                    <CheckCircle className="w-4 h-4 text-purple-600" />
                    <span className="text-sm font-bold text-purple-800">Service Account Verified</span>
                  </div>
                  <div className="space-y-1.5 text-sm">
                    <div className="flex gap-2"><span className="text-xs text-gray-400 w-20 shrink-0 pt-0.5">Email</span><span className="font-semibold text-gray-800 break-all">{serviceAccountEmail}</span></div>
                    <div className="flex gap-2"><span className="text-xs text-gray-400 w-20 shrink-0 pt-0.5">Project</span><span className="font-semibold text-gray-800">{projectId || '—'}</span></div>
                    {availableDrives.length > 0 && (
                      <div className="flex gap-2"><span className="text-xs text-gray-400 w-20 shrink-0 pt-0.5">Shared Drives</span>
                        <div className="flex flex-wrap gap-1">{availableDrives.map(d => <Tag key={d.id} color="default">{d.name}</Tag>)}</div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Folder picker trigger ──────────────────────────────────────── */}
      {storageDestination && googleAuth && (
        <div>
          <label className="block text-sm font-semibold text-gray-800 mb-1">
            Storage Folder <span className="text-xs text-gray-400 font-normal">(optional)</span>
          </label>
          <p className="text-xs text-gray-400 mb-2">Pick a Google Drive folder where backup files or new spreadsheets should be created. Defaults to My Drive root if not selected.</p>
          <button onClick={handleOpenFolderPicker}
            className="w-full border-2 border-dashed border-gray-200 rounded-xl px-4 py-3.5 text-sm flex items-center gap-3 hover:border-blue-400 hover:bg-blue-50/30 transition-all text-left">
            <Folder className={`w-5 h-5 shrink-0 ${googleAuth.folder_name ? 'text-amber-500' : 'text-gray-400'}`} />
            <span className={googleAuth.folder_name ? 'font-medium text-gray-800' : 'text-gray-400'}>
              {googleAuth.folder_name ? `📁 ${googleAuth.folder_name}` : 'Click to choose folder…'}
            </span>
            {!googleAuth.folder_name && <span className="ml-auto text-xs text-gray-400">Optional</span>}
          </button>
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
