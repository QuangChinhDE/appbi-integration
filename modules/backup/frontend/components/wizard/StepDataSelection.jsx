import React from 'react'
import { Check, CheckCircle, Eye, EyeOff, Lock, Globe } from 'lucide-react'
import { APPS, APP_CONNECTION_CONFIG } from '../../constants'

/**
 * Generic Step 2 — object selection for Workflow / WeWork apps.
 * Also doubles as generic step-3 connection for non-condensed, non-request apps
 * (domain + access token).
 */
const StepDataSelection = ({ wizard }) => {
  const {
    currentApp, selectedObjects,
    handleObjectToggle, handleSelectAllObjects,
  } = wizard

  if (!currentApp) return null

  return (
    <div className="w-full max-w-none space-y-6">
      <div>
        <label className="block text-sm font-semibold text-gray-800 mb-1">
          Select data types to back up <span className="text-red-500">*</span>
        </label>
        <p className="text-xs text-gray-400 mb-4">
          Choose the data types from <strong>{currentApp.name}</strong> you want to include in the backup
        </p>

        <div className="space-y-2.5">
          {/* Select all */}
          <div
            onClick={handleSelectAllObjects}
            className="border-2 border-dashed border-gray-200 rounded-xl px-4 py-3.5 cursor-pointer hover:border-blue-300 hover:bg-blue-50/30 flex items-center gap-3 transition-all"
          >
            <div className={`w-5 h-5 rounded flex items-center justify-center border-2 transition-all ${
              selectedObjects.length === currentApp.objects.length
                ? 'bg-blue-600 border-blue-600'
                : 'border-gray-300'
            }`}>
              {selectedObjects.length === currentApp.objects.length && <Check className="w-3 h-3 text-white" />}
            </div>
            <span className="font-semibold text-sm text-gray-700">Select all data types</span>
            <span className="text-xs text-gray-400 ml-auto">{currentApp.objects.length} types</span>
          </div>

          <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {currentApp.objects.map(obj => (
              <div
                key={obj}
                onClick={() => handleObjectToggle(obj)}
                className="border-2 rounded-xl px-4 py-4 cursor-pointer transition-all flex items-center gap-3"
                style={{
                  borderColor: selectedObjects.includes(obj) ? currentApp.color : '#e5e7eb',
                  backgroundColor: selectedObjects.includes(obj) ? currentApp.bg : '#fff',
                }}
              >
                <div
                  className="w-5 h-5 rounded flex items-center justify-center border-2 transition-all shrink-0"
                  style={{
                    backgroundColor: selectedObjects.includes(obj) ? currentApp.color : 'transparent',
                    borderColor: selectedObjects.includes(obj) ? currentApp.color : '#d1d5db',
                  }}
                >
                  {selectedObjects.includes(obj) && <Check className="w-3 h-3 text-white" />}
                </div>
                <div className="flex-1">
                  <div className="font-semibold text-sm" style={{ color: selectedObjects.includes(obj) ? currentApp.color : '#374151' }}>
                    {currentApp.objectLabels[obj]}
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">{currentApp.name} › {currentApp.objectLabels[obj]}</div>
                </div>
                {selectedObjects.includes(obj) && (
                  <CheckCircle className="w-4 h-4 shrink-0" style={{ color: currentApp.color }} />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Generic Step 3 — connection (domain + access token) for non-service, non-request apps.
 */
export const StepGenericConnection = ({ wizard }) => {
  const {
    currentApp, connectionConfig, isServiceApp,
    clearAppliedSourceConnection,
    domain, setDomain,
    accessToken, setAccessToken, showToken, setShowToken,
    setServicePreview,
  } = wizard

  return (
    <div className="w-full max-w-none space-y-6">
      <div className="border border-blue-100 rounded-2xl p-6 bg-blue-50/40">
        <div className="flex items-center gap-2">
          <Lock className="w-5 h-5 text-blue-600" />
          <h4 className="text-sm font-bold text-blue-800">
            {connectionConfig?.stepTitle || `Connect to ${currentApp?.name}`}
          </h4>
        </div>

        <div className={`mt-5 grid gap-5 ${connectionConfig?.requiresDomain ? 'xl:grid-cols-2' : ''}`}>
          {connectionConfig?.requiresDomain && (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                {connectionConfig.domainLabel || 'Domain'} <span className="text-red-500">*</span>
              </label>
              <p className="text-xs text-gray-400 mb-2">{connectionConfig.domainHelp}</p>
              <input
                className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                placeholder={connectionConfig.domainPlaceholder}
                value={domain}
                onChange={e => { clearAppliedSourceConnection(); setDomain(e.target.value); if (isServiceApp) setServicePreview(null) }}
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">
              {connectionConfig?.tokenLabel || 'API Access Token'} <span className="text-red-500">*</span>
            </label>
            <p className="text-xs text-gray-400 mb-2">
              {connectionConfig?.tokenHelp || `Found in ${currentApp?.name} → Settings → API Keys`}
            </p>
            <div className="relative">
              <input
                type={showToken ? 'text' : 'password'}
                className="w-full border border-gray-300 rounded-xl px-4 py-3 pr-12 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                placeholder="Paste your access token here…"
                value={accessToken}
                onChange={e => { clearAppliedSourceConnection(); setAccessToken(e.target.value); if (isServiceApp) setServicePreview(null) }}
              />
              <button type="button" onClick={() => setShowToken(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1">
                {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default StepDataSelection
