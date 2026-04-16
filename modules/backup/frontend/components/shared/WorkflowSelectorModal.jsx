import React from 'react'
import { RefreshCw, Loader2 } from 'lucide-react'
import { Modal, SpinCenter, Empty, Alert, Tag } from '@packages/ui/src/components/common/ui'

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
    <Modal
      title="Select Workflows for This Flow"
      open={workflowSelectorModalOpen}
      onCancel={closeWorkflowSelectorModal}
      width={960}
      footer={
        <>
          <button onClick={() => loadWorkflowPreview(draftSelectedWorkflowIds)} disabled={loadingWorkflowPreview}
            className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 flex items-center gap-2">
            {loadingWorkflowPreview ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Refresh Source
          </button>
          <button onClick={closeWorkflowSelectorModal} className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50">Cancel</button>
          <button onClick={applyWorkflowSelectorModal} disabled={!workflowPreview}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50">Apply Selection</button>
        </>
      }
    >
      <p className="text-sm text-gray-500 mb-4">Select workflows to include in this backup flow.</p>
      {loadingWorkflowPreview ? <SpinCenter /> : !workflowPreview ? <Empty description="Load Workflow source preview first to choose workflows" /> : (
        <div className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            <Tag color="blue">{rows.length} workflows loaded</Tag>
            <Tag color={draftSelectedWorkflowIds.length ? 'green' : 'default'}>{draftSelectedWorkflowIds.length} selected</Tag>
          </div>
          {!workflowPreview.job_count_complete && <Alert type="warning" message={`Detailed preview loaded for ${workflowPreview.detail_loaded_count || 0} workflows only`} description="Click Refresh Source to reload with your current selection." />}
          {workflowPreview.partial_error_count > 0 && <Alert type="warning" message={`Some workflows could not be previewed completely (${workflowPreview.partial_error_count})`} />}
          <div ref={workflowPreviewListRef} className="border border-gray-200 rounded-lg overflow-hidden">
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase w-8">
                      <input type="checkbox"
                        checked={draftSelectedWorkflowIds.length === rows.length && rows.length > 0}
                        onChange={e => setDraftSelectedWorkflowIds(e.target.checked ? rows.map(r => r.workflow_id) : [])}
                        className="rounded" />
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Workflow</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase w-20">Stages</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase w-20">Jobs</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Sample Jobs</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map(record => (
                    <tr key={record.workflow_id} className={`hover:bg-gray-50 ${draftSelectedWorkflowIds.includes(record.workflow_id) ? 'bg-blue-50/50' : ''}`}>
                      <td className="px-3 py-2.5">
                        <input type="checkbox" checked={draftSelectedWorkflowIds.includes(record.workflow_id)}
                          onChange={e => setDraftSelectedWorkflowIds(prev => e.target.checked ? [...prev, record.workflow_id] : prev.filter(id => id !== record.workflow_id))}
                          className="rounded" />
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="font-semibold">{record.workflow_name}</div>
                        <div className="text-xs text-gray-400">ID: {record.workflow_id}</div>
                        {record.preview_error && <div className="text-xs text-yellow-600 mt-0.5">{record.preview_error}</div>}
                      </td>
                      <td className="px-3 py-2.5 text-gray-600">{record.stage_count ?? '—'}</td>
                      <td className="px-3 py-2.5 text-gray-600">{record.job_count ?? '—'}</td>
                      <td className="px-3 py-2.5">
                        {record.detail_loaded
                          ? (record.sample_jobs || []).length > 0
                            ? (record.sample_jobs || []).map(job => <div key={job.job_id || job.job_code} className="text-xs text-gray-600">{job.job_code} - {job.job_name}</div>)
                            : <span className="text-xs text-gray-400">No sample jobs</span>
                          : <span className="text-xs text-gray-400">Refresh after selecting</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}

export default WorkflowSelectorModal