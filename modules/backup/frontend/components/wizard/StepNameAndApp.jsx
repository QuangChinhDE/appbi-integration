import React from 'react'
import {
  Check, CheckCircle, ChevronRight, Cloud, Globe,
  Eye, EyeOff, Loader2, Link2, RefreshCw,
} from 'lucide-react'
import { APPS } from '../../constants'

/**
 * Wizard Step 1 — Flow name + app selection.
 * For Request, Service, and Workflow in condensed mode: also includes connection and source selection.
 */
const StepNameAndApp = ({ wizard }) => {
  const {
    flowName, setFlowName,
    selectedApp, currentApp,
    setShowAppSelectionModal, handleAppSelection,
    usesCondensedServiceWizard,
    connectionConfig,
    sourceConnectionId,
    savedSourceConnections,
    loadingSavedSourceConnections,
    loadSavedSourceConnections,
    applySourceConnection,
    clearAppliedSourceConnection,
    // Condensed extras
    domain, setDomain, accessToken, setAccessToken,
    showToken, setShowToken,
    accessTokenV2, setAccessTokenV2,
    showTokenV2, setShowTokenV2,
    selectedObjects, handleObjectToggle, handleSelectAllObjects,
    requestPreview, loadingRequestPreview, selectedGroupIds,
    openRequestSelectorModal,
    servicePreview, loadingServicePreview, selectedServiceIds,
    openServiceSelectorModal,
    workflowPreview, loadingWorkflowPreview, selectedWorkflowIds,
    openWorkflowSelectorModal,
    weworkPreview, loadingWeworkPreview, selectedProjectIds,
    openWeworkSelectorModal,
    setRequestPreview, setSelectedGroupIds, setDraftSelectedGroupIds,
    setServiceSourceSetupSaved, setServicePreview,
    setSelectedServiceIds, setDraftSelectedServiceIds,
    setWorkflowPreview, setSelectedWorkflowIds, setDraftSelectedWorkflowIds,
    setWeworkPreview, setSelectedProjectIds, setDraftSelectedProjectIds,
  } = wizard
  const isRequestSelected = selectedApp === 'request'
  const isServiceSelected = selectedApp === 'service'
  const isWorkflowSelected = selectedApp === 'workflow'
  const isWeworkSelected = selectedApp === 'wework'
  const requiresDomain = Boolean(connectionConfig?.requiresDomain)
  const currentTokenValue = isRequestSelected ? accessTokenV2 : accessToken
  const setCurrentTokenValue = isRequestSelected ? setAccessTokenV2 : setAccessToken
  const showCurrentToken = isRequestSelected ? showTokenV2 : showToken
  const setShowCurrentToken = isRequestSelected ? setShowTokenV2 : setShowToken
  const canShowCondensedObjects = requiresDomain
    ? Boolean(domain.trim() && currentTokenValue.trim())
    : Boolean(currentTokenValue.trim())

  // ── Condensed Request / Service / Workflow wizard ────────────────────
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

        {currentApp && (
          <div className="border border-gray-200 rounded-2xl bg-white p-5 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-gray-800">
                  <Link2 className="w-4 h-4 text-blue-600" />
                  <span>Reuse a saved source</span>
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  Apply a saved {currentApp.name} connection, then keep adjusting the backup scope below if needed.
                </p>
              </div>
              <button
                type="button"
                onClick={() => loadSavedSourceConnections(selectedApp)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Refresh
              </button>
            </div>

            {sourceConnectionId && (
              <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                This flow is currently using a saved source template. Editing the connection details below will detach it from that template.
              </div>
            )}

            {loadingSavedSourceConnections ? (
              <div className="flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-3 text-sm text-gray-500">
                <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                <span>Loading saved sources…</span>
              </div>
            ) : savedSourceConnections.length > 0 ? (
              <div className="grid gap-2 md:grid-cols-2">
                {savedSourceConnections.map(source => {
                  const isActive = sourceConnectionId === String(source.id)
                  return (
                    <button
                      key={source.id}
                      type="button"
                      onClick={() => applySourceConnection(source.id)}
                      className={`rounded-2xl border px-4 py-3 text-left transition-all ${
                        isActive
                          ? 'border-blue-300 bg-blue-50 shadow-sm'
                          : 'border-gray-200 bg-white hover:border-blue-200 hover:bg-blue-50/40'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className={`text-sm font-semibold ${isActive ? 'text-blue-700' : 'text-gray-800'}`}>{source.name}</span>
                        {isActive && <CheckCircle className="w-4 h-4 text-blue-600 shrink-0" />}
                      </div>
                      <div className="mt-1 text-xs text-gray-500">{source.domain || 'No domain configured'}</div>
                      {source.description && <div className="mt-2 text-xs text-gray-400 line-clamp-2">{source.description}</div>}
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-gray-200 px-4 py-4 text-sm text-gray-500">
                No saved {currentApp.name} sources yet. Create one in the Source module, then come back here to reuse it.
              </div>
            )}
          </div>
        )}

        {/* Request / Service / Workflow connection */}
        {(isRequestSelected || isServiceSelected || isWorkflowSelected || isWeworkSelected) && (
          <>
            <div className="border border-blue-100 rounded-2xl p-5 bg-blue-50/50 space-y-5">
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-blue-600" />
                <h4 className="text-sm font-bold text-blue-800">
                  {connectionConfig?.stepTitle || (isServiceSelected ? 'Service Connection' : isWorkflowSelected ? 'Workflow Connection' : isWeworkSelected ? 'WeWork Connection' : 'Request Connection')}
                </h4>
              </div>
              <div className={`grid gap-5 ${requiresDomain ? 'xl:grid-cols-2' : ''}`}>
                {requiresDomain && (
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">{connectionConfig?.domainLabel || 'Domain'} <span className="text-red-500">*</span></label>
                    <p className="text-xs text-gray-400 mb-2">
                      {connectionConfig?.domainHelp || <>Your system address, e.g. <code className="bg-white px-1 rounded">company.base.com.vn</code></>}
                    </p>
                    <input className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                      placeholder={connectionConfig?.domainPlaceholder || 'e.g. company.base.com.vn'}
                      value={domain}
                      onChange={e => {
                        clearAppliedSourceConnection()
                        if (isRequestSelected) {
                          setRequestPreview(null)
                          setSelectedGroupIds([])
                          setDraftSelectedGroupIds([])
                        }
                        if (isServiceSelected) setServiceSourceSetupSaved(false)
                        setDomain(e.target.value)
                        if (isServiceSelected) {
                          setServicePreview(null)
                          setSelectedServiceIds([])
                          setDraftSelectedServiceIds([])
                        }
                        if (isWorkflowSelected) {
                          setWorkflowPreview(null)
                          setSelectedWorkflowIds([])
                          setDraftSelectedWorkflowIds([])
                        }
                        if (isWeworkSelected) {
                          setWeworkPreview(null)
                          setSelectedProjectIds([])
                          setDraftSelectedProjectIds([])
                        }
                      }} />
                  </div>
                )}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    {connectionConfig?.tokenLabel || (isServiceSelected ? 'Access Token' : isWorkflowSelected ? 'API Access Token' : 'Access Token V2')} <span className="text-red-500">*</span>
                  </label>
                  <p className="text-xs text-gray-400 mb-2">
                    {connectionConfig?.tokenHelp || (isServiceSelected
                      ? <>From Service → <strong>Settings</strong> → <strong>API Keys</strong> → <em>access_token_v2</em></>
                      : isWorkflowSelected
                        ? <>From Workflow → <strong>Settings</strong> → <strong>API Keys</strong></>
                        : isWeworkSelected
                          ? <>From WeWork → <strong>Settings</strong> → <strong>API Keys</strong> → <em>access_token_v2</em></>
                        : <>From Request → <strong>Settings</strong> → <strong>API Keys</strong> → <em>access_token_v2</em></>)}
                  </p>
                  <div className="relative">
                    <input type={showCurrentToken ? 'text' : 'password'}
                      className="w-full border border-gray-300 rounded-xl px-4 py-3 pr-12 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                      placeholder={connectionConfig?.tokenPlaceholder || 'Paste your access token here…'}
                      value={currentTokenValue}
                      onChange={e => {
                        clearAppliedSourceConnection()
                        if (isRequestSelected) {
                          setRequestPreview(null)
                          setSelectedGroupIds([])
                          setDraftSelectedGroupIds([])
                        }
                        if (isServiceSelected) {
                          setServiceSourceSetupSaved(false)
                          setServicePreview(null)
                          setSelectedServiceIds([])
                          setDraftSelectedServiceIds([])
                        }
                        if (isWorkflowSelected) {
                          setWorkflowPreview(null)
                          setSelectedWorkflowIds([])
                          setDraftSelectedWorkflowIds([])
                        }
                        if (isWeworkSelected) {
                          setWeworkPreview(null)
                          setSelectedProjectIds([])
                          setDraftSelectedProjectIds([])
                        }
                        setCurrentTokenValue(e.target.value)
                      }} />
                    <button type="button" onClick={() => setShowCurrentToken(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1"
                      title={showCurrentToken ? 'Hide' : 'Show'}>
                      {showCurrentToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Object selection */}
            {canShowCondensedObjects && (
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

            {isRequestSelected && (
              <div className="border border-gray-200 rounded-2xl p-5 bg-white space-y-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <label className="block text-sm font-semibold text-gray-800">Selected Request Groups <span className="text-red-500">*</span></label>
                    <p className="text-xs text-gray-400 mt-1">Load the Request source and choose exactly which groups this backup flow should include. Direct requests appear as the <strong>[direct]</strong> row.</p>
                  </div>
                  <button
                    onClick={openRequestSelectorModal}
                    disabled={!domain.trim() || !accessTokenV2.trim() || loadingRequestPreview}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-orange-200 bg-orange-50 px-4 py-2 text-sm font-semibold text-orange-700 transition-colors hover:bg-orange-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {loadingRequestPreview ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronRight className="w-4 h-4" />}
                    {requestPreview ? 'Change Selection' : 'Load & Select'}
                  </button>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl bg-gray-50 p-4 text-center">
                    <div className="text-2xl font-bold text-gray-800">{requestPreview?.selectable_source_count ?? '—'}</div>
                    <div className="mt-1 text-[11px] text-gray-400">Groups/direct sources loaded</div>
                  </div>
                  <div className="rounded-xl bg-orange-50 p-4 text-center">
                    <div className="text-2xl font-bold text-orange-700">{selectedGroupIds.length}</div>
                    <div className="mt-1 text-[11px] text-orange-500">Selected for backup</div>
                  </div>
                </div>

                {requestPreview && !requestPreview.request_count_complete && (
                  <p className="text-xs text-amber-600">Detailed preview is currently loaded for {requestPreview.detail_loaded_count || 0} sources. Refresh after changing the selection to update sample requests.</p>
                )}

                {requestPreview?.partial_error_count > 0 && (
                  <p className="text-xs text-amber-600">Some Request groups could not be previewed completely ({requestPreview.partial_error_count}). You can still choose from the loaded list.</p>
                )}

                {!domain.trim() || !accessTokenV2.trim() ? (
                  <p className="text-xs text-amber-600">Enter Request domain and access token first, then load the group list to choose what this flow will back up.</p>
                ) : !requestPreview ? (
                  <p className="text-xs text-amber-600">Load the Request source preview to see the full list of groups available for backup.</p>
                ) : selectedGroupIds.length === 0 ? (
                  <p className="text-xs text-amber-600">Select at least one Request group before moving to the next step.</p>
                ) : (
                  <p className="text-xs text-green-600">{selectedGroupIds.length} Request source{selectedGroupIds.length > 1 ? 's are' : ' is'} selected for this flow.</p>
                )}
              </div>
            )}

            {isServiceSelected && (
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
            )}

            {isWorkflowSelected && (
              <div className="border border-gray-200 rounded-2xl p-5 bg-white space-y-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <label className="block text-sm font-semibold text-gray-800">Selected Workflows <span className="text-red-500">*</span></label>
                    <p className="text-xs text-gray-400 mt-1">Load the Workflow source and choose exactly which workflows this backup flow should include.</p>
                  </div>
                  <button
                    onClick={openWorkflowSelectorModal}
                    disabled={!domain.trim() || !accessToken.trim() || loadingWorkflowPreview}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-4 py-2 text-sm font-semibold text-violet-700 transition-colors hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {loadingWorkflowPreview ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronRight className="w-4 h-4" />}
                    {workflowPreview ? 'Change Selection' : 'Load & Select'}
                  </button>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl bg-gray-50 p-4 text-center">
                    <div className="text-2xl font-bold text-gray-800">{workflowPreview?.workflow_count ?? '—'}</div>
                    <div className="mt-1 text-[11px] text-gray-400">Workflows loaded</div>
                  </div>
                  <div className="rounded-xl bg-violet-50 p-4 text-center">
                    <div className="text-2xl font-bold text-violet-700">{selectedWorkflowIds.length}</div>
                    <div className="mt-1 text-[11px] text-violet-500">Selected for backup</div>
                  </div>
                </div>

                {workflowPreview && !workflowPreview.job_count_complete && (
                  <p className="text-xs text-amber-600">Detailed preview is currently loaded for {workflowPreview.detail_loaded_count || 0} workflows. Refresh after changing the selection to update sample jobs.</p>
                )}

                {workflowPreview?.partial_error_count > 0 && (
                  <p className="text-xs text-amber-600">Some workflows could not be previewed completely ({workflowPreview.partial_error_count}). You can still choose from the loaded list.</p>
                )}

                {!domain.trim() || !accessToken.trim() ? (
                  <p className="text-xs text-amber-600">Enter Workflow domain and access token first, then load the workflow list to choose what this flow will back up.</p>
                ) : !workflowPreview ? (
                  <p className="text-xs text-amber-600">Load the Workflow source preview to see the full list of workflows available for backup.</p>
                ) : selectedWorkflowIds.length === 0 ? (
                  <p className="text-xs text-amber-600">Select at least one Workflow before moving to the next step.</p>
                ) : (
                  <p className="text-xs text-green-600">{selectedWorkflowIds.length} Workflow{selectedWorkflowIds.length > 1 ? 's are' : ' is'} selected for this flow.</p>
                )}
              </div>
            )}

            {isWeworkSelected && (
              <div className="border border-gray-200 rounded-2xl p-5 bg-white space-y-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <label className="block text-sm font-semibold text-gray-800">Selected Projects <span className="text-red-500">*</span></label>
                    <p className="text-xs text-gray-400 mt-1">Load the WeWork source and choose exactly which projects this backup flow should include. Tasks and subtasks will be derived from each selected project.</p>
                  </div>
                  <button
                    onClick={openWeworkSelectorModal}
                    disabled={!domain.trim() || !accessToken.trim() || loadingWeworkPreview}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-700 transition-colors hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {loadingWeworkPreview ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronRight className="w-4 h-4" />}
                    {weworkPreview ? 'Change Selection' : 'Load & Select'}
                  </button>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl bg-gray-50 p-4 text-center">
                    <div className="text-2xl font-bold text-gray-800">{weworkPreview?.project_count ?? '—'}</div>
                    <div className="mt-1 text-[11px] text-gray-400">Projects loaded</div>
                  </div>
                  <div className="rounded-xl bg-sky-50 p-4 text-center">
                    <div className="text-2xl font-bold text-sky-700">{selectedProjectIds.length}</div>
                    <div className="mt-1 text-[11px] text-sky-500">Selected for backup</div>
                  </div>
                  <div className="rounded-xl bg-indigo-50 p-4 text-center">
                    <div className="text-2xl font-bold text-indigo-700">{weworkPreview?.total_task_count ?? '—'}</div>
                    <div className="mt-1 text-[11px] text-indigo-500">Tasks previewed</div>
                  </div>
                </div>

                {weworkPreview?.catalog_warning && (
                  <p className="text-xs text-amber-600">Department catalog loaded partially: {weworkPreview.catalog_warning}</p>
                )}

                {weworkPreview && !weworkPreview.task_count_complete && (
                  <p className="text-xs text-amber-600">Detailed preview is currently loaded for {weworkPreview.detail_loaded_count || 0} projects. Refresh after changing the selection to update sample tasks.</p>
                )}

                {weworkPreview?.partial_error_count > 0 && (
                  <p className="text-xs text-amber-600">Some projects could not be previewed completely ({weworkPreview.partial_error_count}). You can still choose from the loaded list.</p>
                )}

                {!domain.trim() || !accessToken.trim() ? (
                  <p className="text-xs text-amber-600">Enter WeWork domain and access token first, then load the project list to choose what this flow will back up.</p>
                ) : !weworkPreview ? (
                  <p className="text-xs text-amber-600">Load the WeWork source preview to see the full list of projects available for backup.</p>
                ) : selectedProjectIds.length === 0 ? (
                  <p className="text-xs text-amber-600">Select at least one WeWork project before moving to the next step.</p>
                ) : (
                  <p className="text-xs text-green-600">{selectedProjectIds.length} WeWork project{selectedProjectIds.length > 1 ? 's are' : ' is'} selected for this flow.</p>
                )}
              </div>
            )}
          </>
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
