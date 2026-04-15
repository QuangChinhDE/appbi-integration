import React from 'react'
import { RefreshCw, Loader2 } from 'lucide-react'
import { Modal, SpinCenter, Empty, Alert, Tag } from '@packages/ui/src/components/common/ui'

const ServiceSelectorModal = ({ wizard }) => {
  const {
    serviceSelectorModalOpen,
    closeServiceSelectorModal,
    applyServiceSelectorModal,
    loadServicePreview,
    loadingServicePreview,
    servicePreview,
    draftSelectedServiceIds, setDraftSelectedServiceIds,
    servicePreviewListRef,
  } = wizard

  const rows = Array.isArray(servicePreview?.services) ? servicePreview.services : []

  return (
    <Modal
      title="Select Services for This Flow"
      open={serviceSelectorModalOpen}
      onCancel={closeServiceSelectorModal}
      width={960}
      footer={
        <>
          <button onClick={() => loadServicePreview(draftSelectedServiceIds)} disabled={loadingServicePreview}
            className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 flex items-center gap-2">
            {loadingServicePreview ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Refresh Source
          </button>
          <button onClick={closeServiceSelectorModal} className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50">Cancel</button>
          <button onClick={applyServiceSelectorModal} disabled={!servicePreview}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50">Apply Selection</button>
        </>
      }
    >
      <p className="text-sm text-gray-500 mb-4">Select services to include in this backup flow.</p>
      {loadingServicePreview ? <SpinCenter /> : !servicePreview ? <Empty description="Load Service source preview first to choose services" /> : (
        <div className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            <Tag color="blue">{rows.length} services loaded</Tag>
            <Tag color={draftSelectedServiceIds.length ? 'green' : 'default'}>{draftSelectedServiceIds.length} selected</Tag>
          </div>
          {!servicePreview.ticket_count_complete && <Alert type="warning" message={`Detailed preview loaded for ${servicePreview.detail_loaded_count || 0} services only`} description="Click Refresh Source to reload with your current selection." />}
          {servicePreview.partial_error_count > 0 && <Alert type="warning" message={`Some services could not be previewed completely (${servicePreview.partial_error_count})`} />}
          <div ref={servicePreviewListRef} className="border border-gray-200 rounded-lg overflow-hidden">
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase w-8">
                      <input type="checkbox"
                        checked={draftSelectedServiceIds.length === rows.length && rows.length > 0}
                        onChange={e => setDraftSelectedServiceIds(e.target.checked ? rows.map(r => r.service_id) : [])}
                        className="rounded" />
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Service</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase w-20">Stages</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase w-20">Tickets</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Sample Tickets</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map(record => (
                    <tr key={record.service_id} className={`hover:bg-gray-50 ${draftSelectedServiceIds.includes(record.service_id) ? 'bg-blue-50/50' : ''}`}>
                      <td className="px-3 py-2.5">
                        <input type="checkbox" checked={draftSelectedServiceIds.includes(record.service_id)}
                          onChange={e => setDraftSelectedServiceIds(prev => e.target.checked ? [...prev, record.service_id] : prev.filter(id => id !== record.service_id))}
                          className="rounded" />
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="font-semibold">{record.service_name}</div>
                        <div className="text-xs text-gray-400">ID: {record.service_id}</div>
                        {record.preview_error && <div className="text-xs text-yellow-600 mt-0.5">{record.preview_error}</div>}
                      </td>
                      <td className="px-3 py-2.5 text-gray-600">{record.stage_count ?? '—'}</td>
                      <td className="px-3 py-2.5 text-gray-600">{record.ticket_count ?? '—'}</td>
                      <td className="px-3 py-2.5">
                        {record.detail_loaded
                          ? (record.sample_tickets || []).length > 0
                            ? (record.sample_tickets || []).map(t => <div key={t.ticket_id} className="text-xs text-gray-600">{t.ticket_code} - {t.ticket_name}</div>)
                            : <span className="text-xs text-gray-400">No sample tickets</span>
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

export default ServiceSelectorModal
