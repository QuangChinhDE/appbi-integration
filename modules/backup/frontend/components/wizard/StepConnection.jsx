import React from 'react'
import { Globe, Eye, EyeOff, Info } from 'lucide-react'

/**
 * Request app Step 2 — domain + access token.
 */
const StepConnection = ({ wizard }) => {
  const {
    clearAppliedSourceConnection,
    domain, setDomain,
    accessTokenV2, setAccessTokenV2,
    showTokenV2, setShowTokenV2,
  } = wizard

  return (
    <div className="w-full max-w-none space-y-6">
      <div className="border border-brand/20 rounded-xl p-6 bg-brand/10">
        <div className="flex items-center gap-2">
          <Globe className="w-5 h-5 text-brand" />
          <h4 className="text-caption font-strong text-brand">Request System Connection</h4>
        </div>

        <div className="mt-5 grid gap-5 xl:grid-cols-2">
          <div>
            <label className="block text-caption font-strong text-text-secondary mb-1">Domain <span className="text-danger">*</span></label>
            <p className="text-tiny text-text-quaternary mb-2">
              Your system address, e.g. <code className="bg-surface-1 px-1 rounded border border-[rgb(var(--border-line))]">company.base.com.vn</code>
            </p>
            <input
              className="w-full rounded-md border border-[rgb(var(--border-strong))] bg-surface-0 px-3 py-2 text-caption text-text-primary placeholder:text-text-quaternary focus:border-brand focus:shadow-focus-brand focus:outline-none transition-colors"
              placeholder="e.g. company.base.com.vn"
              value={domain}
              onChange={e => { clearAppliedSourceConnection(); setDomain(e.target.value) }}
            />
          </div>

          <div>
            <label className="block text-caption font-strong text-text-secondary mb-1">Access Token (V2) <span className="text-danger">*</span></label>
            <p className="text-tiny text-text-quaternary mb-2">From <strong>Settings</strong> → <strong>API Keys</strong> → copy your Base Account <em>access_token_v2</em></p>
            <div className="relative">
              <input
                type={showTokenV2 ? 'text' : 'password'}
                className="w-full rounded-md border border-[rgb(var(--border-strong))] bg-surface-0 px-3 py-2 pr-12 text-caption text-text-primary placeholder:text-text-quaternary focus:border-brand focus:shadow-focus-brand focus:outline-none transition-colors"
                placeholder="Paste your access token here…"
                value={accessTokenV2}
                onChange={e => { clearAppliedSourceConnection(); setAccessTokenV2(e.target.value) }}
              />
              <button type="button" onClick={() => setShowTokenV2(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-quaternary hover:text-text-secondary p-1"
                title={showTokenV2 ? 'Hide' : 'Show'}>
                {showTokenV2 ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-warning/10 border border-warning/20 rounded-md p-4 flex gap-3">
        <Info className="w-4 h-4 text-warning shrink-0 mt-0.5" />
        <div className="text-tiny text-warning leading-relaxed">
          <strong>Security note:</strong> Your access token is encrypted and stored securely. Never share it with others.
        </div>
      </div>
    </div>
  )
}

export default StepConnection
