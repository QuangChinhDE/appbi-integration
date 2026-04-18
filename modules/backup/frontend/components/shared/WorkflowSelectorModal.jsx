import React from 'react'
import { FolderKanban, RefreshCw, Loader2 } from 'lucide-react'
import AppModalShell from '@packages/ui/src/components/common/AppModalShell'
import { SpinCenter, Empty, Alert, Tag } from '@packages/ui/src/components/common/ui'

const WorkflowSelectorModal = ({ wizard }) => {
  const {
    workflowSelectorModalOpen,
    closeWorkflowSelectorModal,
    applyWorkflowSelectorModal,
    loadWorkflowPreview,
    loadingWorkflowPreview,
    workflowPreview,
    draftSelectedWorkflowIds, setDraftSelectedWorkflowIds,
    workflowPreviewListRef,
  } = wizard

  const rows = Array.isArray(workflowPreview?.workflows) ? workflowPreview.workflows : []

  return (
    workflowSelectorModalOpen ? (
    <AppModalShell
      title="Select workflows"
      description="Choose workflow spaces to include."
      icon={<FolderKanban className="h-5 w-5" />}
      iconClassName="bg-surface-2 text-text-secondary"
      onClose={closeWorkflowSelectorModal}
      maxWidthClass="max-w-[960px]"
      footer={
        <>
          <button onClick={() => loadWorkflowPreview(draftSelectedWorkflowIds)} disabled={loadingWorkflowPreview}
            className="flex items-center gap-2 rounded-md border border-[rgb(var(--border-strong))] px-4 py-2 text-caption font-emphasis text-text-secondary transition-colors hover:bg-surface-2 disabled:opacity-50">
            {loadingWorkflowPreview ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Refresh Source
          </button>
          <button onClick={closeWorkflowSelectorModal} className="rounded-md border border-[rgb(var(--border-strong))] px-4 py-2 text-caption font-emphasis text-text-secondary transition-colors hover:bg-surface-2">Cancel</button>
          <button onClick={applyWorkflowSelectorModal} disabled={!workflowPreview}
            className="rounded-md bg-brand px-4 py-2 text-caption font-strong text-white transition-colors hover:bg-brand-hover disabled:opacity-50">Apply Selection</button>
        </>
      }
    >
      {loadingWorkflowPreview ? <SpinCenter /> : !workflowPreview ? <Empty description="Load Workflow source preview first to choose workflows" /> : (
        <div className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            <Tag color="blue">{rows.length} workflows loaded</Tag>
            <Tag color={draftSelectedWorkflowIds.length ? 'green' : 'default'}>{draftSelectedWorkflowIds.length} selected</Tag>
          </div>
          {!workflowPreview.job_count_complete && <Alert type="warning" message={`Detailed preview loaded for ${workflowPreview.detail_loaded_count || 0} workflows only`} description="Click Refresh Source to reload with your current selection." />}
          {workflowPreview.partial_error_count > 0 && <Alert type="warning" message={`Some workflows could not be previewed completely (${workflowPreview.partial_error_count})`} />}
          <div ref={workflowPreviewListRef} className="border border-[rgb(var(--border-line))] rounded-md overflow-hidden">
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <table className="w-full text-caption">
                <thead className="bg-surface-2 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left text-tiny font-emphasis text-text-tertiary uppercase w-8">
                      <input type="checkbox"
                        checked={draftSelectedWorkflowIds.length === rows.length && rows.length > 0}
                        onChange={e => setDraftSelectedWorkflowIds(e.target.checked ? rows.map(r => r.workflow_id) : [])}
                        className="rounded" />
                    </th>
                    <th className="px-3 py-2 text-left text-tiny font-emphasis text-text-tertiary uppercase">Workflow</th>
                    <th className="px-3 py-2 text-left text-tiny font-emphasis text-text-tertiary uppercase w-20">Stages</th>
                    <th className="px-3 py-2 text-left text-tiny font-emphasis text-text-tertiary uppercase w-20">Jobs</th>
                    <th className="px-3 py-2 text-left text-tiny font-emphasis text-text-tertiary uppercase">Sample Jobs</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[rgb(var(--border-line))]">
                  {rows.map(record => (
                    <tr key={record.workflow_id} className={`hover:bg-surface-2 ${draftSelectedWorkflowIds.includes(record.workflow_id) ? 'bg-brand/10' : ''}`}>
                      <td className="px-3 py-2.5">
                        <input type="checkbox" checked={draftSelectedWorkflowIds.includes(record.workflow_id)}
                          onChange={e => setDraftSelectedWorkflowIds(prev => e.target.checked ? [...prev, record.workflow_id] : prev.filter(id => id !== record.workflow_id))}
                          className="rounded" />
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="font-strong">{record.workflow_name}</div>
                        <div className="text-tiny text-text-quaternary">ID: {record.workflow_id}</div>
                        {record.preview_error && <div className="text-tiny text-warning mt-0.5">{record.preview_error}</div>}
                      </td>
                      <td className="px-3 py-2.5 text-text-secondary">{record.stage_count ?? '—'}</td>
                      <td className="px-3 py-2.5 text-text-secondary">{record.job_count ?? '—'}</td>
                      <td className="px-3 py-2.5">
                        {record.detail_loaded
                          ? (record.sample_jobs || []).length > 0
                            ? (record.sample_jobs || []).map(job => <div key={job.job_id || job.job_code} className="text-tiny text-text-secondary">{job.job_code} - {job.job_name}</div>)
                            : <span className="text-tiny text-text-quaternary">No sample jobs</span>
                          : <span className="text-tiny text-text-quaternary">Refresh after selecting</span>}
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

export default WorkflowSelectorModal