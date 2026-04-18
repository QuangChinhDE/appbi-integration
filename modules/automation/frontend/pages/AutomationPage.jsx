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
        description="Event-driven workflows and scheduled jobs."
        overview={(
          <ModuleOverview
            icon={Zap}
            title="Automation workspace"
            description="Reusable automation flows across sources and destinations."
            badges={['Planned', 'Workflow-ready']}
            stats={[
              { label: 'Status', value: 'Planned', helper: 'Module shell ready.' },
              { label: 'Target', value: 'Flows', helper: 'Scheduled and event-based.' },
              { label: 'Design', value: 'Aligned', helper: 'Shared module pattern.' },
            ]}
          />
        )}
        searchable={false}
        viewToggle={false}
      >
        <div className="rounded-xl border border-dashed border-[rgb(var(--border-line))] bg-surface-1 px-8 py-14 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-brand/10 text-brand">
            <Bot className="h-5 w-5" />
          </div>
          <h2 className="mt-4 text-small font-strong text-text-primary">Coming soon</h2>
          <p className="mx-auto mt-2 max-w-md text-caption leading-relaxed text-text-tertiary">
            Automation flows will land here.
          </p>
        </div>
      </PageListLayout>
    </AppLayout>
  )
}

export default AutomationPage