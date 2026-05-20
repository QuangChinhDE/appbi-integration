import React from 'react'
import {
  CheckCircle, Info, Cloud,
  Headphones, Inbox, FolderKanban, Building2,
} from 'lucide-react'
import { Alert, Spinner } from '@packages/ui/src/components/common/ui'
import { SummaryCard, SummaryField } from '../shared/SummaryCard'
import FileTreePreview from '../shared/FileTreePreview'
import { getBackupDestinationLabel } from '../../constants'
import {
  buildRequestOutputTree,
  buildServiceOutputTree,
  buildWorkflowOutputTree,
  buildWeworkOutputTree,
} from '../../../shared/outputTrees'

const BACKUP_TYPE_LABELS = { structured: 'Structured (Spreadsheet)', unstructured: 'Files & Attachments', all: 'Complete' }
const BACKUP_TYPE_COLORS = { structured: '#0284c7', unstructured: '#d97706', all: '#7c3aed' }

const reviewSplitLayoutClass = 'grid flex-1 min-h-0 gap-5 xl:grid-cols-[minmax(340px,0.95fr)_minmax(0,1.55fr)] 2xl:grid-cols-[minmax(380px,0.9fr)_minmax(0,1.7fr)]'
const reviewSummaryColumnClass = 'min-w-0 space-y-4 overflow-y-auto'

function buildGenericTreeLines(googleAuth, currentApp) {
  return [
    { indent: 0, icon: '📁', text: googleAuth?.folder_name || 'My Drive', color: '#e2e8f0' },
    { indent: 1, icon: '📁', text: currentApp?.name || 'App', color: '#10b981' },
    { indent: 2, icon: '📊', text: 'data_export.xlsx', color: '#4ade80' },
    { indent: 2, icon: '📁', text: 'attachments/', color: '#60a5fa' },
    { indent: 3, icon: '📄', text: 'file.pdf', color: '#64748b' },
    { indent: 2, icon: '…', text: '(structure depends on actual data)', color: '#64748b' },
  ]
}

/* ═══════════════════════════════════════════════════════════════════════
 * Archive notice for Service + gdrive
 * ═══════════════════════════════════════════════════════════════════════ */

function renderServiceArchiveNotice(appId, destinationType) {
  if (appId !== 'base_service' || destinationType !== 'gdrive') return null
  return (
    <Alert
      type="info"
      message="Re-run will move old folder to Trash"
      description="Re-running the same Service flow will move its old Base Service folder to Google Drive Trash before re-creating it. If this destination already contains Base Service from another flow, choose a different folder to avoid overwrite conflicts."
    />
  )
}

/* ═══════════════════════════════════════════════════════════════════════
 * Ready banner (top)
 * ═══════════════════════════════════════════════════════════════════════ */

function ReadyBanner() {
  return (
    <div className="shrink-0 flex flex-col items-start gap-3 rounded-xl border border-success/30 bg-gradient-to-r from-success/10 to-emerald-50 px-5 py-5 lg:flex-row lg:items-center">
      <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 bg-success/10">
        <CheckCircle className="w-5 h-5 text-success" />
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="text-h3 font-strong text-success">Ready to create backup flow!</h3>
        <p className="mt-1 text-small leading-6 text-success">Review the configuration below and confirm</p>
      </div>
    </div>
  )
}

function ReviewNotice({ blocked, archiveNotice }) {
  if (!blocked) return null

  return (
    <details className="shrink-0 rounded-xl border border-warning/20 bg-warning/10 text-warning">
      <summary className="list-none cursor-pointer px-4 py-3 [&::-webkit-details-marker]:hidden">
        <div className="flex items-center gap-2 text-caption font-emphasis">
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-warning/10 text-warning">!</span>
          <span>Warning before creating</span>
        </div>
      </summary>
      <div className="border-t border-warning/20 px-4 pb-4 pt-3 text-caption leading-6 text-warning">
        <p>{blocked}</p>
        {archiveNotice && <div className="mt-2">{archiveNotice}</div>}
      </div>
    </details>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
 * SERVICE review variant
 * ═══════════════════════════════════════════════════════════════════════ */

function ServiceReview({ wizard, isEdit }) {
  const {
    domain, selectedObjects, currentApp, backupType, storageDestination, googleAuth,
    servicePreview, loadingServicePreview, selectedServiceIds,
    getCompatibilityBlockedReason,
    getGoogleDriveRunBlockedReason,
  } = wizard

  const treeLines = buildServiceOutputTree({ googleAuth, backupType })
  const blocked = getCompatibilityBlockedReason() || getGoogleDriveRunBlockedReason()
  const archiveNotice = renderServiceArchiveNotice(currentApp?.id || wizard.selectedApp, storageDestination)

  return (
    <div className="h-full flex flex-col gap-4">
      {!blocked && <ReadyBanner />}

      <div className={reviewSplitLayoutClass}>
        <div className={reviewSummaryColumnClass}>
          {/* Source card */}
          <SummaryCard title="Data Source" icon={Headphones} color="#16a34a">
            <SummaryField label="App"><span className="font-strong text-success">Service</span></SummaryField>
            <SummaryField label="Domain">
              <span className="font-mono text-caption text-text-secondary">{domain || <span className="text-danger">Not set</span>}</span>
            </SummaryField>
            <SummaryField label="Data">
              <div className="flex flex-wrap gap-1 mt-0.5">
                {selectedObjects.map(obj => (
                  <span key={obj} className="inline-flex items-center px-2 py-0.5 rounded-full text-micro font-emphasis bg-success/10 text-success">{currentApp?.objectLabels[obj]}</span>
                ))}
              </div>
            </SummaryField>
          </SummaryCard>

          {/* Destination card */}
          <SummaryCard title="Storage" icon={Cloud} color="#2563eb">
            <SummaryField label="Backup Type">
              {backupType
                ? <span className="text-small font-emphasis" style={{ color: BACKUP_TYPE_COLORS[backupType] }}>{BACKUP_TYPE_LABELS[backupType]}</span>
                : <span className="text-caption text-danger">Not selected</span>}
            </SummaryField>
            <SummaryField label="Destination"><span className="font-emphasis text-text-primary">{getBackupDestinationLabel(storageDestination)}</span></SummaryField>
            <SummaryField label="Google Account">
              <span className="break-all text-caption text-text-secondary">{googleAuth?.email || <span className="text-danger">Not connected</span>}</span>
            </SummaryField>
            <SummaryField label="Storage Folder">
              <span className="text-caption text-text-secondary">{googleAuth?.folder_name || <span className="text-text-quaternary">My Drive (default)</span>}</span>
            </SummaryField>
          </SummaryCard>

          {/* Service count card */}
          <div className="bg-surface-1 border border-[rgb(var(--border-line))] rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 bg-surface-2 border-b border-[rgb(var(--border-line))] flex items-center gap-2">
              <Headphones className="w-3.5 h-3.5 text-text-tertiary" />
              <span className="text-label font-strong uppercase tracking-[0.14em] text-text-secondary">Service Summary</span>
            </div>
            <div className="px-4 py-3 flex gap-3">
              <div className="flex-1 bg-surface-2 rounded-md p-3 text-center">
                <div className="text-2xl font-strong text-text-primary">{servicePreview?.service_count || 0}</div>
                <div className="mt-1 text-micro text-text-quaternary">Total</div>
              </div>
              <div className="flex-1 bg-brand/10 rounded-md p-3 text-center">
                <div className="text-2xl font-strong text-brand">{selectedServiceIds.length || 0}</div>
                <div className="mt-1 text-micro text-brand">Selected for backup</div>
              </div>
            </div>
            {loadingServicePreview && (
              <div className="px-4 pb-3 flex items-center gap-2 text-caption text-text-quaternary"><Spinner /><span>Loading…</span></div>
            )}
            {!loadingServicePreview && servicePreview && !servicePreview.ticket_count_complete && (
              <div className="px-4 pb-3">
                <Alert type="warning" message={`Loaded ${servicePreview.detail_loaded_count || 0} services. Open list and refresh to update.`} />
              </div>
            )}
          </div>
        </div>

        {/* RIGHT — Output tree */}
        <div className="min-w-0 flex flex-col min-h-[360px] xl:min-h-0">
          <FileTreePreview lines={treeLines} />
          <div className="mt-3 shrink-0">
            <p className="text-caption leading-6 text-text-quaternary">
              <span className="text-success font-strong">📊 .xlsx</span> — Catalog, service summaries, ticket info, and custom exports &nbsp;·&nbsp;
              {(backupType === 'unstructured' || backupType === 'all') && (
                <><span className="text-[#7c3aed] font-strong">📁 Tickets/</span> — Per-ticket folders with info, custom sheets, and attachments &nbsp;·&nbsp;</>
              )}
              <span className="text-brand font-strong">📋 ticket.json</span> — Raw merged ticket payload
            </p>
            {backupType === 'structured' && (
              <p className="mt-1.5 text-caption leading-6 text-warning">
                With <strong>Structured</strong> backup, the system creates catalog and service-level spreadsheets only. Per-ticket folders and attachments are skipped.
              </p>
            )}
            {backupType === 'unstructured' && (
              <p className="mt-1.5 text-caption leading-6 text-warning">
                With <strong>Files &amp; Attachments</strong> backup, service summary spreadsheets are still created, and the backup also adds per-ticket info/custom files plus attachments.
              </p>
            )}
            {backupType === 'all' && (
              <p className="mt-1.5 text-caption leading-6 text-warning">
                <strong>Complete</strong> backup keeps the service summary spreadsheets and also creates per-ticket folders with info, custom exports, raw JSON, and attachments.
              </p>
            )}
          </div>
        </div>
      </div>

      <ReviewNotice blocked={blocked} archiveNotice={archiveNotice} />
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
 * REQUEST review variant
 * ═══════════════════════════════════════════════════════════════════════ */

function RequestReview({ wizard, isEdit }) {
  const {
    currentApp, domain, accessTokenV2, backupType, storageDestination, googleAuth,
    selectedObjects,
    requestPreview, loadingRequestPreview, selectedGroupIds,
    selectedApp, getCompatibilityBlockedReason, getGoogleDriveRunBlockedReason,
  } = wizard

  const hasRequestScope = !selectedObjects.length || selectedObjects.includes('request')
  const hasNamedGroupSelection = selectedGroupIds.length === 0 || selectedGroupIds.some(groupId => groupId !== '0')
  const includesDirectRequests = selectedGroupIds.length === 0 || selectedGroupIds.includes('0')
  const treeLines = buildRequestOutputTree({ googleAuth, selectedObjects, selectedGroupIds })
  const blocked = getCompatibilityBlockedReason() || getGoogleDriveRunBlockedReason()
  const archiveNotice = renderServiceArchiveNotice(selectedApp, storageDestination)
  const destinationLabel = getBackupDestinationLabel(storageDestination)

  return (
    <div className="h-full flex flex-col gap-4">
      {!blocked && <ReadyBanner />}

      <div className={reviewSplitLayoutClass}>
        <div className={reviewSummaryColumnClass}>
          <SummaryCard title="Data Source" icon={Inbox} color="#ea580c">
            <SummaryField label="App"><span className="font-strong" style={{ color: currentApp?.color }}>{currentApp?.name}</span></SummaryField>
            <SummaryField label="Domain">
              <span className="font-mono text-caption text-text-secondary">{domain || <span className="text-danger">Not set</span>}</span>
            </SummaryField>
            <SummaryField label="Auth Token">
              <span className="font-mono text-caption text-text-tertiary">
                {accessTokenV2 ? `••••${accessTokenV2.slice(-4)}` : <span className="text-danger">Not set</span>}
              </span>
            </SummaryField>
            <SummaryField label="Data">
              <div className="flex flex-wrap gap-1 mt-0.5">
                {selectedObjects.map(objectId => (
                  <span key={objectId} className="inline-flex items-center px-2 py-0.5 rounded-full text-micro font-emphasis bg-brand/10 text-brand">
                    {currentApp?.objectLabels?.[objectId] || objectId}
                  </span>
                ))}
              </div>
            </SummaryField>
          </SummaryCard>

          <SummaryCard title="Storage" icon={Cloud} color="#2563eb">
            <SummaryField label="Backup Type">
              {backupType
                ? <span className="text-small font-emphasis" style={{ color: BACKUP_TYPE_COLORS[backupType] }}>{BACKUP_TYPE_LABELS[backupType]}</span>
                : <span className="text-caption text-danger">Not selected</span>}
            </SummaryField>
            <SummaryField label="Destination"><span className="font-emphasis text-text-primary">{destinationLabel || <span className="text-caption text-danger">Not selected</span>}</span></SummaryField>
            <SummaryField label="Google Account"><span className="break-all text-caption text-text-secondary">{googleAuth?.email || <span className="text-danger">Not connected</span>}</span></SummaryField>
            <SummaryField label="Storage Folder"><span className="text-caption text-text-secondary">{googleAuth?.folder_name || <span className="text-text-quaternary">My Drive (default)</span>}</span></SummaryField>
          </SummaryCard>

          <div className="bg-surface-1 border border-[rgb(var(--border-line))] rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 bg-surface-2 border-b border-[rgb(var(--border-line))] flex items-center gap-2">
              <Inbox className="w-3.5 h-3.5 text-text-tertiary" />
              <span className="text-label font-strong uppercase tracking-[0.14em] text-text-secondary">Request Group Summary</span>
            </div>
            <div className="px-4 py-3 flex gap-3">
              <div className="flex-1 bg-surface-2 rounded-md p-3 text-center">
                <div className="text-2xl font-strong text-text-primary">{requestPreview?.selectable_source_count ?? selectedGroupIds.length}</div>
                <div className="mt-1 text-micro text-text-quaternary">Groups/direct sources loaded</div>
              </div>
              <div className="flex-1 bg-brand/10 rounded-md p-3 text-center">
                <div className="text-2xl font-strong text-brand">{selectedGroupIds.length}</div>
                <div className="mt-1 text-micro text-brand">Selected for backup</div>
              </div>
            </div>
            {loadingRequestPreview && (
              <div className="px-4 pb-3 flex items-center gap-2 text-caption text-text-quaternary"><Spinner /><span>Loading…</span></div>
            )}
            {!loadingRequestPreview && requestPreview && !requestPreview.request_count_complete && (
              <div className="px-4 pb-3">
                <Alert type="warning" message={`Loaded ${requestPreview.detail_loaded_count || 0} sources. Open list and refresh to update.`} />
              </div>
            )}
            <div className="px-4 pb-4 space-y-1.5 text-caption text-text-secondary">
              <div className="flex items-center justify-between rounded-md bg-surface-2 px-3 py-2">
                <span>Named group folders</span>
                <span className={`font-strong ${hasNamedGroupSelection ? 'text-success' : 'text-text-quaternary'}`}>
                  {hasNamedGroupSelection ? 'Included' : 'Excluded'}
                </span>
              </div>
              <div className="flex items-center justify-between rounded-md bg-surface-2 px-3 py-2">
                <span>Direct requests folder</span>
                <span className={`font-strong ${includesDirectRequests ? 'text-success' : 'text-text-quaternary'}`}>
                  {includesDirectRequests ? 'Included' : 'Excluded'}
                </span>
              </div>
              <div className="flex items-center justify-between rounded-md bg-surface-2 px-3 py-2">
                <span>Per-request folders</span>
                <span className={`font-strong ${hasRequestScope ? 'text-success' : 'text-text-quaternary'}`}>
                  {hasRequestScope ? 'Included' : 'Excluded'}
                </span>
              </div>
            </div>
          </div>

          <div className="bg-warning/10 border border-warning/20 rounded-xl p-3">
            <div className="flex gap-2">
              <Info className="w-3.5 h-3.5 text-warning shrink-0 mt-0.5" />
              <p className="text-caption leading-6 text-warning">
                <strong>Note:</strong> Request uses the selected data scope (<strong>Group</strong> / <strong>Request</strong>) for structure, while the backup type is currently treated as a storage setup choice rather than changing the Request export content.
              </p>
            </div>
          </div>
        </div>

        <div className="min-w-0 flex flex-col min-h-[360px] xl:min-h-0">
          <FileTreePreview lines={treeLines} />
          <div className="mt-3 space-y-1 shrink-0">
            <p className="text-caption leading-6 text-text-quaternary">
              <span className="text-success font-strong">📊 .xlsx</span> — Group request lists, request info, and custom exports &nbsp;·&nbsp;
              <span className="text-brand font-strong">📋 .json</span> — Full request detail bundle &nbsp;·&nbsp;
              <span className="text-brand font-strong">📝 .txt</span> — Posts &amp; comments &nbsp;·&nbsp;
              <span className="text-text-quaternary font-strong">📁 Tệp đính kèm/</span> — Files attached to the request when available
            </p>
            {!hasRequestScope && (
              <p className="mt-1.5 text-caption leading-6 text-warning">
                Only the group-level <strong>Danh sách request.xlsx</strong> files are created when <strong>Request</strong> is not selected.
              </p>
            )}
          </div>
        </div>
      </div>

      <ReviewNotice blocked={blocked} archiveNotice={archiveNotice} />
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
 * WORKFLOW review variant
 * ═══════════════════════════════════════════════════════════════════════ */

function WorkflowReview({ wizard, isEdit }) {
  const {
    currentApp, domain, accessToken, selectedObjects,
    backupType, storageDestination, googleAuth,
    workflowPreview, loadingWorkflowPreview, selectedWorkflowIds,
    getCompatibilityBlockedReason,
    getGoogleDriveRunBlockedReason,
  } = wizard

  const hasWorkflowScope = selectedObjects.some(objectId => ['workflow', 'job'].includes(objectId))
  const hasJobScope = selectedObjects.includes('job')
  const treeLines = buildWorkflowOutputTree({ googleAuth, selectedObjects })
  const blocked = getCompatibilityBlockedReason() || getGoogleDriveRunBlockedReason()
  const destinationLabel = getBackupDestinationLabel(storageDestination)

  return (
    <div className="h-full flex flex-col gap-4">
      {!blocked && <ReadyBanner />}

      <div className={reviewSplitLayoutClass}>
        <div className={reviewSummaryColumnClass}>
          <SummaryCard title="Data Source" icon={FolderKanban} color="#7c3aed">
            <SummaryField label="App"><span className="font-strong text-[#7c3aed]">Workflow</span></SummaryField>
            <SummaryField label="Domain">
              <span className="font-mono text-caption text-text-secondary">{domain || <span className="text-danger">Not set</span>}</span>
            </SummaryField>
            <SummaryField label="Access Token">
              <span className="font-mono text-caption text-text-tertiary">
                {accessToken ? `••••${accessToken.slice(-4)}` : <span className="text-danger">Not set</span>}
              </span>
            </SummaryField>
            <SummaryField label="Data">
              <div className="flex flex-wrap gap-1 mt-0.5">
                {selectedObjects.map(objectId => (
                  <span key={objectId} className="inline-flex items-center px-2 py-0.5 rounded-full text-micro font-emphasis bg-[#7c3aed]/10 text-[#7c3aed]">
                    {currentApp?.objectLabels?.[objectId] || objectId}
                  </span>
                ))}
              </div>
            </SummaryField>
          </SummaryCard>

          <SummaryCard title="Storage" icon={Cloud} color="#2563eb">
            <SummaryField label="Backup Type">
              {backupType
                ? <span className="text-small font-emphasis" style={{ color: BACKUP_TYPE_COLORS[backupType] }}>{BACKUP_TYPE_LABELS[backupType]}</span>
                : <span className="text-caption text-danger">Not selected</span>}
            </SummaryField>
            <SummaryField label="Destination"><span className="font-emphasis text-text-primary">{destinationLabel}</span></SummaryField>
            <SummaryField label="Google Account"><span className="break-all text-caption text-text-secondary">{googleAuth?.email || <span className="text-danger">Not connected</span>}</span></SummaryField>
            <SummaryField label="Storage Folder"><span className="text-caption text-text-secondary">{googleAuth?.folder_name || <span className="text-text-quaternary">My Drive (default)</span>}</span></SummaryField>
          </SummaryCard>

          <div className="bg-surface-1 border border-[rgb(var(--border-line))] rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 bg-surface-2 border-b border-[rgb(var(--border-line))] flex items-center gap-2">
              <FolderKanban className="w-3.5 h-3.5 text-text-tertiary" />
              <span className="text-label font-strong uppercase tracking-[0.14em] text-text-secondary">Workflow Summary</span>
            </div>
            <div className="px-4 py-3 flex gap-3">
              <div className="flex-1 bg-surface-2 rounded-md p-3 text-center">
                <div className="text-2xl font-strong text-text-primary">{workflowPreview?.workflow_count ?? selectedWorkflowIds.length}</div>
                <div className="mt-1 text-micro text-text-quaternary">Workflows loaded</div>
              </div>
              <div className="flex-1 bg-[#7c3aed]/10 rounded-md p-3 text-center">
                <div className="text-2xl font-strong text-[#7c3aed]">{selectedWorkflowIds.length}</div>
                <div className="mt-1 text-micro text-[#7c3aed]">Selected for backup</div>
              </div>
            </div>
            {loadingWorkflowPreview && (
              <div className="px-4 pb-3 flex items-center gap-2 text-caption text-text-quaternary"><Spinner /><span>Loading…</span></div>
            )}
            {!loadingWorkflowPreview && workflowPreview && !workflowPreview.job_count_complete && (
              <div className="px-4 pb-3">
                <Alert type="warning" message={`Loaded ${workflowPreview.detail_loaded_count || 0} workflows. Open list and refresh to update.`} />
              </div>
            )}
            <div className="px-4 pb-4 space-y-1.5 text-caption text-text-secondary">
              <div className="flex items-center justify-between rounded-md bg-surface-2 px-3 py-2">
                <span>Guide and workflow config</span>
                <span className={`font-strong ${hasWorkflowScope ? 'text-success' : 'text-text-quaternary'}`}>
                  {hasWorkflowScope ? 'Included' : 'Excluded'}
                </span>
              </div>
              <div className="flex items-center justify-between rounded-md bg-surface-2 px-3 py-2">
                <span>Job list and per-job folders</span>
                <span className={`font-strong ${hasJobScope ? 'text-success' : 'text-text-quaternary'}`}>
                  {hasJobScope ? 'Included' : 'Excluded'}
                </span>
              </div>
              <div className="flex items-center justify-between rounded-md bg-surface-2 px-3 py-2">
                <span>Job info, log, and move files</span>
                <span className={`font-strong ${hasJobScope ? 'text-success' : 'text-text-quaternary'}`}>
                  {hasJobScope ? 'Generated' : 'Excluded'}
                </span>
              </div>
              <div className="flex items-center justify-between rounded-md bg-surface-2 px-3 py-2">
                <span>Input data exports</span>
                <span className={`font-strong ${hasJobScope ? 'text-success' : 'text-text-quaternary'}`}>
                  {hasJobScope ? 'Included' : 'Excluded'}
                </span>
              </div>
              <div className="flex items-center justify-between rounded-md bg-surface-2 px-3 py-2">
                <span>Posts/comments content</span>
                <span className={`font-strong ${hasJobScope ? 'text-success' : 'text-text-quaternary'}`}>
                  {hasJobScope ? 'Included' : 'Excluded'}
                </span>
              </div>
              <div className="flex items-center justify-between rounded-md bg-surface-2 px-3 py-2">
                <span>Attachment/file info</span>
                <span className={`font-strong ${hasJobScope ? 'text-success' : 'text-text-quaternary'}`}>
                  {hasJobScope ? 'Generated' : 'Excluded'}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="min-w-0 flex flex-col min-h-[360px] xl:min-h-0">
          <FileTreePreview lines={treeLines} />
          <div className="mt-3 shrink-0">
            <p className="text-caption leading-6 text-text-quaternary">
              <span className="text-success font-strong">📊 .xlsx</span> — Workflow config, job lists, job info, logs/moves, input-data exports, and attachment metadata &nbsp;·&nbsp;
              <span className="text-brand font-strong">📝 .txt</span> — README and post/comment export &nbsp;·&nbsp;
              <span className="text-[#7c3aed] font-strong">📁 Workflows/</span> — One folder per selected workflow
            </p>
            {hasJobScope && (
              <p className="mt-1.5 text-caption leading-6 text-warning">
                Current Workflow runtime always writes the same approved folder tree for Google Drive whenever <strong>Job</strong> is selected. The <strong>backup_type</strong> value is recorded in the manifest, but it does not currently reshape the Workflow export structure.
              </p>
            )}
          </div>
        </div>
      </div>

      <ReviewNotice blocked={blocked} archiveNotice={null} />
    </div>
  )
}

function WeworkReview({ wizard, isEdit }) {
  const {
    currentApp, domain, accessToken,
    selectedObjects, storageDestination, googleAuth,
    weworkPreview, loadingWeworkPreview, selectedProjectIds,
    getCompatibilityBlockedReason,
    getGoogleDriveRunBlockedReason,
  } = wizard

  const hasDepartmentScope = selectedObjects.includes('department')
  const hasProjectScope = selectedObjects.includes('project')
  const hasTaskScope = selectedObjects.includes('task')
  const treeLines = buildWeworkOutputTree({ googleAuth, selectedObjects, selectedProjectIds })
  const blocked = getCompatibilityBlockedReason() || getGoogleDriveRunBlockedReason()

  return (
    <div className="h-full flex flex-col gap-4">
      {!blocked && <ReadyBanner />}

      <div className={reviewSplitLayoutClass}>
        <div className={reviewSummaryColumnClass}>
          <SummaryCard title="Data Source" icon={Building2} color="#2563eb">
            <SummaryField label="App"><span className="font-strong" style={{ color: currentApp?.color }}>{currentApp?.name}</span></SummaryField>
            <SummaryField label="Domain"><span className="font-mono text-caption text-text-secondary">{domain || <span className="text-danger">Not set</span>}</span></SummaryField>
            <SummaryField label="Access Token"><span className="font-mono text-caption text-text-tertiary">{accessToken ? `••••${accessToken.slice(-4)}` : <span className="text-danger">Not set</span>}</span></SummaryField>
            <SummaryField label="Backup Data">
              <div className="flex flex-wrap gap-1 mt-0.5">
                {selectedObjects.map(obj => (
                  <span key={obj} className="inline-flex items-center px-2 py-0.5 rounded-full text-micro font-emphasis" style={{ backgroundColor: currentApp?.bg, color: currentApp?.color }}>{currentApp?.objectLabels[obj]}</span>
                ))}
              </div>
            </SummaryField>
          </SummaryCard>

          <SummaryCard title="Selection Scope" icon={FolderKanban} color="#0f766e">
            <SummaryField label="Projects selected"><span className="font-strong text-text-primary">{selectedProjectIds.length}</span></SummaryField>
            <SummaryField label="Projects loaded"><span className="text-text-secondary">{weworkPreview?.project_count ?? '—'}</span></SummaryField>
            <SummaryField label="Departments in scope"><span className="text-text-secondary">{weworkPreview?.department_count ?? '—'}</span></SummaryField>
            <SummaryField label="Tasks previewed"><span className="text-text-secondary">{weworkPreview?.total_task_count ?? '—'}</span></SummaryField>
            <SummaryField label="Exports generated">
              <div className="space-y-1.5 text-caption text-text-secondary">
                <div className="flex items-center justify-between rounded-md bg-surface-2 px-3 py-2">
                  <span>Department info</span>
                  <span className={`font-strong ${hasDepartmentScope ? 'text-success' : 'text-text-quaternary'}`}>{hasDepartmentScope ? 'Included' : 'Excluded'}</span>
                </div>
                <div className="flex items-center justify-between rounded-md bg-surface-2 px-3 py-2">
                  <span>Project info + custom exports</span>
                  <span className={`font-strong ${hasProjectScope ? 'text-success' : 'text-text-quaternary'}`}>{hasProjectScope ? 'Included' : 'Excluded'}</span>
                </div>
                <div className="flex items-center justify-between rounded-md bg-surface-2 px-3 py-2">
                  <span>Project data lists</span>
                  <span className={`font-strong ${hasProjectScope || hasTaskScope ? 'text-success' : 'text-text-quaternary'}`}>{hasProjectScope || hasTaskScope ? 'Included' : 'Excluded'}</span>
                </div>
                <div className="flex items-center justify-between rounded-md bg-surface-2 px-3 py-2">
                  <span>Flat task folders + attachment indexes</span>
                  <span className={`font-strong ${hasTaskScope ? 'text-success' : 'text-text-quaternary'}`}>{hasTaskScope ? 'Included' : 'Excluded'}</span>
                </div>
              </div>
            </SummaryField>
            {loadingWeworkPreview && <div className="text-caption text-text-quaternary">Loading current WeWork preview…</div>}
            {weworkPreview?.catalog_warning && <Alert type="warning" message="Department catalog loaded partially" description={weworkPreview.catalog_warning} />}
            {weworkPreview?.partial_error_count > 0 && <Alert type="warning" message={`Some projects could not be previewed completely (${weworkPreview.partial_error_count})`} />}
          </SummaryCard>

          <SummaryCard title="Storage" icon={Cloud} color="#2563eb">
            <SummaryField label="Destination"><span className="font-emphasis text-text-primary">{getBackupDestinationLabel(storageDestination)}</span></SummaryField>
            <SummaryField label="Google Account"><span className="break-all text-caption text-text-secondary">{googleAuth?.email || <span className="text-danger">Not connected</span>}</span></SummaryField>
            <SummaryField label="Storage Folder"><span className="text-caption text-text-secondary">{googleAuth?.folder_name || <span className="text-text-quaternary">My Drive (default)</span>}</span></SummaryField>
          </SummaryCard>
        </div>

        <div className="min-w-0 flex flex-col min-h-[360px] xl:min-h-0">
          <FileTreePreview lines={treeLines} />
          <div className="mt-3 shrink-0 space-y-2">
            <p className="text-caption leading-6 text-text-quaternary">
              <span className="text-success font-strong">📊 .xlsx</span> — Department/project info, task/tasklist/milestone lists, custom exports, and attachment indexes &nbsp;·&nbsp;
              <span className="text-text-quaternary font-strong">📋 .json</span> — Raw task detail snapshot for each task folder &nbsp;·&nbsp;
              <span className="text-brand font-strong">📁 Flat task folders</span> — Every task is exported once under the selected project instead of nesting child folders recursively
            </p>
            <div className="bg-info/10 border border-info/20 rounded-xl p-3 flex gap-2">
              <Info className="w-3.5 h-3.5 text-info shrink-0 mt-0.5" />
              <p className="text-caption leading-6 text-info">
                WeWork backup now keeps <strong>Departments</strong> and <strong>Projects</strong> as separate root branches. Project folders are the main backup unit, and every exported task lives directly inside that project&apos;s <strong>3. Tasks</strong> folder.
              </p>
            </div>
            <div className="bg-warning/10 border border-warning/20 rounded-xl p-3 flex gap-2">
              <Info className="w-3.5 h-3.5 text-warning shrink-0 mt-0.5" />
              <p className="text-caption leading-6 text-warning">
                The current WeWork runtime records <strong>backup_type</strong> in the manifest, but it does not currently reshape this folder tree. Task attachment indexes are populated from <strong>files</strong>, <strong>result.files</strong>, <strong>result_files</strong>, and <strong>review_files</strong> whenever those payloads exist.
              </p>
            </div>
          </div>
        </div>
      </div>

      <ReviewNotice blocked={blocked} archiveNotice={null} />
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
 * GENERIC review fallback
 * ═══════════════════════════════════════════════════════════════════════ */

function GenericReview({ wizard, isEdit }) {
  const {
    currentApp, connectionConfig, domain, accessToken,
    selectedObjects,
    storageDestination, googleAuth,
  } = wizard

  const treeLines = buildGenericTreeLines(googleAuth, currentApp)

  return (
    <div className="h-full flex flex-col gap-5">
      {/* Ready banner */}
      <div className="shrink-0 flex flex-col items-start gap-3 rounded-xl border border-brand/20 bg-gradient-to-r from-brand/10 to-indigo-50 px-5 py-5 lg:flex-row lg:items-center">
        <div className="w-10 h-10 rounded-full bg-brand/10 flex items-center justify-center shrink-0">
          <CheckCircle className="w-5 h-5 text-brand" />
        </div>
        <div>
          <h3 className="text-h3 font-strong text-brand">Configuration complete!</h3>
          <p className="mt-1 text-small leading-6 text-brand">Review and confirm to create the flow</p>
        </div>
      </div>

      <div className={reviewSplitLayoutClass}>
        <div className={reviewSummaryColumnClass}>
          <SummaryCard title="Data Source" icon={Inbox} color="#ea580c">
            <SummaryField label="App"><span className="font-strong" style={{ color: currentApp?.color }}>{currentApp?.name}</span></SummaryField>
            <SummaryField label="Backup Data">
              <div className="flex flex-wrap gap-1 mt-0.5">
                {selectedObjects.map(obj => (
                  <span key={obj} className="inline-flex items-center px-2 py-0.5 rounded-full text-micro font-emphasis" style={{ backgroundColor: currentApp?.bg, color: currentApp?.color }}>{currentApp?.objectLabels[obj]}</span>
                ))}
              </div>
            </SummaryField>
            {connectionConfig?.requiresDomain && (
              <SummaryField label="Domain">
                <span className="font-mono text-caption text-text-secondary">{domain || <span className="text-danger">Not set</span>}</span>
              </SummaryField>
            )}
            <SummaryField label="Access Token">
              <span className="font-mono text-caption text-text-tertiary">
                {accessToken ? `••••${accessToken.slice(-4)}` : <span className="text-danger">Not set</span>}
              </span>
            </SummaryField>
          </SummaryCard>

          <SummaryCard title="Storage" icon={Cloud} color="#2563eb">
            <SummaryField label="Destination"><span className="font-emphasis text-text-primary">{getBackupDestinationLabel(storageDestination)}</span></SummaryField>
            <SummaryField label="Google Account"><span className="break-all text-caption text-text-secondary">{googleAuth?.email || <span className="text-danger">Not connected</span>}</span></SummaryField>
            <SummaryField label="Storage Folder"><span className="text-caption text-text-secondary">{googleAuth?.folder_name || <span className="text-text-quaternary">My Drive (default)</span>}</span></SummaryField>
          </SummaryCard>
        </div>

        <div className="min-w-0 flex flex-col min-h-[360px] xl:min-h-0">
          <FileTreePreview lines={treeLines} />
          <div className="mt-3 shrink-0">
            <div className="bg-warning/10 border border-warning/20 rounded-xl p-3 flex gap-2">
              <Info className="w-3.5 h-3.5 text-warning shrink-0 mt-0.5" />
              <p className="text-caption leading-6 text-warning">
                The output folder structure for <strong>{currentApp?.name}</strong> will be determined on first backup run based on your actual data.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
 * Main entry
 * ═══════════════════════════════════════════════════════════════════════ */

const StepReview = ({ wizard, viewMode }) => {
  const isEdit = viewMode === 'edit'

  if (wizard.isServiceApp) return <ServiceReview wizard={wizard} isEdit={isEdit} />
  if (wizard.isWorkflowApp) return <WorkflowReview wizard={wizard} isEdit={isEdit} />
  if (wizard.isWeworkApp) return <WeworkReview wizard={wizard} isEdit={isEdit} />
  if (wizard.isRequestApp) return <RequestReview wizard={wizard} isEdit={isEdit} />
  return <GenericReview wizard={wizard} isEdit={isEdit} />
}

export default StepReview
