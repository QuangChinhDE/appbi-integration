import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft, ArrowRight, Check, ChevronRight,
  Clock, Database, Globe, Rocket, Workflow,
} from 'lucide-react'

import api from '@shared/api/client'
import AppModalShell from '@packages/ui/src/components/common/AppModalShell'
import { Button, Input, Select, message } from '@packages/ui/src/components/common/ui'
import { getAppMeta } from '@modules/apps/frontend/constants'
import {
  PIPELINE_STEPS, WRITE_MODE_OPTIONS, SCHEDULE_TYPE_OPTIONS,
} from '../constants'


const EMPTY_DRAFT = {
  name: '',
  description: '',
  source_connector_key: '',
  source_credential_id: '',
  source_streams: [],
  source_config: {},
  dest_connector_key: '',
  dest_credential_id: '',
  dest_stream_key: '',
  dest_config: {},
  write_mode: 'append',
  field_mapping: null,
  schedule: { type: 'manual' },
}


// ── Step: Source ─────────────────────────────────────────────────────────────

function StepSource({ draft, setDraft, credentials, catalogStreams, sourceApps }) {
  const appCredentials = credentials.filter((c) => c.app_id === draft.source_connector_key)
  const sourceStreams = (catalogStreams[draft.source_connector_key] || []).filter(
    (s) => s.capabilities?.includes('read')
  )

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-2 text-[10px] font-emphasis uppercase tracking-wider text-text-quaternary">Source app</div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sourceApps.map((app) => {
            const selected = draft.source_connector_key === app.id
            return (
              <button
                key={app.id}
                type="button"
                onClick={() => setDraft((d) => ({ ...d, source_connector_key: app.id, source_credential_id: '', source_streams: [] }))}
                className={`flex items-center gap-3 rounded-xl border p-3 text-left transition-all ${
                  selected
                    ? 'border-brand/30 bg-brand/5 shadow-linear-sm'
                    : 'border-[rgb(var(--border-line))] hover:border-brand/20 hover:bg-surface-2'
                }`}
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: app.color + '18', color: app.color }}>
                  {app.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-caption font-emphasis text-text-primary">{app.title}</div>
                  <div className="truncate text-tiny text-text-tertiary">{app.description}</div>
                </div>
                {selected && <Check className="h-4 w-4 shrink-0 text-brand" />}
              </button>
            )
          })}
        </div>
      </div>

      {draft.source_connector_key && (
        <div>
          <div className="mb-2 text-[10px] font-emphasis uppercase tracking-wider text-text-quaternary">Source credential</div>
          {appCredentials.length > 0 ? (
            <Select value={draft.source_credential_id} onChange={(e) => setDraft((d) => ({ ...d, source_credential_id: e.target.value }))}>
              <option value="">Select a saved credential…</option>
              {appCredentials.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          ) : (
            <p className="text-caption text-text-tertiary">No saved credentials for this app. Go to Apps to create one first.</p>
          )}
        </div>
      )}

      {draft.source_connector_key && sourceStreams.length > 0 && (
        <div>
          <div className="mb-2 text-[10px] font-emphasis uppercase tracking-wider text-text-quaternary">Streams to sync</div>
          <div className="space-y-2">
            {sourceStreams.map((stream) => {
              const checked = draft.source_streams.includes(stream.stream_key)
              return (
                <label
                  key={stream.stream_key}
                  className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-all ${
                    checked ? 'border-brand/30 bg-brand/5' : 'border-[rgb(var(--border-line))] hover:bg-surface-2'
                  }`}
                >
                   <input type="radio" name="source_stream_key" checked={checked} onChange={() => {
                     setDraft((d) => ({
                       ...d,
                       source_streams: [stream.stream_key],
                     }))
                   }} className="accent-brand" />
                  <div>
                    <div className="text-caption font-emphasis text-text-primary">{stream.display_name}</div>
                    <div className="text-tiny text-text-tertiary">{stream.stream_key}</div>
                  </div>
                </label>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}


// ── Step: Destination ───────────────────────────────────────────────────────

function StepDestination({ draft, setDraft, credentials, catalogStreams, destApps }) {
  const appCredentials = credentials.filter((c) => c.app_id === draft.dest_connector_key)
  const destStreams = (catalogStreams[draft.dest_connector_key] || []).filter((s) => s.write_config != null)
  const selectedStream = destStreams.find((s) => s.stream_key === draft.dest_stream_key)
  const supportedModes = selectedStream?.write_config?.supported_modes || ['append']

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-2 text-[10px] font-emphasis uppercase tracking-wider text-text-quaternary">Destination app</div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {destApps.map((app) => {
            const selected = draft.dest_connector_key === app.id
            return (
              <button
                key={app.id}
                type="button"
                onClick={() => setDraft((d) => ({ ...d, dest_connector_key: app.id, dest_credential_id: '', dest_stream_key: '', write_mode: 'append' }))}
                className={`flex items-center gap-3 rounded-xl border p-3 text-left transition-all ${
                  selected
                    ? 'border-brand/30 bg-brand/5 shadow-linear-sm'
                    : 'border-[rgb(var(--border-line))] hover:border-brand/20 hover:bg-surface-2'
                }`}
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: app.color + '18', color: app.color }}>
                  {app.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-caption font-emphasis text-text-primary">{app.title}</div>
                </div>
                {selected && <Check className="h-4 w-4 shrink-0 text-brand" />}
              </button>
            )
          })}
        </div>
      </div>

      {draft.dest_connector_key && (
        <div>
          <div className="mb-2 text-[10px] font-emphasis uppercase tracking-wider text-text-quaternary">Destination credential</div>
          {appCredentials.length > 0 ? (
            <Select value={draft.dest_credential_id} onChange={(e) => setDraft((d) => ({ ...d, dest_credential_id: e.target.value }))}>
              <option value="">Select a saved credential…</option>
              {appCredentials.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          ) : (
            <p className="text-caption text-text-tertiary">No saved credentials. Go to Apps to create one first.</p>
          )}
        </div>
      )}

      {destStreams.length > 0 && (
        <div>
          <div className="mb-2 text-[10px] font-emphasis uppercase tracking-wider text-text-quaternary">Target stream</div>
          <Select value={draft.dest_stream_key} onChange={(e) => {
            const key = e.target.value
            const stream = destStreams.find((s) => s.stream_key === key)
            setDraft((d) => ({ ...d, dest_stream_key: key, write_mode: stream?.write_config?.default_mode || 'append' }))
          }}>
            <option value="">Select target stream…</option>
            {destStreams.map((s) => <option key={s.stream_key} value={s.stream_key}>{s.display_name}</option>)}
          </Select>
        </div>
      )}

      {draft.dest_stream_key && (
        <div>
          <div className="mb-2 text-[10px] font-emphasis uppercase tracking-wider text-text-quaternary">Write mode</div>
          <div className="space-y-2">
            {WRITE_MODE_OPTIONS.filter((opt) => supportedModes.includes(opt.value)).map((opt) => (
              <label
                key={opt.value}
                className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-all ${
                  draft.write_mode === opt.value ? 'border-brand/30 bg-brand/5' : 'border-[rgb(var(--border-line))] hover:bg-surface-2'
                }`}
              >
                <input type="radio" name="write_mode" value={opt.value} checked={draft.write_mode === opt.value} onChange={() => setDraft((d) => ({ ...d, write_mode: opt.value }))} className="accent-brand" />
                <div>
                  <div className="text-caption font-emphasis text-text-primary">{opt.label}</div>
                  <div className="text-tiny text-text-tertiary">{opt.description}</div>
                </div>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}


// ── Step: Mapping ───────────────────────────────────────────────────────────

function StepMapping({ draft, setDraft, catalogStreams }) {
  const sourceStreams = catalogStreams[draft.source_connector_key] || []
  const selectedSourceStreams = sourceStreams.filter((s) => draft.source_streams.includes(s.stream_key))
  const sourceFields = selectedSourceStreams.flatMap((s) =>
    (s.schema_fields || []).map((f) => ({ ...f, stream: s.stream_key }))
  )

  return (
    <div className="space-y-4">
      <p className="text-caption leading-6 text-text-tertiary">
        Map source fields to destination columns, or leave blank for auto-mapping at runtime.
      </p>

      {sourceFields.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-[rgb(var(--border-line))] bg-surface-1">
          <table className="min-w-full divide-y divide-[rgb(var(--border-line))]">
            <thead className="bg-surface-2">
              <tr>
                <th className="px-6 py-3 text-left text-tiny font-emphasis uppercase tracking-[0.14em] text-text-quaternary">Source field</th>
                <th className="px-6 py-3 text-left text-tiny font-emphasis uppercase tracking-[0.14em] text-text-quaternary">Stream</th>
                <th className="px-6 py-3 text-left text-tiny font-emphasis uppercase tracking-[0.14em] text-text-quaternary">→ Destination field</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[rgb(var(--border-line))]">
              {sourceFields.map((field, idx) => (
                <tr key={`${field.stream}-${field.name}-${idx}`} className="hover:bg-surface-2/70">
                  <td className="px-6 py-2 text-caption text-text-primary">{field.name}</td>
                  <td className="px-6 py-2 text-tiny text-text-tertiary">{field.stream}</td>
                  <td className="px-6 py-2">
                    <Input size="sm" placeholder={field.name}
                      value={draft.field_mapping?.[`${field.stream}.${field.name}`] || ''}
                      onChange={(e) => {
                        const key = `${field.stream}.${field.name}`
                        setDraft((d) => ({ ...d, field_mapping: { ...(d.field_mapping || {}), [key]: e.target.value } }))
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-[rgb(var(--border-line))] bg-surface-1 px-6 py-12 text-center">
          <p className="text-caption text-text-tertiary">Source streams have no declared schema fields. Auto-mapping will be used at runtime.</p>
        </div>
      )}
    </div>
  )
}


// ── Step: Schedule ──────────────────────────────────────────────────────────

function StepSchedule({ draft, setDraft }) {
  const scheduleType = draft.schedule?.type || 'manual'

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-2 text-[10px] font-emphasis uppercase tracking-wider text-text-quaternary">Schedule type</div>
        <div className="space-y-2">
          {SCHEDULE_TYPE_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-all ${
                scheduleType === opt.value ? 'border-brand/30 bg-brand/5' : 'border-[rgb(var(--border-line))] hover:bg-surface-2'
              }`}
            >
              <input type="radio" name="schedule_type" value={opt.value} checked={scheduleType === opt.value} onChange={() => setDraft((d) => ({ ...d, schedule: { type: opt.value } }))} className="accent-brand" />
              <div>
                <div className="text-caption font-emphasis text-text-primary">{opt.label}</div>
                <div className="text-tiny text-text-tertiary">{opt.description}</div>
              </div>
            </label>
          ))}
        </div>
      </div>

      {scheduleType === 'interval' && (
        <div>
          <div className="mb-2 text-[10px] font-emphasis uppercase tracking-wider text-text-quaternary">Run every (hours)</div>
          <Input type="number" min={1} max={168}
            value={draft.schedule?.interval_hours || 24}
            onChange={(e) => setDraft((d) => ({ ...d, schedule: { ...d.schedule, interval_hours: parseInt(e.target.value, 10) || 24 } }))}
          />
        </div>
      )}

      {scheduleType === 'cron' && (
        <div>
          <div className="mb-2 text-[10px] font-emphasis uppercase tracking-wider text-text-quaternary">Cron expression</div>
          <Input placeholder="0 */6 * * *"
            value={draft.schedule?.cron || ''}
            onChange={(e) => setDraft((d) => ({ ...d, schedule: { ...d.schedule, cron: e.target.value } }))}
          />
          <p className="mt-1 text-tiny text-text-tertiary">Standard 5-field cron (minute hour day month weekday)</p>
        </div>
      )}
    </div>
  )
}


// ── Step: Review ────────────────────────────────────────────────────────────

function StepReview({ draft }) {
  const srcMeta = getAppMeta(draft.source_connector_key)
  const dstMeta = getAppMeta(draft.dest_connector_key)

  const sections = [
    { label: 'Pipeline name', value: draft.name || '(Auto-generated)' },
    { label: 'Source app', value: srcMeta?.title || draft.source_connector_key },
    { label: 'Streams', value: draft.source_streams.join(', ') || '-' },
    { label: 'Destination app', value: dstMeta?.title || draft.dest_connector_key },
    { label: 'Target stream', value: draft.dest_stream_key || '-' },
    { label: 'Write mode', value: draft.write_mode },
    { label: 'Schedule', value: draft.schedule?.type || 'manual' },
  ]

  return (
    <div className="space-y-4">
      <div className="divide-y divide-[rgb(var(--border-line))] rounded-xl border border-[rgb(var(--border-line))] bg-surface-1">
        {sections.map((s) => (
          <div key={s.label} className="flex items-center justify-between px-5 py-3">
            <span className="text-caption text-text-tertiary">{s.label}</span>
            <span className="text-caption font-emphasis text-text-primary">{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}


// ── Wizard Shell ────────────────────────────────────────────────────────────

const PipelineWizard = ({ onBack, onSaved }) => {
  const [currentStep, setCurrentStep] = useState(0)
  const [draft, setDraft] = useState({ ...EMPTY_DRAFT })
  const [credentials, setCredentials] = useState([])
  const [catalogStreams, setCatalogStreams] = useState({})
  const [sourceApps, setSourceApps] = useState([])
  const [destApps, setDestApps] = useState([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const load = async () => {
      try {
        const [credRes, overviewRes] = await Promise.all([
          api.get('/api/apps/credentials'),
          api.get('/api/pipeline/overview'),
        ])
        setCredentials(Array.isArray(credRes.data) ? credRes.data : credRes.data?.items || [])
        const overview = overviewRes.data || {}
        const sources = Array.isArray(overview.sources) ? overview.sources : []
        const destinations = Array.isArray(overview.destinations) ? overview.destinations : []
        setSourceApps(sources.map((item) => ({
          ...getAppMeta(item.app_id),
          id: item.app_id,
          title: item.app_name,
          description: item.summary,
        })))
        setDestApps(destinations.map((item) => ({
          ...getAppMeta(item.app_id),
          id: item.app_id,
          title: item.app_name,
          description: item.summary,
        })))
        const streamMap = {}
        for (const item of [...sources, ...destinations]) {
          streamMap[item.app_id] = item.streams || []
        }
        setCatalogStreams(streamMap)
      } catch {
        message.error('Failed to load catalog data')
      }
    }
    load()
  }, [])

  const steps = PIPELINE_STEPS
  const totalSteps = steps.length
  const progressPercent = totalSteps > 1 ? Math.round((currentStep / (totalSteps - 1)) * 100) : 0

  const canNext = useMemo(() => {
    if (currentStep === 0) return draft.source_connector_key && draft.source_credential_id && draft.source_streams.length === 1
    if (currentStep === 1) return draft.dest_connector_key && draft.dest_credential_id && draft.dest_stream_key
    return true
  }, [currentStep, draft])

  const next = useCallback(() => {
    if (currentStep < totalSteps - 1 && canNext) setCurrentStep((s) => s + 1)
  }, [currentStep, totalSteps, canNext])

  const prev = useCallback(() => {
    if (currentStep > 0) setCurrentStep((s) => s - 1)
  }, [currentStep])

  const handleFinish = useCallback(async () => {
    setSaving(true)
    try {
      const payload = {
        ...draft,
        source_stream_key: draft.source_streams[0] || null,
        schedule: {
          ...(draft.schedule || { type: 'manual' }),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        },
        name: draft.name || `${getAppMeta(draft.source_connector_key)?.title || 'Source'} → ${getAppMeta(draft.dest_connector_key)?.title || 'Dest'}`,
        status: 'draft',
      }
      const res = await api.post('/api/pipeline/pipelines', payload)
      if (res.data) {
        message.success('Pipeline created')
        if (typeof onSaved === 'function') onSaved(res.data)
      }
    } catch (err) {
      message.error(err.response?.data?.detail || 'Failed to create pipeline')
    } finally {
      setSaving(false)
    }
  }, [draft, onSaved])

  // Configured summary
  const srcMeta = getAppMeta(draft.source_connector_key)
  const dstMeta = getAppMeta(draft.dest_connector_key)

  const footer = (
    <div className="flex w-full items-center justify-between gap-3">
      <Button variant="secondary" size="md" disabled={currentStep === 0} onClick={prev} leadingIcon={<ArrowLeft className="h-4 w-4" />}>
        Back
      </Button>
      <div className="flex flex-wrap items-center justify-end gap-3">
        {currentStep < totalSteps - 1 && (
          <Button variant="primary" size="md" onClick={next} disabled={!canNext} trailingIcon={<ChevronRight className="h-4 w-4" />}>
            Next
          </Button>
        )}
        {currentStep === totalSteps - 1 && (
          <Button variant="primary" size="md" onClick={handleFinish} disabled={saving} leadingIcon={<Rocket className="h-4 w-4" />}>
            {saving ? 'Creating…' : 'Create Pipeline'}
          </Button>
        )}
      </div>
    </div>
  )

  const renderStepContent = () => {
    switch (currentStep) {
      case 0: return <StepSource draft={draft} setDraft={setDraft} credentials={credentials} catalogStreams={catalogStreams} sourceApps={sourceApps} />
      case 1: return <StepDestination draft={draft} setDraft={setDraft} credentials={credentials} catalogStreams={catalogStreams} destApps={destApps} />
      case 2: return <StepMapping draft={draft} setDraft={setDraft} catalogStreams={catalogStreams} />
      case 3: return <StepSchedule draft={draft} setDraft={setDraft} />
      case 4: return <StepReview draft={draft} />
      default: return null
    }
  }

  return (
    <AppModalShell
      variant="page"
      onClose={onBack}
      leadingAction={(
        <Button variant="secondary" size="sm" onClick={onBack} leadingIcon={<ArrowLeft className="h-4 w-4" />}>
          Back to list
        </Button>
      )}
      title="Create data pipeline"
      description="Configure source, destination, field mapping, and schedule."
      icon={<Workflow className="h-5 w-5" />}
      bodyClassName="px-4 py-4 sm:px-6 lg:px-8 xl:px-10 2xl:px-12"
      footer={footer}
    >
      <div className="grid min-h-[calc(100vh-13rem)] gap-6 xl:grid-cols-[minmax(280px,360px)_minmax(0,1fr)]">
        {/* ── Left sidebar ── */}
        <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-[rgb(var(--border-line))] bg-gradient-to-b from-surface-1 via-brand/5 to-brand/5 shadow-linear-sm">
          <div className="border-b border-[rgb(var(--border-line))] px-5 py-5">
            <div className="inline-flex items-center gap-2 rounded-full border border-brand/20 bg-surface-1/80 px-3 py-1 text-tiny font-strong text-brand">
              <Workflow className="h-3.5 w-3.5" />
              New pipeline
            </div>
            <div className="mt-4">
              <h3 className="text-small font-strong text-text-primary">
                {draft.name || 'Draft your pipeline configuration'}
              </h3>
              <p className="mt-1 text-caption leading-6 text-text-tertiary">
                Follow the steps to configure source, destination, mapping, and schedule.
              </p>
            </div>

            {draft.name && (
              <div className="mt-4 rounded-xl border border-[rgb(var(--border-line))] bg-surface-1/80 px-4 py-3 shadow-linear-sm backdrop-blur">
                <p className="text-tiny font-emphasis uppercase tracking-wide text-text-quaternary">Pipeline name</p>
                <p className="mt-1 truncate text-caption font-strong text-text-secondary">{draft.name}</p>
              </div>
            )}
          </div>

          <div className="border-b border-[rgb(var(--border-line))] px-5 py-4">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-tiny font-emphasis uppercase tracking-wide text-text-quaternary">Progress</span>
              <span className="text-tiny font-strong text-brand">{progressPercent}%</span>
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
                  key={step.key}
                  className={`flex items-start gap-3 rounded-xl px-3 py-3 transition-all ${
                    isActive
                      ? 'border border-brand/20 bg-brand/10 shadow-linear-sm'
                      : isPending
                        ? 'border border-transparent bg-transparent opacity-60'
                        : 'border border-[rgb(var(--border-line))] bg-surface-1/80 hover:bg-surface-1'
                  }`}
                >
                  <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-tiny font-strong transition-all ${
                    isDone ? 'bg-success text-white' : isActive ? 'bg-brand text-white shadow-linear-sm shadow-brand/20' : 'bg-surface-2 text-text-quaternary'
                  }`}>
                    {isDone ? <Check className="h-3.5 w-3.5" /> : idx + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={`text-caption font-strong leading-tight ${isActive ? 'text-brand' : isDone ? 'text-success' : 'text-text-tertiary'}`}>
                      {step.label}
                    </p>
                  </div>
                </div>
              )
            })}
          </nav>

          {/* Configured summary */}
          {currentStep > 0 && (srcMeta || dstMeta) && (
            <div className="mx-3 mb-4 shrink-0 rounded-xl border border-[rgb(var(--border-line))] bg-surface-1/80 p-4 shadow-linear-sm backdrop-blur">
              <p className="text-tiny font-emphasis uppercase tracking-wide text-text-quaternary">Configured</p>
              <div className="mt-3 space-y-2.5">
                {srcMeta && (
                  <div className="flex items-center gap-2">
                    <span style={{ color: srcMeta.color }}>{srcMeta.icon && React.cloneElement(srcMeta.icon, { className: 'w-3.5 h-3.5' })}</span>
                    <span className="text-caption font-strong" style={{ color: srcMeta.color }}>{srcMeta.title}</span>
                  </div>
                )}
                {draft.source_streams.length > 0 && (
                  <div className="text-tiny text-text-tertiary">{draft.source_streams.length} stream(s) selected</div>
                )}
                {dstMeta && (
                  <div className="flex items-center gap-2">
                    <span style={{ color: dstMeta.color }}>{dstMeta.icon && React.cloneElement(dstMeta.icon, { className: 'w-3.5 h-3.5' })}</span>
                    <span className="text-caption font-strong" style={{ color: dstMeta.color }}>{dstMeta.title}</span>
                  </div>
                )}
                {draft.write_mode && draft.write_mode !== 'append' && (
                  <div className="text-tiny text-text-tertiary">Write: {draft.write_mode}</div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Right content ── */}
        <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-[rgb(var(--border-line))] bg-surface-1 shadow-linear-sm">
          <div className="shrink-0 border-b border-[rgb(var(--border-line))] bg-surface-1 px-5 py-4 lg:px-8 xl:px-10">
            <div className="w-full min-w-0">
              <div className="mb-1 flex items-center gap-2 text-tiny font-emphasis uppercase tracking-wide text-text-quaternary">
                <span>Step {currentStep + 1} / {totalSteps}</span>
              </div>
              <h1 className="text-h2 font-strong text-text-primary">{steps[currentStep]?.label || ''}</h1>
            </div>
          </div>

          <div className="flex-1 bg-surface-2 px-5 py-5 lg:min-h-0 lg:overflow-y-auto lg:px-8 xl:px-10">
            {/* Pipeline name input (shown on first step) */}
            {currentStep === 0 && (
              <div className="mb-6">
                <div className="mb-2 text-[10px] font-emphasis uppercase tracking-wider text-text-quaternary">Pipeline name</div>
                <Input placeholder="My data pipeline" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
              </div>
            )}
            {renderStepContent()}
          </div>
        </div>
      </div>
    </AppModalShell>
  )
}

export default PipelineWizard
