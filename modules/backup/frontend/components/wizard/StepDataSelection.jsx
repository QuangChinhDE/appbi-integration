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
        <label className="block text-caption font-strong text-text-primary mb-1">
          Select data types to back up <span className="text-danger">*</span>
        </label>
        <p className="text-tiny text-text-quaternary mb-4">
          Choose the data types from <strong>{currentApp.name}</strong> you want to include in the backup
        </p>

        <div className="space-y-2.5">
          {/* Select all */}
          <div
            onClick={handleSelectAllObjects}
            className="border-2 border-dashed border-[rgb(var(--border-line))] rounded-md px-4 py-3.5 cursor-pointer hover:border-brand/30 hover:bg-brand/10 flex items-center gap-3 transition-all"
          >
            <div className={`w-5 h-5 rounded flex items-center justify-center border-2 transition-all ${
              selectedObjects.length === currentApp.objects.length
                ? 'bg-brand border-brand'
                : 'border-[rgb(var(--border-strong))]'
            }`}>
              {selectedObjects.length === currentApp.objects.length && <Check className="w-3 h-3 text-white" />}
            </div>
            <span className="font-strong text-caption text-text-secondary">Select all data types</span>
            <span className="text-tiny text-text-quaternary ml-auto">{currentApp.objects.length} types</span>
          </div>

          <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {currentApp.objects.map(obj => (
              <div
                key={obj}
                onClick={() => handleObjectToggle(obj)}
                className="border-2 rounded-md px-4 py-4 cursor-pointer transition-all flex items-center gap-3"
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
                  <div className="font-strong text-caption" style={{ color: selectedObjects.includes(obj) ? currentApp.color : '#374151' }}>
                    {currentApp.objectLabels[obj]}
                  </div>
                  <div className="text-tiny text-text-quaternary mt-0.5">{currentApp.name} › {currentApp.objectLabels[obj]}</div>
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
      <div className="border border-brand/20 rounded-xl p-6 bg-brand/10">
        <div className="flex items-center gap-2">
          <Lock className="w-5 h-5 text-brand" />
          <h4 className="text-caption font-strong text-brand">
            {connectionConfig?.stepTitle || `Connect to ${currentApp?.name}`}
          </h4>
        </div>

        <div className={`mt-5 grid gap-5 ${connectionConfig?.requiresDomain ? 'xl:grid-cols-2' : ''}`}>
          {connectionConfig?.requiresDomain && (
            <div>
              <label className="block text-caption font-strong text-text-secondary mb-1">
                {connectionConfig.domainLabel || 'Domain'} <span className="text-danger">*</span>
              </label>
              <p className="text-tiny text-text-quaternary mb-2">{connectionConfig.domainHelp}</p>
              <input
                className="w-full rounded-md border border-[rgb(var(--border-strong))] bg-surface-0 px-3 py-2 text-caption text-text-primary placeholder:text-text-quaternary focus:border-brand focus:shadow-focus-brand focus:outline-none transition-colors"
                placeholder={connectionConfig.domainPlaceholder}
                value={domain}
                onChange={e => { clearAppliedSourceConnection(); setDomain(e.target.value); if (isServiceApp) setServicePreview(null) }}
              />
            </div>
          )}

          <div>
            <label className="block text-caption font-strong text-text-secondary mb-1">
              {connectionConfig?.tokenLabel || 'API Access Token'} <span className="text-danger">*</span>
            </label>
            <p className="text-tiny text-text-quaternary mb-2">
              {connectionConfig?.tokenHelp || `Found in ${currentApp?.name} → Settings → API Keys`}
            </p>
            <div className="relative">
              <input
                type={showToken ? 'text' : 'password'}
                className="w-full rounded-md border border-[rgb(var(--border-strong))] bg-surface-0 px-3 py-2 pr-12 text-caption text-text-primary placeholder:text-text-quaternary focus:border-brand focus:shadow-focus-brand focus:outline-none transition-colors"
                placeholder="Paste your access token here…"
                value={accessToken}
                onChange={e => { clearAppliedSourceConnection(); setAccessToken(e.target.value); if (isServiceApp) setServicePreview(null) }}
              />
              <button type="button" onClick={() => setShowToken(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-quaternary hover:text-text-secondary p-1">
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
