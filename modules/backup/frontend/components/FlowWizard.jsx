import React from 'react'
import {
  ArrowLeft, Cloud, Globe, Check, CheckCircle,
  ChevronRight, Pencil, Play, Rocket, FileSpreadsheet, Folder,
} from 'lucide-react'
import BackupSetupSection from './shared/BackupSetupSection'
import StepNameAndApp from './wizard/StepNameAndApp'
import StepConnection from './wizard/StepConnection'
import StepDataSelection, { StepGenericConnection } from './wizard/StepDataSelection'
import StepServiceAccount from './wizard/StepServiceAccount'
import StepReview from './wizard/StepReview'

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
    ? 'mx-auto w-full max-w-[1180px] h-full'
    : 'mx-auto w-full max-w-[1180px]'

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
    <div className="p-8">
      <div className="flex min-h-[calc(100vh-10rem)] flex-col overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm lg:h-[calc(100vh-10rem)] lg:flex-row">
        {/* ── Left sidebar ── */}
        <div className="flex w-full shrink-0 flex-col border-b border-gray-200 bg-gradient-to-b from-white via-blue-50/30 to-cyan-50/50 lg:h-full lg:min-h-0 lg:w-80 lg:border-b-0 lg:border-r lg:overflow-hidden xl:w-96">
          {/* Header */}
          <div className="border-b border-gray-100 px-5 py-5">
            <button
              type="button"
              onClick={onBack}
              className="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-400 transition-colors hover:text-gray-700"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>{backLabel}</span>
            </button>

            <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-white/80 px-3 py-1 text-xs font-semibold text-blue-700">
              <Cloud className="h-3.5 w-3.5" />
              {isEdit ? 'Edit backup flow' : 'Create backup flow'}
            </div>

            <div className="mt-4 flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-sm shadow-blue-200">
                <Cloud className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Backup wizard</h2>
                <p className="mt-1 text-sm leading-6 text-gray-500">
                  Configure source scope, storage, and execution settings with the same reusable building blocks used across the platform.
                </p>
              </div>
            </div>

            {flowName && (
              <div className="mt-4 rounded-2xl border border-white/70 bg-white/80 px-4 py-3 shadow-sm backdrop-blur">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Flow name</p>
                <p className="mt-1 truncate text-sm font-semibold text-gray-700">{flowName}</p>
              </div>
            )}
          </div>

          {/* Progress bar */}
          <div className="border-b border-gray-100 px-5 py-4">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-gray-400">Progress</span>
              <span className="text-xs font-semibold text-blue-600">{progressPercent}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-gray-100">
              <div className="h-full rounded-full bg-blue-500 transition-all duration-500" style={{ width: `${progressPercent}%` }} />
            </div>
          </div>

          {/* Steps nav */}
          <nav className="flex-1 space-y-2 overflow-y-auto px-3 py-4">
            {steps.map((step, idx) => {
              const isDone = idx < currentStep
              const isActive = idx === currentStep
              const isPending = idx > currentStep
              return (
                <div
                  key={idx}
                  className={`flex items-start gap-3 rounded-2xl px-3 py-3 transition-all ${
                    isActive
                      ? 'border border-blue-200 bg-blue-50 shadow-sm'
                      : isPending
                        ? 'border border-transparent bg-transparent opacity-60'
                        : 'border border-gray-100 bg-white/80 hover:bg-white'
                  }`}
                >
                  <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-all ${
                    isDone ? 'bg-green-500 text-white' : isActive ? 'bg-blue-600 text-white shadow-sm shadow-blue-200' : 'bg-gray-100 text-gray-400'
                  }`}>
                    {isDone ? <Check className="h-3.5 w-3.5" /> : idx + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-semibold leading-tight ${isActive ? 'text-blue-700' : isDone ? 'text-green-700' : 'text-gray-500'}`}>
                      {step.title}
                    </p>
                    {stepDescriptions[idx] && (
                      <p className={`mt-0.5 text-xs leading-5 ${isActive ? 'text-blue-500' : isDone ? 'text-green-500' : 'text-gray-400'}`}>
                        {stepDescriptions[idx]}
                      </p>
                    )}
                  </div>
                </div>
              )
            })}
          </nav>

          {/* Sidebar summary card */}
          {currentStep > 0 && (selectedApp || googleAuth) && (
            <div className="mx-3 mb-4 shrink-0 rounded-2xl border border-gray-200 bg-white/80 p-4 shadow-sm backdrop-blur">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Configured</p>
              <div className="mt-3 space-y-2.5">
                {currentApp && (
                  <div className="flex items-center gap-2">
                    <span style={{ color: currentApp.color }}>
                      {currentApp.icon && React.cloneElement(currentApp.icon, { className: 'w-3.5 h-3.5' })}
                    </span>
                    <span className="text-sm font-semibold" style={{ color: currentApp.color }}>{currentApp.name}</span>
                  </div>
                )}
                {domain && (
                  <div className="flex items-center gap-1.5 truncate text-xs text-gray-500">
                    <Globe className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                    <span className="truncate">{domain}</span>
                  </div>
                )}
                {backupType && (
                  <div className="flex items-center gap-1.5">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      backupType === 'structured' ? 'bg-blue-100 text-blue-700' :
                      backupType === 'unstructured' ? 'bg-amber-100 text-amber-700' :
                      'bg-purple-100 text-purple-700'
                    }`}>
                      {backupType === 'structured' ? 'Structured' : backupType === 'unstructured' ? 'Files & Attachments' : 'Complete'}
                    </span>
                  </div>
                )}
                {storageDestination && (
                  <div className="flex items-center gap-1.5 text-xs text-gray-500">
                    {storageDestination === 'gsheets'
                      ? <FileSpreadsheet className="h-3.5 w-3.5 shrink-0 text-green-500" />
                      : <Folder className="h-3.5 w-3.5 shrink-0 text-blue-500" />}
                    <span>{storageDestination === 'gsheets' ? 'Google Sheets' : 'Google Drive'}</span>
                  </div>
                )}
                {googleAuth?.email && (
                  <div className="flex items-center gap-1.5 truncate text-xs text-gray-500">
                    <CheckCircle className="h-3.5 w-3.5 shrink-0 text-green-500" />
                    <span className="truncate">{googleAuth.email}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Right: step content ── */}
        <div className="flex min-w-0 flex-1 flex-col lg:h-full lg:min-h-0 lg:overflow-hidden">
          {/* Step header */}
          <div className="shrink-0 border-b border-gray-200 bg-white px-5 py-4 lg:px-8 xl:px-10">
            <div className="mx-auto w-full max-w-[1180px]">
              <div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-gray-400">
                <span>Step {currentStep + 1} / {totalSteps}</span>
              </div>
              <h1 className="text-xl font-bold text-gray-900">
                {steps[currentStep]?.title || ''}
              </h1>
              {stepDescriptions[currentStep] && (
                <p className="mt-1 text-sm leading-6 text-gray-500">{stepDescriptions[currentStep]}</p>
              )}
            </div>
          </div>

          {/* Content area */}
          <div className="flex-1 bg-gray-50/80 px-5 py-5 lg:min-h-0 lg:overflow-y-auto lg:px-8 xl:px-10">
            <div className={stepContentShellClass}>
              {renderStepContent()}
            </div>
          </div>

          {/* Bottom nav bar */}
          <div className="shrink-0 border-t border-gray-200 bg-white px-5 py-3 lg:px-8 xl:px-10">
            <div className="mx-auto flex w-full max-w-[1180px] items-center justify-between gap-3">
              <button
                type="button"
                disabled={currentStep === 0}
                onClick={prev}
                className="inline-flex items-center gap-2 rounded-2xl border border-gray-200 px-5 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ArrowLeft className="h-4 w-4" /> Back
              </button>
              <div className="flex flex-wrap items-center justify-end gap-3">
                {currentStep < totalSteps - 1 && (
                  <button
                    type="button"
                    onClick={next}
                    className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm shadow-blue-200 transition-colors hover:bg-blue-700"
                  >
                    Next <ChevronRight className="h-4 w-4" />
                  </button>
                )}
                {currentStep === totalSteps - 1 && (
                  <>
                    <button
                      type="button"
                      onClick={() => { void handleSubmit(false) }}
                      className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm shadow-blue-200 transition-colors hover:bg-blue-700"
                    >
                      {isEdit
                        ? <><Pencil className="h-4 w-4" /> Save Changes</>
                        : <><Rocket className="h-4 w-4" /> Create Backup Flow</>}
                    </button>
                    {['request', 'service', 'workflow', 'wework'].includes(currentApp?.id || '') && (
                      <button
                        type="button"
                        onClick={() => { void handleSubmit(true) }}
                        className="inline-flex items-center gap-2 rounded-2xl border border-green-300 bg-green-50 px-5 py-2.5 text-sm font-medium text-green-700 transition-colors hover:bg-green-100"
                      >
                        <Play className="h-4 w-4" />
                        {isEdit ? 'Save & Run Now' : 'Create & Run Now'}
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default FlowWizard
