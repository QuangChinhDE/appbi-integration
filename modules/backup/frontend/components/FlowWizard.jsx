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
const FlowWizard = ({ wizard, viewMode, onBack }) => {
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
    const saved = await handleFinish(runAfterSave, viewMode)
    if (saved && isEdit) onBack()
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
    <div className="flex min-h-full flex-col bg-gray-50 lg:h-full lg:min-h-0 lg:flex-row lg:overflow-hidden">
      {/* ── Left sidebar ── */}
      <div className="w-full shrink-0 bg-white border-b border-gray-200 flex flex-col shadow-sm lg:h-full lg:min-h-0 lg:w-72 lg:border-b-0 lg:border-r lg:overflow-hidden xl:w-80">
        {/* Header */}
        <div className="px-5 py-5 border-b border-gray-100">
          <button onClick={onBack}
            className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-700 transition-colors mb-4">
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to list</span>
          </button>

          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shrink-0">
              <Cloud className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="text-[11px] font-medium text-blue-600 uppercase tracking-wide">
                {isEdit ? 'Edit' : 'Create'}
              </p>
              <h2 className="text-sm font-bold text-gray-900 leading-tight">
                Backup Flow
              </h2>
            </div>
          </div>

          {flowName && (
            <div className="mt-3 px-3 py-2 bg-gray-50 rounded-lg border border-gray-100">
              <p className="text-[11px] text-gray-400 mb-0.5">Flow name</p>
              <p className="text-sm font-medium text-gray-700 truncate">{flowName}</p>
            </div>
          )}
        </div>

        {/* Progress bar */}
        <div className="px-5 py-3 border-b border-gray-100">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] text-gray-400">Progress</span>
            <span className="text-[11px] font-semibold text-blue-600">{progressPercent}%</span>
          </div>
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full transition-all duration-500" style={{ width: `${progressPercent}%` }} />
          </div>
        </div>

        {/* Steps nav */}
        <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
          {steps.map((step, idx) => {
            const isDone = idx < currentStep
            const isActive = idx === currentStep
            const isPending = idx > currentStep
            return (
              <div key={idx}
                className={`flex items-start gap-3 px-3 py-3 rounded-xl transition-all ${
                  isActive ? 'bg-blue-50 border border-blue-100' : isPending ? 'opacity-50' : 'hover:bg-gray-50'
                }`}>
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 transition-all ${
                  isDone ? 'bg-green-500 text-white' : isActive ? 'bg-blue-600 text-white shadow-sm shadow-blue-200' : 'bg-gray-100 text-gray-400'
                }`}>
                  {isDone ? <Check className="w-3.5 h-3.5" /> : idx + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-semibold leading-tight ${isActive ? 'text-blue-700' : isDone ? 'text-green-700' : 'text-gray-400'}`}>
                    {step.title}
                  </p>
                  {stepDescriptions[idx] && (
                    <p className={`text-[11px] mt-0.5 leading-snug ${isActive ? 'text-blue-500' : isDone ? 'text-green-500' : 'text-gray-300'}`}>
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
          <div className="mx-3 mb-4 shrink-0 p-3 bg-gray-50 rounded-xl border border-gray-100 space-y-2">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Configured</p>
            {currentApp && (
              <div className="flex items-center gap-2">
                <span style={{ color: currentApp.color }}>
                  {currentApp.icon && React.cloneElement(currentApp.icon, { className: 'w-3.5 h-3.5' })}
                </span>
                <span className="text-xs font-semibold" style={{ color: currentApp.color }}>{currentApp.name}</span>
              </div>
            )}
            {domain && (
              <div className="flex items-center gap-1.5 text-[11px] text-gray-500 truncate">
                <Globe className="w-3 h-3 shrink-0 text-gray-400" />
                <span className="truncate">{domain}</span>
              </div>
            )}
            {backupType && (
              <div className="flex items-center gap-1.5">
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                  backupType === 'structured' ? 'bg-blue-100 text-blue-700' :
                  backupType === 'unstructured' ? 'bg-amber-100 text-amber-700' :
                  'bg-purple-100 text-purple-700'
                }`}>
                  {backupType === 'structured' ? 'Structured' : backupType === 'unstructured' ? 'Files & Attachments' : 'Complete'}
                </span>
              </div>
            )}
            {storageDestination && (
              <div className="flex items-center gap-1.5 text-[11px] text-gray-500">
                {storageDestination === 'gsheets'
                  ? <FileSpreadsheet className="w-3 h-3 text-green-500 shrink-0" />
                  : <Folder className="w-3 h-3 text-blue-500 shrink-0" />}
                <span>{storageDestination === 'gsheets' ? 'Google Sheets' : 'Google Drive'}</span>
              </div>
            )}
            {googleAuth?.email && (
              <div className="flex items-center gap-1.5 text-[11px] text-gray-500 truncate">
                <CheckCircle className="w-3 h-3 text-green-500 shrink-0" />
                <span className="truncate">{googleAuth.email}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Right: step content ── */}
      <div className="flex-1 flex flex-col min-w-0 lg:h-full lg:min-h-0 lg:overflow-hidden">
        {/* Step header */}
        <div className="shrink-0 bg-white border-b border-gray-200 px-5 py-4 lg:px-8 lg:py-4 xl:px-10">
          <div className="mx-auto w-full max-w-[1180px]">
            <div className="flex items-center gap-2 text-xs text-gray-400 mb-1">
              <span>Step {currentStep + 1} / {totalSteps}</span>
            </div>
            <h1 className="text-xl font-bold text-gray-900">
              {steps[currentStep]?.title || ''}
            </h1>
            {stepDescriptions[currentStep] && (
              <p className="text-sm text-gray-500 mt-0.5">{stepDescriptions[currentStep]}</p>
            )}
          </div>
        </div>

        {/* Content area */}
        <div className="flex-1 px-5 py-5 lg:min-h-0 lg:overflow-y-auto lg:px-8 lg:py-5 xl:px-10">
          <div className={stepContentShellClass}>
            {renderStepContent()}
          </div>
        </div>

        {/* Bottom nav bar */}
        {(
          <div className="shrink-0 border-t border-gray-200 bg-white px-5 py-3 lg:px-8 lg:py-3 xl:px-10">
            <div className="mx-auto flex w-full max-w-[1180px] items-center justify-between gap-3">
              <button disabled={currentStep === 0} onClick={prev}
                className="flex items-center gap-2 px-5 py-2.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium">
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
              <div className="flex items-center gap-3 flex-wrap justify-end">
                {currentStep < totalSteps - 1 && (
                  <button onClick={next}
                    className="flex items-center gap-2 px-6 py-2.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold shadow-sm shadow-blue-200">
                    Next <ChevronRight className="w-4 h-4" />
                  </button>
                )}
                {currentStep === totalSteps - 1 && (
                  <>
                    <button onClick={() => { void handleSubmit(false) }}
                      className="flex items-center gap-2 px-6 py-2.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold shadow-sm shadow-blue-200">
                      {isEdit
                        ? <><Pencil className="w-4 h-4" /> Save Changes</>
                        : <><Rocket className="w-4 h-4" /> Create Backup Flow</>}
                    </button>
                    {['request', 'service', 'workflow', 'wework'].includes(currentApp?.id || '') && (
                      <button onClick={() => { void handleSubmit(true) }}
                        className="flex items-center gap-2 px-5 py-2.5 text-sm border border-green-300 text-green-700 bg-green-50 rounded-lg hover:bg-green-100 transition-colors font-medium">
                        <Play className="w-4 h-4" />
                        {isEdit ? 'Save & Run Now' : 'Create & Run Now'}
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default FlowWizard
