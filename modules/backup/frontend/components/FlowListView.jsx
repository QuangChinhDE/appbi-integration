import React from 'react'
import {
  Plus, Eye, Pencil, Play, Rocket, Square, Trash2, Cloud, Search,
  Inbox, FolderKanban, Building2, Headphones, FileSpreadsheet, Globe,
} from 'lucide-react'
import { Tag } from '@packages/ui/src/components/common/ui'
import { APP_META, BACKUP_TYPE_TAG } from '../constants'

const FlowListView = ({
  flows,
  filterText,
  viewMode,
  canEdit,
  onCreateDraft,
  onOpenDetails,
  onPublish,
  onEdit,
  onRun,
  onStop,
  onDelete,
  stoppingFlowId,
}) => {
  const appIcons = {
    request:  <Inbox className="w-4 h-4" />,
    workflow: <FolderKanban className="w-4 h-4" />,
    wework:   <Building2 className="w-4 h-4" />,
    service:  <Headphones className="w-4 h-4" />,
  }
  const normalizedFilter = filterText.trim().toLowerCase()
  const filteredFlows = flows.filter((record) => {
    if (!normalizedFilter) return true
    return [
      record.name,
      record.app,
      record.app_name,
      record.destination_name,
      record.destination_type,
      record.last_run_status,
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(normalizedFilter))
  })

  if (flows.length === 0) {
    return (
      <div className="rounded-xl border-2 border-dashed border-gray-200 bg-white px-6 py-14 text-center shadow-sm">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
          <Cloud className="h-6 w-6" />
        </div>
        <h3 className="mt-4 text-lg font-semibold text-gray-900">No backup flows yet</h3>
        <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-gray-500">
          {canEdit
            ? 'Create your first draft flow, connect a source and a destination, then publish it when the configuration is ready.'
            : 'No backup flows are available for this workspace yet.'}
        </p>
        {canEdit && (
          <button
            onClick={onCreateDraft}
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" /> New Backup Flow
          </button>
        )}
      </div>
    )
  }

  if (filteredFlows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 bg-white px-6 py-12 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-400">
          <Search className="h-5 w-5" />
        </div>
        <h3 className="mt-4 text-base font-semibold text-gray-900">No flows match your search</h3>
        <p className="mt-2 text-sm text-gray-500">
          No results for <span className="font-medium text-gray-700">"{filterText}"</span>. Try another keyword or open a flow from a different app.
        </p>
      </div>
    )
  }

  if (viewMode === 'grid') {
    return (
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {filteredFlows.map((record) => {
          const meta = APP_META[record.app] || { color: '#64748b' }
          const icon = appIcons[record.app] || <Cloud className="w-4 h-4" />
          const bt = BACKUP_TYPE_TAG[record.backup_type]
          const supportsRun = ['request', 'service', 'workflow', 'wework'].includes(record.app)
          const hasActiveRun = ['pending', 'running'].includes(record.last_run_status)
          const isStopping = stoppingFlowId === record.id

          return (
            <div key={record.id} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:border-blue-300 hover:shadow-md">
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-start gap-3">
                  <div
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
                    style={{ backgroundColor: `${meta.color}18`, color: meta.color }}
                  >
                    {icon}
                  </div>
                  <div className="min-w-0">
                    <div className="text-base font-semibold text-gray-900">{record.name || 'Untitled draft'}</div>
                    <div className="mt-1 text-sm text-gray-500">{record.app_name || record.app || 'Unknown app'}</div>
                  </div>
                </div>

                {canEdit && (
                  <button
                    onClick={() => onDelete(record)}
                    className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {record.is_draft === 1 ? <Tag color="gold">Draft</Tag> : <Tag color="cyan">Ready</Tag>}
                {record.is_published === 1 ? <Tag color="green">Published</Tag> : <Tag color="default">Unpublished</Tag>}
                {bt && <Tag color={bt.color}>{bt.label}</Tag>}
              </div>

              <div className="mt-4 space-y-2 text-sm text-gray-500">
                <div>Destination: <span className="text-gray-700">{record.destination_name || 'Not set'}</span></div>
                <div>Last run: <span className="text-gray-700">{record.last_run_at || 'Never run'}</span></div>
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-4">
                <button
                  onClick={() => onOpenDetails(record)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50"
                >
                  <Eye className="h-3.5 w-3.5" /> Details
                </button>
                {canEdit && record.is_published === 0 && (
                  <button
                    onClick={() => onPublish(record)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 px-3 py-2 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-50"
                  >
                    <Rocket className="h-3.5 w-3.5" /> Publish
                  </button>
                )}
                {canEdit && (
                  <button
                    onClick={() => onEdit(record)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50"
                  >
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </button>
                )}
                {canEdit && record.is_published === 1 && supportsRun && hasActiveRun ? (
                  <button
                    onClick={() => onStop(record)}
                    disabled={isStopping}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Square className="h-3.5 w-3.5" /> {isStopping ? 'Stopping…' : 'Stop'}
                  </button>
                ) : canEdit && record.is_published === 1 && supportsRun && (
                  <button
                    onClick={() => onRun(record)}
                    disabled={Boolean(record.run_blocked_reason)}
                    title={record.run_blocked_reason || undefined}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Play className="h-3.5 w-3.5" /> Run
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">App / Flow</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Backup Type</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Destination</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Last Run</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredFlows.map(record => {
                  const meta = APP_META[record.app] || { color: '#64748b' }
                  const icon = appIcons[record.app] || <Cloud className="w-4 h-4" />
                  const bt = BACKUP_TYPE_TAG[record.backup_type]
                  const supportsRun = ['request', 'service', 'workflow', 'wework'].includes(record.app)
                  const hasActiveRun = ['pending', 'running'].includes(record.last_run_status)
                  const isStopping = stoppingFlowId === record.id

                  return (
                    <tr key={record.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                            style={{ backgroundColor: `${meta.color}18`, color: meta.color }}>
                            {icon}
                          </div>
                          <div>
                            <div className="font-semibold text-gray-900">{record.app_name || <span className="text-gray-400">—</span>}</div>
                            <div className="text-xs text-gray-400">{record.name || 'Untitled draft'}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {bt ? <Tag color={bt.color}>{bt.label}</Tag> : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        {record.destination_name ? (
                          <div className="flex items-center gap-1.5">
                            {record.destination_type === 'gsheets'
                              ? <FileSpreadsheet className="w-4 h-4 text-green-600" />
                              : <Globe className="w-4 h-4 text-blue-500" />}
                            <span className="text-gray-700">{record.destination_name}</span>
                          </div>
                        ) : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {record.is_draft === 1 ? <Tag color="gold">Draft</Tag> : <Tag color="cyan">Ready</Tag>}
                          {record.is_published === 1 ? <Tag color="green">Published</Tag> : <Tag color="default">Unpublished</Tag>}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs text-gray-400">{record.last_run_at || 'Never run'}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1.5 flex-wrap">
                          <button onClick={() => onOpenDetails(record)}
                            className="flex items-center gap-1 px-2.5 py-1.5 text-xs border border-gray-300 rounded-md hover:bg-gray-50 transition-colors">
                            <Eye className="w-3.5 h-3.5" /> Details
                          </button>
                          {canEdit && record.is_published === 0 && (
                            <button onClick={() => onPublish(record)}
                              className="flex items-center gap-1 px-2.5 py-1.5 text-xs border border-blue-300 text-blue-600 rounded-md hover:bg-blue-50 transition-colors">
                              <Rocket className="w-3.5 h-3.5" /> Publish
                            </button>
                          )}
                          {canEdit && (
                            <button onClick={() => onEdit(record)}
                              className="flex items-center gap-1 px-2.5 py-1.5 text-xs border border-gray-300 rounded-md hover:bg-gray-50 transition-colors">
                              <Pencil className="w-3.5 h-3.5" /> Edit
                            </button>
                          )}
                          {canEdit && record.is_published === 1 && supportsRun && hasActiveRun ? (
                            <button
                              onClick={() => onStop(record)}
                              disabled={isStopping}
                              className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                              <Square className="w-3.5 h-3.5" /> {isStopping ? 'Stopping…' : 'Stop'}
                            </button>
                          ) : canEdit && record.is_published === 1 && supportsRun && (
                            <button
                              onClick={() => onRun(record)}
                              disabled={Boolean(record.run_blocked_reason)}
                              title={record.run_blocked_reason || undefined}
                              className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                              <Play className="w-3.5 h-3.5" /> Run
                            </button>
                          )}
                          {canEdit && (
                            <button onClick={() => onDelete(record)}
                              className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
    </div>
  )
}

export default FlowListView
