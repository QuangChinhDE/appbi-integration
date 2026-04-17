import React from 'react'
import { Bot, Zap } from 'lucide-react'
import AppLayout from '@packages/ui/src/components/layout/AppLayout'
import ModuleOverview from '@packages/ui/src/components/common/ModuleOverview'
import PageListLayout from '@packages/ui/src/components/common/PageListLayout'

const AutomationPage = () => {
  return (
    <AppLayout>
      <PageListLayout
        title="Automation"
        description="Event-driven workflows, scheduled jobs, and orchestration rules will follow the same module structure used across AppBI AI."
        overview={(
          <ModuleOverview
            icon={Zap}
            title="Automation workspace"
            description="This module is reserved for reusable automation flows that connect sources, destinations, and backup execution into one operational surface."
            badges={['Shared shell', 'Workflow-ready', 'Coming next']}
            stats={[
              {
                label: 'Status',
                value: 'Planned',
                helper: 'Module shell is ready for rollout.',
              },
              {
                label: 'Target',
                value: 'Flows',
                helper: 'Scheduled and event-based automations.',
              },
              {
                label: 'Design',
                value: 'Aligned',
                helper: 'Uses the same presentation pattern as other modules.',
              },
            ]}
          />
        )}
        searchable={false}
        viewToggle={false}
      >
        <div className="rounded-xl border border-dashed border-gray-200 bg-white px-8 py-14 text-center shadow-sm">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
            <Bot className="h-6 w-6" />
          </div>
          <h2 className="mt-4 text-lg font-semibold text-gray-900">Automation module is being standardized next</h2>
          <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-gray-500">
            The route is now attached to the same page shell, overview block, spacing, and empty-state treatment used by the AI application so future workflows land in a consistent UI.
          </p>
        </div>
      </PageListLayout>
    </AppLayout>
  )
}

export default AutomationPage