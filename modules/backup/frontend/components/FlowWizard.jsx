import React from 'react'
import {
  ArrowLeft, Cloud, Globe, Check, CheckCircle,
  ChevronRight, Pencil, Play, Rocket, Folder,
} from 'lucide-react'
import AppModalShell from '@packages/ui/src/components/common/AppModalShell'
import { Button } from '@packages/ui/src/components/common/ui'
import BackupSetupSection from './shared/BackupSetupSection'
import StepNameAndApp from './wizard/StepNameAndApp'
import StepConnection from './wizard/StepConnection'
import StepDataSelection, { StepGenericConnection } from './wizard/StepDataSelection'
import StepServiceAccount from './wizard/StepServiceAccount'
import StepReview from './wizard/StepReview'
import { getBackupDestinationLabel } from '../constants'
import { supportsBackupFlowRun } from '../runSupport'

/**
 * Wizard shell — left sidebar + right step content + bottom nav.
 */
const FlowWizard = ({ wizard, viewMode, onBack, onSaved, backLabel = 'Back to list' }) => {
  const {
    currentStep, totalSteps, flowName,
    selectedApp, currentApp, isRequestApp, isServiceApp,
    usesCondensedServiceWizard, hasServiceAccountStep,
    backupType, storageDestination, googleAuth, domain,
    next, prev, handleFinish,
    getStepLabels, getStepDescriptions,
  } = wizard

  const isEdit = viewMode === 'edit'
  const steps = getStepLabels()
  const stepDescriptions = getStepDescriptions()
  const progressPercent = totalSteps > 1 ? Math.round((currentStep / (totalSteps - 1)) * 100) : 0

  const handleSubmit = async (runAfterSave = false) => {
    const saveResult = await handleFinish(runAfterSave, viewMode)
    if (saveResult?.success && typeof onSaved === 'function') {
      await onSaved(saveResult)
      return
    }
    if (saveResult?.success && isEdit) onBack()
  }

  // Dynamic max-width for step content
  const isReviewStep = currentStep === totalSteps - 1
  const stepContentShellClass = isReviewStep
    ? 'flex h-full min-w-0 w-full'
    : 'min-w-0 w-full'

  const footer = (
    <div className="flex w-full items-center justify-between gap-3">
      <Button
        variant="secondary"
        size="md"
        disabled={currentStep === 0}
        onClick={prev}
        leadingIcon={<ArrowLeft className="h-4 w-4" />}
      >
        Back
      </Button>
      <div className="flex flex-wrap items-center justify-end gap-3">
        {currentStep < totalSteps - 1 && (
          <Button
            variant="primary"
            size="md"
            onClick={next}
            trailingIcon={<ChevronRight className="h-4 w-4" />}
          >
            Next
          </Button>
        )}
        {currentStep === totalSteps - 1 && (
          <>
            <Button
              variant="primary"
              size="md"
              onClick={() => { void handleSubmit(false) }}
              leadingIcon={isEdit ? <Pencil className="h-4 w-4" /> : <Rocket className="h-4 w-4" />}
            >
              {isEdit
                ? 'Save Changes'
                : 'Create Backup Flow'}
            </Button>
            {supportsBackupFlowRun(currentApp?.id || '') && (
              <Button
                variant="secondary"
                size="md"
                onClick={() => { void handleSubmit(true) }}
                leadingIcon={<Play className="h-4 w-4" />}
                className="border-success/30 bg-success/10 text-success hover:bg-success/15"
              >
                {isEdit ? 'Save & Run Now' : 'Create & Run Now'}
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  )

  // ── Render step content ──────────────────────────────────────────────

  const renderStepContent = () => {
    if (usesCondensedServiceWizard) {
      switch (currentStep) {
        case 0: return <StepNameAndApp wizard={wizard} viewMode={viewMode} />
        case 1: return <BackupSetupSection wizard={wizard} />
        case 2: return <StepReview wizard={wizard} viewMode={viewMode} />
        default: return null
      }
    }

    if (isRequestApp) {
      switch (currentStep) {
        case 0: return <StepNameAndApp wizard={wizard} viewMode={viewMode} />
        case 1: return <StepConnection wizard={wizard} />
        case 2: return <BackupSetupSection wizard={wizard} />
        case 3: return hasServiceAccountStep
          ? <StepServiceAccount wizard={wizard} />
          : <StepReview wizard={wizard} viewMode={viewMode} />
        case 4: return <StepReview wizard={wizard} viewMode={viewMode} />
        default: return null
      }
    }

    // Generic (Workflow / WeWork)
    switch (currentStep) {
      case 0: return <StepNameAndApp wizard={wizard} viewMode={viewMode} />
      case 1: return <StepDataSelection wizard={wizard} />
      case 2: return <StepGenericConnection wizard={wizard} />
      case 3: return hasServiceAccountStep
        ? <StepServiceAccount wizard={wizard} />
        : <StepReview wizard={wizard} viewMode={viewMode} />
      case 4: return <StepReview wizard={wizard} viewMode={viewMode} />
      default: return null
    }
  }

  return (
    <AppModalShell
      variant="page"
      onClose={onBack}
      leadingAction={(
        <Button
          variant="secondary"
          size="sm"
          onClick={onBack}
          leadingIcon={<ArrowLeft className="h-4 w-4" />}
        >
          {backLabel}
        </Button>
      )}
      title={isEdit ? 'Edit backup flow' : 'Create backup flow'}
      description="Configure flow scope, storage, and schedule."
      icon={<Cloud className="h-5 w-5" />}
      bodyClassName="px-4 py-5 sm:px-6 xl:px-8"
      footer={footer}
    >
      <div className="grid min-h-[calc(100vh-13rem)] gap-6 xl:grid-cols-[minmax(280px,360px)_minmax(0,1fr)]">
        <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-[rgb(var(--border-line))] bg-gradient-to-b from-surface-1 via-brand/5 to-brand/5 shadow-linear-sm">
          <div className="border-b border-[rgb(var(--border-line))] px-5 py-5">
            <div className="inline-flex items-center gap-2 rounded-full border border-brand/20 bg-surface-1/80 px-3 py-1.5 text-micro font-emphasis uppercase tracking-[0.14em] text-brand">
              <Cloud className="h-3.5 w-3.5" />
              {isEdit ? 'Editing flow' : 'New flow'}
            </div>

            <div className="mt-4">
              <h3 className="text-h3 font-strong text-text-primary">
                {flowName || (isEdit ? 'Editing backup configuration' : 'Draft your backup configuration')}
              </h3>
              <p className="mt-1.5 text-small leading-6 text-text-tertiary">
                Follow the step navigator to confirm app scope, source data, storage, and run behavior before saving the flow.
              </p>
            </div>

            {flowName && (
              <div className="mt-4 rounded-xl border border-[rgb(var(--border-line))] bg-surface-1/80 px-4 py-3 shadow-linear-sm backdrop-blur">
                <p className="text-micro font-emphasis uppercase tracking-[0.14em] text-text-quaternary">Flow name</p>
                <p className="mt-1 truncate text-small font-emphasis text-text-secondary">{flowName}</p>
              </div>
            )}
          </div>

          <div className="border-b border-[rgb(var(--border-line))] px-5 py-4">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-micro font-emphasis uppercase tracking-[0.14em] text-text-quaternary">Progress</span>
              <span className="text-micro font-strong text-brand">{progressPercent}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-brand transition-all duration-500" style={{ width: `${progressPercent}%` }} />
            </div>
          </div>

          <nav className="flex-1 space-y-2 overflow-y-auto px-3 py-4">
            {steps.map((step, idx) => {
              const isDone = idx < currentStep
              const isActive = idx === currentStep
              const isPending = idx > currentStep
              return (
                <div
                  key={idx}
                  className={`flex items-start gap-3 rounded-xl px-3 py-3.5 transition-all ${
                    isActive
                      ? 'border border-brand/20 bg-brand/10 shadow-linear-sm'
                      : isPending
                        ? 'border border-transparent bg-transparent opacity-60'
                        : 'border border-[rgb(var(--border-line))] bg-surface-1/80 hover:bg-surface-1'
                  }`}
                >
                  <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-label font-strong transition-all ${
                    isDone ? 'bg-success text-white' : isActive ? 'bg-brand text-white shadow-linear-sm shadow-brand/20' : 'bg-surface-2 text-text-quaternary'
                  }`}>
                    {isDone ? <Check className="h-3.5 w-3.5" /> : idx + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={`text-small font-emphasis leading-6 ${isActive ? 'text-brand' : isDone ? 'text-success' : 'text-text-tertiary'}`}>
                      {step.title}
                    </p>
                    {stepDescriptions[idx] && (
                      <p className={`mt-0.5 text-caption leading-5 ${isActive ? 'text-brand' : isDone ? 'text-success' : 'text-text-quaternary'}`}>
                        {stepDescriptions[idx]}
                      </p>
                    )}
                  </div>
                </div>
              )
            })}
          </nav>

          {currentStep > 0 && (selectedApp || googleAuth) && (
            <div className="mx-3 mb-4 shrink-0 rounded-xl border border-[rgb(var(--border-line))] bg-surface-1/80 p-4 shadow-linear-sm backdrop-blur">
              <p className="text-micro font-emphasis uppercase tracking-[0.14em] text-text-quaternary">Configured</p>
              <div className="mt-3 space-y-2.5">
                {currentApp && (
                  <div className="flex items-center gap-2">
                    <span style={{ color: currentApp.color }}>
                      {currentApp.icon && React.cloneElement(currentApp.icon, { className: 'w-3.5 h-3.5' })}
                    </span>
                    <span className="text-small font-emphasis" style={{ color: currentApp.color }}>{currentApp.name}</span>
                  </div>
                )}
                {domain && (
                  <div className="flex items-center gap-1.5 truncate text-caption text-text-tertiary">
                    <Globe className="h-3.5 w-3.5 shrink-0 text-text-quaternary" />
                    <span className="truncate">{domain}</span>
                  </div>
                )}
                {backupType && (
                  <div className="flex items-center gap-1.5">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-micro font-emphasis ${
                      backupType === 'structured' ? 'bg-brand/10 text-brand' :
                      backupType === 'unstructured' ? 'bg-warning/10 text-warning' :
                      'bg-[#7c3aed]/10 text-[#7c3aed]'
                    }`}>
                      {backupType === 'structured' ? 'Structured' : backupType === 'unstructured' ? 'Files & Attachments' : 'Complete'}
                    </span>
                  </div>
                )}
                {storageDestination && (
                  <div className="flex items-center gap-1.5 text-caption text-text-tertiary">
                    <Folder className="h-3.5 w-3.5 shrink-0 text-brand" />
                    <span>{getBackupDestinationLabel(storageDestination)}</span>
                  </div>
                )}
                {googleAuth?.email && (
                  <div className="flex items-center gap-1.5 truncate text-caption text-text-tertiary">
                    <CheckCircle className="h-3.5 w-3.5 shrink-0 text-success" />
                    <span className="truncate">{googleAuth.email}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-[rgb(var(--border-line))] bg-surface-1 shadow-linear-sm">
          <div className="shrink-0 border-b border-[rgb(var(--border-line))] bg-surface-1 px-5 py-4 lg:px-8 xl:px-8">
            <div className="w-full min-w-0">
              <div className="mb-1 flex items-center gap-2 text-micro font-emphasis uppercase tracking-[0.14em] text-text-quaternary">
                <span>Step {currentStep + 1} / {totalSteps}</span>
              </div>
              <h1 className="text-h3 font-strong text-text-primary">
                {steps[currentStep]?.title || ''}
              </h1>
              {stepDescriptions[currentStep] && (
                <p className="mt-1.5 text-small leading-6 text-text-tertiary">{stepDescriptions[currentStep]}</p>
              )}
            </div>
          </div>

          <div className="flex-1 bg-surface-2 px-5 py-5 lg:min-h-0 lg:overflow-y-auto lg:px-8 xl:px-8">
            <div className={stepContentShellClass}>
              {renderStepContent()}
            </div>
          </div>
        </div>
      </div>
    </AppModalShell>
  )
}

export default FlowWizard
