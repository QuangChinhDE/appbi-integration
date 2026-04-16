import React from 'react'
import { RefreshCw, Loader2 } from 'lucide-react'
import { Modal, SpinCenter, Empty, Alert, Tag } from '@packages/ui/src/components/common/ui'

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
    <Modal
      title="Select Projects for This Flow"
      open={weworkSelectorModalOpen}
      onCancel={closeWeworkSelectorModal}
      width={980}
      footer={
        <>
          <button onClick={() => loadWeworkPreview(draftSelectedProjectIds)} disabled={loadingWeworkPreview}
            className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 flex items-center gap-2">
            {loadingWeworkPreview ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Refresh Source
          </button>
          <button onClick={closeWeworkSelectorModal} className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50">Cancel</button>
          <button onClick={applyWeworkSelectorModal} disabled={!weworkPreview}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50">Apply Selection</button>
        </>
      }
    >
      <p className="text-sm text-gray-500 mb-4">Select the WeWork projects to include in this backup flow.</p>
      {loadingWeworkPreview ? <SpinCenter /> : !weworkPreview ? <Empty description="Load WeWork source preview first to choose projects" /> : (
        <div className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            <Tag color="blue">{rows.length} projects loaded</Tag>
            <Tag color={draftSelectedProjectIds.length ? 'green' : 'default'}>{draftSelectedProjectIds.length} selected</Tag>
          </div>
          {!weworkPreview.task_count_complete && <Alert type="warning" message={`Detailed preview loaded for ${weworkPreview.detail_loaded_count || 0} projects only`} description="Click Refresh Source to reload with your current selection." />}
          {weworkPreview.catalog_warning && <Alert type="warning" message="Department catalog loaded partially" description={weworkPreview.catalog_warning} />}
          {weworkPreview.partial_error_count > 0 && <Alert type="warning" message={`Some projects could not be previewed completely (${weworkPreview.partial_error_count})`} />}
          <div ref={weworkPreviewListRef} className="border border-gray-200 rounded-lg overflow-hidden">
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase w-8">
                      <input type="checkbox"
                        checked={draftSelectedProjectIds.length === rows.length && rows.length > 0}
                        onChange={e => setDraftSelectedProjectIds(e.target.checked ? rows.map(r => r.project_id) : [])}
                        className="rounded" />
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Project</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Department</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase w-20">Tasks</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase w-24">Subtasks</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Sample Tasks</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map(record => (
                    <tr key={record.project_id} className={`hover:bg-gray-50 ${draftSelectedProjectIds.includes(record.project_id) ? 'bg-blue-50/50' : ''}`}>
                      <td className="px-3 py-2.5">
                        <input type="checkbox" checked={draftSelectedProjectIds.includes(record.project_id)}
                          onChange={e => setDraftSelectedProjectIds(prev => e.target.checked ? [...prev, record.project_id] : prev.filter(id => id !== record.project_id))}
                          className="rounded" />
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="font-semibold">{record.project_name}</div>
                        <div className="text-xs text-gray-400">ID: {record.project_id}</div>
                        {record.preview_error && <div className="text-xs text-yellow-600 mt-0.5">{record.preview_error}</div>}
                      </td>
                      <td className="px-3 py-2.5 text-gray-600">{record.department_name || <span className="text-gray-400">Unassigned</span>}</td>
                      <td className="px-3 py-2.5 text-gray-600">{record.top_level_task_count ?? record.task_count ?? '—'}</td>
                      <td className="px-3 py-2.5 text-gray-600">{record.subtask_count ?? '—'}</td>
                      <td className="px-3 py-2.5">
                        {record.detail_loaded
                          ? (record.sample_tasks || []).length > 0
                            ? (record.sample_tasks || []).map(task => (
                              <div key={task.task_id || task.task_name} className="text-xs text-gray-600">
                                {task.parent_id && task.parent_id !== '0' ? '↳ ' : ''}{task.task_name}
                              </div>
                            ))
                            : <span className="text-xs text-gray-400">No sample tasks</span>
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

export default WeworkSelectorModal