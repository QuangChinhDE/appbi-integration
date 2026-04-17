import React from 'react'
import { Inbox, RefreshCw, Loader2 } from 'lucide-react'
import AppModalShell from '@packages/ui/src/components/common/AppModalShell'
import { SpinCenter, Empty, Alert, Tag } from '@packages/ui/src/components/common/ui'

const RequestSelectorModal = ({ wizard }) => {
  const {
    requestSelectorModalOpen,
    closeRequestSelectorModal,
    applyRequestSelectorModal,
    loadRequestPreview,
    loadingRequestPreview,
    requestPreview,
    draftSelectedGroupIds, setDraftSelectedGroupIds,
    requestPreviewListRef,
  } = wizard

  const rows = Array.isArray(requestPreview?.groups) ? requestPreview.groups : []

  return (
    requestSelectorModalOpen ? (
    <AppModalShell
      title="Select Request groups"
      description="Choose the Request groups and direct-request bucket included in this flow. Refresh the preview any time you need to reload counts or samples."
      icon={<Inbox className="h-5 w-5" />}
      iconClassName="bg-orange-50 text-orange-600"
      onClose={closeRequestSelectorModal}
      maxWidthClass="max-w-[960px]"
      footer={
        <>
          <button onClick={() => loadRequestPreview(draftSelectedGroupIds)} disabled={loadingRequestPreview}
            className="flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50">
            {loadingRequestPreview ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Refresh Source
          </button>
          <button onClick={closeRequestSelectorModal} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50">Cancel</button>
          <button onClick={applyRequestSelectorModal} disabled={!requestPreview}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50">Apply Selection</button>
        </>
      }
    >
      {loadingRequestPreview ? <SpinCenter /> : !requestPreview ? <Empty description="Load Request source preview first to choose groups" /> : (
        <div className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            <Tag color="blue">{rows.length} sources loaded</Tag>
            <Tag color={draftSelectedGroupIds.length ? 'green' : 'default'}>{draftSelectedGroupIds.length} selected</Tag>
          </div>
          {!requestPreview.request_count_complete && <Alert type="warning" message={`Detailed preview loaded for ${requestPreview.detail_loaded_count || 0} sources only`} description="Click Refresh Source to reload with your current selection." />}
          {requestPreview.partial_error_count > 0 && <Alert type="warning" message={`Some Request groups could not be previewed completely (${requestPreview.partial_error_count})`} />}
          <div ref={requestPreviewListRef} className="border border-gray-200 rounded-lg overflow-hidden">
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase w-8">
                      <input type="checkbox"
                        checked={draftSelectedGroupIds.length === rows.length && rows.length > 0}
                        onChange={e => setDraftSelectedGroupIds(e.target.checked ? rows.map(row => row.group_id) : [])}
                        className="rounded" />
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Group</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase w-24">Requests</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Sample Requests</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map(record => (
                    <tr key={record.group_id} className={`hover:bg-gray-50 ${draftSelectedGroupIds.includes(record.group_id) ? 'bg-blue-50/50' : ''}`}>
                      <td className="px-3 py-2.5">
                        <input type="checkbox" checked={draftSelectedGroupIds.includes(record.group_id)}
                          onChange={e => setDraftSelectedGroupIds(prev => e.target.checked ? [...prev, record.group_id] : prev.filter(id => id !== record.group_id))}
                          className="rounded" />
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className="font-semibold">{record.group_name}</div>
                          {record.is_direct && <Tag color="gold">Direct</Tag>}
                        </div>
                        <div className="text-xs text-gray-400">ID: {record.group_id}</div>
                        {record.preview_error && <div className="text-xs text-yellow-600 mt-0.5">{record.preview_error}</div>}
                      </td>
                      <td className="px-3 py-2.5 text-gray-600">{record.request_count ?? '—'}</td>
                      <td className="px-3 py-2.5">
                        {record.detail_loaded
                          ? (record.sample_requests || []).length > 0
                            ? (record.sample_requests || []).map(request => <div key={request.request_id || request.request_code} className="text-xs text-gray-600">{request.request_code} - {request.request_name}</div>)
                            : <span className="text-xs text-gray-400">No sample requests</span>
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
    </AppModalShell>
    ) : null
  )
}

export default RequestSelectorModal