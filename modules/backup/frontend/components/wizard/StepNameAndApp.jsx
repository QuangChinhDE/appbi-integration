import React from 'react'
import {
  Check, CheckCircle, ChevronRight, Cloud, Globe,
  Eye, EyeOff, Loader2, Link2, RefreshCw,
} from 'lucide-react'
import { APPS } from '../../constants'
import SearchablePickerCard from '../shared/SearchablePickerCard'

/**
 * Wizard Step 1 — Flow name + app selection.
 * For Request, Service, and Workflow in condensed mode: also includes connection and source selection.
 */
const StepNameAndApp = ({ wizard }) => {
  const {
    flowName, setFlowName,
    selectedApp, currentApp,
    handleAppSelection,
    usesCondensedServiceWizard,
    connectionConfig,
    sourceConnectionId,
    savedSourceConnections,
    loadingSavedSourceConnections,
    loadSavedSourceConnections,
    applySourceConnection,
    // Condensed extras
    domain, setDomain, accessToken, setAccessToken,
    accessTokenV2, setAccessTokenV2,
    selectedObjects, handleObjectToggle, handleSelectAllObjects,
    requestPreview, loadingRequestPreview, selectedGroupIds,
    openRequestSelectorModal,
    servicePreview, loadingServicePreview, selectedServiceIds,
    openServiceSelectorModal,
    workflowPreview, loadingWorkflowPreview, selectedWorkflowIds,
    openWorkflowSelectorModal,
    weworkPreview, loadingWeworkPreview, selectedProjectIds,
    openWeworkSelectorModal,
  } = wizard
  const isRequestSelected = selectedApp === 'request'
  const isServiceSelected = selectedApp === 'service'
  const isWorkflowSelected = selectedApp === 'workflow'
  const isWeworkSelected = selectedApp === 'wework'
  const requiresDomain = Boolean(connectionConfig?.requiresDomain)
  const currentTokenValue = isRequestSelected ? accessTokenV2 : accessToken
  const appliedSource = savedSourceConnections.find(source => String(source.id) === String(sourceConnectionId)) || null
  const canShowCondensedObjects = Boolean(
    sourceConnectionId
    && (!requiresDomain || domain.trim())
    && currentTokenValue.trim()
  )
  const [sourceSearch, setSourceSearch] = React.useState('')

  const filteredSourceConnections = React.useMemo(() => {
    const normalizedQuery = sourceSearch.trim().toLowerCase()
    const filtered = savedSourceConnections.filter((source) => {
      if (!normalizedQuery) return true
      return [
        source.name,
        source.app_name,
        source.app_id,
        source.app,
        source.domain,
        source.owner_email,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedQuery))
    })

    return [...filtered].sort((left, right) => {
      const leftActive = String(left.id) === String(sourceConnectionId)
      const rightActive = String(right.id) === String(sourceConnectionId)
      if (leftActive !== rightActive) return leftActive ? -1 : 1

      const leftMatchesSelected = selectedApp && (left.app_id || left.app) === selectedApp
      const rightMatchesSelected = selectedApp && (right.app_id || right.app) === selectedApp
      if (leftMatchesSelected !== rightMatchesSelected) return leftMatchesSelected ? -1 : 1

      return String(left.name || '').localeCompare(String(right.name || ''))
    })
  }, [savedSourceConnections, sourceSearch, sourceConnectionId, selectedApp])

  const handleSourceSearchFocus = React.useCallback(() => {
    if (!loadingSavedSourceConnections) {
      void loadSavedSourceConnections(null)
    }
  }, [loadingSavedSourceConnections, loadSavedSourceConnections])

  const sourceSummaryText = savedSourceConnections.length > 0
    ? `${filteredSourceConnections.length}/${savedSourceConnections.length} source${savedSourceConnections.length > 1 ? 's' : ''}`
    : 'No saved sources'

  // ── Condensed Request / Service / Workflow wizard ────────────────────
  if (usesCondensedServiceWizard) {
    return (
      <div className="w-full min-w-0 space-y-8">
        <div className="grid gap-6 2xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
          <div className="space-y-6">
            <section className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-gray-400">Flow identity</p>
                  <h3 className="mt-2 text-sm font-semibold text-gray-900">Name this backup flow before choosing the saved source</h3>
                  <p className="mt-1 text-xs leading-6 text-gray-500">The saved source decides the app and credentials. The flow name should explain why this backup exists.</p>
                </div>
                <div className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ${sourceConnectionId ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {sourceConnectionId ? 'Source selected' : 'Waiting for source'}
                </div>
              </div>
              <div className="mt-4">
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
            </section>

            <SearchablePickerCard
              icon={<Link2 className="h-5 w-5" />}
              title="Pick a saved source"
              description="Search by source name, app, domain, or owner. Focusing the search box will sync the latest saved sources automatically, so you should not need a manual refresh before choosing."
              searchValue={sourceSearch}
              onSearchChange={setSourceSearch}
              onSearchFocus={handleSourceSearchFocus}
              searchPlaceholder="Search saved sources…"
              summary={sourceSummaryText}
              loading={loadingSavedSourceConnections}
              loadingText="Loading saved sources…"
              isEmpty={filteredSourceConnections.length === 0}
              action={(
                <button
                  type="button"
                  onClick={() => loadSavedSourceConnections(null)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Sync now
                </button>
              )}
              emptyState={(
                <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-4 py-5 text-sm text-gray-500">
                  {savedSourceConnections.length === 0
                    ? 'No saved sources yet. Create one in the Apps module, then come back here to reuse it.'
                    : 'No saved source matches your search. Try another keyword.'}
                </div>
              )}
            >
              <div className="max-h-[28rem] overflow-y-auto pr-1">
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {filteredSourceConnections.map(source => {
                    const isActive = sourceConnectionId === String(source.id)
                    const sourceAppId = source.app_id || source.app
                    const sourceApp = APPS[sourceAppId]
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
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className={`truncate text-sm font-semibold ${isActive ? 'text-blue-700' : 'text-gray-800'}`}>{source.name}</div>
                            <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-gray-400">
                              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-600">{source.app_name || sourceApp?.name || sourceAppId || 'Source'}</span>
                              {source.domain && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-600">{source.domain}</span>}
                            </div>
                          </div>
                          {isActive && <CheckCircle className="mt-0.5 w-4 h-4 text-blue-600 shrink-0" />}
                        </div>
                        {source.owner_email && <div className="mt-2 text-xs text-gray-400">Owner: {source.owner_email}</div>}
                      </button>
                    )
                  })}
                </div>
              </div>
            </SearchablePickerCard>
          </div>

          <div className="space-y-6">
            <section className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-gray-400">Resolved application</p>
                  <h3 className="mt-2 text-sm font-semibold text-gray-900">The app is derived from the saved source</h3>
                </div>
                <div className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ${currentApp ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                  {currentApp ? 'Ready' : 'Not resolved yet'}
                </div>
              </div>

              <div
                className={`mt-4 w-full flex items-center gap-4 px-4 py-4 rounded-2xl border-2 text-left ${
                  currentApp ? 'border-solid shadow-sm' : 'border-dashed border-gray-200 bg-white'
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
                    {currentApp ? currentApp.name : 'Select a saved source to resolve the source application'}
                  </p>
                  {currentApp
                    ? <p className="text-xs mt-0.5" style={{ color: `${currentApp.color}99` }}>{currentApp.description}</p>
                    : <p className="text-xs text-gray-400 mt-0.5">The saved source controls the app, credentials, and downstream selection experience for this backup flow.</p>}
                </div>
                {currentApp && <CheckCircle className="w-5 h-5 shrink-0" style={{ color: currentApp.color }} />}
              </div>
            </section>

            <section className="rounded-3xl border border-blue-100 bg-blue-50/50 p-5 shadow-sm">
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-blue-600" />
                <h4 className="text-sm font-bold text-blue-800">Applied source profile</h4>
              </div>

              {appliedSource ? (
                <div className="mt-4 grid gap-3 md:grid-cols-2 2xl:grid-cols-1">
                  <div className="rounded-2xl border border-blue-200 bg-white p-4">
                    <div className="text-xs font-medium uppercase tracking-wide text-gray-400">Source name</div>
                    <div className="mt-1 text-sm font-semibold text-gray-900">{appliedSource.name}</div>
                    <div className="mt-2 text-xs text-gray-500">Owner: {appliedSource.owner_email || 'Unknown'}</div>
                  </div>
                  <div className="rounded-2xl border border-blue-200 bg-white p-4">
                    <div className="text-xs font-medium uppercase tracking-wide text-gray-400">Connection</div>
                    <div className="mt-1 text-sm font-semibold text-gray-900">{appliedSource.domain || 'No domain configured'}</div>
                    <div className="mt-2 text-xs text-gray-500">Managed from the Apps module</div>
                  </div>
                </div>
              ) : (
                <div className="mt-4 rounded-2xl border border-dashed border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-700">
                  Select one saved source from the search results. To create or edit a source connection, use the Apps module first, then come back here.
                </div>
              )}
            </section>
          </div>
        </div>

        {currentApp && (
          <div className="space-y-4">
            {/* Object selection */}
            {canShowCondensedObjects && (
              <section className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-[0.18em] text-gray-400">Backup scope</p>
                    <h3 className="mt-2 text-sm font-semibold text-gray-900">Choose the data this flow will include</h3>
                    <p className="mt-1 text-xs leading-6 text-gray-500">The saved source handles credentials. This section only decides which data sets should be exported from that source.</p>
                  </div>
                  <div className="shrink-0 rounded-full bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-500">
                    {selectedObjects.length}/{currentApp.objects.length} selected
                  </div>
                </div>

                <div className="mt-5">
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
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
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
              </section>
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
                    disabled={!sourceConnectionId || !domain.trim() || !accessTokenV2.trim() || loadingRequestPreview}
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

                {!sourceConnectionId ? (
                  <p className="text-xs text-amber-600">Select a saved Request source first, then load the group list to choose what this flow will back up.</p>
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
                    disabled={!sourceConnectionId || !domain.trim() || !accessToken.trim() || loadingServicePreview}
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

                {!sourceConnectionId ? (
                  <p className="text-xs text-amber-600">Select a saved Service source first, then load the service list to choose what this flow will back up.</p>
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
                    disabled={!sourceConnectionId || !domain.trim() || !accessToken.trim() || loadingWorkflowPreview}
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

                {!sourceConnectionId ? (
                  <p className="text-xs text-amber-600">Select a saved Workflow source first, then load the workflow list to choose what this flow will back up.</p>
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
                    disabled={!sourceConnectionId || !domain.trim() || !accessToken.trim() || loadingWeworkPreview}
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

                {!sourceConnectionId ? (
                  <p className="text-xs text-amber-600">Select a saved WeWork source first, then load the project list to choose what this flow will back up.</p>
                ) : !weworkPreview ? (
                  <p className="text-xs text-amber-600">Load the WeWork source preview to see the full list of projects available for backup.</p>
                ) : selectedProjectIds.length === 0 ? (
                  <p className="text-xs text-amber-600">Select at least one WeWork project before moving to the next step.</p>
                ) : (
                  <p className="text-xs text-green-600">{selectedProjectIds.length} WeWork project{selectedProjectIds.length > 1 ? 's are' : ' is'} selected for this flow.</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  // ── Standard wizard (Request, Workflow, WeWork) ───────────────────────
  return (
    <div className="w-full min-w-0 space-y-8">
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
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
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
