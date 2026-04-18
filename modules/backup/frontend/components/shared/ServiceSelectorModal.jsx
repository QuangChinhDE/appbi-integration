import React from 'react'
import { Headphones, RefreshCw, Loader2 } from 'lucide-react'
import AppModalShell from '@packages/ui/src/components/common/AppModalShell'
import { SpinCenter, Empty, Alert, Tag } from '@packages/ui/src/components/common/ui'

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
    serviceSelectorModalOpen ? (
    <AppModalShell
      title="Select services"
      description="Choose Service workspaces to include."
      icon={<Headphones className="h-5 w-5" />}
      iconClassName="bg-success/10 text-success"
      onClose={closeServiceSelectorModal}
      maxWidthClass="max-w-[960px]"
      footer={
        <>
          <button onClick={() => loadServicePreview(draftSelectedServiceIds)} disabled={loadingServicePreview}
            className="flex items-center gap-2 rounded-md border border-[rgb(var(--border-strong))] px-4 py-2 text-caption font-emphasis text-text-secondary transition-colors hover:bg-surface-2 disabled:opacity-50">
            {loadingServicePreview ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Refresh Source
          </button>
          <button onClick={closeServiceSelectorModal} className="rounded-md border border-[rgb(var(--border-strong))] px-4 py-2 text-caption font-emphasis text-text-secondary transition-colors hover:bg-surface-2">Cancel</button>
          <button onClick={applyServiceSelectorModal} disabled={!servicePreview}
            className="rounded-md bg-brand px-4 py-2 text-caption font-strong text-white transition-colors hover:bg-brand-hover disabled:opacity-50">Apply Selection</button>
        </>
      }
    >
      {loadingServicePreview ? <SpinCenter /> : !servicePreview ? <Empty description="Load Service source preview first to choose services" /> : (
        <div className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            <Tag color="blue">{rows.length} services loaded</Tag>
            <Tag color={draftSelectedServiceIds.length ? 'green' : 'default'}>{draftSelectedServiceIds.length} selected</Tag>
          </div>
          {!servicePreview.ticket_count_complete && <Alert type="warning" message={`Detailed preview loaded for ${servicePreview.detail_loaded_count || 0} services only`} description="Click Refresh Source to reload with your current selection." />}
          {servicePreview.partial_error_count > 0 && <Alert type="warning" message={`Some services could not be previewed completely (${servicePreview.partial_error_count})`} />}
          <div ref={servicePreviewListRef} className="border border-[rgb(var(--border-line))] rounded-md overflow-hidden">
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <table className="w-full text-caption">
                <thead className="bg-surface-2 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left text-tiny font-emphasis text-text-tertiary uppercase w-8">
                      <input type="checkbox"
                        checked={draftSelectedServiceIds.length === rows.length && rows.length > 0}
                        onChange={e => setDraftSelectedServiceIds(e.target.checked ? rows.map(r => r.service_id) : [])}
                        className="rounded" />
                    </th>
                    <th className="px-3 py-2 text-left text-tiny font-emphasis text-text-tertiary uppercase">Service</th>
                    <th className="px-3 py-2 text-left text-tiny font-emphasis text-text-tertiary uppercase w-20">Stages</th>
                    <th className="px-3 py-2 text-left text-tiny font-emphasis text-text-tertiary uppercase w-20">Tickets</th>
                    <th className="px-3 py-2 text-left text-tiny font-emphasis text-text-tertiary uppercase">Sample Tickets</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[rgb(var(--border-line))]">
                  {rows.map(record => (
                    <tr key={record.service_id} className={`hover:bg-surface-2 ${draftSelectedServiceIds.includes(record.service_id) ? 'bg-brand/10' : ''}`}>
                      <td className="px-3 py-2.5">
                        <input type="checkbox" checked={draftSelectedServiceIds.includes(record.service_id)}
                          onChange={e => setDraftSelectedServiceIds(prev => e.target.checked ? [...prev, record.service_id] : prev.filter(id => id !== record.service_id))}
                          className="rounded" />
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="font-strong">{record.service_name}</div>
                        <div className="text-tiny text-text-quaternary">ID: {record.service_id}</div>
                        {record.preview_error && <div className="text-tiny text-warning mt-0.5">{record.preview_error}</div>}
                      </td>
                      <td className="px-3 py-2.5 text-text-secondary">{record.stage_count ?? '—'}</td>
                      <td className="px-3 py-2.5 text-text-secondary">{record.ticket_count ?? '—'}</td>
                      <td className="px-3 py-2.5">
                        {record.detail_loaded
                          ? (record.sample_tickets || []).length > 0
                            ? (record.sample_tickets || []).map(t => <div key={t.ticket_id} className="text-tiny text-text-secondary">{t.ticket_code} - {t.ticket_name}</div>)
                            : <span className="text-tiny text-text-quaternary">No sample tickets</span>
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

export default ServiceSelectorModal
