import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Search, Sparkles } from 'lucide-react'

import { APP_CATALOG, getAppMeta } from '@modules/apps/frontend/constants'
import AppModalShell from '@packages/ui/src/components/common/AppModalShell'
import { Button, FilterTag, Input } from '@packages/ui/src/components/common/ui'

import { getCredentialFormForApp } from './credentialFormRegistry'


const ROLE_META = {
  source: {
    label: 'Source',
    tone: 'info',
    summary: 'Used when Backup reads data from Base apps.',
  },
  destination: {
    label: 'Destination',
    tone: 'brand',
    summary: 'Used when Backup writes files to storage destinations.',
  },
}


function renderIcon(icon, className) {
  if (!React.isValidElement(icon)) return icon
  return React.cloneElement(icon, { className })
}


function CredentialModal({ open, appId: initialAppId = null, editingId = null, onClose, onSaved }) {
  const isEditMode = Boolean(editingId)
  const [appId, setAppId] = useState(initialAppId)
  const [searchText, setSearchText] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [saving, setSaving] = useState(false)
  const formRef = useRef(null)

  useEffect(() => {
    if (!open) {
      setAppId(initialAppId)
      setSearchText('')
      setRoleFilter('all')
      return
    }
    setAppId(initialAppId)
    setSearchText('')
    setRoleFilter('all')
  }, [open, initialAppId])

  const step = useMemo(() => (appId ? 'form' : 'pick'), [appId])
  const formApp = appId ? getAppMeta(appId) : null

  const visibleApps = useMemo(() => {
    const q = searchText.trim().toLowerCase()

    return APP_CATALOG.filter((app) => {
      if (roleFilter !== 'all' && app.role !== roleFilter) return false
      if (!q) return true
      return [app.title, app.description, app.role, app.id]
        .some((value) => String(value || '').toLowerCase().includes(q))
    })
  }, [roleFilter, searchText])

  const sourceApps = visibleApps.filter((app) => app.role === 'source')
  const destinationApps = visibleApps.filter((app) => app.role === 'destination')

  const handleCancel = () => {
    if (!saving) onClose?.()
  }

  const handleBack = () => {
    if (!saving) {
      setAppId(null)
    }
  }

  const handleSave = async () => {
    const ok = await formRef.current?.save()
    if (ok) onClose?.()
  }

  const title = step === 'pick'
    ? 'Add credential'
    : isEditMode
      ? `Edit ${formApp?.title || ''} credential`.trim()
      : `New ${formApp?.title || ''} credential`.trim()

  const description = step === 'pick'
    ? 'Choose the app and create the reusable credential in one flow.'
    : isEditMode
      ? 'Update the saved credential without leaving the registry.'
      : 'Configure the credential now. Backup will pick it up automatically later.'

  const footer = step === 'pick'
    ? (
      <Button variant="secondary" size="sm" onClick={handleCancel}>
        Cancel
      </Button>
    )
    : (
      <>
        <Button variant="secondary" size="sm" onClick={handleCancel} disabled={saving}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" onClick={handleSave} loading={saving}>
          {isEditMode ? 'Save changes' : 'Create credential'}
        </Button>
      </>
    )

  if (!open) return null

  return (
    <AppModalShell
      onClose={handleCancel}
      closeDisabled={saving}
      title={title}
      description={description}
      icon={step === 'pick' ? <Sparkles className="h-4 w-4" /> : renderIcon(formApp?.icon, 'h-4 w-4')}
      maxWidthClass={step === 'pick' ? 'max-w-6xl' : 'max-w-4xl'}
      panelClassName="max-h-[90vh]"
      bodyClassName="p-0"
      footer={footer}
      leadingAction={step === 'form' && !isEditMode ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={handleBack}
          disabled={saving}
          leadingIcon={<ArrowLeft className="h-3.5 w-3.5" />}
        >
          Back
        </Button>
      ) : null}
    >
      {step === 'pick' ? (
        <PickerStep
          searchText={searchText}
          onSearchTextChange={setSearchText}
          roleFilter={roleFilter}
          onRoleFilterChange={setRoleFilter}
          sourceApps={sourceApps}
          destinationApps={destinationApps}
          onPick={setAppId}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {formApp && (
            <SelectedAppSummary app={formApp} isEditMode={isEditMode} />
          )}

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
            {(() => {
              const FormComponent = getCredentialFormForApp(appId)
              if (!FormComponent) return null
              return (
                <FormComponent
                  ref={formRef}
                  appId={appId}
                  editingId={editingId}
                  onSaved={onSaved}
                  onSavingChange={setSaving}
                />
              )
            })()}
          </div>
        </div>
      )}
    </AppModalShell>
  )
}


function PickerStep({
  searchText,
  onSearchTextChange,
  roleFilter,
  onRoleFilterChange,
  sourceApps,
  destinationApps,
  onPick,
}) {
  const totalApps = APP_CATALOG.length
  const visibleCount = sourceApps.length + destinationApps.length

  return (
    <div className="space-y-5 px-5 py-5">
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="rounded-xl border border-[rgb(var(--border-line))] bg-surface-2 p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="text-small font-strong text-text-primary">One modal, one completed action</div>
              <p className="mt-1 text-caption leading-6 text-text-tertiary">
                The user no longer needs to open an Available tab first. Pick the app here, enter the credential,
                and save it directly into the shared registry.
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-2 md:grid-cols-3">
            <StepTile
              step="01"
              title="Choose app"
              description="Base apps, Google Drive, OneDrive, Sheets, or BigQuery."
            />
            <StepTile
              step="02"
              title="Enter credential"
              description="Use the app-specific form immediately in the same modal."
            />
            <StepTile
              step="03"
              title="Reuse in Backup"
              description="Flows only reference the saved credential later."
            />
          </div>
        </div>

        <div className="rounded-xl border border-[rgb(var(--border-line))] bg-surface-1 p-4">
          <div className="text-caption font-emphasis text-text-secondary">Registry coverage</div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <StatTile label="All apps" value={String(totalApps)} />
            <StatTile label="Sources" value={String(APP_CATALOG.filter((app) => app.role === 'source').length)} />
            <StatTile label="Targets" value={String(APP_CATALOG.filter((app) => app.role === 'destination').length)} />
          </div>
          <p className="mt-3 text-tiny leading-5 text-text-tertiary">
            Source and destination are only usage roles. The credential itself stays role-neutral inside Apps.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="w-full max-w-xl">
          <Input
            value={searchText}
            onChange={(event) => onSearchTextChange(event.target.value)}
            placeholder="Filter apps by name, role, or keyword"
            leadingIcon={<Search className="h-4 w-4" />}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FilterTag tone="neutral" active={roleFilter === 'all'} onClick={() => onRoleFilterChange('all')}>
            All
          </FilterTag>
          <FilterTag tone="info" active={roleFilter === 'source'} onClick={() => onRoleFilterChange('source')}>
            Sources
          </FilterTag>
          <FilterTag tone="brand" active={roleFilter === 'destination'} onClick={() => onRoleFilterChange('destination')}>
            Destinations
          </FilterTag>
          <FilterTag tone="neutral" as="span">
            {visibleCount} shown
          </FilterTag>
        </div>
      </div>

      {visibleCount === 0 ? (
        <div className="rounded-xl border border-dashed border-[rgb(var(--border-line))] bg-surface-2 px-6 py-12 text-center">
          <div className="text-small font-strong text-text-primary">No apps match the current filter</div>
          <p className="mt-1 text-caption text-text-tertiary">
            Try another keyword or switch the role filter.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          <AppPickerSection
            label="Source apps"
            description="Credentials that Backup uses to read data from Base products."
            apps={sourceApps}
            onPick={onPick}
          />
          <AppPickerSection
            label="Destination apps"
            description="Credentials that Backup uses to write files to storage destinations."
            apps={destinationApps}
            onPick={onPick}
          />
        </div>
      )}
    </div>
  )
}


function StepTile({ step, title, description }) {
  return (
    <div className="rounded-lg border border-[rgb(var(--border-line))] bg-surface-1 p-3">
      <div className="text-tiny font-emphasis uppercase tracking-[0.14em] text-text-quaternary">{step}</div>
      <div className="mt-2 text-caption font-emphasis text-text-primary">{title}</div>
      <p className="mt-1 text-tiny leading-5 text-text-tertiary">{description}</p>
    </div>
  )
}


function StatTile({ label, value }) {
  return (
    <div className="rounded-lg border border-[rgb(var(--border-line))] bg-surface-2 px-3 py-2.5">
      <div className="text-small font-strong text-text-primary">{value}</div>
      <div className="mt-1 text-tiny text-text-tertiary">{label}</div>
    </div>
  )
}


function AppPickerSection({ label, description, apps, onPick }) {
  if (apps.length === 0) return null

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-caption font-emphasis text-text-primary">{label}</div>
          <div className="mt-0.5 text-tiny text-text-tertiary">{description}</div>
        </div>
        <FilterTag tone="neutral" as="span">
          {apps.length} apps
        </FilterTag>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {apps.map((app) => (
          <button
            key={app.id}
            type="button"
            onClick={() => onPick(app.id)}
            className="group rounded-xl border border-[rgb(var(--border-line))] bg-surface-1 p-4 text-left transition-all hover:border-brand/30 hover:bg-surface-2 hover:shadow-linear-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
                style={{ backgroundColor: `${app.color}18`, color: app.color }}
              >
                {renderIcon(app.icon, 'h-4 w-4')}
              </div>
              <FilterTag tone={ROLE_META[app.role].tone} as="span">
                {ROLE_META[app.role].label}
              </FilterTag>
            </div>

            <div className="mt-4">
              <div className="text-small font-strong text-text-primary">{app.title}</div>
              <p className="mt-1 text-caption leading-6 text-text-tertiary">{app.description}</p>
            </div>

            <div className="mt-4 flex items-center justify-between gap-3 border-t border-[rgb(var(--border-line))] pt-3">
              <span className="text-tiny text-text-tertiary">{ROLE_META[app.role].summary}</span>
              <span className="text-tiny font-emphasis text-brand transition-colors group-hover:text-brand-hover">
                Select
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}


function SelectedAppSummary({ app, isEditMode }) {
  const roleMeta = ROLE_META[app.role]

  return (
    <div className="border-b border-[rgb(var(--border-line))] bg-surface-2 px-5 py-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
            style={{ backgroundColor: `${app.color}18`, color: app.color }}
          >
            {renderIcon(app.icon, 'h-5 w-5')}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-small font-strong text-text-primary">{app.title}</h3>
              <FilterTag tone={roleMeta.tone} as="span">{roleMeta.label}</FilterTag>
            </div>
            <p className="mt-1 text-caption text-text-tertiary">{app.description}</p>
          </div>
        </div>

        <div className="rounded-lg border border-[rgb(var(--border-line))] bg-surface-1 px-3 py-2">
          <div className="flex items-center gap-2 text-caption font-emphasis text-text-primary">
            <Sparkles className="h-3.5 w-3.5 text-brand" />
            {isEditMode ? 'Editing existing credential' : 'Creating reusable credential'}
          </div>
          <div className="mt-1 text-tiny text-text-tertiary">{roleMeta.summary}</div>
        </div>
      </div>
    </div>
  )
}


export default CredentialModal
