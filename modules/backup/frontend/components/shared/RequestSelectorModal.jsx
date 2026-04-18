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
      description="Choose Request groups and direct-request bucket."
      icon={<Inbox className="h-5 w-5" />}
      iconClassName="bg-surface-2 text-text-secondary"
      onClose={closeRequestSelectorModal}
      maxWidthClass="max-w-[960px]"
      footer={
        <>
          <button onClick={() => loadRequestPreview(draftSelectedGroupIds)} disabled={loadingRequestPreview}
            className="flex items-center gap-2 rounded-md border border-[rgb(var(--border-strong))] px-4 py-2 text-caption font-emphasis text-text-secondary transition-colors hover:bg-surface-2 disabled:opacity-50">
            {loadingRequestPreview ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Refresh Source
          </button>
          <button onClick={closeRequestSelectorModal} className="rounded-md border border-[rgb(var(--border-strong))] px-4 py-2 text-caption font-emphasis text-text-secondary transition-colors hover:bg-surface-2">Cancel</button>
          <button onClick={applyRequestSelectorModal} disabled={!requestPreview}
            className="rounded-md bg-brand px-4 py-2 text-caption font-strong text-white transition-colors hover:bg-brand-hover disabled:opacity-50">Apply Selection</button>
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
          <div ref={requestPreviewListRef} className="border border-[rgb(var(--border-line))] rounded-md overflow-hidden">
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <table className="w-full text-caption">
                <thead className="bg-surface-2 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left text-tiny font-emphasis text-text-tertiary uppercase w-8">
                      <input type="checkbox"
                        checked={draftSelectedGroupIds.length === rows.length && rows.length > 0}
                        onChange={e => setDraftSelectedGroupIds(e.target.checked ? rows.map(row => row.group_id) : [])}
                        className="rounded" />
                    </th>
                    <th className="px-3 py-2 text-left text-tiny font-emphasis text-text-tertiary uppercase">Group</th>
                    <th className="px-3 py-2 text-left text-tiny font-emphasis text-text-tertiary uppercase w-24">Requests</th>
                    <th className="px-3 py-2 text-left text-tiny font-emphasis text-text-tertiary uppercase">Sample Requests</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[rgb(var(--border-line))]">
                  {rows.map(record => (
                    <tr key={record.group_id} className={`hover:bg-surface-2 ${draftSelectedGroupIds.includes(record.group_id) ? 'bg-brand/5' : ''}`}>
                      <td className="px-3 py-2.5">
                        <input type="checkbox" checked={draftSelectedGroupIds.includes(record.group_id)}
                          onChange={e => setDraftSelectedGroupIds(prev => e.target.checked ? [...prev, record.group_id] : prev.filter(id => id !== record.group_id))}
                          className="rounded" />
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className="font-strong">{record.group_name}</div>
                          {record.is_direct && <Tag color="gold">Direct</Tag>}
                        </div>
                        <div className="text-tiny text-text-quaternary">ID: {record.group_id}</div>
                        {record.preview_error && <div className="text-tiny text-warning mt-0.5">{record.preview_error}</div>}
                      </td>
                      <td className="px-3 py-2.5 text-text-secondary">{record.request_count ?? '—'}</td>
                      <td className="px-3 py-2.5">
                        {record.detail_loaded
                          ? (record.sample_requests || []).length > 0
                            ? (record.sample_requests || []).map(request => <div key={request.request_id || request.request_code} className="text-tiny text-text-secondary">{request.request_code} - {request.request_name}</div>)
                            : <span className="text-tiny text-text-quaternary">No sample requests</span>
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

export default RequestSelectorModal