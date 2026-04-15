import React from 'react'
import {
  CheckCircle, Info, Cloud, Globe,
  Headphones, Inbox, FolderKanban, Check, Folder,
} from 'lucide-react'
import { Alert, Spinner, Tag } from '@packages/ui/src/components/common/ui'
import { SummaryCard, SummaryField } from '../shared/SummaryCard'
import FileTreePreview from '../shared/FileTreePreview'

const BACKUP_TYPE_LABELS = { structured: 'Structured (Spreadsheet)', unstructured: 'Files & Attachments', all: 'Complete' }
const BACKUP_TYPE_COLORS = { structured: '#0284c7', unstructured: '#d97706', all: '#7c3aed' }

const reviewSplitLayoutClass = 'grid flex-1 min-h-0 gap-5 xl:grid-cols-[minmax(400px,460px)_minmax(0,1fr)]'
const reviewSummaryColumnClass = 'min-w-0 space-y-4 overflow-y-auto'

/* ═══════════════════════════════════════════════════════════════════════
 * Tree builders — identical logic to the original monolith
 * ═══════════════════════════════════════════════════════════════════════ */

function buildServiceTreeLines(googleAuth, backupType) {
  const root = googleAuth?.folder_name || 'My Drive'
  const hasTickets = backupType === 'unstructured' || backupType === 'all'
  const hasStructured = backupType === 'structured' || backupType === 'all'

  const lines = [
    { indent: 0, icon: '📁', text: root, color: '#e2e8f0' },
    { indent: 1, icon: '📁', text: 'Base Service', color: '#10b981' },
    { indent: 2, icon: '📁', text: '01. Categories', color: '#60a5fa' },
  ]

  if (hasStructured) {
    lines.push({ indent: 3, icon: '📊', text: 'ticket_types.xlsx', color: '#4ade80' })
    lines.push({ indent: 3, icon: '📊', text: 'ticket_sources.xlsx', color: '#4ade80' })
    lines.push({ indent: 3, icon: '📊', text: 'statuses.xlsx', color: '#4ade80' })
  }

  lines.push({ indent: 2, icon: '📁', text: 'Service A', color: '#60a5fa' })

  if (hasStructured) {
    lines.push({ indent: 3, icon: '📊', text: 'Ticket list.xlsx', color: '#4ade80' })
    lines.push({ indent: 3, icon: '📊', text: 'Stage list.xlsx', color: '#4ade80' })
  }

  if (hasTickets) {
    lines.push({ indent: 3, icon: '📁', text: 'Tickets', color: '#a78bfa' })
    lines.push({ indent: 4, icon: '📁', text: '[TICKET-001] Ticket name 1', color: '#93c5fd' })
    lines.push({ indent: 5, icon: '📋', text: 'ticket.json', color: '#94a3b8' })
    lines.push({ indent: 5, icon: '📊', text: 'Ticket info.xlsx', color: '#94a3b8' })
    lines.push({ indent: 5, icon: '📁', text: 'Attachments/', color: '#94a3b8' })
    lines.push({ indent: 6, icon: '📄', text: 'file.pdf', color: '#64748b' })
    lines.push({ indent: 6, icon: '🖼️', text: 'image.png', color: '#64748b' })
    lines.push({ indent: 4, icon: '📁', text: '[TICKET-002] Ticket name 2', color: '#93c5fd' })
    lines.push({ indent: 5, icon: '…', text: '(similar)', color: '#64748b' })
  }

  lines.push({ indent: 2, icon: '📁', text: 'Service B', color: '#60a5fa' })
  lines.push({ indent: 3, icon: '…', text: '(similar)', color: '#64748b' })

  return lines
}

function buildRequestTreeLines(googleAuth) {
  const root = googleAuth?.folder_name || 'My Drive'
  return [
    { indent: 0, icon: '📁', text: root, color: '#e2e8f0' },
    { indent: 1, icon: '📁', text: 'Requests', color: '#10b981' },
    { indent: 2, icon: '📁', text: '[001] Request Group A', color: '#60a5fa' },
    { indent: 3, icon: '📊', text: 'request_info.xlsx', color: '#4ade80' },
    { indent: 3, icon: '📁', text: '[1234] Request name 1', color: '#60a5fa' },
    { indent: 4, icon: '📊', text: 'Custom fields.xlsx', color: '#94a3b8' },
    { indent: 4, icon: '📝', text: 'post_and_comment.txt', color: '#94a3b8' },
    { indent: 4, icon: '📊', text: '[table name].xlsx', color: '#94a3b8' },
    { indent: 4, icon: '📁', text: 'Attachments/', color: '#94a3b8' },
    { indent: 5, icon: '📄', text: 'file1.pdf', color: '#64748b' },
    { indent: 5, icon: '🖼️', text: 'image.png', color: '#64748b' },
    { indent: 3, icon: '📁', text: '[1235] Request name 2', color: '#60a5fa' },
    { indent: 4, icon: '…', text: '(similar)', color: '#64748b' },
    { indent: 2, icon: '📁', text: '[002] Request Group B', color: '#60a5fa' },
    { indent: 3, icon: '…', text: '(similar)', color: '#64748b' },
    { indent: 2, icon: '📁', text: '[direct] Direct requests', color: '#60a5fa' },
    { indent: 3, icon: '…', text: '(requests not in any group)', color: '#64748b' },
  ]
}

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
  if (appId !== 'service' || destinationType !== 'gdrive') return null
  return (
    <Alert
      type="info"
      message="Re-run will move old folder to Trash"
      description="Each time a new Service backup runs, the old Base Service folder will be moved to Google Drive Trash before re-creating."
    />
  )
}

/* ═══════════════════════════════════════════════════════════════════════
 * Ready banner (top)
 * ═══════════════════════════════════════════════════════════════════════ */

function ReadyBanner() {
  return (
    <div className="shrink-0 rounded-2xl px-5 py-4 flex flex-col items-start gap-3 border border-green-200 bg-gradient-to-r from-green-50 to-emerald-50 lg:flex-row lg:items-center">
      <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 bg-green-100">
        <CheckCircle className="w-5 h-5 text-green-600" />
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="text-sm font-bold text-green-800">Ready to create backup flow!</h3>
        <p className="text-xs text-green-600 mt-0.5">Review the configuration below and confirm</p>
      </div>
    </div>
  )
}

function ReviewNotice({ blocked, archiveNotice }) {
  if (!blocked) return null

  return (
    <details className="shrink-0 rounded-xl border border-amber-200 bg-amber-50 text-amber-800">
      <summary className="list-none cursor-pointer px-4 py-3 [&::-webkit-details-marker]:hidden">
        <div className="flex items-center gap-2 text-xs font-semibold">
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-100 text-amber-700">!</span>
          <span>Warning before creating</span>
        </div>
      </summary>
      <div className="border-t border-amber-200 px-4 pb-4 pt-3 text-xs leading-relaxed text-amber-700">
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
    getGoogleDriveRunBlockedReason,
  } = wizard

  const treeLines = buildServiceTreeLines(googleAuth, backupType)
  const blocked = getGoogleDriveRunBlockedReason()
  const archiveNotice = renderServiceArchiveNotice(currentApp?.id || wizard.selectedApp, storageDestination)

  return (
    <div className="h-full flex flex-col gap-4">
      {!blocked && <ReadyBanner />}

      <div className={reviewSplitLayoutClass}>
        <div className={reviewSummaryColumnClass}>
          {/* Source card */}
          <SummaryCard title="Data Source" icon={Headphones} color="#16a34a">
            <SummaryField label="App"><span className="font-semibold text-green-700">Service</span></SummaryField>
            <SummaryField label="Domain">
              <span className="font-mono text-xs text-gray-700">{domain || <span className="text-red-400">Not set</span>}</span>
            </SummaryField>
            <SummaryField label="Data">
              <div className="flex flex-wrap gap-1 mt-0.5">
                {selectedObjects.map(obj => (
                  <span key={obj} className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-green-100 text-green-700">{currentApp?.objectLabels[obj]}</span>
                ))}
              </div>
            </SummaryField>
          </SummaryCard>

          {/* Destination card */}
          <SummaryCard title="Storage" icon={Cloud} color="#2563eb">
            <SummaryField label="Backup Type">
              {backupType
                ? <span className="font-semibold text-sm" style={{ color: BACKUP_TYPE_COLORS[backupType] }}>{BACKUP_TYPE_LABELS[backupType]}</span>
                : <span className="text-red-400 text-xs">Not selected</span>}
            </SummaryField>
            <SummaryField label="Destination">
              <span className="font-semibold">{storageDestination === 'gsheets' ? 'Google Sheets' : 'Google Drive'}</span>
            </SummaryField>
            <SummaryField label="Google Account">
              <span className="text-xs text-gray-700 break-all">{googleAuth?.email || <span className="text-red-400">Not connected</span>}</span>
            </SummaryField>
            <SummaryField label="Storage Folder">
              <span className="text-xs text-gray-700">{googleAuth?.folder_name || <span className="text-gray-400">My Drive (default)</span>}</span>
            </SummaryField>
          </SummaryCard>

          {/* Service count card */}
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
            <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 flex items-center gap-2">
              <Headphones className="w-3.5 h-3.5 text-gray-500" />
              <span className="text-[11px] font-bold text-gray-600 uppercase tracking-wide">Service Summary</span>
            </div>
            <div className="px-4 py-3 flex gap-3">
              <div className="flex-1 bg-gray-50 rounded-xl p-3 text-center">
                <div className="text-2xl font-bold text-gray-800">{servicePreview?.service_count || 0}</div>
                <div className="text-[11px] text-gray-400 mt-0.5">Total</div>
              </div>
              <div className="flex-1 bg-blue-50 rounded-xl p-3 text-center">
                <div className="text-2xl font-bold text-blue-700">{selectedServiceIds.length || 0}</div>
                <div className="text-[11px] text-blue-500 mt-0.5">Selected for backup</div>
              </div>
            </div>
            {loadingServicePreview && (
              <div className="px-4 pb-3 flex items-center gap-2 text-xs text-gray-400"><Spinner /><span>Loading…</span></div>
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
            <p className="text-[11px] text-gray-400 leading-relaxed">
              <span className="text-green-500 font-bold">📊 .xlsx</span> — Spreadsheet data &nbsp;·&nbsp;
              {(backupType === 'unstructured' || backupType === 'all') && (
                <><span className="text-purple-400 font-bold">📁 Tickets/</span> — Ticket folders with files &amp; attachments &nbsp;·&nbsp;</>
              )}
              <span className="text-blue-400 font-bold">📋 ticket.json</span> — Raw ticket data
            </p>
            {backupType === 'structured' && (
              <p className="text-[11px] text-amber-600 mt-1.5">
                With <strong>Structured</strong> backup, only .xlsx files are created — no Tickets folder or attachments.
              </p>
            )}
            {backupType === 'unstructured' && (
              <p className="text-[11px] text-amber-600 mt-1.5">
                With <strong>Files &amp; Attachments</strong> backup, only Tickets folders with JSON and attachments are created — no summary .xlsx.
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
    selectedApp, getGoogleDriveRunBlockedReason,
  } = wizard

  const treeLines = buildRequestTreeLines(googleAuth)
  const blocked = getGoogleDriveRunBlockedReason()
  const archiveNotice = renderServiceArchiveNotice(selectedApp, storageDestination)
  const destinationLabel = storageDestination === 'gsheets' ? 'Google Sheets' : 'Google Drive'

  return (
    <div className="h-full flex flex-col gap-4">
      {!blocked && <ReadyBanner />}

      <div className={reviewSplitLayoutClass}>
        <div className={reviewSummaryColumnClass}>
          <SummaryCard title="Data Source" icon={Inbox} color="#ea580c">
            <SummaryField label="App"><span className="font-semibold" style={{ color: currentApp?.color }}>{currentApp?.name}</span></SummaryField>
            <SummaryField label="Domain">
              <span className="font-mono text-xs text-gray-700">{domain || <span className="text-red-400">Not set</span>}</span>
            </SummaryField>
            <SummaryField label="Auth Token">
              <span className="font-mono text-gray-500 text-xs">
                {accessTokenV2 ? `••••${accessTokenV2.slice(-4)}` : <span className="text-red-400">Not set</span>}
              </span>
            </SummaryField>
          </SummaryCard>

          <SummaryCard title="Storage" icon={Cloud} color="#2563eb">
            <SummaryField label="Backup Type">
              {backupType
                ? <span className="font-semibold" style={{ color: BACKUP_TYPE_COLORS[backupType] }}>{BACKUP_TYPE_LABELS[backupType]}</span>
                : <span className="text-red-400 text-xs">Not selected</span>}
            </SummaryField>
            <SummaryField label="Destination"><span className="font-semibold">{destinationLabel || <span className="text-red-400 text-xs">Not selected</span>}</span></SummaryField>
            <SummaryField label="Google Account"><span className="text-xs text-gray-700 break-all">{googleAuth?.email || <span className="text-red-400">Not connected</span>}</span></SummaryField>
            <SummaryField label="Storage Folder"><span className="text-xs text-gray-700">{googleAuth?.folder_name || <span className="text-gray-400">My Drive (default)</span>}</span></SummaryField>
          </SummaryCard>

          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
            <div className="flex gap-2">
              <Info className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
              <p className="text-[11px] text-amber-700 leading-relaxed">
                <strong>Note:</strong> For Request, the system always backs up all data (spreadsheets + attachments) regardless of the selected backup type.
              </p>
            </div>
          </div>
        </div>

        <div className="min-w-0 flex flex-col min-h-[360px] xl:min-h-0">
          <FileTreePreview lines={treeLines} />
          <div className="mt-3 space-y-1 shrink-0">
            <p className="text-[11px] text-gray-400 leading-relaxed">
              <span className="text-green-500 font-bold">📊 .xlsx</span> — Request list &amp; custom fields &nbsp;·&nbsp;
              <span className="text-blue-400 font-bold">📝 .txt</span> — Posts &amp; comments &nbsp;·&nbsp;
              <span className="text-gray-400 font-bold">📁 Attachments/</span> — Original files or metadata if unavailable
            </p>
          </div>
        </div>
      </div>

      <ReviewNotice blocked={blocked} archiveNotice={archiveNotice} />
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
 * GENERIC review variant (Workflow / WeWork)
 * ═══════════════════════════════════════════════════════════════════════ */

function GenericReview({ wizard, isEdit }) {
  const {
    currentApp, connectionConfig, domain, accessToken,
    selectedObjects, selectedFieldIds, exportFormats,
    storageDestination, googleAuth,
    getAvailableFields, handleFieldToggle, handleSelectAllFields,
  } = wizard

  const treeLines = buildGenericTreeLines(googleAuth, currentApp)
  const availableFields = getAvailableFields()
  const specialFields = availableFields.filter(f =>
    selectedFieldIds.includes(f.id) && (f.type === 'input-table' || f.type === 'select-master')
  )

  return (
    <div className="h-full flex flex-col gap-5">
      {/* Ready banner */}
      <div className="shrink-0 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-2xl px-5 py-4 flex flex-col items-start gap-3 lg:flex-row lg:items-center">
        <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
          <CheckCircle className="w-5 h-5 text-blue-600" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-blue-800">Configuration complete!</h3>
          <p className="text-xs text-blue-600 mt-0.5">Review and confirm to create the flow</p>
        </div>
      </div>

      <div className={reviewSplitLayoutClass}>
        <div className={reviewSummaryColumnClass}>
          <SummaryCard title="Data Source" icon={Inbox} color="#ea580c">
            <SummaryField label="App"><span className="font-semibold" style={{ color: currentApp?.color }}>{currentApp?.name}</span></SummaryField>
            <SummaryField label="Backup Data">
              <div className="flex flex-wrap gap-1 mt-0.5">
                {selectedObjects.map(obj => (
                  <span key={obj} className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ backgroundColor: currentApp?.bg, color: currentApp?.color }}>{currentApp?.objectLabels[obj]}</span>
                ))}
              </div>
            </SummaryField>
            {connectionConfig?.requiresDomain && (
              <SummaryField label="Domain">
                <span className="font-mono text-xs text-gray-700">{domain || <span className="text-red-400">Not set</span>}</span>
              </SummaryField>
            )}
            <SummaryField label="Access Token">
              <span className="font-mono text-gray-500 text-xs">
                {accessToken ? `••••${accessToken.slice(-4)}` : <span className="text-red-400">Not set</span>}
              </span>
            </SummaryField>
          </SummaryCard>

          <SummaryCard title="Storage" icon={Cloud} color="#2563eb">
            <SummaryField label="Destination"><span className="font-semibold">{storageDestination === 'gsheets' ? 'Google Sheets' : 'Google Drive'}</span></SummaryField>
            <SummaryField label="Google Account"><span className="text-xs text-gray-700 break-all">{googleAuth?.email || <span className="text-red-400">Not connected</span>}</span></SummaryField>
            <SummaryField label="Storage Folder"><span className="text-xs text-gray-700">{googleAuth?.folder_name || <span className="text-gray-400">My Drive (default)</span>}</span></SummaryField>
            {selectedFieldIds.length > 0 && (
              <SummaryField label="Custom Fields"><span className="font-semibold">{selectedFieldIds.length} fields selected</span></SummaryField>
            )}
          </SummaryCard>

          {/* Custom fields section */}
          {availableFields.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
              <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                <span className="text-[11px] font-bold text-gray-600 uppercase tracking-wide">Custom Fields</span>
                <button onClick={handleSelectAllFields} className="text-[11px] text-blue-600 hover:text-blue-800 font-medium">
                  {selectedFieldIds.length === availableFields.length ? 'Deselect all' : 'Select all'}
                </button>
              </div>
              <div className="px-3 py-2 space-y-1 max-h-48 overflow-y-auto">
                {availableFields.map(field => (
                  <div key={field.id} onClick={() => handleFieldToggle(field.id)}
                    className="flex items-center gap-2.5 px-2 py-2 rounded-lg cursor-pointer transition-colors hover:bg-gray-50">
                    <div className="w-4 h-4 rounded flex items-center justify-center border-2 transition-all shrink-0"
                      style={{
                        backgroundColor: selectedFieldIds.includes(field.id) ? currentApp?.color : 'transparent',
                        borderColor: selectedFieldIds.includes(field.id) ? currentApp?.color : '#d1d5db',
                      }}>
                      {selectedFieldIds.includes(field.id) && <Check className="w-2.5 h-2.5 text-white" />}
                    </div>
                    <span className="text-xs font-medium text-gray-700 flex-1">{field.name}</span>
                    <span className="text-[10px] text-gray-400 bg-gray-100 px-1 rounded">{field.type}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Export format for special fields */}
          {specialFields.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
              <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100">
                <span className="text-[11px] font-bold text-gray-600 uppercase tracking-wide">Export Format</span>
              </div>
              <div className="px-3 py-2 space-y-2">
                {specialFields.map(field => (
                  <div key={field.id}>
                    <p className="text-[11px] text-gray-500 mb-1 px-1">{field.name}</p>
                    <div className="flex gap-1.5">
                      {[
                        { id: 'json', label: 'JSON', emoji: '📄' },
                        { id: 'excel', label: 'Excel', emoji: '📊' },
                      ].map(fmt => (
                        <div key={fmt.id}
                          onClick={() => wizard.setExportFormats({ ...exportFormats, [field.id]: fmt.id })}
                          className="flex-1 border-2 rounded-xl p-2 cursor-pointer transition-all flex items-center gap-1.5"
                          style={{
                            borderColor: exportFormats[field.id] === fmt.id ? '#3b82f6' : '#e5e7eb',
                            backgroundColor: exportFormats[field.id] === fmt.id ? '#eff6ff' : '#fff',
                          }}>
                          <span className="text-sm">{fmt.emoji}</span>
                          <span className="text-xs font-semibold">{fmt.label}</span>
                          {exportFormats[field.id] === fmt.id && <Check className="w-3 h-3 text-blue-600 ml-auto" />}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="min-w-0 flex flex-col min-h-[360px] xl:min-h-0">
          <FileTreePreview lines={treeLines} />
          <div className="mt-3 shrink-0">
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex gap-2">
              <Info className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
              <p className="text-[11px] text-amber-700 leading-relaxed">
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
  if (wizard.isRequestApp) return <RequestReview wizard={wizard} isEdit={isEdit} />
  return <GenericReview wizard={wizard} isEdit={isEdit} />
}

export default StepReview
