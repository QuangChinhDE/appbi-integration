import React from 'react'
import {
  Check, CheckCircle, ChevronRight, Cloud, Globe,
  Eye, EyeOff, Loader2,
} from 'lucide-react'
import { Alert } from '@packages/ui/src/components/common/ui'
import { APPS } from '../../constants'

/**
 * Wizard Step 1 — Flow name + app selection.
 * For Service app in condensed mode: also includes domain, token, objects, and next-button.
 */
const StepNameAndApp = ({ wizard }) => {
  const {
    flowName, setFlowName,
    selectedApp, currentApp,
    setShowAppSelectionModal, handleAppSelection,
    usesCondensedServiceWizard,
    // Service-condensed extras
    domain, setDomain, accessToken, setAccessToken,
    showToken, setShowToken,
    selectedObjects, handleObjectToggle, handleSelectAllObjects,
    servicePreview, loadingServicePreview, selectedServiceIds,
    openServiceSelectorModal,
    setServiceSourceSetupSaved, setServicePreview,
  } = wizard

  // ── Condensed Service wizard ──────────────────────────────────────────
  if (usesCondensedServiceWizard) {
    return (
      <div className="w-full max-w-4xl space-y-8">
        <div className="grid gap-6 xl:grid-cols-2">
          {/* Flow name */}
          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-1">
              Backup Flow Name <span className="text-red-500">*</span>
            </label>
            <p className="text-xs text-gray-400 mb-2">Give it a descriptive name, e.g. "Daily Backup — Service IT"</p>
            <input
              className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
              placeholder='e.g. "Daily Backup — Service IT"'
              value={flowName}
              onChange={e => setFlowName(e.target.value)}
              maxLength={120}
            />
          </div>

          {/* App picker */}
          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-1">
              Source Application <span className="text-red-500">*</span>
            </label>
            <p className="text-xs text-gray-400 mb-3">Choose the app whose data you want to back up</p>
            <button
              onClick={() => setShowAppSelectionModal(true)}
              className={`w-full flex items-center gap-4 px-4 py-4 rounded-xl border-2 text-left transition-all ${
                currentApp ? 'border-solid shadow-sm' : 'border-dashed border-gray-200 hover:border-blue-300 bg-white'
              }`}
              style={currentApp ? { borderColor: currentApp.color, backgroundColor: currentApp.bg } : {}}
            >
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ backgroundColor: currentApp ? `${currentApp.color}20` : '#f3f4f6', color: currentApp?.color || '#9ca3af' }}>
                {currentApp?.icon || <Cloud className="w-5 h-5" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-semibold ${currentApp ? '' : 'text-gray-400'}`}
                  style={currentApp ? { color: currentApp.color } : {}}>
                  {currentApp ? currentApp.name : 'Click to choose an app…'}
                </p>
                {currentApp
                  ? <p className="text-xs mt-0.5" style={{ color: `${currentApp.color}99` }}>{currentApp.description}</p>
                  : <p className="text-xs text-gray-400 mt-0.5">Request, Workflow, WeWork, Service…</p>}
              </div>
              {currentApp
                ? <CheckCircle className="w-5 h-5 shrink-0" style={{ color: currentApp.color }} />
                : <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />}
            </button>
          </div>
        </div>

        {/* Service credentials */}
        {selectedApp === 'service' && (
          <>
            <div className="border border-blue-100 rounded-2xl p-5 bg-blue-50/50 space-y-5">
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-blue-600" />
                <h4 className="text-sm font-bold text-blue-800">Service Connection</h4>
              </div>
              <div className="grid gap-5 xl:grid-cols-2">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Domain <span className="text-red-500">*</span></label>
                  <p className="text-xs text-gray-400 mb-2">
                    Your Service address, e.g. <code className="bg-white px-1 rounded">company.base.com.vn</code>
                  </p>
                  <input className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    placeholder="e.g. company.base.com.vn"
                    value={domain}
                    onChange={e => { setServiceSourceSetupSaved(false); setDomain(e.target.value); setServicePreview(null) }} />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Access Token <span className="text-red-500">*</span></label>
                  <p className="text-xs text-gray-400 mb-2">From Service → <strong>Settings</strong> → <strong>API Keys</strong> → <em>access_token_v2</em></p>
                  <div className="relative">
                    <input type={showToken ? 'text' : 'password'}
                      className="w-full border border-gray-300 rounded-xl px-4 py-3 pr-12 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                      placeholder="Paste your access token here…"
                      value={accessToken}
                      onChange={e => { setServiceSourceSetupSaved(false); setAccessToken(e.target.value); setServicePreview(null) }} />
                    <button type="button" onClick={() => setShowToken(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1"
                      title={showToken ? 'Hide' : 'Show'}>
                      {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Object selection */}
            {(domain.trim() && accessToken.trim()) && (
              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-1">Data to Backup <span className="text-red-500">*</span></label>
                <p className="text-xs text-gray-400 mb-3">Select the data types to include in this backup</p>
                <div className="space-y-2">
                  <div onClick={handleSelectAllObjects}
                    className="border-2 border-dashed border-gray-200 rounded-xl px-4 py-3 cursor-pointer hover:border-blue-300 hover:bg-blue-50/30 flex items-center gap-3 transition-all">
                    <div className={`w-5 h-5 rounded flex items-center justify-center border-2 transition-all ${
                      selectedObjects.length === currentApp.objects.length ? 'bg-blue-600 border-blue-600' : 'border-gray-300'
                    }`}>{selectedObjects.length === currentApp.objects.length && <Check className="w-3 h-3 text-white" />}</div>
                    <span className="font-semibold text-sm text-gray-700">Select all</span>
                    <span className="text-xs text-gray-400 ml-auto">{currentApp.objects.length} data types</span>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {currentApp.objects.map(obj => (
                      <div key={obj} onClick={() => handleObjectToggle(obj)}
                        className="border-2 rounded-xl px-4 py-3.5 cursor-pointer transition-all flex items-center gap-3"
                        style={{ borderColor: selectedObjects.includes(obj) ? currentApp.color : '#e5e7eb', backgroundColor: selectedObjects.includes(obj) ? currentApp.bg : '#fff' }}>
                        <div className="w-5 h-5 rounded flex items-center justify-center border-2 transition-all shrink-0"
                          style={{ backgroundColor: selectedObjects.includes(obj) ? currentApp.color : 'transparent', borderColor: selectedObjects.includes(obj) ? currentApp.color : '#d1d5db' }}>
                          {selectedObjects.includes(obj) && <Check className="w-3 h-3 text-white" />}
                        </div>
                        <div className="flex-1">
                          <div className="font-semibold text-sm" style={{ color: selectedObjects.includes(obj) ? currentApp.color : '#374151' }}>
                            {currentApp.objectLabels[obj]}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div className="border border-gray-200 rounded-2xl p-5 bg-white space-y-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <label className="block text-sm font-semibold text-gray-800">Selected Services <span className="text-red-500">*</span></label>
                  <p className="text-xs text-gray-400 mt-1">Choose which Service workspaces this backup flow will include.</p>
                </div>
                <button
                  onClick={openServiceSelectorModal}
                  disabled={!domain.trim() || !accessToken.trim() || loadingServicePreview}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 transition-colors hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loadingServicePreview ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronRight className="w-4 h-4" />}
                  {servicePreview ? 'Change Selection' : 'Load & Select'}
                </button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl bg-gray-50 p-4 text-center">
                  <div className="text-2xl font-bold text-gray-800">{servicePreview?.service_count ?? '—'}</div>
                  <div className="mt-1 text-[11px] text-gray-400">Services loaded</div>
                </div>
                <div className="rounded-xl bg-blue-50 p-4 text-center">
                  <div className="text-2xl font-bold text-blue-700">{selectedServiceIds.length}</div>
                  <div className="mt-1 text-[11px] text-blue-500">Selected for backup</div>
                </div>
              </div>

              {!domain.trim() || !accessToken.trim() ? (
                <p className="text-xs text-amber-600">Enter Service domain and access token first, then load the service list to choose what this flow will back up.</p>
              ) : selectedServiceIds.length === 0 ? (
                <p className="text-xs text-amber-600">Select at least one Service before moving to the next step.</p>
              ) : (
                <p className="text-xs text-green-600">{selectedServiceIds.length} Service{selectedServiceIds.length > 1 ? 's are' : ' is'} selected for this flow.</p>
              )}
            </div>
          </>
        )}

        {selectedApp && selectedApp !== 'service' && (
          <Alert type="info" message="This flow uses the standard wizard" description="Click Next in the bottom bar to continue configuration." />
        )}
      </div>
    )
  }

  // ── Standard wizard (Request, Workflow, WeWork) ───────────────────────
  return (
    <div className="w-full max-w-5xl space-y-8">
      {/* Flow name */}
      <div>
        <label className="block text-sm font-semibold text-gray-800 mb-1">Backup Flow Name <span className="text-red-500">*</span></label>
        <p className="text-xs text-gray-400 mb-2">Give it a descriptive name, e.g. "Weekly Backup — Request"</p>
        <input className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          placeholder='e.g. "Weekly Backup — Request"'
          value={flowName} onChange={e => setFlowName(e.target.value)} maxLength={120} />
      </div>

      {/* App cards */}
      <div>
        <label className="block text-sm font-semibold text-gray-800 mb-1">Source Application <span className="text-red-500">*</span></label>
        <p className="text-xs text-gray-400 mb-4">Which app do you want to back up data from?</p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {Object.values(APPS).map(app => (
            <div key={app.id} onClick={() => handleAppSelection(app.id)}
              className="relative border-2 rounded-2xl p-5 cursor-pointer transition-all hover:shadow-md"
              style={{ borderColor: selectedApp === app.id ? app.color : '#e5e7eb', backgroundColor: selectedApp === app.id ? app.bg : '#fff' }}>
              {selectedApp === app.id && <div className="absolute top-3 right-3"><CheckCircle className="w-5 h-5" style={{ color: app.color }} /></div>}
              <div className="flex items-start gap-4">
                <div className="rounded-xl p-3 flex items-center justify-center shrink-0" style={{ color: app.color, backgroundColor: `${app.color}18`, width: 52, height: 52 }}>
                  {app.icon}
                </div>
                <div className="flex-1 min-w-0 pr-4">
                  <div className="font-bold text-sm mb-1" style={{ color: app.color }}>{app.name}</div>
                  <p className="text-xs text-gray-500 mb-3 leading-relaxed">{app.description}</p>
                  <div className="flex flex-wrap gap-1">
                    {app.objects.map(obj => (
                      <span key={obj} className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold"
                        style={{ backgroundColor: `${app.color}18`, color: app.color }}>
                        {app.objectLabels[obj]}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default StepNameAndApp
