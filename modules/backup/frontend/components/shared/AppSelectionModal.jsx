import React from 'react'
import { Check, Workflow } from 'lucide-react'
import AppModalShell from '@packages/ui/src/components/common/AppModalShell'
import { SELECTABLE_BACKUP_APPS } from '../../constants'

const AppSelectionModal = ({ open, onCancel, selectedApp, onSelect }) => (
  open ? (
  <AppModalShell
    title="Choose application"
    description="Select the data source for this flow."
    icon={<Workflow className="h-5 w-5" />}
    onClose={onCancel}
    maxWidthClass="max-w-4xl"
  >
    <div className="grid gap-4 md:grid-cols-2">
      {SELECTABLE_BACKUP_APPS.map(app => (
        <button
          key={app.id}
          onClick={() => onSelect(app.id)}
          className={`flex items-start gap-4 rounded-xl border p-5 text-left transition-all hover:shadow-linear-sm ${
            selectedApp === app.id ? 'border-current' : 'border-[rgb(var(--border-line))] hover:border-[rgb(var(--border-strong))]'
          }`}
          style={selectedApp === app.id ? { borderColor: app.color, backgroundColor: app.bg } : undefined}
        >
          <div className="shrink-0 rounded-xl p-3" style={{ backgroundColor: app.bg, color: app.color }}>{app.icon}</div>
          <div className="flex-1 min-w-0">
            <div className="mb-1 text-small font-emphasis" style={{ color: app.color }}>{app.name}</div>
            <p className="mb-2 text-caption text-text-tertiary">{app.description}</p>
            <div className="flex flex-wrap gap-1">
              {app.objects.map(obj => (
                <span key={obj} className="inline-flex items-center rounded px-1.5 py-0.5 text-micro font-emphasis" style={{ backgroundColor: app.bg, color: app.color }}>
                  {app.objectLabels[obj]}
                </span>
              ))}
            </div>
          </div>
          {selectedApp === app.id && <Check className="w-4 h-4 shrink-0 mt-0.5" style={{ color: app.color }} />}
        </button>
      ))}
    </div>
  </AppModalShell>
  ) : null
)

export default AppSelectionModal
