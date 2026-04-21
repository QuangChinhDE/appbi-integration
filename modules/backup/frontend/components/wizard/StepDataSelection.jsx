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
    <div className="w-full max-w-none space-y-5">
      <div>
        <label className="mb-1 block text-small font-strong text-text-primary">
          Select data types to back up <span className="text-danger">*</span>
        </label>
        <p className="mb-4 text-caption text-text-quaternary">
          Choose the data types from <strong>{currentApp.name}</strong> you want to include in the backup
        </p>

        <div className="space-y-2.5">
          {/* Select all */}
          <div
            onClick={handleSelectAllObjects}
            className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-[rgb(var(--border-line))] px-4 py-4 transition-all hover:border-brand/30 hover:bg-brand/10"
          >
            <div className={`w-5 h-5 rounded flex items-center justify-center border-2 transition-all ${
              selectedObjects.length === currentApp.objects.length
                ? 'bg-brand border-brand'
                : 'border-[rgb(var(--border-strong))]'
            }`}>
              {selectedObjects.length === currentApp.objects.length && <Check className="w-3 h-3 text-white" />}
            </div>
            <span className="text-small font-emphasis text-text-secondary">Select all data types</span>
            <span className="ml-auto text-caption text-text-quaternary">{currentApp.objects.length} types</span>
          </div>

          <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {currentApp.objects.map(obj => (
              (() => {
                const isSelected = selectedObjects.includes(obj)
                return (
              <div
                key={obj}
                onClick={() => handleObjectToggle(obj)}
                className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-4 transition-all ${isSelected ? '' : 'border-[rgb(var(--border-line))] bg-surface-1 hover:border-brand/20 hover:bg-brand/5'}`}
                style={isSelected ? { borderColor: currentApp.color, backgroundColor: currentApp.bg } : undefined}
              >
                <div
                  className="w-5 h-5 rounded flex items-center justify-center border-2 transition-all shrink-0"
                  style={{
                    backgroundColor: isSelected ? currentApp.color : 'transparent',
                    borderColor: isSelected ? currentApp.color : '#d1d5db',
                  }}
                >
                  {isSelected && <Check className="w-3 h-3 text-white" />}
                </div>
                <div className="flex-1">
                  <div className="text-small font-emphasis" style={{ color: isSelected ? currentApp.color : '#374151' }}>
                    {currentApp.objectLabels[obj]}
                  </div>
                  <div className="mt-0.5 text-caption text-text-quaternary">{currentApp.name} › {currentApp.objectLabels[obj]}</div>
                </div>
                {isSelected && (
                  <CheckCircle className="w-4 h-4 shrink-0" style={{ color: currentApp.color }} />
                )}
              </div>
                )
              })()
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
    <div className="w-full max-w-none space-y-5">
      <div className="rounded-xl border border-brand/20 bg-brand/10 p-5">
        <div className="flex items-center gap-2">
          <Lock className="w-5 h-5 text-brand" />
          <h4 className="text-small font-strong text-brand">
            {connectionConfig?.stepTitle || `Connect to ${currentApp?.name}`}
          </h4>
        </div>

        <div className={`mt-5 grid gap-5 ${connectionConfig?.requiresDomain ? 'xl:grid-cols-2' : ''}`}>
          {connectionConfig?.requiresDomain && (
            <div>
              <label className="mb-1 block text-label font-emphasis text-text-secondary">
                {connectionConfig.domainLabel || 'Domain'} <span className="text-danger">*</span>
              </label>
              <p className="mb-2 text-caption text-text-quaternary">{connectionConfig.domainHelp}</p>
              <input
                className="w-full rounded-md border border-[rgb(var(--border-strong))] bg-surface-0 px-3.5 py-2.5 text-small text-text-primary placeholder:text-text-quaternary transition-colors focus:border-brand focus:shadow-focus-brand focus:outline-none"
                placeholder={connectionConfig.domainPlaceholder}
                value={domain}
                onChange={e => { clearAppliedSourceConnection(); setDomain(e.target.value); if (isServiceApp) setServicePreview(null) }}
              />
            </div>
          )}

          <div>
            <label className="mb-1 block text-label font-emphasis text-text-secondary">
              {connectionConfig?.tokenLabel || 'API Access Token'} <span className="text-danger">*</span>
            </label>
            <p className="mb-2 text-caption text-text-quaternary">
              {connectionConfig?.tokenHelp || `Found in ${currentApp?.name} → Settings → API Keys`}
            </p>
            <div className="relative">
              <input
                type={showToken ? 'text' : 'password'}
                className="w-full rounded-md border border-[rgb(var(--border-strong))] bg-surface-0 px-3.5 py-2.5 pr-12 text-small text-text-primary placeholder:text-text-quaternary transition-colors focus:border-brand focus:shadow-focus-brand focus:outline-none"
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
