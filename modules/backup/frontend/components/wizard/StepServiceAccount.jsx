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
    <div className="max-w-xl space-y-6">
      {/* Upload area */}
      {platformServiceAccount?.available ? (
        <div className="bg-violet-50 border border-violet-200 rounded-2xl p-5 space-y-2">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-violet-600" />
            <span className="text-sm font-bold text-violet-800">Platform credential active</span>
          </div>
          <p className="text-xs text-violet-700 leading-relaxed">
            This flow can use the shared service account, similar to appbi-ai. Share the target Drive folder or Sheet with <span className="font-semibold">{platformServiceAccount.email}</span>.
          </p>
          <p className="text-xs text-violet-600">Upload another JSON key below only if you want to override the shared credential.</p>
        </div>
      ) : (
        <Alert type="warning" message="Shared platform credential is not configured" description="Upload a Google service account JSON key to continue with service account mode." />
      )}

      <div className="border-2 border-dashed border-gray-200 rounded-2xl p-6 hover:border-purple-300 transition-colors">
        <div className="flex items-center gap-2 mb-1">
          <Lock className="w-4 h-4 text-purple-600" />
          <p className="text-sm font-bold text-gray-800">{platformServiceAccount?.available ? 'Optional Google Service Account JSON override' : 'Upload Google Service Account JSON'}</p>
        </div>
        <p className="text-xs text-gray-400 mb-4 leading-relaxed">
          {platformServiceAccount?.available
            ? <>Upload a different <code className="bg-gray-100 px-1 rounded">.json</code> key only when this flow should not use the shared platform credential.</>
            : <>Go to <strong>Google Cloud Console</strong> → <strong>IAM &amp; Admin</strong> → <strong>Service Accounts</strong> → select account → <strong>Keys</strong> tab → <strong>Add Key</strong> → download <code className="bg-gray-100 px-1 rounded">.json</code> file</>}
        </p>
        <input
          type="file"
          accept=".json,application/json"
          onChange={handleServiceAccountFileUpload}
          className="text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border file:border-gray-300 file:text-xs file:font-semibold file:bg-white file:text-gray-700 hover:file:bg-gray-50"
        />
        {serviceAccountFileName && (
          <div className="flex items-center gap-1.5 mt-3 text-xs text-gray-500">
            <CheckCircle className="w-3.5 h-3.5 text-green-500" />
            <span>Uploaded: {serviceAccountFileName}</span>
          </div>
        )}
      </div>

      {serviceAccountError && <Alert type="error" message={serviceAccountError} />}

      {serviceAccountAnalysisLoading && (
        <div className="flex items-center gap-2 py-4 text-sm text-gray-500"><Spinner /> Analyzing file…</div>
      )}

      {/* Analysis result */}
      {serviceAccountEmail && !serviceAccountAnalysisLoading && (
        <div className="bg-purple-50 border border-purple-200 rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-purple-600" />
            <span className="text-sm font-bold text-purple-800">Service Account Confirmed</span>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex gap-3">
              <span className="text-xs text-gray-400 w-20 shrink-0 pt-0.5">Email</span>
              <span className="font-semibold text-gray-800 break-all">{serviceAccountEmail}</span>
            </div>
            <div className="flex gap-3">
              <span className="text-xs text-gray-400 w-20 shrink-0 pt-0.5">Project</span>
              <span className="font-semibold text-gray-800">{projectId || '—'}</span>
            </div>
            {availableDrives.length > 0 && (
              <div className="flex gap-3">
                <span className="text-xs text-gray-400 w-20 shrink-0 pt-0.5">Shared Drives</span>
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
          <label className="block text-sm font-semibold text-gray-800 mb-1">
            Storage Folder <span className="text-xs text-gray-400 font-normal">(optional)</span>
          </label>
          <p className="text-xs text-gray-400 mb-2">
            Choose a folder in Google Drive for your backup. Only Shared Drive folders are supported with Service Account.
          </p>
          <button
            onClick={handleOpenFolderPicker}
            className="w-full border-2 border-dashed border-gray-200 rounded-xl px-4 py-3.5 text-sm flex items-center gap-3 hover:border-purple-400 hover:bg-purple-50/30 transition-all text-left"
          >
            <Folder className={`w-5 h-5 shrink-0 ${googleAuth.folder_name ? 'text-amber-500' : 'text-gray-400'}`} />
            <span className={googleAuth.folder_name ? 'font-medium text-gray-800' : 'text-gray-400'}>
              {googleAuth.folder_name ? `📁 ${googleAuth.folder_name}` : 'Click to choose a folder…'}
            </span>
          </button>
          {folderSummary && (
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              <Tag color={folderSummary.color}>{folderSummary.tag}</Tag>
              <Tag color="default">{folderSummary.driveName}</Tag>
              <span className="text-xs text-gray-400 self-center">{folderSummary.help}</span>
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
