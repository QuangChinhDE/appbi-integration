import React from 'react'
import {
  CheckCircle, Info, Cloud, Globe,
  Headphones, Inbox, FolderKanban, Building2, Check, Folder,
} from 'lucide-react'
import { Alert, Spinner, Tag } from '@packages/ui/src/components/common/ui'
import { SummaryCard, SummaryField } from '../shared/SummaryCard'
import FileTreePreview from '../shared/FileTreePreview'

const BACKUP_TYPE_LABELS = { structured: 'Structured (Spreadsheet)', unstructured: 'Files & Attachments', all: 'Complete' }
const BACKUP_TYPE_COLORS = { structured: '#0284c7', unstructured: '#d97706', all: '#7c3aed' }

const reviewSplitLayoutClass = 'grid flex-1 min-h-0 gap-5 xl:grid-cols-[minmax(340px,0.95fr)_minmax(0,1.55fr)] 2xl:grid-cols-[minmax(380px,0.9fr)_minmax(0,1.7fr)]'
const reviewSummaryColumnClass = 'min-w-0 space-y-4 overflow-y-auto'

/* ═══════════════════════════════════════════════════════════════════════
 * Tree builders — identical logic to the original monolith
 * ═══════════════════════════════════════════════════════════════════════ */

function buildServiceTreeLines(googleAuth, backupType) {
  const root = googleAuth?.folder_name || 'My Drive'
  const hasTicketFolders = backupType === 'unstructured' || backupType === 'all'

  const lines = [
    { indent: 0, icon: '📁', text: root, color: '#e2e8f0' },
    { indent: 1, icon: '📁', text: 'Base Service', color: '#10b981' },
    { indent: 2, icon: '📁', text: '01. Danh mục', color: '#60a5fa' },
    { indent: 3, icon: '📊', text: 'Danh sách service.xlsx', color: '#4ade80' },
    { indent: 3, icon: '📊', text: 'Danh sách compound.xlsx', color: '#4ade80' },
    { indent: 3, icon: '📊', text: 'Danh sách group.xlsx', color: '#4ade80' },
    { indent: 2, icon: '📁', text: '[1001] Example Service', color: '#60a5fa' },
    { indent: 3, icon: '📊', text: 'Thông tin service.xlsx', color: '#4ade80' },
    { indent: 3, icon: '📊', text: 'Danh sách ticket.xlsx', color: '#4ade80' },
    { indent: 3, icon: '📊', text: 'Danh sách stage.xlsx', color: '#4ade80' },
  ]

  if (hasTicketFolders) {
    lines.push({ indent: 3, icon: '📁', text: 'Tickets', color: '#a78bfa' })
    lines.push({ indent: 4, icon: '📁', text: '[INC-001] Example Ticket', color: '#93c5fd' })
    lines.push({ indent: 5, icon: '📊', text: 'Thông tin ticket.xlsx', color: '#4ade80' })
    lines.push({ indent: 5, icon: '📋', text: 'ticket.json', color: '#94a3b8' })
    lines.push({ indent: 5, icon: '📊', text: 'Thông tin trường tùy chỉnh.xlsx', color: '#4ade80' })
    lines.push({ indent: 5, icon: '📊', text: '[resolution steps].xlsx', color: '#4ade80' })
    lines.push({ indent: 5, icon: '📁', text: 'Tệp đính kèm', color: '#94a3b8' })
    lines.push({ indent: 6, icon: '📄', text: 'file.pdf', color: '#64748b' })
    lines.push({ indent: 6, icon: '🖼️', text: 'image.png', color: '#64748b' })
    lines.push({ indent: 4, icon: '…', text: '(one folder per ticket)', color: '#64748b' })
  }

  lines.push({ indent: 2, icon: '…', text: '(one folder per selected service)', color: '#64748b' })

  return lines
}

function buildRequestTreeLines(googleAuth, selectedObjects, selectedGroupIds) {
  const root = googleAuth?.folder_name || 'My Drive'
  const hasGroupScope = !selectedObjects.length || selectedObjects.includes('group') || selectedObjects.includes('request')
  const hasRequestScope = !selectedObjects.length || selectedObjects.includes('request')
  const hasExplicitGroupSelection = selectedGroupIds.length > 0
  const hasNamedGroupSelection = !hasExplicitGroupSelection || selectedGroupIds.some(groupId => groupId !== '0')
  const hasDirectSelection = !hasExplicitGroupSelection || selectedGroupIds.includes('0')

  const lines = [
    { indent: 0, icon: '📁', text: root, color: '#e2e8f0' },
    { indent: 1, icon: '📁', text: 'Requests', color: '#10b981' },
  ]

  if (!hasGroupScope) {
    lines.push({ indent: 2, icon: '…', text: '(select at least one Request data type)', color: '#64748b' })
    return lines
  }

  if (hasNamedGroupSelection) {
    lines.push({ indent: 2, icon: '📁', text: '[001] Request Group A', color: '#60a5fa' })
    lines.push({ indent: 3, icon: '📊', text: 'Danh sách request.xlsx', color: '#4ade80' })

    if (hasRequestScope) {
      lines.push({ indent: 3, icon: '📁', text: '[1234] Request name 1', color: '#60a5fa' })
      lines.push({ indent: 4, icon: '📊', text: 'Thông tin request.xlsx', color: '#4ade80' })
      lines.push({ indent: 4, icon: '📋', text: 'request.json', color: '#94a3b8' })
      lines.push({ indent: 4, icon: '📊', text: 'Thông tin trường tùy chỉnh.xlsx', color: '#4ade80' })
      lines.push({ indent: 4, icon: '📊', text: '[table name].xlsx', color: '#4ade80' })
      lines.push({ indent: 4, icon: '📝', text: 'post_and_comment.txt', color: '#94a3b8' })
      lines.push({ indent: 4, icon: '📁', text: 'Tệp đính kèm', color: '#94a3b8' })
      lines.push({ indent: 5, icon: '📄', text: 'file1.pdf', color: '#64748b' })
      lines.push({ indent: 5, icon: '🖼️', text: 'image.png', color: '#64748b' })
      lines.push({ indent: 3, icon: '📁', text: '[1235] Request name 2', color: '#60a5fa' })
      lines.push({ indent: 4, icon: '…', text: '(similar)', color: '#64748b' })
    } else {
      lines.push({ indent: 3, icon: '…', text: '(request folders are skipped when Request is not selected)', color: '#64748b' })
    }

    lines.push({ indent: 2, icon: '📁', text: '[002] Request Group B', color: '#60a5fa' })
    lines.push({ indent: 3, icon: '…', text: '(similar)', color: '#64748b' })
  } else {
    lines.push({ indent: 2, icon: '…', text: '(named group folders are skipped when only direct requests are selected)', color: '#64748b' })
  }

  if (hasDirectSelection) {
    lines.push({ indent: 2, icon: '📁', text: '[direct] Đề xuất trực tiếp', color: '#60a5fa' })
    lines.push({ indent: 3, icon: '📊', text: 'Danh sách request.xlsx', color: '#4ade80' })
    if (hasRequestScope) {
      lines.push({ indent: 3, icon: '…', text: '(requests not in any group)', color: '#64748b' })
    }
  } else {
    lines.push({ indent: 2, icon: '…', text: '(direct requests are excluded by the current group selection)', color: '#64748b' })
  }

  return lines
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

function buildWorkflowTreeLines(googleAuth, backupType, selectedObjects) {
  const root = googleAuth?.folder_name || 'My Drive'
  const hasWorkflowScope = selectedObjects.some(objectId => ['workflow', 'job'].includes(objectId))
  const hasJobScope = selectedObjects.includes('job')

  const lines = [
    { indent: 0, icon: '📁', text: root, color: '#e2e8f0' },
    { indent: 1, icon: '📁', text: 'Base Workflow', color: '#10b981' },
  ]

  if (!selectedObjects.length) {
    lines.push({ indent: 2, icon: '…', text: '(select at least one Workflow data type)', color: '#64748b' })
    return lines
  }

  lines.push({ indent: 2, icon: '📁', text: 'Workflows', color: '#60a5fa' })

  if (!hasWorkflowScope) {
    lines.push({ indent: 3, icon: '…', text: '(workflow folders are created when Workflow or Job is selected)', color: '#64748b' })
    lines.push({ indent: 2, icon: '📁', text: '0. Danh mục chung', color: '#60a5fa' })
    lines.push({ indent: 3, icon: '📊', text: 'Danh sách workflow.xlsx', color: '#4ade80' })
    lines.push({ indent: 3, icon: '📋', text: 'backup_manifest.json', color: '#94a3b8' })
    return lines
  }

  lines.push({ indent: 3, icon: '📁', text: '[8899] Example Workflow', color: '#60a5fa' })
  lines.push({ indent: 4, icon: '📁', text: '0. Hướng dẫn', color: '#93c5fd' })
  lines.push({ indent: 5, icon: '📝', text: 'README.txt', color: '#94a3b8' })
  lines.push({ indent: 4, icon: '📁', text: '1. Cấu hình workflow', color: '#93c5fd' })
  lines.push({ indent: 5, icon: '📊', text: 'Thông tin workflow.xlsx', color: '#4ade80' })
  lines.push({ indent: 5, icon: '📊', text: 'Danh sách stage.xlsx', color: '#4ade80' })

  if (hasJobScope) {
    lines.push({ indent: 4, icon: '📁', text: '2. Danh sách công việc', color: '#93c5fd' })
    lines.push({ indent: 5, icon: '📊', text: 'Danh sách job.xlsx', color: '#4ade80' })
    lines.push({ indent: 4, icon: '📁', text: '3. Jobs', color: '#a78bfa' })
    lines.push({ indent: 5, icon: '📁', text: '[73301] Example Job', color: '#93c5fd' })
    lines.push({ indent: 6, icon: '📁', text: '1. Thông tin', color: '#bfdbfe' })
    lines.push({ indent: 7, icon: '📊', text: 'Thông tin job.xlsx', color: '#4ade80' })
    lines.push({ indent: 7, icon: '📊', text: 'Thông tin job log.xlsx', color: '#4ade80' })
    lines.push({ indent: 7, icon: '📊', text: 'Thông tin job moves.xlsx', color: '#4ade80' })
    lines.push({ indent: 6, icon: '📁', text: '2. Dữ liệu nhập', color: '#bfdbfe' })
    lines.push({ indent: 7, icon: '📊', text: 'custom_fields.xlsx', color: '#4ade80' })
    lines.push({ indent: 7, icon: '📊', text: 'input table.xlsx', color: '#4ade80' })
    lines.push({ indent: 7, icon: '📊', text: 'input table kèm base table.xlsx', color: '#4ade80' })
    lines.push({ indent: 7, icon: '📊', text: 'select master.xlsx', color: '#4ade80' })
    lines.push({ indent: 6, icon: '📁', text: '3. Nội dung', color: '#bfdbfe' })
    lines.push({ indent: 7, icon: '📝', text: 'post_and_comment.txt', color: '#94a3b8' })
    lines.push({ indent: 6, icon: '📁', text: '4. Tệp đính kèm', color: '#bfdbfe' })
    lines.push({ indent: 7, icon: '📝', text: 'Thông tin files', color: '#94a3b8' })
    lines.push({ indent: 5, icon: '…', text: '(one folder per job)', color: '#64748b' })
  } else {
    lines.push({ indent: 4, icon: '…', text: '(job list and job folders are skipped when Job is not selected)', color: '#64748b' })
  }

  lines.push({ indent: 3, icon: '…', text: '(one folder per selected workflow)', color: '#64748b' })
  lines.push({ indent: 2, icon: '📁', text: '0. Danh mục chung', color: '#60a5fa' })
  lines.push({ indent: 3, icon: '📊', text: 'Danh sách workflow.xlsx', color: '#4ade80' })
  lines.push({ indent: 3, icon: '📋', text: 'backup_manifest.json', color: '#94a3b8' })

  return lines
}

function buildWeworkTreeLines(googleAuth, selectedObjects, selectedProjectIds) {
  const root = googleAuth?.folder_name || 'My Drive'
  const hasDepartmentScope = selectedObjects.includes('department')
  const hasProjectScope = selectedObjects.includes('project')
  const hasTaskScope = selectedObjects.includes('task')
  const hasProjectContainers = hasProjectScope || hasTaskScope

  const lines = [
    { indent: 0, icon: '📁', text: root, color: '#e2e8f0' },
    { indent: 1, icon: '📁', text: 'Base WeWork', color: '#10b981' },
    { indent: 2, icon: '📁', text: '0. Danh mục chung', color: '#60a5fa' },
    { indent: 3, icon: '📊', text: 'Danh sách phòng ban.xlsx', color: '#4ade80' },
    { indent: 3, icon: '📊', text: 'Danh sách project.xlsx', color: '#4ade80' },
    { indent: 3, icon: '📋', text: 'backup_manifest.json', color: '#94a3b8' },
    { indent: 2, icon: '📁', text: '1. Departments', color: '#60a5fa' },
  ]

  if (!selectedObjects.length) {
    lines.push({ indent: 3, icon: '…', text: '(select at least one WeWork data type)', color: '#64748b' })
    return lines
  }

  lines.push({ indent: 3, icon: '📁', text: '[301] Product Department', color: '#93c5fd' })
  if (hasDepartmentScope) {
    lines.push({ indent: 4, icon: '📊', text: 'Thông tin phòng ban.xlsx', color: '#4ade80' })
  } else {
    lines.push({ indent: 4, icon: '…', text: '(department info is skipped when Department is not selected)', color: '#64748b' })
  }

  if (hasProjectContainers) {
    lines.push({ indent: 4, icon: '📁', text: '[771] Project Apollo', color: '#60a5fa' })
    if (hasProjectScope) {
      lines.push({ indent: 5, icon: '📁', text: '1. Thông tin', color: '#bfdbfe' })
      lines.push({ indent: 6, icon: '📊', text: 'Thông tin project.xlsx', color: '#4ade80' })
      lines.push({ indent: 6, icon: '📊', text: 'Danh sách tasklist.xlsx', color: '#4ade80' })
      lines.push({ indent: 6, icon: '📊', text: 'Danh sách milestone.xlsx', color: '#4ade80' })
      lines.push({ indent: 5, icon: '📁', text: '2. Tùy chỉnh', color: '#bfdbfe' })
      lines.push({ indent: 6, icon: '📊', text: 'Thông tin trường tùy chỉnh.xlsx', color: '#4ade80' })
      lines.push({ indent: 6, icon: '📊', text: 'custom_budget.xlsx', color: '#4ade80' })
    } else {
      lines.push({ indent: 5, icon: '…', text: '(project info and custom exports are skipped when Project is not selected)', color: '#64748b' })
    }

    if (hasTaskScope) {
      lines.push({ indent: 5, icon: '📁', text: '3. Tasks', color: '#a78bfa' })
      lines.push({ indent: 6, icon: '📊', text: 'Danh sách task.xlsx', color: '#4ade80' })
      lines.push({ indent: 6, icon: '📁', text: '[5001] Root Task', color: '#93c5fd' })
      lines.push({ indent: 7, icon: '📁', text: '1. Thông tin', color: '#bfdbfe' })
      lines.push({ indent: 8, icon: '📊', text: 'Thông tin task.xlsx', color: '#4ade80' })
      lines.push({ indent: 8, icon: '📋', text: 'task.json', color: '#94a3b8' })
      lines.push({ indent: 7, icon: '📁', text: '2. Tùy chỉnh', color: '#bfdbfe' })
      lines.push({ indent: 8, icon: '📊', text: 'Thông tin trường tùy chỉnh.xlsx', color: '#4ade80' })
      lines.push({ indent: 7, icon: '📁', text: '3. Công việc con', color: '#bfdbfe' })
      lines.push({ indent: 8, icon: '📁', text: '[5002] Child Task', color: '#93c5fd' })
      lines.push({ indent: 9, icon: '📁', text: '1. Thông tin', color: '#bfdbfe' })
      lines.push({ indent: 10, icon: '📊', text: 'Thông tin task.xlsx', color: '#4ade80' })
      lines.push({ indent: 8, icon: '…', text: '(nested again when a child task becomes a parent)', color: '#64748b' })
    } else {
      lines.push({ indent: 5, icon: '…', text: '(task folders are skipped when Task is not selected)', color: '#64748b' })
    }
  } else {
    lines.push({ indent: 4, icon: '…', text: '(project folders are created when Project or Task is selected)', color: '#64748b' })
  }

  if (selectedProjectIds.length > 1) {
    lines.push({ indent: 3, icon: '…', text: '(one department/project branch per selected project)', color: '#64748b' })
  }

  return lines
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
    <div className="shrink-0 rounded-xl px-5 py-4 flex flex-col items-start gap-3 border border-success/30 bg-gradient-to-r from-success/10 to-emerald-50 lg:flex-row lg:items-center">
      <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 bg-success/10">
        <CheckCircle className="w-5 h-5 text-success" />
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="text-caption font-strong text-success">Ready to create backup flow!</h3>
        <p className="text-tiny text-success mt-0.5">Review the configuration below and confirm</p>
      </div>
    </div>
  )
}

function ReviewNotice({ blocked, archiveNotice }) {
  if (!blocked) return null

  return (
    <details className="shrink-0 rounded-md border border-warning/20 bg-warning/10 text-warning">
      <summary className="list-none cursor-pointer px-4 py-3 [&::-webkit-details-marker]:hidden">
        <div className="flex items-center gap-2 text-tiny font-strong">
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-warning/10 text-warning">!</span>
          <span>Warning before creating</span>
        </div>
      </summary>
      <div className="border-t border-warning/20 px-4 pb-4 pt-3 text-tiny leading-relaxed text-warning">
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
            <SummaryField label="App"><span className="font-strong text-success">Service</span></SummaryField>
            <SummaryField label="Domain">
              <span className="font-mono text-tiny text-text-secondary">{domain || <span className="text-danger">Not set</span>}</span>
            </SummaryField>
            <SummaryField label="Data">
              <div className="flex flex-wrap gap-1 mt-0.5">
                {selectedObjects.map(obj => (
                  <span key={obj} className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-strong bg-success/10 text-success">{currentApp?.objectLabels[obj]}</span>
                ))}
              </div>
            </SummaryField>
          </SummaryCard>

          {/* Destination card */}
          <SummaryCard title="Storage" icon={Cloud} color="#2563eb">
            <SummaryField label="Backup Type">
              {backupType
                ? <span className="font-strong text-caption" style={{ color: BACKUP_TYPE_COLORS[backupType] }}>{BACKUP_TYPE_LABELS[backupType]}</span>
                : <span className="text-danger text-tiny">Not selected</span>}
            </SummaryField>
            <SummaryField label="Destination">
              <span className="font-strong">{storageDestination === 'gsheets' ? 'Google Sheets' : 'Google Drive'}</span>
            </SummaryField>
            <SummaryField label="Google Account">
              <span className="text-tiny text-text-secondary break-all">{googleAuth?.email || <span className="text-danger">Not connected</span>}</span>
            </SummaryField>
            <SummaryField label="Storage Folder">
              <span className="text-tiny text-text-secondary">{googleAuth?.folder_name || <span className="text-text-quaternary">My Drive (default)</span>}</span>
            </SummaryField>
          </SummaryCard>

          {/* Service count card */}
          <div className="bg-surface-1 border border-[rgb(var(--border-line))] rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 bg-surface-2 border-b border-[rgb(var(--border-line))] flex items-center gap-2">
              <Headphones className="w-3.5 h-3.5 text-text-tertiary" />
              <span className="text-[11px] font-strong text-text-secondary uppercase tracking-wide">Service Summary</span>
            </div>
            <div className="px-4 py-3 flex gap-3">
              <div className="flex-1 bg-surface-2 rounded-md p-3 text-center">
                <div className="text-2xl font-strong text-text-primary">{servicePreview?.service_count || 0}</div>
                <div className="text-[11px] text-text-quaternary mt-0.5">Total</div>
              </div>
              <div className="flex-1 bg-brand/10 rounded-md p-3 text-center">
                <div className="text-2xl font-strong text-brand">{selectedServiceIds.length || 0}</div>
                <div className="text-[11px] text-brand mt-0.5">Selected for backup</div>
              </div>
            </div>
            {loadingServicePreview && (
              <div className="px-4 pb-3 flex items-center gap-2 text-tiny text-text-quaternary"><Spinner /><span>Loading…</span></div>
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
            <p className="text-[11px] text-text-quaternary leading-relaxed">
              <span className="text-success font-strong">📊 .xlsx</span> — Catalog, service summaries, ticket info, and custom exports &nbsp;·&nbsp;
              {(backupType === 'unstructured' || backupType === 'all') && (
                <><span className="text-[#7c3aed] font-strong">📁 Tickets/</span> — Per-ticket folders with info, custom sheets, and attachments &nbsp;·&nbsp;</>
              )}
              <span className="text-brand font-strong">📋 ticket.json</span> — Raw merged ticket payload
            </p>
            {backupType === 'structured' && (
              <p className="text-[11px] text-warning mt-1.5">
                With <strong>Structured</strong> backup, the system creates catalog and service-level spreadsheets only. Per-ticket folders and attachments are skipped.
              </p>
            )}
            {backupType === 'unstructured' && (
              <p className="text-[11px] text-warning mt-1.5">
                With <strong>Files &amp; Attachments</strong> backup, service summary spreadsheets are still created, and the backup also adds per-ticket info/custom files plus attachments.
              </p>
            )}
            {backupType === 'all' && (
              <p className="text-[11px] text-warning mt-1.5">
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
    selectedApp, getGoogleDriveRunBlockedReason,
  } = wizard

  const hasRequestScope = !selectedObjects.length || selectedObjects.includes('request')
  const hasNamedGroupSelection = selectedGroupIds.length === 0 || selectedGroupIds.some(groupId => groupId !== '0')
  const includesDirectRequests = selectedGroupIds.length === 0 || selectedGroupIds.includes('0')
  const treeLines = buildRequestTreeLines(googleAuth, selectedObjects, selectedGroupIds)
  const blocked = getGoogleDriveRunBlockedReason()
  const archiveNotice = renderServiceArchiveNotice(selectedApp, storageDestination)
  const destinationLabel = storageDestination === 'gsheets' ? 'Google Sheets' : 'Google Drive'

  return (
    <div className="h-full flex flex-col gap-4">
      {!blocked && <ReadyBanner />}

      <div className={reviewSplitLayoutClass}>
        <div className={reviewSummaryColumnClass}>
          <SummaryCard title="Data Source" icon={Inbox} color="#ea580c">
            <SummaryField label="App"><span className="font-strong" style={{ color: currentApp?.color }}>{currentApp?.name}</span></SummaryField>
            <SummaryField label="Domain">
              <span className="font-mono text-tiny text-text-secondary">{domain || <span className="text-danger">Not set</span>}</span>
            </SummaryField>
            <SummaryField label="Auth Token">
              <span className="font-mono text-text-tertiary text-tiny">
                {accessTokenV2 ? `••••${accessTokenV2.slice(-4)}` : <span className="text-danger">Not set</span>}
              </span>
            </SummaryField>
            <SummaryField label="Data">
              <div className="flex flex-wrap gap-1 mt-0.5">
                {selectedObjects.map(objectId => (
                  <span key={objectId} className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-strong bg-brand/10 text-brand">
                    {currentApp?.objectLabels?.[objectId] || objectId}
                  </span>
                ))}
              </div>
            </SummaryField>
          </SummaryCard>

          <SummaryCard title="Storage" icon={Cloud} color="#2563eb">
            <SummaryField label="Backup Type">
              {backupType
                ? <span className="font-strong" style={{ color: BACKUP_TYPE_COLORS[backupType] }}>{BACKUP_TYPE_LABELS[backupType]}</span>
                : <span className="text-danger text-tiny">Not selected</span>}
            </SummaryField>
            <SummaryField label="Destination"><span className="font-strong">{destinationLabel || <span className="text-danger text-tiny">Not selected</span>}</span></SummaryField>
            <SummaryField label="Google Account"><span className="text-tiny text-text-secondary break-all">{googleAuth?.email || <span className="text-danger">Not connected</span>}</span></SummaryField>
            <SummaryField label="Storage Folder"><span className="text-tiny text-text-secondary">{googleAuth?.folder_name || <span className="text-text-quaternary">My Drive (default)</span>}</span></SummaryField>
          </SummaryCard>

          <div className="bg-surface-1 border border-[rgb(var(--border-line))] rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 bg-surface-2 border-b border-[rgb(var(--border-line))] flex items-center gap-2">
              <Inbox className="w-3.5 h-3.5 text-text-tertiary" />
              <span className="text-[11px] font-strong text-text-secondary uppercase tracking-wide">Request Group Summary</span>
            </div>
            <div className="px-4 py-3 flex gap-3">
              <div className="flex-1 bg-surface-2 rounded-md p-3 text-center">
                <div className="text-2xl font-strong text-text-primary">{requestPreview?.selectable_source_count ?? selectedGroupIds.length}</div>
                <div className="text-[11px] text-text-quaternary mt-0.5">Groups/direct sources loaded</div>
              </div>
              <div className="flex-1 bg-brand/10 rounded-md p-3 text-center">
                <div className="text-2xl font-strong text-brand">{selectedGroupIds.length}</div>
                <div className="text-[11px] text-brand mt-0.5">Selected for backup</div>
              </div>
            </div>
            {loadingRequestPreview && (
              <div className="px-4 pb-3 flex items-center gap-2 text-tiny text-text-quaternary"><Spinner /><span>Loading…</span></div>
            )}
            {!loadingRequestPreview && requestPreview && !requestPreview.request_count_complete && (
              <div className="px-4 pb-3">
                <Alert type="warning" message={`Loaded ${requestPreview.detail_loaded_count || 0} sources. Open list and refresh to update.`} />
              </div>
            )}
            <div className="px-4 pb-4 space-y-1 text-tiny text-text-secondary">
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

          <div className="bg-warning/10 border border-warning/20 rounded-md p-3">
            <div className="flex gap-2">
              <Info className="w-3.5 h-3.5 text-warning shrink-0 mt-0.5" />
              <p className="text-[11px] text-warning leading-relaxed">
                <strong>Note:</strong> Request uses the selected data scope (<strong>Group</strong> / <strong>Request</strong>) for structure, while the backup type is currently treated as a storage setup choice rather than changing the Request export content.
              </p>
            </div>
          </div>
        </div>

        <div className="min-w-0 flex flex-col min-h-[360px] xl:min-h-0">
          <FileTreePreview lines={treeLines} />
          <div className="mt-3 space-y-1 shrink-0">
            <p className="text-[11px] text-text-quaternary leading-relaxed">
              <span className="text-success font-strong">📊 .xlsx</span> — Group request lists, request info, and custom exports &nbsp;·&nbsp;
              <span className="text-brand font-strong">📋 .json</span> — Full request detail bundle &nbsp;·&nbsp;
              <span className="text-brand font-strong">📝 .txt</span> — Posts &amp; comments &nbsp;·&nbsp;
              <span className="text-text-quaternary font-strong">📁 Tệp đính kèm/</span> — Files attached to the request when available
            </p>
            {!hasRequestScope && (
              <p className="text-[11px] text-warning mt-1.5">
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
    getGoogleDriveRunBlockedReason,
  } = wizard

  const hasWorkflowScope = selectedObjects.some(objectId => ['workflow', 'job'].includes(objectId))
  const hasJobScope = selectedObjects.includes('job')
  const hasDiscussionExports = hasJobScope && backupType === 'all'
  const treeLines = buildWorkflowTreeLines(googleAuth, backupType, selectedObjects)
  const blocked = getGoogleDriveRunBlockedReason()
  const destinationLabel = storageDestination === 'gsheets' ? 'Google Sheets' : 'Google Drive'

  return (
    <div className="h-full flex flex-col gap-4">
      {!blocked && <ReadyBanner />}

      <div className={reviewSplitLayoutClass}>
        <div className={reviewSummaryColumnClass}>
          <SummaryCard title="Data Source" icon={FolderKanban} color="#7c3aed">
            <SummaryField label="App"><span className="font-strong text-[#7c3aed]">Workflow</span></SummaryField>
            <SummaryField label="Domain">
              <span className="font-mono text-tiny text-text-secondary">{domain || <span className="text-danger">Not set</span>}</span>
            </SummaryField>
            <SummaryField label="Access Token">
              <span className="font-mono text-text-tertiary text-tiny">
                {accessToken ? `••••${accessToken.slice(-4)}` : <span className="text-danger">Not set</span>}
              </span>
            </SummaryField>
            <SummaryField label="Data">
              <div className="flex flex-wrap gap-1 mt-0.5">
                {selectedObjects.map(objectId => (
                  <span key={objectId} className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-strong bg-[#7c3aed]/10 text-[#7c3aed]">
                    {currentApp?.objectLabels?.[objectId] || objectId}
                  </span>
                ))}
              </div>
            </SummaryField>
          </SummaryCard>

          <SummaryCard title="Storage" icon={Cloud} color="#2563eb">
            <SummaryField label="Backup Type">
              {backupType
                ? <span className="font-strong text-caption" style={{ color: BACKUP_TYPE_COLORS[backupType] }}>{BACKUP_TYPE_LABELS[backupType]}</span>
                : <span className="text-danger text-tiny">Not selected</span>}
            </SummaryField>
            <SummaryField label="Destination"><span className="font-strong">{destinationLabel}</span></SummaryField>
            <SummaryField label="Google Account"><span className="text-tiny text-text-secondary break-all">{googleAuth?.email || <span className="text-danger">Not connected</span>}</span></SummaryField>
            <SummaryField label="Storage Folder"><span className="text-tiny text-text-secondary">{googleAuth?.folder_name || <span className="text-text-quaternary">My Drive (default)</span>}</span></SummaryField>
          </SummaryCard>

          <div className="bg-surface-1 border border-[rgb(var(--border-line))] rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 bg-surface-2 border-b border-[rgb(var(--border-line))] flex items-center gap-2">
              <FolderKanban className="w-3.5 h-3.5 text-text-tertiary" />
              <span className="text-[11px] font-strong text-text-secondary uppercase tracking-wide">Workflow Summary</span>
            </div>
            <div className="px-4 py-3 flex gap-3">
              <div className="flex-1 bg-surface-2 rounded-md p-3 text-center">
                <div className="text-2xl font-strong text-text-primary">{workflowPreview?.workflow_count ?? selectedWorkflowIds.length}</div>
                <div className="text-[11px] text-text-quaternary mt-0.5">Workflows loaded</div>
              </div>
              <div className="flex-1 bg-[#7c3aed]/10 rounded-md p-3 text-center">
                <div className="text-2xl font-strong text-[#7c3aed]">{selectedWorkflowIds.length}</div>
                <div className="text-[11px] text-[#7c3aed] mt-0.5">Selected for backup</div>
              </div>
            </div>
            {loadingWorkflowPreview && (
              <div className="px-4 pb-3 flex items-center gap-2 text-tiny text-text-quaternary"><Spinner /><span>Loading…</span></div>
            )}
            {!loadingWorkflowPreview && workflowPreview && !workflowPreview.job_count_complete && (
              <div className="px-4 pb-3">
                <Alert type="warning" message={`Loaded ${workflowPreview.detail_loaded_count || 0} workflows. Open list and refresh to update.`} />
              </div>
            )}
            <div className="px-4 pb-4 space-y-1 text-tiny text-text-secondary">
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
                <span className={`font-strong ${hasWorkflowScope ? 'text-success' : 'text-text-quaternary'}`}>
                  {hasWorkflowScope ? 'Included' : 'Excluded'}
                </span>
              </div>
              <div className="flex items-center justify-between rounded-md bg-surface-2 px-3 py-2">
                <span>Posts/comments content</span>
                <span className={`font-strong ${hasJobScope ? 'text-success' : 'text-text-quaternary'}`}>
                  {hasJobScope ? (hasDiscussionExports ? 'Included' : 'Note only') : 'Excluded'}
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
            <p className="text-[11px] text-text-quaternary leading-relaxed">
              <span className="text-success font-strong">📊 .xlsx</span> — Workflow config, job lists, job info, logs/moves, and input-data exports &nbsp;·&nbsp;
              <span className="text-brand font-strong">📝 .txt</span> — README, post/comment export, and file info &nbsp;·&nbsp;
              <span className="text-[#7c3aed] font-strong">📁 Workflows/</span> — One folder per selected workflow
            </p>
            {backupType === 'structured' && (
              <p className="text-[11px] text-warning mt-1.5">
                With <strong>Structured</strong> backup, the <strong>3. Nội dung/post_and_comment.txt</strong> file is still created, but it contains a note instead of post/comment content.
              </p>
            )}
            {backupType === 'all' && hasJobScope && (
              <p className="text-[11px] text-warning mt-1.5">
                With <strong>Complete</strong> backup, each job folder includes <strong>post_and_comment.txt</strong> with the job discussion content returned by Workflow API.
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
    getGoogleDriveRunBlockedReason,
  } = wizard

  const hasDepartmentScope = selectedObjects.includes('department')
  const hasProjectScope = selectedObjects.includes('project')
  const hasTaskScope = selectedObjects.includes('task')
  const treeLines = buildWeworkTreeLines(googleAuth, selectedObjects, selectedProjectIds)
  const blocked = getGoogleDriveRunBlockedReason()

  return (
    <div className="h-full flex flex-col gap-4">
      {!blocked && <ReadyBanner />}

      <div className={reviewSplitLayoutClass}>
        <div className={reviewSummaryColumnClass}>
          <SummaryCard title="Data Source" icon={Building2} color="#2563eb">
            <SummaryField label="App"><span className="font-strong" style={{ color: currentApp?.color }}>{currentApp?.name}</span></SummaryField>
            <SummaryField label="Domain"><span className="font-mono text-tiny text-text-secondary">{domain || <span className="text-danger">Not set</span>}</span></SummaryField>
            <SummaryField label="Access Token"><span className="font-mono text-tiny text-text-tertiary">{accessToken ? `••••${accessToken.slice(-4)}` : <span className="text-danger">Not set</span>}</span></SummaryField>
            <SummaryField label="Backup Data">
              <div className="flex flex-wrap gap-1 mt-0.5">
                {selectedObjects.map(obj => (
                  <span key={obj} className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-strong" style={{ backgroundColor: currentApp?.bg, color: currentApp?.color }}>{currentApp?.objectLabels[obj]}</span>
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
              <div className="space-y-1.5 text-tiny text-text-secondary">
                <div className="flex items-center justify-between rounded-md bg-surface-2 px-3 py-2">
                  <span>Department info</span>
                  <span className={`font-strong ${hasDepartmentScope ? 'text-success' : 'text-text-quaternary'}`}>{hasDepartmentScope ? 'Included' : 'Container only'}</span>
                </div>
                <div className="flex items-center justify-between rounded-md bg-surface-2 px-3 py-2">
                  <span>Project info + tasklists + milestones</span>
                  <span className={`font-strong ${hasProjectScope ? 'text-success' : 'text-text-quaternary'}`}>{hasProjectScope ? 'Included' : 'Excluded'}</span>
                </div>
                <div className="flex items-center justify-between rounded-md bg-surface-2 px-3 py-2">
                  <span>Nested task folders</span>
                  <span className={`font-strong ${hasTaskScope ? 'text-success' : 'text-text-quaternary'}`}>{hasTaskScope ? 'Included' : 'Excluded'}</span>
                </div>
              </div>
            </SummaryField>
            {loadingWeworkPreview && <div className="text-tiny text-text-quaternary">Loading current WeWork preview…</div>}
            {weworkPreview?.catalog_warning && <Alert type="warning" message="Department catalog loaded partially" description={weworkPreview.catalog_warning} />}
            {weworkPreview?.partial_error_count > 0 && <Alert type="warning" message={`Some projects could not be previewed completely (${weworkPreview.partial_error_count})`} />}
          </SummaryCard>

          <SummaryCard title="Storage" icon={Cloud} color="#2563eb">
            <SummaryField label="Destination"><span className="font-strong">{storageDestination === 'gsheets' ? 'Google Sheets' : 'Google Drive'}</span></SummaryField>
            <SummaryField label="Google Account"><span className="text-tiny text-text-secondary break-all">{googleAuth?.email || <span className="text-danger">Not connected</span>}</span></SummaryField>
            <SummaryField label="Storage Folder"><span className="text-tiny text-text-secondary">{googleAuth?.folder_name || <span className="text-text-quaternary">My Drive (default)</span>}</span></SummaryField>
          </SummaryCard>
        </div>

        <div className="min-w-0 flex flex-col min-h-[360px] xl:min-h-0">
          <FileTreePreview lines={treeLines} />
          <div className="mt-3 shrink-0 space-y-2">
            <p className="text-[11px] text-text-quaternary leading-relaxed">
              <span className="text-success font-strong">📊 .xlsx</span> — Department/project info, tasklists, milestones, task lists, and custom exports &nbsp;·&nbsp;
              <span className="text-text-quaternary font-strong">📋 .json</span> — Raw task detail snapshot for each task folder &nbsp;·&nbsp;
              <span className="text-brand font-strong">📁 Nested task folders</span> — Child tasks are placed under the parent task whose ID matches their <strong>parent_id</strong>
            </p>
            <div className="bg-info/10 border border-info/20 rounded-xl p-3 flex gap-2">
              <Info className="w-3.5 h-3.5 text-info shrink-0 mt-0.5" />
              <p className="text-[11px] text-info leading-relaxed">
                WeWork task folders are built from task payload relationships, not from a separate subtask endpoint. Any task with <strong>parent_id = "0"</strong> becomes a top-level folder, and any task whose <strong>parent_id</strong> matches another task ID is nested under that parent.
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
      <div className="shrink-0 bg-gradient-to-r from-brand/10 to-indigo-50 border border-brand/20 rounded-xl px-5 py-4 flex flex-col items-start gap-3 lg:flex-row lg:items-center">
        <div className="w-10 h-10 rounded-full bg-brand/10 flex items-center justify-center shrink-0">
          <CheckCircle className="w-5 h-5 text-brand" />
        </div>
        <div>
          <h3 className="text-caption font-strong text-brand">Configuration complete!</h3>
          <p className="text-tiny text-brand mt-0.5">Review and confirm to create the flow</p>
        </div>
      </div>

      <div className={reviewSplitLayoutClass}>
        <div className={reviewSummaryColumnClass}>
          <SummaryCard title="Data Source" icon={Inbox} color="#ea580c">
            <SummaryField label="App"><span className="font-strong" style={{ color: currentApp?.color }}>{currentApp?.name}</span></SummaryField>
            <SummaryField label="Backup Data">
              <div className="flex flex-wrap gap-1 mt-0.5">
                {selectedObjects.map(obj => (
                  <span key={obj} className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-strong" style={{ backgroundColor: currentApp?.bg, color: currentApp?.color }}>{currentApp?.objectLabels[obj]}</span>
                ))}
              </div>
            </SummaryField>
            {connectionConfig?.requiresDomain && (
              <SummaryField label="Domain">
                <span className="font-mono text-tiny text-text-secondary">{domain || <span className="text-danger">Not set</span>}</span>
              </SummaryField>
            )}
            <SummaryField label="Access Token">
              <span className="font-mono text-text-tertiary text-tiny">
                {accessToken ? `••••${accessToken.slice(-4)}` : <span className="text-danger">Not set</span>}
              </span>
            </SummaryField>
          </SummaryCard>

          <SummaryCard title="Storage" icon={Cloud} color="#2563eb">
            <SummaryField label="Destination"><span className="font-strong">{storageDestination === 'gsheets' ? 'Google Sheets' : 'Google Drive'}</span></SummaryField>
            <SummaryField label="Google Account"><span className="text-tiny text-text-secondary break-all">{googleAuth?.email || <span className="text-danger">Not connected</span>}</span></SummaryField>
            <SummaryField label="Storage Folder"><span className="text-tiny text-text-secondary">{googleAuth?.folder_name || <span className="text-text-quaternary">My Drive (default)</span>}</span></SummaryField>
            {selectedFieldIds.length > 0 && (
              <SummaryField label="Custom Fields"><span className="font-strong">{selectedFieldIds.length} fields selected</span></SummaryField>
            )}
          </SummaryCard>

          {/* Custom fields section */}
          {availableFields.length > 0 && (
            <div className="bg-surface-1 border border-[rgb(var(--border-line))] rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 bg-surface-2 border-b border-[rgb(var(--border-line))] flex items-center justify-between">
                <span className="text-[11px] font-strong text-text-secondary uppercase tracking-wide">Custom Fields</span>
                <button onClick={handleSelectAllFields} className="text-[11px] text-brand hover:text-brand font-emphasis">
                  {selectedFieldIds.length === availableFields.length ? 'Deselect all' : 'Select all'}
                </button>
              </div>
              <div className="px-3 py-2 space-y-1 max-h-48 overflow-y-auto">
                {availableFields.map(field => (
                  <div key={field.id} onClick={() => handleFieldToggle(field.id)}
                    className="flex items-center gap-2.5 px-2 py-2 rounded-md cursor-pointer transition-colors hover:bg-surface-2">
                    <div className="w-4 h-4 rounded flex items-center justify-center border-2 transition-all shrink-0"
                      style={{
                        backgroundColor: selectedFieldIds.includes(field.id) ? currentApp?.color : 'transparent',
                        borderColor: selectedFieldIds.includes(field.id) ? currentApp?.color : '#d1d5db',
                      }}>
                      {selectedFieldIds.includes(field.id) && <Check className="w-2.5 h-2.5 text-white" />}
                    </div>
                    <span className="text-tiny font-emphasis text-text-secondary flex-1">{field.name}</span>
                    <span className="text-[10px] text-text-quaternary bg-surface-2 px-1 rounded">{field.type}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Export format for special fields */}
          {specialFields.length > 0 && (
            <div className="bg-surface-1 border border-[rgb(var(--border-line))] rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 bg-surface-2 border-b border-[rgb(var(--border-line))]">
                <span className="text-[11px] font-strong text-text-secondary uppercase tracking-wide">Export Format</span>
              </div>
              <div className="px-3 py-2 space-y-2">
                {specialFields.map(field => (
                  <div key={field.id}>
                    <p className="text-[11px] text-text-tertiary mb-1 px-1">{field.name}</p>
                    <div className="flex gap-1.5">
                      {[
                        { id: 'json', label: 'JSON', emoji: '📄' },
                        { id: 'excel', label: 'Excel', emoji: '📊' },
                      ].map(fmt => (
                        <div key={fmt.id}
                          onClick={() => wizard.setExportFormats({ ...exportFormats, [field.id]: fmt.id })}
                          className="flex-1 border-2 rounded-md p-2 cursor-pointer transition-all flex items-center gap-1.5"
                          style={{
                            borderColor: exportFormats[field.id] === fmt.id ? '#3b82f6' : '#e5e7eb',
                            backgroundColor: exportFormats[field.id] === fmt.id ? '#eff6ff' : '#fff',
                          }}>
                          <span className="text-caption">{fmt.emoji}</span>
                          <span className="text-tiny font-strong">{fmt.label}</span>
                          {exportFormats[field.id] === fmt.id && <Check className="w-3 h-3 text-brand ml-auto" />}
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
            <div className="bg-warning/10 border border-warning/20 rounded-md p-3 flex gap-2">
              <Info className="w-3.5 h-3.5 text-warning shrink-0 mt-0.5" />
              <p className="text-[11px] text-warning leading-relaxed">
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
