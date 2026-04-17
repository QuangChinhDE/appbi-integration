import React from 'react'
import { Check, Workflow } from 'lucide-react'
import AppModalShell from '@packages/ui/src/components/common/AppModalShell'
import { APPS } from '../../constants'

const AppSelectionModal = ({ open, onCancel, selectedApp, onSelect }) => (
  open ? (
  <AppModalShell
    title="Choose application"
    description="Select the source application that this backup flow should follow. The remaining wizard steps adapt automatically to the app you choose."
    icon={<Workflow className="h-5 w-5" />}
    onClose={onCancel}
    maxWidthClass="max-w-4xl"
  >
    <div className="grid gap-4 md:grid-cols-2">
      {Object.values(APPS).map(app => (
        <button
          key={app.id}
          onClick={() => onSelect(app.id)}
          className={`flex gap-4 items-start p-4 rounded-lg border-2 text-left transition-all hover:shadow-md ${
            selectedApp === app.id ? 'border-current shadow-sm' : 'border-gray-200 hover:border-gray-300'
          }`}
          style={selectedApp === app.id ? { borderColor: app.color, backgroundColor: app.bg } : {}}
        >
          <div className="p-2.5 rounded-lg shrink-0" style={{ backgroundColor: app.bg, color: app.color }}>{app.icon}</div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm mb-1" style={{ color: app.color }}>{app.name}</div>
            <p className="text-xs text-gray-500 mb-2">{app.description}</p>
            <div className="flex flex-wrap gap-1">
              {app.objects.map(obj => (
                <span key={obj} className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium" style={{ backgroundColor: app.bg, color: app.color }}>
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
