import React from 'react'
import { Building2, RefreshCw, Loader2 } from 'lucide-react'
import AppModalShell from '@packages/ui/src/components/common/AppModalShell'
import { SpinCenter, Empty, Alert, Tag } from '@packages/ui/src/components/common/ui'

const WeworkSelectorModal = ({ wizard }) => {
  const {
    weworkSelectorModalOpen,
    closeWeworkSelectorModal,
    applyWeworkSelectorModal,
    loadWeworkPreview,
    loadingWeworkPreview,
    weworkPreview,
    draftSelectedProjectIds, setDraftSelectedProjectIds,
    weworkPreviewListRef,
  } = wizard

  const rows = Array.isArray(weworkPreview?.projects) ? weworkPreview.projects : []

  return (
    weworkSelectorModalOpen ? (
    <AppModalShell
      title="Select WeWork projects"
      description="Choose WeWork projects to include."
      icon={<Building2 className="h-5 w-5" />}
      iconClassName="bg-surface-2 text-text-secondary"
      onClose={closeWeworkSelectorModal}
      maxWidthClass="max-w-[980px]"
      footer={
        <>
          <button onClick={() => loadWeworkPreview(draftSelectedProjectIds)} disabled={loadingWeworkPreview}
            className="flex items-center gap-2 rounded-md border border-[rgb(var(--border-strong))] px-4 py-2 text-label font-emphasis text-text-secondary transition-colors hover:bg-surface-2 disabled:opacity-50">
            {loadingWeworkPreview ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Refresh Source
          </button>
          <button onClick={closeWeworkSelectorModal} className="rounded-md border border-[rgb(var(--border-strong))] px-4 py-2 text-label font-emphasis text-text-secondary transition-colors hover:bg-surface-2">Cancel</button>
          <button onClick={applyWeworkSelectorModal} disabled={!weworkPreview}
            className="rounded-md bg-brand px-4 py-2 text-label font-emphasis text-white transition-colors hover:bg-brand-hover disabled:opacity-50">Apply Selection</button>
        </>
      }
    >
      {loadingWeworkPreview ? <SpinCenter /> : !weworkPreview ? <Empty description="Load WeWork source preview first to choose projects" /> : (
        <div className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            <Tag color="blue">{rows.length} projects loaded</Tag>
            <Tag color={draftSelectedProjectIds.length ? 'green' : 'default'}>{draftSelectedProjectIds.length} selected</Tag>
          </div>
          {!weworkPreview.task_count_complete && <Alert type="warning" message={`Detailed preview loaded for ${weworkPreview.detail_loaded_count || 0} projects only`} description="Click Refresh Source to reload with your current selection." />}
          {weworkPreview.catalog_warning && <Alert type="warning" message="Department catalog loaded partially" description={weworkPreview.catalog_warning} />}
          {weworkPreview.partial_error_count > 0 && <Alert type="warning" message={`Some projects could not be previewed completely (${weworkPreview.partial_error_count})`} />}
          <div ref={weworkPreviewListRef} className="border border-[rgb(var(--border-line))] rounded-md overflow-hidden">
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <table className="w-full text-caption">
                <thead className="bg-surface-2 sticky top-0">
                  <tr>
                    <th className="w-8 px-3 py-2 text-left text-label font-emphasis uppercase tracking-[0.14em] text-text-tertiary">
                      <input type="checkbox"
                        checked={draftSelectedProjectIds.length === rows.length && rows.length > 0}
                        onChange={e => setDraftSelectedProjectIds(e.target.checked ? rows.map(r => r.project_id) : [])}
                        className="rounded" />
                    </th>
                    <th className="px-3 py-2 text-left text-label font-emphasis uppercase tracking-[0.14em] text-text-tertiary">Project</th>
                    <th className="px-3 py-2 text-left text-label font-emphasis uppercase tracking-[0.14em] text-text-tertiary">Department</th>
                    <th className="w-20 px-3 py-2 text-left text-label font-emphasis uppercase tracking-[0.14em] text-text-tertiary">Tasks</th>
                    <th className="w-24 px-3 py-2 text-left text-label font-emphasis uppercase tracking-[0.14em] text-text-tertiary">Subtasks</th>
                    <th className="px-3 py-2 text-left text-label font-emphasis uppercase tracking-[0.14em] text-text-tertiary">Sample Tasks</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[rgb(var(--border-line))]">
                  {rows.map(record => (
                    <tr key={record.project_id} className={`hover:bg-surface-2 ${draftSelectedProjectIds.includes(record.project_id) ? 'bg-brand/10' : ''}`}>
                      <td className="px-3 py-2.5">
                        <input type="checkbox" checked={draftSelectedProjectIds.includes(record.project_id)}
                          onChange={e => setDraftSelectedProjectIds(prev => e.target.checked ? [...prev, record.project_id] : prev.filter(id => id !== record.project_id))}
                          className="rounded" />
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="font-strong">{record.project_name}</div>
                        <div className="text-caption text-text-quaternary">ID: {record.project_id}</div>
                        {record.preview_error && <div className="mt-0.5 text-caption text-warning">{record.preview_error}</div>}
                      </td>
                      <td className="px-3 py-2.5 text-text-secondary">{record.department_name || <span className="text-text-quaternary">Unassigned</span>}</td>
                      <td className="px-3 py-2.5 text-text-secondary">{record.top_level_task_count ?? record.task_count ?? '—'}</td>
                      <td className="px-3 py-2.5 text-text-secondary">{record.subtask_count ?? '—'}</td>
                      <td className="px-3 py-2.5">
                        {record.detail_loaded
                          ? (record.sample_tasks || []).length > 0
                            ? (record.sample_tasks || []).map(task => (
                              <div key={task.task_id || task.task_name} className="text-caption text-text-secondary">
                                {task.parent_id && task.parent_id !== '0' ? '↳ ' : ''}{task.task_name}
                              </div>
                            ))
                            : <span className="text-caption text-text-quaternary">No sample tasks</span>
                          : <span className="text-caption text-text-quaternary">Refresh after selecting</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </AppModalShell>
    ) : null
  )
}

export default WeworkSelectorModal