import React from 'react'
import {
  Check, CheckCircle, ChevronRight, Cloud, Globe,
  Eye, EyeOff, Loader2, Link2, RefreshCw,
} from 'lucide-react'
import { APPS, SELECTABLE_BACKUP_APPS } from '../../constants'
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
    backupAppsPermissionConflict,
    backupAppsPermissionMessage,
    connectionConfig,
    sourceConnectionId,
    savedSourceConnections,
    loadingSavedSourceConnections,
    savedSourceConnectionsError,
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
    requiresRequestSelection,
    requiresServiceSelection,
    requiresWorkflowSelection,
    requiresWeworkSelection,
  } = wizard
  const isRequestSelected = selectedApp === 'base_request'
  const isServiceSelected = selectedApp === 'base_service'
  const isWorkflowSelected = selectedApp === 'base_workflow'
  const isWeworkSelected = selectedApp === 'base_wework'
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
      <div className="w-full min-w-0 space-y-7">
        <div className="grid gap-6 2xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
          <div className="space-y-6">
            <section className="rounded-xl border border-[rgb(var(--border-line))] bg-surface-1 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-micro font-emphasis uppercase tracking-[0.14em] text-text-quaternary">Flow identity</p>
                  <h3 className="mt-2 text-h3 font-strong text-text-primary">Name this backup flow before choosing the saved source</h3>
                  <p className="mt-1.5 text-small leading-6 text-text-tertiary">The saved source decides the app and credentials. The flow name should explain why this backup exists.</p>
                </div>
                <div className={`shrink-0 rounded-full px-3 py-1.5 text-micro font-emphasis uppercase tracking-[0.14em] ${sourceConnectionId ? 'bg-success/10 text-success' : 'bg-surface-2 text-text-tertiary'}`}>
                  {sourceConnectionId ? 'Source selected' : 'Waiting for source'}
                </div>
              </div>
              <div className="mt-4">
                <label className="mb-1 block text-label font-emphasis text-text-primary">
                  Backup Flow Name <span className="text-danger">*</span>
                </label>
                <p className="mb-2 text-caption text-text-quaternary">Give it a descriptive name, e.g. "Daily Backup — Service IT"</p>
                <input
                  className="w-full rounded-md border border-[rgb(var(--border-strong))] bg-surface-0 px-3.5 py-2.5 text-small text-text-primary placeholder:text-text-quaternary transition-colors focus:border-brand focus:shadow-focus-brand focus:outline-none"
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
                  disabled={backupAppsPermissionConflict}
                  className="inline-flex items-center gap-1.5 rounded-md border border-[rgb(var(--border-line))] px-3 py-2 text-label font-emphasis text-text-secondary transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Sync now
                </button>
              )}
              emptyState={(
                <div className="rounded-xl border border-dashed border-[rgb(var(--border-line))] bg-surface-2 px-4 py-5 text-caption text-text-tertiary">
                  {savedSourceConnectionsError || backupAppsPermissionConflict
                    ? (savedSourceConnectionsError || backupAppsPermissionMessage)
                    : savedSourceConnections.length === 0
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
                        className={`rounded-xl border px-4 py-3 text-left transition-all ${
                          isActive
                            ? 'border-brand/20 bg-brand/10'
                            : 'border-[rgb(var(--border-line))] bg-surface-1 hover:border-brand/20 hover:bg-brand/10'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className={`truncate text-small font-emphasis ${isActive ? 'text-brand' : 'text-text-primary'}`}>{source.name}</div>
                            <div className="mt-1 flex flex-wrap gap-1.5 text-micro text-text-quaternary">
                              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-text-secondary">{source.app_name || sourceApp?.name || sourceAppId || 'Source'}</span>
                              {source.domain && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-text-secondary">{source.domain}</span>}
                            </div>
                          </div>
                          {isActive && <CheckCircle className="mt-0.5 w-4 h-4 text-brand shrink-0" />}
                        </div>
                        {source.owner_email && <div className="mt-2 text-caption text-text-quaternary">Owner: {source.owner_email}</div>}
                      </button>
                    )
                  })}
                </div>
              </div>
            </SearchablePickerCard>
          </div>

          <div className="space-y-6">
            <section className="rounded-xl border border-[rgb(var(--border-line))] bg-surface-1 p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-micro font-emphasis uppercase tracking-[0.14em] text-text-quaternary">Resolved application</p>
                  <h3 className="mt-2 text-h3 font-strong text-text-primary">The app is derived from the saved source</h3>
                </div>
                <div className={`shrink-0 rounded-full px-3 py-1.5 text-micro font-emphasis uppercase tracking-[0.14em] ${currentApp ? 'bg-brand/10 text-brand' : 'bg-surface-2 text-text-tertiary'}`}>
                  {currentApp ? 'Ready' : 'Not resolved yet'}
                </div>
              </div>

              <div
                className={`mt-4 flex w-full items-center gap-4 rounded-xl border px-4 py-4 text-left ${
                  currentApp ? 'border-solid' : 'border-dashed border-[rgb(var(--border-line))] bg-surface-1'
                }`}
                style={currentApp ? { borderColor: currentApp.color, backgroundColor: currentApp.bg } : undefined}
              >
                <div className="w-10 h-10 rounded-md flex items-center justify-center shrink-0"
                  style={{ backgroundColor: currentApp ? `${currentApp.color}20` : '#f3f4f6', color: currentApp?.color || '#9ca3af' }}>
                  {currentApp?.icon || <Cloud className="w-5 h-5" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-small font-strong ${currentApp ? '' : 'text-text-quaternary'}`}
                    style={currentApp ? { color: currentApp.color } : {}}>
                    {currentApp ? currentApp.name : 'Select a saved source to resolve the source application'}
                  </p>
                  {currentApp
                    ? <p className="mt-0.5 text-caption" style={{ color: `${currentApp.color}99` }}>{currentApp.description}</p>
                    : <p className="mt-0.5 text-caption text-text-quaternary">The saved source controls the app, credentials, and downstream selection experience for this backup flow.</p>}
                </div>
                {currentApp && <CheckCircle className="w-5 h-5 shrink-0" style={{ color: currentApp.color }} />}
              </div>
            </section>

            <section className="rounded-xl border border-brand/20 bg-brand/10 p-5">
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-brand" />
                <h4 className="text-small font-strong text-brand">Applied source profile</h4>
              </div>

              {appliedSource ? (
                <div className="mt-4 grid gap-3 md:grid-cols-2 2xl:grid-cols-1">
                  <div className="rounded-xl border border-brand/20 bg-surface-1 p-4">
                    <div className="text-micro font-emphasis uppercase tracking-[0.14em] text-text-quaternary">Source name</div>
                    <div className="mt-1 text-small font-emphasis text-text-primary">{appliedSource.name}</div>
                    <div className="mt-2 text-caption text-text-tertiary">Owner: {appliedSource.owner_email || 'Unknown'}</div>
                  </div>
                  <div className="rounded-xl border border-brand/20 bg-surface-1 p-4">
                    <div className="text-micro font-emphasis uppercase tracking-[0.14em] text-text-quaternary">Connection</div>
                    <div className="mt-1 text-small font-emphasis text-text-primary">{appliedSource.domain || 'No domain configured'}</div>
                    <div className="mt-2 text-caption text-text-tertiary">Managed from the Apps module</div>
                  </div>
                </div>
              ) : (
                <div className="mt-4 rounded-xl border border-dashed border-warning/20 bg-warning/10 px-4 py-4 text-caption text-warning">
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
              <section className="rounded-xl border border-[rgb(var(--border-line))] bg-surface-1 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-micro font-emphasis uppercase tracking-[0.14em] text-text-quaternary">Backup scope</p>
                    <h3 className="mt-2 text-h3 font-strong text-text-primary">Choose the data this flow will include</h3>
                    <p className="mt-1.5 text-small leading-6 text-text-tertiary">The saved source handles credentials. This section only decides which data sets should be exported from that source.</p>
                  </div>
                  <div className="shrink-0 rounded-full bg-surface-2 px-3 py-1.5 text-micro font-emphasis uppercase tracking-[0.14em] text-text-tertiary">
                    {selectedObjects.length}/{currentApp.objects.length} selected
                  </div>
                </div>

                <div className="mt-5">
                <label className="mb-1 block text-label font-emphasis text-text-primary">Data to Backup <span className="text-danger">*</span></label>
                <p className="mb-3 text-caption text-text-quaternary">Select the data types to include in this backup</p>
                <div className="space-y-2">
                  <div onClick={handleSelectAllObjects}
                    className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-[rgb(var(--border-line))] px-4 py-4 transition-all hover:border-brand/30 hover:bg-brand/10">
                    <div className={`w-5 h-5 rounded flex items-center justify-center border-2 transition-all ${
                      selectedObjects.length === currentApp.objects.length ? 'bg-brand border-brand' : 'border-[rgb(var(--border-strong))]'
                    }`}>{selectedObjects.length === currentApp.objects.length && <Check className="w-3 h-3 text-white" />}</div>
                    <span className="text-small font-emphasis text-text-secondary">Select all</span>
                    <span className="ml-auto text-caption text-text-quaternary">{currentApp.objects.length} data types</span>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {currentApp.objects.map(obj => (
                      <div key={obj} onClick={() => handleObjectToggle(obj)}
                        className="flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-4 transition-all"
                        style={{ borderColor: selectedObjects.includes(obj) ? currentApp.color : '#e5e7eb', backgroundColor: selectedObjects.includes(obj) ? currentApp.bg : '#fff' }}>
                        <div className="w-5 h-5 rounded flex items-center justify-center border-2 transition-all shrink-0"
                          style={{ backgroundColor: selectedObjects.includes(obj) ? currentApp.color : 'transparent', borderColor: selectedObjects.includes(obj) ? currentApp.color : '#d1d5db' }}>
                          {selectedObjects.includes(obj) && <Check className="w-3 h-3 text-white" />}
                        </div>
                        <div className="flex-1">
                          <div className="text-small font-emphasis" style={{ color: selectedObjects.includes(obj) ? currentApp.color : '#374151' }}>
                            {currentApp.objectLabels[obj]}
                          </div>
                          <div className="mt-0.5 text-caption text-text-quaternary">{currentApp.name} › {currentApp.objectLabels[obj]}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                </div>
              </section>
            )}

            {isRequestSelected && requiresRequestSelection && (
              <div className="border border-[rgb(var(--border-line))] rounded-xl p-5 bg-surface-1 space-y-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <label className="block text-small font-strong text-text-primary">Selected Request Groups <span className="text-danger">*</span></label>
                    <p className="mt-1 text-caption text-text-quaternary">Load the Request source and choose exactly which groups this backup flow should include. Direct requests appear as the <strong>[direct]</strong> row.</p>
                  </div>
                  <button
                    onClick={openRequestSelectorModal}
                    disabled={!sourceConnectionId || !domain.trim() || !accessTokenV2.trim() || loadingRequestPreview}
                    className="inline-flex items-center justify-center gap-2 rounded-md border border-[rgb(var(--border-strong))] bg-surface-1 px-4 py-2 text-label font-emphasis text-text-primary transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {loadingRequestPreview ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronRight className="w-4 h-4" />}
                    {requestPreview ? 'Change Selection' : 'Load & Select'}
                  </button>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-md bg-surface-2 p-4 text-center">
                    <div className="text-2xl font-strong text-text-primary">{requestPreview?.selectable_source_count ?? '—'}</div>
                    <div className="mt-1 text-micro text-text-quaternary">Groups/direct sources loaded</div>
                  </div>
                  <div className="rounded-md bg-surface-2 p-4 text-center">
                    <div className="text-2xl font-strong text-text-primary">{selectedGroupIds.length}</div>
                    <div className="mt-1 text-micro text-text-tertiary">Selected for backup</div>
                  </div>
                </div>

                {requestPreview && !requestPreview.request_count_complete && (
                  <p className="text-caption text-warning">Detailed preview is currently loaded for {requestPreview.detail_loaded_count || 0} sources. Refresh after changing the selection to update sample requests.</p>
                )}

                {requestPreview?.partial_error_count > 0 && (
                  <p className="text-caption text-warning">Some Request groups could not be previewed completely ({requestPreview.partial_error_count}). You can still choose from the loaded list.</p>
                )}

                {!sourceConnectionId ? (
                  <p className="text-caption text-warning">Select a saved Request source first, then load the group list to choose what this flow will back up.</p>
                ) : !requestPreview ? (
                  <p className="text-caption text-warning">Click "Load & Select" to load the available groups from this Request source.</p>
                ) : selectedGroupIds.length === 0 ? (
                  <p className="text-caption text-warning">Select at least one Request group before moving to the next step.</p>
                ) : (
                  <p className="text-caption text-success">{selectedGroupIds.length} Request source{selectedGroupIds.length > 1 ? 's are' : ' is'} selected for this flow.</p>
                )}
              </div>
            )}

            {isServiceSelected && requiresServiceSelection && (
              <div className="border border-[rgb(var(--border-line))] rounded-xl p-5 bg-surface-1 space-y-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <label className="block text-small font-strong text-text-primary">Selected Services <span className="text-danger">*</span></label>
                    <p className="mt-1 text-caption text-text-quaternary">Choose which Service workspaces this backup flow will include.</p>
                  </div>
                  <button
                    onClick={openServiceSelectorModal}
                    disabled={!sourceConnectionId || !domain.trim() || !accessToken.trim() || loadingServicePreview}
                    className="inline-flex items-center justify-center gap-2 rounded-md border border-brand/20 bg-brand/10 px-4 py-2 text-label font-emphasis text-brand transition-colors hover:bg-brand/10 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {loadingServicePreview ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronRight className="w-4 h-4" />}
                    {servicePreview ? 'Change Selection' : 'Load & Select'}
                  </button>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-md bg-surface-2 p-4 text-center">
                    <div className="text-2xl font-strong text-text-primary">{servicePreview?.service_count ?? '—'}</div>
                    <div className="mt-1 text-micro text-text-quaternary">Services loaded</div>
                  </div>
                  <div className="rounded-md bg-brand/10 p-4 text-center">
                    <div className="text-2xl font-strong text-brand">{selectedServiceIds.length}</div>
                    <div className="mt-1 text-micro text-brand">Selected for backup</div>
                  </div>
                </div>

                {!sourceConnectionId ? (
                  <p className="text-caption text-warning">Select a saved Service source first, then load the service list to choose what this flow will back up.</p>
                ) : !servicePreview ? (
                  <p className="text-caption text-warning">Click "Load & Select" to load the available services from this source.</p>
                ) : selectedServiceIds.length === 0 ? (
                  <p className="text-caption text-warning">Select at least one Service before moving to the next step.</p>
                ) : (
                  <p className="text-caption text-success">{selectedServiceIds.length} Service{selectedServiceIds.length > 1 ? 's are' : ' is'} selected for this flow.</p>
                )}
              </div>
            )}

            {isWorkflowSelected && requiresWorkflowSelection && (
              <div className="border border-[rgb(var(--border-line))] rounded-xl p-5 bg-surface-1 space-y-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <label className="block text-small font-strong text-text-primary">Selected Workflows <span className="text-danger">*</span></label>
                    <p className="mt-1 text-caption text-text-quaternary">Load the Workflow source and choose exactly which workflows this backup flow should include.</p>
                  </div>
                  <button
                    onClick={openWorkflowSelectorModal}
                    disabled={!sourceConnectionId || !domain.trim() || !accessToken.trim() || loadingWorkflowPreview}
                    className="inline-flex items-center justify-center gap-2 rounded-md border border-[#7c3aed]/20 bg-[#7c3aed]/10 px-4 py-2 text-label font-emphasis text-[#7c3aed] transition-colors hover:bg-[#7c3aed]/20 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {loadingWorkflowPreview ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronRight className="w-4 h-4" />}
                    {workflowPreview ? 'Change Selection' : 'Load & Select'}
                  </button>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-md bg-surface-2 p-4 text-center">
                    <div className="text-2xl font-strong text-text-primary">{workflowPreview?.workflow_count ?? '—'}</div>
                    <div className="mt-1 text-micro text-text-quaternary">Workflows loaded</div>
                  </div>
                  <div className="rounded-md bg-[#7c3aed]/10 p-4 text-center">
                    <div className="text-2xl font-strong text-[#7c3aed]">{selectedWorkflowIds.length}</div>
                    <div className="mt-1 text-micro text-[#7c3aed]">Selected for backup</div>
                  </div>
                </div>

                {workflowPreview && !workflowPreview.job_count_complete && (
                  <p className="text-caption text-warning">Detailed preview is currently loaded for {workflowPreview.detail_loaded_count || 0} workflows. Refresh after changing the selection to update sample jobs.</p>
                )}

                {workflowPreview?.partial_error_count > 0 && (
                  <p className="text-caption text-warning">Some workflows could not be previewed completely ({workflowPreview.partial_error_count}). You can still choose from the loaded list.</p>
                )}

                {!sourceConnectionId ? (
                  <p className="text-caption text-warning">Select a saved Workflow source first, then load the workflow list to choose what this flow will back up.</p>
                ) : !workflowPreview ? (
                  <p className="text-caption text-warning">Click "Load & Select" to load the available workflows from this source.</p>
                ) : selectedWorkflowIds.length === 0 ? (
                  <p className="text-caption text-warning">Select at least one Workflow before moving to the next step.</p>
                ) : (
                  <p className="text-caption text-success">{selectedWorkflowIds.length} Workflow{selectedWorkflowIds.length > 1 ? 's are' : ' is'} selected for this flow.</p>
                )}
              </div>
            )}

            {isWeworkSelected && requiresWeworkSelection && (
              <div className="border border-[rgb(var(--border-line))] rounded-xl p-5 bg-surface-1 space-y-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <label className="block text-small font-strong text-text-primary">Selected Projects <span className="text-danger">*</span></label>
                    <p className="mt-1 text-caption text-text-quaternary">Load the WeWork source and choose exactly which projects this backup flow should include. Tasks and child tasks will be derived from each selected project and exported as flat task folders inside that project.</p>
                  </div>
                  <button
                    onClick={openWeworkSelectorModal}
                    disabled={!sourceConnectionId || !domain.trim() || !accessToken.trim() || loadingWeworkPreview}
                    className="inline-flex items-center justify-center gap-2 rounded-md border border-[rgb(var(--border-strong))] bg-surface-1 px-4 py-2 text-label font-emphasis text-text-primary transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {loadingWeworkPreview ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronRight className="w-4 h-4" />}
                    {weworkPreview ? 'Change Selection' : 'Load & Select'}
                  </button>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-md bg-surface-2 p-4 text-center">
                    <div className="text-2xl font-strong text-text-primary">{weworkPreview?.project_count ?? '—'}</div>
                    <div className="mt-1 text-micro text-text-quaternary">Projects loaded</div>
                  </div>
                  <div className="rounded-md bg-surface-2 p-4 text-center">
                    <div className="text-2xl font-strong text-text-primary">{selectedProjectIds.length}</div>
                    <div className="mt-1 text-micro text-text-tertiary">Selected for backup</div>
                  </div>
                  <div className="rounded-md bg-brand/10 p-4 text-center">
                    <div className="text-2xl font-strong text-brand">{weworkPreview?.total_task_count ?? '—'}</div>
                    <div className="mt-1 text-micro text-brand">Tasks previewed</div>
                  </div>
                </div>

                {weworkPreview?.catalog_warning && (
                  <p className="text-caption text-warning">Department catalog loaded partially: {weworkPreview.catalog_warning}</p>
                )}

                {weworkPreview && !weworkPreview.task_count_complete && (
                  <p className="text-caption text-warning">Detailed preview is currently loaded for {weworkPreview.detail_loaded_count || 0} projects. Refresh after changing the selection to update sample tasks.</p>
                )}

                {weworkPreview?.partial_error_count > 0 && (
                  <p className="text-caption text-warning">Some projects could not be previewed completely ({weworkPreview.partial_error_count}). You can still choose from the loaded list.</p>
                )}

                {!sourceConnectionId ? (
                  <p className="text-caption text-warning">Select a saved WeWork source first, then load the project list to choose what this flow will back up.</p>
                ) : !weworkPreview ? (
                  <p className="text-caption text-warning">Click "Load & Select" to load the available projects from this WeWork source.</p>
                ) : selectedProjectIds.length === 0 ? (
                  <p className="text-caption text-warning">Select at least one WeWork project before moving to the next step.</p>
                ) : (
                  <p className="text-caption text-success">{selectedProjectIds.length} WeWork project{selectedProjectIds.length > 1 ? 's are' : ' is'} selected for this flow.</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  // ── Standard wizard (supported backup apps only) ──────────────────────
  return (
    <div className="w-full min-w-0 space-y-7">
      {/* Flow name */}
      <div>
        <label className="mb-1 block text-label font-emphasis text-text-primary">Backup Flow Name <span className="text-danger">*</span></label>
        <p className="mb-2 text-caption text-text-quaternary">Give it a descriptive name, e.g. "Weekly Backup — Request"</p>
        <input className="w-full rounded-md border border-[rgb(var(--border-strong))] bg-surface-0 px-3.5 py-2.5 text-small text-text-primary placeholder:text-text-quaternary transition-colors focus:border-brand focus:shadow-focus-brand focus:outline-none"
          placeholder='e.g. "Weekly Backup — Request"'
          value={flowName} onChange={e => setFlowName(e.target.value)} maxLength={120} />
      </div>

      {/* App cards */}
      <div>
        <label className="mb-1 block text-label font-emphasis text-text-primary">Source Application <span className="text-danger">*</span></label>
        <p className="mb-4 text-caption text-text-quaternary">Which app do you want to back up data from?</p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {SELECTABLE_BACKUP_APPS.map(app => (
            <div key={app.id} onClick={() => handleAppSelection(app.id)}
              className="relative cursor-pointer rounded-xl border p-5 transition-all hover:shadow-linear-sm"
              style={{ borderColor: selectedApp === app.id ? app.color : '#e5e7eb', backgroundColor: selectedApp === app.id ? app.bg : '#fff' }}>
              {selectedApp === app.id && <div className="absolute top-3 right-3"><CheckCircle className="w-5 h-5" style={{ color: app.color }} /></div>}
              <div className="flex items-start gap-4">
                <div className="rounded-xl p-3 flex items-center justify-center shrink-0" style={{ color: app.color, backgroundColor: `${app.color}18`, width: 52, height: 52 }}>
                  {app.icon}
                </div>
                <div className="flex-1 min-w-0 pr-4">
                  <div className="mb-1 text-small font-emphasis" style={{ color: app.color }}>{app.name}</div>
                  <p className="mb-3 text-caption leading-6 text-text-tertiary">{app.description}</p>
                  <div className="flex flex-wrap gap-1">
                    {app.objects.map(obj => (
                      <span key={obj} className="inline-flex items-center px-2 py-0.5 rounded-full text-micro font-emphasis"
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
