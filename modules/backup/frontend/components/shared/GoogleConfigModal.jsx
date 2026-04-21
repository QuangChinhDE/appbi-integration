import React from 'react'
import { Globe, Loader2 } from 'lucide-react'
import AppModalShell from '@packages/ui/src/components/common/AppModalShell'
import { SpinCenter, Alert } from '@packages/ui/src/components/common/ui'
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
    googleConfigModalOpen ? (
    <AppModalShell
      title="Configure Google OAuth"
      description="Enter the OAuth client details used by the integration workspace, then connect the Google account directly from this flow."
      icon={<Globe className="h-5 w-5" />}
      iconClassName="bg-brand/10 text-brand"
      onClose={() => { if (googleConfigSaving) return; setGoogleConfigModalOpen(false); setGoogleConfigError('') }}
      maxWidthClass="max-w-xl"
      footer={
        <>
          <button onClick={() => { setGoogleConfigModalOpen(false); setGoogleConfigError('') }} disabled={googleConfigSaving}
            className="rounded-md border border-[rgb(var(--border-strong))] px-4 py-2 text-label font-emphasis text-text-secondary transition-colors hover:bg-surface-2 disabled:opacity-50">Cancel</button>
          <button onClick={handleSaveGoogleConfigAndConnect} disabled={googleConfigSaving}
            className="flex items-center gap-2 rounded-md bg-brand px-4 py-2 text-label font-emphasis text-white transition-colors hover:bg-brand-hover disabled:opacity-50">
            {googleConfigSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Save & Connect Google
          </button>
        </>
      }
    >
      {googleConfigError && <Alert type="error" message={googleConfigError} className="mb-4" />}
      {googleConfigLoading ? <SpinCenter /> : (
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-label font-emphasis text-text-secondary">Client ID <span className="text-danger">*</span></label>
            <input value={gcClientId} onChange={e => setGcClientId(e.target.value)} placeholder="123456789-abc.apps.googleusercontent.com"
              className="w-full rounded-md border border-[rgb(var(--border-strong))] bg-surface-0 px-3.5 py-2.5 text-small text-text-primary placeholder:text-text-quaternary transition-colors focus:border-brand focus:shadow-focus-brand focus:outline-none" />
          </div>
          <div>
            <label className="mb-1 block text-label font-emphasis text-text-secondary">Client Secret</label>
            <input type="password" value={gcClientSecret} onChange={e => setGcClientSecret(e.target.value)}
              placeholder={googleSecretSet ? 'Leave blank to keep current secret' : 'GOCSPX-xxxxxxxxxxxxxxxx'}
              className="w-full rounded-md border border-[rgb(var(--border-strong))] bg-surface-0 px-3.5 py-2.5 text-small text-text-primary placeholder:text-text-quaternary transition-colors focus:border-brand focus:shadow-focus-brand focus:outline-none" />
            <p className="mt-1 text-caption text-text-quaternary">{googleSecretSet ? 'A secret is already stored. Leave blank to keep it.' : 'Stored encrypted in the database.'}</p>
          </div>
          <div>
            <label className="mb-1 block text-label font-emphasis text-text-secondary">Redirect URI <span className="text-danger">*</span></label>
            <input value={gcRedirectUri} onChange={e => setGcRedirectUri(e.target.value)} placeholder={DEFAULT_GOOGLE_REDIRECT}
              className="w-full rounded-md border border-[rgb(var(--border-strong))] bg-surface-0 px-3.5 py-2.5 text-small text-text-primary placeholder:text-text-quaternary transition-colors focus:border-brand focus:shadow-focus-brand focus:outline-none" />
          </div>
          <Alert type="info" message="Google Cloud Console reminder" description={`Authorized redirect URI must include ${googleRedirectUri || DEFAULT_GOOGLE_REDIRECT}`} />
        </div>
      )}
    </AppModalShell>
    ) : null
  )
}

export default GoogleConfigModal
