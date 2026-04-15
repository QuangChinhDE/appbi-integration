import React from 'react'
import {
  Plus, Eye, Pencil, Play, Rocket, Trash2, Cloud,
  Inbox, FolderKanban, Building2, Headphones, FileSpreadsheet, Globe,
} from 'lucide-react'
import { Tag, SpinCenter, Empty } from '@packages/ui/src/components/common/ui'
import { APP_META, BACKUP_TYPE_TAG } from '../constants'

const FlowListView = ({
  flows,
  loadingFlows,
  onCreateDraft,
  onOpenDetails,
  onPublish,
  onEdit,
  onRun,
  onDelete,
}) => {
  const appIcons = {
    request:  <Inbox className="w-4 h-4" />,
    workflow: <FolderKanban className="w-4 h-4" />,
    wework:   <Building2 className="w-4 h-4" />,
    service:  <Headphones className="w-4 h-4" />,
  }

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Backup Flows</h2>
          <p className="text-sm text-gray-500 mt-0.5">Manage and monitor your backup configurations</p>
        </div>
        <button
          onClick={onCreateDraft}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-md transition-colors"
        >
          <Plus className="w-4 h-4" /> New Backup Flow
        </button>
      </div>

      {/* Table card */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {loadingFlows ? (
          <SpinCenter text="Loading backup flows…" />
        ) : flows.length === 0 ? (
          <Empty description='No backup flows yet. Click "New Backup Flow" to create one.' />
        ) : (
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
                {flows.map(record => {
                  const meta = APP_META[record.app] || { color: '#64748b' }
                  const icon = appIcons[record.app] || <Cloud className="w-4 h-4" />
                  const bt = BACKUP_TYPE_TAG[record.backup_type]

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
                          {record.is_published === 0 && (
                            <button onClick={() => onPublish(record)}
                              className="flex items-center gap-1 px-2.5 py-1.5 text-xs border border-blue-300 text-blue-600 rounded-md hover:bg-blue-50 transition-colors">
                              <Rocket className="w-3.5 h-3.5" /> Publish
                            </button>
                          )}
                          <button onClick={() => onEdit(record)}
                            className="flex items-center gap-1 px-2.5 py-1.5 text-xs border border-gray-300 rounded-md hover:bg-gray-50 transition-colors">
                            <Pencil className="w-3.5 h-3.5" /> Edit
                          </button>
                          {record.is_published === 1 && ['request', 'service'].includes(record.app) && (
                            <button
                              onClick={() => onRun(record)}
                              disabled={Boolean(record.run_blocked_reason)}
                              title={record.run_blocked_reason || undefined}
                              className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                              <Play className="w-3.5 h-3.5" /> Run
                            </button>
                          )}
                          <button onClick={() => onDelete(record)}
                            className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}

export default FlowListView
