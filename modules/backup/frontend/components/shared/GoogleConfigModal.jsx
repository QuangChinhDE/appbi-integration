import React from 'react'
import { Loader2 } from 'lucide-react'
import { Modal, SpinCenter, Alert } from '@packages/ui/src/components/common/ui'
import { DEFAULT_GOOGLE_REDIRECT } from '../../constants'

const GoogleConfigModal = ({ wizard }) => {
  const {
    googleConfigModalOpen, setGoogleConfigModalOpen,
    googleConfigLoading, googleConfigSaving,
    googleSecretSet, googleRedirectUri,
    googleConfigError, setGoogleConfigError,
    gcClientId, setGcClientId,
    gcClientSecret, setGcClientSecret,
    gcRedirectUri, setGcRedirectUri,
    handleSaveGoogleConfigAndConnect,
  } = wizard

  return (
    <Modal
      title="Configure Google OAuth"
      open={googleConfigModalOpen}
      onCancel={() => { if (googleConfigSaving) return; setGoogleConfigModalOpen(false); setGoogleConfigError('') }}
      width={600}
      footer={
        <>
          <button onClick={() => { setGoogleConfigModalOpen(false); setGoogleConfigError('') }} disabled={googleConfigSaving}
            className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50">Cancel</button>
          <button onClick={handleSaveGoogleConfigAndConnect} disabled={googleConfigSaving}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
            {googleConfigSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Save & Connect Google
          </button>
        </>
      }
    >
      <p className="text-sm text-gray-500 mb-4">Enter <strong>Client ID</strong>, <strong>Client Secret</strong> and <strong>Redirect URI</strong> then connect.</p>
      {googleConfigError && <Alert type="error" message={googleConfigError} className="mb-4" />}
      {googleConfigLoading ? <SpinCenter /> : (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Client ID <span className="text-red-500">*</span></label>
            <input value={gcClientId} onChange={e => setGcClientId(e.target.value)} placeholder="123456789-abc.apps.googleusercontent.com"
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Client Secret</label>
            <input type="password" value={gcClientSecret} onChange={e => setGcClientSecret(e.target.value)}
              placeholder={googleSecretSet ? 'Leave blank to keep current secret' : 'GOCSPX-xxxxxxxxxxxxxxxx'}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <p className="text-xs text-gray-400 mt-1">{googleSecretSet ? 'A secret is already stored. Leave blank to keep it.' : 'Stored encrypted in the database.'}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Redirect URI <span className="text-red-500">*</span></label>
            <input value={gcRedirectUri} onChange={e => setGcRedirectUri(e.target.value)} placeholder={DEFAULT_GOOGLE_REDIRECT}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <Alert type="info" message="Google Cloud Console reminder" description={`Authorized redirect URI must include ${googleRedirectUri || DEFAULT_GOOGLE_REDIRECT}`} />
        </div>
      )}
    </Modal>
  )
}

export default GoogleConfigModal
