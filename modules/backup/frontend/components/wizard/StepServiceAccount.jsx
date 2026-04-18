import React from 'react'
import { Lock, CheckCircle, Folder, Info } from 'lucide-react'
import { Tag, Alert, Spinner } from '@packages/ui/src/components/common/ui'

/**
 * Service Account step — JSON upload + analysis + optional folder picker.
 */
const StepServiceAccount = ({ wizard }) => {
  const {
    serviceAccountAnalysis, serviceAccountAnalysisLoading,
    serviceAccountFileName, serviceAccountError,
    platformServiceAccount,
    googleAuth, googleAuthMethod, storageDestination,
    handleServiceAccountFileUpload, handleOpenFolderPicker,
    getGoogleDriveRunBlockedReason, getGoogleDriveFolderSummary,
    resolvedGoogleAuthMethod,
  } = wizard

  const analysis = serviceAccountAnalysis || {}
  const availableDrives = Array.isArray(analysis.drives) ? analysis.drives : []
  const serviceAccountEmail = analysis.client_email || googleAuth?.service_account_email || googleAuth?.email
  const projectId = analysis.project_id || googleAuth?.project_id

  const folderSummary = getGoogleDriveFolderSummary(googleAuth, resolvedGoogleAuthMethod, storageDestination)
  const blockedReason = getGoogleDriveRunBlockedReason()

  return (
    <div className="w-full max-w-none space-y-6">
      {/* Upload area */}
      {platformServiceAccount?.available ? (
        <div className="bg-[#7c3aed]/10 border border-[#7c3aed]/20 rounded-xl p-5 space-y-2">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-[#7c3aed]" />
            <span className="text-caption font-strong text-[#7c3aed]">Platform credential active</span>
          </div>
          <p className="text-tiny text-[#7c3aed] leading-relaxed">
            This flow can use the shared service account, similar to appbi-ai. Share the target Drive folder or Sheet with <span className="font-strong">{platformServiceAccount.email}</span>.
          </p>
          <p className="text-tiny text-[#7c3aed]">Upload another JSON key below only if you want to override the shared credential.</p>
        </div>
      ) : (
        <Alert type="warning" message="Shared platform credential is not configured" description="Upload a Google service account JSON key to continue with service account mode." />
      )}

      <div className="border-2 border-dashed border-[rgb(var(--border-line))] rounded-xl p-6 hover:border-[#7c3aed]/30 transition-colors">
        <div className="flex items-center gap-2 mb-1">
          <Lock className="w-4 h-4 text-[#7c3aed]" />
          <p className="text-caption font-strong text-text-primary">{platformServiceAccount?.available ? 'Optional Google Service Account JSON override' : 'Upload Google Service Account JSON'}</p>
        </div>
        <p className="text-tiny text-text-quaternary mb-4 leading-relaxed">
          {platformServiceAccount?.available
            ? <>Upload a different <code className="bg-surface-2 px-1 rounded">.json</code> key only when this flow should not use the shared platform credential.</>
            : <>Go to <strong>Google Cloud Console</strong> → <strong>IAM &amp; Admin</strong> → <strong>Service Accounts</strong> → select account → <strong>Keys</strong> tab → <strong>Add Key</strong> → download <code className="bg-surface-2 px-1 rounded">.json</code> file</>}
        </p>
        <input
          type="file"
          accept=".json,application/json"
          onChange={handleServiceAccountFileUpload}
          className="text-caption text-text-secondary file:mr-3 file:py-2 file:px-4 file:rounded-md file:border file:border-[rgb(var(--border-strong))] file:text-tiny file:font-strong file:bg-surface-1 file:text-text-secondary hover:file:bg-surface-2"
        />
        {serviceAccountFileName && (
          <div className="flex items-center gap-1.5 mt-3 text-tiny text-text-tertiary">
            <CheckCircle className="w-3.5 h-3.5 text-success" />
            <span>Uploaded: {serviceAccountFileName}</span>
          </div>
        )}
      </div>

      {serviceAccountError && <Alert type="error" message={serviceAccountError} />}

      {serviceAccountAnalysisLoading && (
        <div className="flex items-center gap-2 py-4 text-caption text-text-tertiary"><Spinner /> Analyzing file…</div>
      )}

      {/* Analysis result */}
      {serviceAccountEmail && !serviceAccountAnalysisLoading && (
        <div className="bg-[#7c3aed]/10 border border-[#7c3aed]/20 rounded-xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-[#7c3aed]" />
            <span className="text-caption font-strong text-[#7c3aed]">Service Account Confirmed</span>
          </div>
          <div className="space-y-2 text-caption">
            <div className="flex gap-3">
              <span className="text-tiny text-text-quaternary w-20 shrink-0 pt-0.5">Email</span>
              <span className="font-strong text-text-primary break-all">{serviceAccountEmail}</span>
            </div>
            <div className="flex gap-3">
              <span className="text-tiny text-text-quaternary w-20 shrink-0 pt-0.5">Project</span>
              <span className="font-strong text-text-primary">{projectId || '—'}</span>
            </div>
            {availableDrives.length > 0 && (
              <div className="flex gap-3">
                <span className="text-tiny text-text-quaternary w-20 shrink-0 pt-0.5">Shared Drives</span>
                <div className="flex flex-wrap gap-1">
                  {availableDrives.map(d => <Tag key={d.id} color="default">{d.name}</Tag>)}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Folder picker for Google Drive */}
      {storageDestination === 'gdrive' && googleAuth && (
        <div>
          <label className="block text-caption font-strong text-text-primary mb-1">
            Storage Folder <span className="text-tiny text-text-quaternary font-normal">(optional)</span>
          </label>
          <p className="text-tiny text-text-quaternary mb-2">
            Choose a folder in Google Drive for your backup. Only Shared Drive folders are supported with Service Account.
          </p>
          <button
            onClick={handleOpenFolderPicker}
            className="w-full border-2 border-dashed border-[rgb(var(--border-line))] rounded-md px-4 py-3.5 text-caption flex items-center gap-3 hover:border-brand/30 hover:bg-brand/10 transition-all text-left"
          >
            <Folder className={`w-5 h-5 shrink-0 ${googleAuth.folder_name ? 'text-brand' : 'text-text-quaternary'}`} />
            <span className={googleAuth.folder_name ? 'font-emphasis text-text-primary' : 'text-text-quaternary'}>
              {googleAuth.folder_name ? `📁 ${googleAuth.folder_name}` : 'Click to choose a folder…'}
            </span>
          </button>
          {folderSummary && (
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              <Tag color={folderSummary.color}>{folderSummary.tag}</Tag>
              <Tag color="default">{folderSummary.driveName}</Tag>
              <span className="text-tiny text-text-quaternary self-center">{folderSummary.help}</span>
            </div>
          )}
          {blockedReason && (
            <Alert type="warning" message="This folder cannot be used for backup" description={blockedReason} className="mt-2" />
          )}
        </div>
      )}
    </div>
  )
}

export default StepServiceAccount
