import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft, ArrowRight, Check, ChevronRight,
  Database, Loader2, Workflow,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import api from '@shared/api/client'
import { APP_CATALOG, getAppMeta } from '@modules/apps/frontend/constants'
import { PIPELINE_STEPS, WRITE_MODE_OPTIONS, SCHEDULE_TYPE_OPTIONS } from '@modules/pipeline/frontend/constants'
import AppModalShell from '@packages/ui/src/components/common/AppModalShell'
import { Button, Input, Select, message } from '@packages/ui/src/components/common/ui'
import AppLayout from '@packages/ui/src/components/layout/AppLayout'


const SOURCE_APPS = APP_CATALOG.filter((a) => a.role === 'source')
const DEST_APPS = APP_CATALOG.filter((a) => a.role === 'destination')

const EMPTY_PIPELINE = {
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


// ── Step Components ──────────────────────────────────────────────────────────

function StepSource({ draft, setDraft, credentials, catalogStreams }) {
  const selectedApp = getAppMeta(draft.source_connector_key)
  const appCredentials = credentials.filter((c) => c.app_id === draft.source_connector_key)
  const sourceStreams = catalogStreams[draft.source_connector_key] || []

  return (
    <div className="space-y-6">
      <div>
        <label className="mb-2 block text-caption font-emphasis text-text-primary">Source App</label>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SOURCE_APPS.map((app) => (
            <button
              key={app.id}
              type="button"
              onClick={() => setDraft((d) => ({
                ...d,
                source_connector_key: app.id,
                source_credential_id: '',
                source_streams: [],
              }))}
              className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                draft.source_connector_key === app.id
                  ? 'border-brand bg-brand/5 ring-1 ring-brand/20'
                  : 'border-[rgb(var(--border-line))] hover:border-brand/30'
              }`}
            >
              <div
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                style={{ backgroundColor: app.color + '18', color: app.color }}
              >
                {app.icon}
              </div>
              <div className="min-w-0">
                <div className="text-caption font-emphasis text-text-primary">{app.title}</div>
                <div className="truncate text-tiny text-text-tertiary">{app.description}</div>
              </div>
              {draft.source_connector_key === app.id && (
                <Check className="ml-auto h-4 w-4 shrink-0 text-brand" />
              )}
            </button>
          ))}
        </div>
      </div>

      {draft.source_connector_key && (
        <div>
          <label className="mb-2 block text-caption font-emphasis text-text-primary">
            Credential
          </label>
          {appCredentials.length > 0 ? (
            <Select
              value={draft.source_credential_id}
              onChange={(e) => setDraft((d) => ({ ...d, source_credential_id: e.target.value }))}
            >
              <option value="">Select a saved credential…</option>
              {appCredentials.map((c) => (
                <option key={c.id} value={c.id}>{c.name} — {c.app_name}</option>
              ))}
            </Select>
          ) : (
            <p className="text-caption text-text-tertiary">
              No saved credentials for {selectedApp?.title}. Go to Apps to create one first.
            </p>
          )}
        </div>
      )}

      {draft.source_connector_key && sourceStreams.length > 0 && (
        <div>
          <label className="mb-2 block text-caption font-emphasis text-text-primary">
            Streams to sync
          </label>
          <div className="space-y-2">
            {sourceStreams.filter((s) => s.capabilities?.includes('read')).map((stream) => {
              const checked = draft.source_streams.includes(stream.stream_key)
              return (
                <label
                  key={stream.stream_key}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${
                    checked
                      ? 'border-brand/30 bg-brand/5'
                      : 'border-[rgb(var(--border-line))] hover:bg-surface-2'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      setDraft((d) => ({
                        ...d,
                        source_streams: e.target.checked
                          ? [...d.source_streams, stream.stream_key]
                          : d.source_streams.filter((k) => k !== stream.stream_key),
                      }))
                    }}
                    className="accent-brand"
                  />
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


function StepDestination({ draft, setDraft, credentials, catalogStreams }) {
  const appCredentials = credentials.filter((c) => c.app_id === draft.dest_connector_key)
  const destStreams = (catalogStreams[draft.dest_connector_key] || []).filter(
    (s) => s.write_config != null
  )
  const selectedStream = destStreams.find((s) => s.stream_key === draft.dest_stream_key)
  const supportedModes = selectedStream?.write_config?.supported_modes || ['append']

  return (
    <div className="space-y-6">
      <div>
        <label className="mb-2 block text-caption font-emphasis text-text-primary">Destination App</label>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {DEST_APPS.map((app) => (
            <button
              key={app.id}
              type="button"
              onClick={() => setDraft((d) => ({
                ...d,
                dest_connector_key: app.id,
                dest_credential_id: '',
                dest_stream_key: '',
                write_mode: 'append',
              }))}
              className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                draft.dest_connector_key === app.id
                  ? 'border-brand bg-brand/5 ring-1 ring-brand/20'
                  : 'border-[rgb(var(--border-line))] hover:border-brand/30'
              }`}
            >
              <div
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                style={{ backgroundColor: app.color + '18', color: app.color }}
              >
                {app.icon}
              </div>
              <div className="min-w-0">
                <div className="text-caption font-emphasis text-text-primary">{app.title}</div>
              </div>
              {draft.dest_connector_key === app.id && (
                <Check className="ml-auto h-4 w-4 shrink-0 text-brand" />
              )}
            </button>
          ))}
        </div>
      </div>

      {draft.dest_connector_key && (
        <div>
          <label className="mb-2 block text-caption font-emphasis text-text-primary">Credential</label>
          {appCredentials.length > 0 ? (
            <Select
              value={draft.dest_credential_id}
              onChange={(e) => setDraft((d) => ({ ...d, dest_credential_id: e.target.value }))}
            >
              <option value="">Select a saved credential…</option>
              {appCredentials.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          ) : (
            <p className="text-caption text-text-tertiary">
              No saved credentials. Go to Apps to create one first.
            </p>
          )}
        </div>
      )}

      {destStreams.length > 0 && (
        <div>
          <label className="mb-2 block text-caption font-emphasis text-text-primary">
            Target Stream
          </label>
          <Select
            value={draft.dest_stream_key}
            onChange={(e) => {
              const key = e.target.value
              const stream = destStreams.find((s) => s.stream_key === key)
              setDraft((d) => ({
                ...d,
                dest_stream_key: key,
                write_mode: stream?.write_config?.default_mode || 'append',
              }))
            }}
          >
            <option value="">Select target stream…</option>
            {destStreams.map((s) => (
              <option key={s.stream_key} value={s.stream_key}>{s.display_name}</option>
            ))}
          </Select>
        </div>
      )}

      {draft.dest_stream_key && (
        <div>
          <label className="mb-2 block text-caption font-emphasis text-text-primary">Write Mode</label>
          <div className="space-y-2">
            {WRITE_MODE_OPTIONS.filter((opt) => supportedModes.includes(opt.value)).map((opt) => (
              <label
                key={opt.value}
                className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${
                  draft.write_mode === opt.value
                    ? 'border-brand/30 bg-brand/5'
                    : 'border-[rgb(var(--border-line))] hover:bg-surface-2'
                }`}
              >
                <input
                  type="radio"
                  name="write_mode"
                  value={opt.value}
                  checked={draft.write_mode === opt.value}
                  onChange={() => setDraft((d) => ({ ...d, write_mode: opt.value }))}
                  className="accent-brand"
                />
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


function StepMapping({ draft, setDraft, catalogStreams }) {
  const sourceStreams = catalogStreams[draft.source_connector_key] || []
  const destStreams = catalogStreams[draft.dest_connector_key] || []
  const destStream = destStreams.find((s) => s.stream_key === draft.dest_stream_key)
  const destSupportsSchema = destStream?.write_config?.supports_dynamic_schema !== false

  const selectedSourceStreams = sourceStreams.filter((s) =>
    draft.source_streams.includes(s.stream_key)
  )
  const sourceFields = selectedSourceStreams.flatMap((s) =>
    (s.schema_fields || []).map((f) => ({ ...f, stream: s.stream_key }))
  )

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-caption font-emphasis text-text-primary">Field Mapping</h3>
        <p className="mt-1 text-tiny text-text-tertiary">
          {destSupportsSchema
            ? 'Fields will be discovered dynamically at each run. You can set custom mappings below or leave blank for auto-mapping.'
            : 'Destination requires a fixed schema. Map source fields to target columns.'}
        </p>
      </div>

      {sourceFields.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-[rgb(var(--border-line))]">
          <table className="min-w-full divide-y divide-[rgb(var(--border-line))]">
            <thead className="bg-surface-2">
              <tr>
                <th className="px-4 py-2 text-left text-tiny font-emphasis uppercase text-text-quaternary">Source Field</th>
                <th className="px-4 py-2 text-left text-tiny font-emphasis uppercase text-text-quaternary">Stream</th>
                <th className="px-4 py-2 text-left text-tiny font-emphasis uppercase text-text-quaternary">Type</th>
                <th className="px-4 py-2 text-left text-tiny font-emphasis uppercase text-text-quaternary">→ Destination Field</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[rgb(var(--border-line))]">
              {sourceFields.map((field, idx) => (
                <tr key={`${field.stream}-${field.name}-${idx}`} className="hover:bg-surface-2">
                  <td className="px-4 py-2 text-caption text-text-primary">{field.name}</td>
                  <td className="px-4 py-2 text-tiny text-text-tertiary">{field.stream}</td>
                  <td className="px-4 py-2 text-tiny text-text-tertiary">{field.type || 'string'}</td>
                  <td className="px-4 py-2">
                    <Input
                      size="sm"
                      placeholder={field.name}
                      value={draft.field_mapping?.[`${field.stream}.${field.name}`] || ''}
                      onChange={(e) => {
                        const key = `${field.stream}.${field.name}`
                        setDraft((d) => ({
                          ...d,
                          field_mapping: { ...(d.field_mapping || {}), [key]: e.target.value },
                        }))
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-[rgb(var(--border-line))] bg-surface-2 px-6 py-8 text-center">
          <p className="text-caption text-text-tertiary">
            Source streams have no declared schema fields. Fields will be discovered at runtime — auto-mapping will be used.
          </p>
        </div>
      )}
    </div>
  )
}


function StepSchedule({ draft, setDraft }) {
  const scheduleType = draft.schedule?.type || 'manual'

  return (
    <div className="space-y-6">
      <div>
        <label className="mb-2 block text-caption font-emphasis text-text-primary">Schedule Type</label>
        <div className="space-y-2">
          {SCHEDULE_TYPE_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${
                scheduleType === opt.value
                  ? 'border-brand/30 bg-brand/5'
                  : 'border-[rgb(var(--border-line))] hover:bg-surface-2'
              }`}
            >
              <input
                type="radio"
                name="schedule_type"
                value={opt.value}
                checked={scheduleType === opt.value}
                onChange={() => setDraft((d) => ({ ...d, schedule: { type: opt.value } }))}
                className="accent-brand"
              />
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
          <label className="mb-2 block text-caption font-emphasis text-text-primary">
            Run every (hours)
          </label>
          <Input
            type="number"
            min={1}
            max={168}
            value={draft.schedule?.interval_hours || 24}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                schedule: { ...d.schedule, interval_hours: parseInt(e.target.value, 10) || 24 },
              }))
            }
          />
        </div>
      )}

      {scheduleType === 'cron' && (
        <div>
          <label className="mb-2 block text-caption font-emphasis text-text-primary">
            Cron Expression
          </label>
          <Input
            placeholder="0 */6 * * *"
            value={draft.schedule?.cron || ''}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                schedule: { ...d.schedule, cron: e.target.value },
              }))
            }
          />
          <p className="mt-1 text-tiny text-text-tertiary">Standard 5-field cron (minute hour day month weekday)</p>
        </div>
      )}
    </div>
  )
}


function StepReview({ draft }) {
  const sourceMeta = getAppMeta(draft.source_connector_key)
  const destMeta = getAppMeta(draft.dest_connector_key)

  const sections = [
    { label: 'Name', value: draft.name || '—' },
    { label: 'Source', value: sourceMeta?.title || draft.source_connector_key },
    { label: 'Streams', value: draft.source_streams.join(', ') || '—' },
    { label: 'Destination', value: destMeta?.title || draft.dest_connector_key },
    { label: 'Target Stream', value: draft.dest_stream_key || '—' },
    { label: 'Write Mode', value: draft.write_mode },
    { label: 'Schedule', value: draft.schedule?.type || 'manual' },
  ]

  return (
    <div className="space-y-4">
      <h3 className="text-caption font-emphasis text-text-primary">Review Pipeline Configuration</h3>
      <div className="divide-y divide-[rgb(var(--border-line))] rounded-lg border border-[rgb(var(--border-line))]">
        {sections.map((s) => (
          <div key={s.label} className="flex items-center justify-between px-4 py-3">
            <span className="text-caption text-text-tertiary">{s.label}</span>
            <span className="text-caption font-emphasis text-text-primary">{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}


// ── Main Wizard ──────────────────────────────────────────────────────────────

export default function PipelineCreatePage() {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [draft, setDraft] = useState({ ...EMPTY_PIPELINE })
  const [credentials, setCredentials] = useState([])
  const [catalogStreams, setCatalogStreams] = useState({})
  const [saving, setSaving] = useState(false)

  // Load credentials + catalog once
  useEffect(() => {
    const load = async () => {
      try {
        const [credRes, catalogRes] = await Promise.all([
          api.get('/api/apps/credentials'),
          api.get('/api/connectors/catalog'),
        ])
        setCredentials(Array.isArray(credRes.data) ? credRes.data : credRes.data?.items || [])
        // Build a map: connector_key → streams[]
        const catalog = Array.isArray(catalogRes.data) ? catalogRes.data : catalogRes.data?.connectors || []
        const streamMap = {}
        for (const c of catalog) {
          streamMap[c.connector_key] = c.streams || []
        }
        setCatalogStreams(streamMap)
      } catch {
        message.error('Failed to load catalog data')
      }
    }
    load()
  }, [])

  const currentStep = PIPELINE_STEPS[step]

  const canNext = useMemo(() => {
    if (step === 0) return draft.source_connector_key && draft.source_streams.length > 0
    if (step === 1) return draft.dest_connector_key && draft.dest_stream_key
    if (step === 2) return true // mapping is optional
    if (step === 3) return true // schedule defaults to manual
    return true
  }, [step, draft])

  const handleCreate = useCallback(async () => {
    setSaving(true)
    try {
      const payload = {
        ...draft,
        name: draft.name || `${getAppMeta(draft.source_connector_key)?.title} → ${getAppMeta(draft.dest_connector_key)?.title}`,
        status: 'draft',
      }
      const { data } = await api.post('/api/pipeline/pipelines', payload)
      message.success('Pipeline created')
      navigate(`/pipeline/detail/${data.id}`)
    } catch (err) {
      message.error(err.response?.data?.detail || 'Failed to create pipeline')
    } finally {
      setSaving(false)
    }
  }, [draft, navigate])

  const renderStepContent = () => {
    switch (step) {
      case 0: return <StepSource draft={draft} setDraft={setDraft} credentials={credentials} catalogStreams={catalogStreams} />
      case 1: return <StepDestination draft={draft} setDraft={setDraft} credentials={credentials} catalogStreams={catalogStreams} />
      case 2: return <StepMapping draft={draft} setDraft={setDraft} catalogStreams={catalogStreams} />
      case 3: return <StepSchedule draft={draft} setDraft={setDraft} />
      case 4: return <StepReview draft={draft} />
      default: return null
    }
  }

  return (
    <AppLayout>
      <AppModalShell variant="page">
        <div className="flex min-h-[600px]">
          {/* Left sidebar — step navigator */}
          <div className="w-56 shrink-0 border-r border-[rgb(var(--border-line))] bg-surface-2 p-4">
            <button
              type="button"
              onClick={() => navigate('/pipeline')}
              className="mb-6 flex items-center gap-1.5 text-tiny text-text-tertiary hover:text-text-primary"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Back to Pipeline
            </button>

            <h3 className="mb-4 text-tiny font-emphasis uppercase tracking-wider text-text-quaternary">
              Create Pipeline
            </h3>

            <div className="space-y-1">
              {PIPELINE_STEPS.map((s, idx) => {
                const isActive = idx === step
                const isCompleted = idx < step
                return (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => idx <= step && setStep(idx)}
                    disabled={idx > step}
                    className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-caption transition-colors ${
                      isActive
                        ? 'bg-brand/10 font-emphasis text-brand'
                        : isCompleted
                          ? 'text-text-secondary hover:bg-surface-3'
                          : 'text-text-quaternary'
                    }`}
                  >
                    <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-emphasis ${
                      isActive
                        ? 'bg-brand text-white'
                        : isCompleted
                          ? 'bg-emerald-500 text-white'
                          : 'bg-surface-3 text-text-quaternary'
                    }`}>
                      {isCompleted ? <Check className="h-3 w-3" /> : idx + 1}
                    </div>
                    {s.label}
                  </button>
                )
              })}
            </div>

            {/* Pipeline name input */}
            <div className="mt-6">
              <label className="mb-1 block text-tiny font-emphasis text-text-quaternary">Pipeline Name</label>
              <Input
                size="sm"
                placeholder="My Pipeline"
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              />
            </div>
          </div>

          {/* Right panel — step content */}
          <div className="flex flex-1 flex-col">
            <div className="border-b border-[rgb(var(--border-line))] px-6 py-4">
              <h2 className="text-body font-emphasis text-text-primary">{currentStep.label}</h2>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-6">
              {renderStepContent()}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-[rgb(var(--border-line))] px-6 py-4">
              <Button
                variant="ghost"
                size="sm"
                disabled={step === 0}
                onClick={() => setStep((s) => s - 1)}
              >
                <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back
              </Button>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => navigate('/pipeline')}>
                  Cancel
                </Button>
                {step < PIPELINE_STEPS.length - 1 ? (
                  <Button size="sm" disabled={!canNext} onClick={() => setStep((s) => s + 1)}>
                    Next <ArrowRight className="ml-1 h-3.5 w-3.5" />
                  </Button>
                ) : (
                  <Button size="sm" disabled={saving} onClick={handleCreate}>
                    {saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                    Create Pipeline
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </AppModalShell>
    </AppLayout>
  )
}
