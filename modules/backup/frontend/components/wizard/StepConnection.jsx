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
    <div className="max-w-xl space-y-6">
      <div className="border border-blue-100 rounded-2xl p-6 bg-blue-50/40 space-y-5">
        <div className="flex items-center gap-2">
          <Globe className="w-5 h-5 text-blue-600" />
          <h4 className="text-sm font-bold text-blue-800">Request System Connection</h4>
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Domain <span className="text-red-500">*</span></label>
          <p className="text-xs text-gray-400 mb-2">
            Your system address, e.g. <code className="bg-white px-1 rounded border border-gray-200">company.base.com.vn</code>
          </p>
          <input
            className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            placeholder="e.g. company.base.com.vn"
            value={domain}
            onChange={e => { clearAppliedSourceConnection(); setDomain(e.target.value) }}
          />
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Access Token (V2) <span className="text-red-500">*</span></label>
          <p className="text-xs text-gray-400 mb-2">From <strong>Settings</strong> → <strong>API Keys</strong> → copy your Base Account <em>access_token_v2</em></p>
          <div className="relative">
            <input
              type={showTokenV2 ? 'text' : 'password'}
              className="w-full border border-gray-300 rounded-xl px-4 py-3 pr-12 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              placeholder="Paste your access token here…"
              value={accessTokenV2}
              onChange={e => { clearAppliedSourceConnection(); setAccessTokenV2(e.target.value) }}
            />
            <button type="button" onClick={() => setShowTokenV2(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1"
              title={showTokenV2 ? 'Hide' : 'Show'}>
              {showTokenV2 ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-3">
        <Info className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
        <div className="text-xs text-amber-700 leading-relaxed">
          <strong>Security note:</strong> Your access token is encrypted and stored securely. Never share it with others.
        </div>
      </div>
    </div>
  )
}

export default StepConnection
