import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft, Check, ChevronDown, ChevronRight,
  Loader2, Rocket, Search, Trash2, Workflow,
} from 'lucide-react'

import api from '@shared/api/client'
import AppModalShell from '@packages/ui/src/components/common/AppModalShell'
import { Button, Input, Select, message } from '@packages/ui/src/components/common/ui'
import { getAppMeta } from '@modules/apps/frontend/constants'
import {
  PIPELINE_STEPS, WRITE_MODE_OPTIONS, SCHEDULE_TYPE_OPTIONS,
  SYNC_MODE_OPTIONS, REPLICATION_FREQUENCY_OPTIONS,
} from '../constants'
import SyncCatalogTable from './SyncCatalogTable'


const EMPTY_BINDING = {
  source_stream_key: '',
  source_config: {},
  dest_stream_key: '',
  dest_config: {},
  // Airbyte-style 4-way sync mode picked per stream. Defaults to the safest
  // option (full_refresh_append) — incremental requires the connector to have
  // declared a cursor_field, which the wizard checks before enabling.
  sync_mode: 'full_refresh_append',
  write_mode: 'append',
  cursor_field: null,
  primary_key: null,
  // Empty list = pass through every field; populated = keep only listed paths.
  selected_fields: null,
  field_mapping: {},
}

// Per-stream sync mode options shown in the table row dropdown. Mirrors the
// labels Airbyte uses; the wizard maps each to (write_mode, requires_cursor,
// requires_primary_key) so we can enable/disable rows that aren't possible
// with the chosen stream.
const PER_STREAM_SYNC_MODES = [
  {
    value: 'incremental_dedup',
    label: 'Incremental | Append + Deduped',
    write_mode: 'upsert',
    requires_cursor: true,
    requires_primary_key: true,
  },
  {
    value: 'full_refresh_overwrite',
    label: 'Full refresh | Overwrite',
    write_mode: 'replace',
    requires_cursor: false,
    requires_primary_key: false,
  },
  {
    value: 'incremental_append',
    label: 'Incremental | Append',
    write_mode: 'append',
    requires_cursor: true,
    requires_primary_key: false,
  },
  {
    value: 'full_refresh_append',
    label: 'Full refresh | Append',
    write_mode: 'append',
    requires_cursor: false,
    requires_primary_key: false,
  },
]

const EMPTY_DRAFT = {
  name: '',
  description: '',
  source_connector_key: '',
  source_credential_id: '',
  dest_connector_key: '',
  dest_credential_id: '',
  shared_dest_config: {},
  bindings: [{ ...EMPTY_BINDING }],
  schedule: { type: 'manual' },
  // AirByte-style high-level sync mode chosen on the Select streams step.
  // Picked once for the whole connection and applied to every selected stream
  // via SYNC_MODE_OPTIONS[].write_mode at submit time.
  sync_mode: 'replicate',
  // Optional prefix prepended to every destination table/sheet name.
  stream_prefix: '',
}

const SHARED_DEST_FIELD_ALLOWLIST = new Set([
  'dataset_id',
  'database',
  'database_name',
  'schema',
  'schema_name',
  'folder_id',
  'spreadsheet_id',
  'bucket',
  'project_id',
])

const PER_BINDING_DEST_FIELD_DENYLIST = new Set([
  'table_id',
  'sheet_name',
  'file_name',
  'resource_name',
  'merge_key',
  'schema_fields',
])

function getDefaultDestStreamKey(destStreams) {
  const tabular = destStreams.find((stream) => stream.write_config?.target_kind === 'tabular')
  return tabular?.stream_key || destStreams[0]?.stream_key || ''
}

function getSharedDestinationFields(destStreams) {
  const fieldMap = new Map()

  destStreams.forEach((stream) => {
    ;(stream.config_fields || []).forEach((field) => {
      if (PER_BINDING_DEST_FIELD_DENYLIST.has(field.name)) return
      const entry = fieldMap.get(field.name) || { field, count: 0 }
      entry.count += 1
      if (!fieldMap.has(field.name)) entry.field = field
      fieldMap.set(field.name, entry)
    })
  })

  return Array.from(fieldMap.values())
    .filter(({ field, count }) => count > 1 || SHARED_DEST_FIELD_ALLOWLIST.has(field.name))
    .map(({ field }) => field)
}

function describeSyncMode(stream) {
  const syncModes = Array.isArray(stream?.sync_modes) ? stream.sync_modes : []
  if (syncModes.includes('incremental')) return 'Incremental'
  if (syncModes.includes('full_refresh')) return 'Full refresh'
  return 'Manual'
}


// ── Step: Source ─────────────────────────────────────────────────────────────

function StepSource({ draft, setDraft, credentials, sourceApps }) {
  const appCredentials = credentials.filter((c) => c.app_id === draft.source_connector_key)

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
                onClick={() => setDraft((d) => ({
                  ...d,
                  source_connector_key: app.id,
                  source_credential_id: '',
                  bindings: [{ ...EMPTY_BINDING }],
                }))}
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
    </div>
  )
}


// ── Step: Destination ───────────────────────────────────────────────────────

function StepDestination({ draft, setDraft, credentials, destApps }) {
  const appCredentials = credentials.filter((c) => c.app_id === draft.dest_connector_key)

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
                onClick={() => setDraft((d) => ({
                  ...d,
                  dest_connector_key: app.id,
                  dest_credential_id: '',
                  shared_dest_config: {},
                  bindings: d.bindings.map((b) => ({ ...b, dest_stream_key: '', write_mode: 'append' })),
                }))}
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
    </div>
  )
}


// ── Step: Bindings ──────────────────────────────────────────────────────────

function BindingRow({
  binding, index, sourceStreams, destStreams, onChange, onRemove, canRemove,
  sourceConnectorKey, sourceCredentialId,
  sharedDestFieldNames = [],
  hideSourceSelector = false,
}) {
  const destStream = destStreams.find((s) => s.stream_key === binding.dest_stream_key)
  const targetKind = destStream?.write_config?.target_kind || 'tabular'
  const supportedModes = destStream?.write_config?.supported_modes || ['append']
  const effectiveModes = targetKind === 'resource' ? ['append'] : supportedModes
  const sourceStream = sourceStreams.find((s) => s.stream_key === binding.source_stream_key)
  const perBindingDestFields = (destStream?.config_fields || []).filter((field) => !sharedDestFieldNames.includes(field.name))

  const [discovering, setDiscovering] = useState(false)
  const [discoveredFields, setDiscoveredFields] = useState(binding.discovered_fields || [])
  const [discoveryInfo, setDiscoveryInfo] = useState(null)

  const update = (patch) => onChange({ ...binding, ...patch })

  const runDiscovery = async () => {
    if (!binding.source_stream_key) {
      message.error('Pick a source stream first')
      return
    }
    setDiscovering(true)
    try {
      const res = await api.post('/api/pipeline/discover-fields', {
        source_credential_id: sourceCredentialId,
        source_connector_key: sourceConnectorKey,
        source_stream_key: binding.source_stream_key,
        source_config: binding.source_config || {},
        sample_size: 10,
      })
      const fields = res.data?.fields || []
      setDiscoveredFields(fields)
      setDiscoveryInfo({
        sample: res.data?.sample_size || 0,
        total: res.data?.total_records_read || 0,
      })
      onChange({ ...binding, discovered_fields: fields })
      message.success(`Discovered ${fields.length} field(s) from ${res.data?.sample_size || 0} sample record(s)`)
    } catch (err) {
      message.error(err.response?.data?.detail || 'Discovery failed')
    } finally {
      setDiscovering(false)
    }
  }

  const updateMapping = (sourceKey, destColumn) => {
    const mapping = { ...(binding.field_mapping || {}) }
    const trimmed = (destColumn || '').trim()
    if (trimmed) mapping[trimmed] = sourceKey
    else {
      for (const k of Object.keys(mapping)) {
        if (mapping[k] === sourceKey) delete mapping[k]
      }
    }
    update({ field_mapping: mapping })
  }

  const getMappedDestColumn = (sourceKey) => {
    const mapping = binding.field_mapping || {}
    const entry = Object.entries(mapping).find(([, src]) => src === sourceKey)
    return entry?.[0] || ''
  }

  return (
    <div className="rounded-xl border border-[rgb(var(--border-line))] bg-surface-1 p-4 shadow-linear-sm">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-tiny font-emphasis uppercase tracking-wider text-text-quaternary">Binding {index + 1}</span>
        {canRemove && (
          <Button variant="ghost" size="sm" onClick={onRemove} leadingIcon={<Trash2 className="h-3.5 w-3.5" />}>
            Remove
          </Button>
        )}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {hideSourceSelector ? (
          <div>
            <div className="mb-1.5 text-tiny font-emphasis text-text-secondary">Source stream</div>
            <div className="flex min-h-10 items-center rounded-lg border border-[rgb(var(--border-line))] bg-surface-2 px-3 text-caption text-text-primary">
              {sourceStream?.display_name || binding.source_stream_key || '—'}
            </div>
          </div>
        ) : (
          <div>
            <div className="mb-1.5 text-tiny font-emphasis text-text-secondary">Source stream</div>
            <Select value={binding.source_stream_key} onChange={(e) => update({ source_stream_key: e.target.value })}>
              <option value="">Select source stream…</option>
              {sourceStreams.map((s) => (
                <option key={s.stream_key} value={s.stream_key}>{s.display_name}</option>
              ))}
            </Select>
          </div>
        )}
        <div>
          <div className="mb-1.5 text-tiny font-emphasis text-text-secondary">Destination stream</div>
          <Select value={binding.dest_stream_key} onChange={(e) => {
            const nextStream = destStreams.find((s) => s.stream_key === e.target.value)
            update({
              dest_stream_key: e.target.value,
              write_mode: nextStream?.write_config?.default_mode || 'append',
            })
          }}>
            <option value="">Select destination stream…</option>
            {destStreams.map((s) => {
              const kind = s.write_config?.target_kind || 'tabular'
              const suffix = kind === 'resource' ? ' — creates new' : ''
              return <option key={s.stream_key} value={s.stream_key}>{s.display_name}{suffix}</option>
            })}
          </Select>
        </div>
      </div>

      {binding.dest_stream_key && (
        <div className="mt-3">
          <div className="mb-1.5 text-tiny font-emphasis text-text-secondary">Write mode</div>
          <div className="flex flex-wrap gap-2">
            {WRITE_MODE_OPTIONS.filter((opt) => effectiveModes.includes(opt.value)).map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => update({ write_mode: opt.value })}
                className={`rounded-lg border px-3 py-1.5 text-tiny transition-all ${
                  binding.write_mode === opt.value
                    ? 'border-brand/30 bg-brand/10 text-brand'
                    : 'border-[rgb(var(--border-line))] text-text-tertiary hover:bg-surface-2'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {targetKind === 'resource' && (
            <p className="mt-1.5 text-tiny text-text-tertiary">
              Resource destinations create one record per source row. Only append is supported.
            </p>
          )}
        </div>
      )}

      {sourceStream?.config_fields?.length > 0 && (
        <ConfigFieldsSection
          title="Source config"
          fields={sourceStream.config_fields}
          values={binding.source_config}
          onChange={(values) => update({ source_config: values })}
        />
      )}
      {perBindingDestFields.length > 0 && (
        <ConfigFieldsSection
          title="Stream-specific destination config"
          fields={perBindingDestFields}
          values={binding.dest_config}
          onChange={(values) => update({ dest_config: values })}
        />
      )}

      {binding.source_stream_key && (
        <div className="mt-3 border-t border-[rgb(var(--border-line))] pt-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-tiny font-emphasis text-text-secondary">Discover source fields</div>
              <p className="text-tiny text-text-tertiary">
                Test the connection and read a sample. Top-level keys of the first records become available columns.
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={runDiscovery}
              disabled={discovering}
              leadingIcon={discovering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            >
              {discovering ? 'Reading…' : 'Test & discover'}
            </Button>
          </div>

          {discoveredFields.length > 0 && (
            <div className="mt-3">
              {discoveryInfo && (
                <p className="mb-2 text-tiny text-text-tertiary">
                  Sampled {discoveryInfo.sample} of {discoveryInfo.total} record(s). Leave destination column blank to skip a field; empty mapping = pass-through all keys.
                </p>
              )}
              <div className="overflow-hidden rounded-lg border border-[rgb(var(--border-line))]">
                <table className="min-w-full divide-y divide-[rgb(var(--border-line))]">
                  <thead className="bg-surface-2">
                    <tr>
                      <th className="px-3 py-2 text-left text-tiny font-emphasis uppercase tracking-[0.14em] text-text-quaternary">Source key</th>
                      <th className="px-3 py-2 text-left text-tiny font-emphasis uppercase tracking-[0.14em] text-text-quaternary">Type</th>
                      <th className="px-3 py-2 text-left text-tiny font-emphasis uppercase tracking-[0.14em] text-text-quaternary">→ Destination column</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[rgb(var(--border-line))]">
                    {discoveredFields.map((f) => (
                      <tr key={f.name}>
                        <td className="px-3 py-1.5 text-tiny text-text-primary font-mono">{f.name}</td>
                        <td className="px-3 py-1.5 text-tiny text-text-tertiary">{f.type}</td>
                        <td className="px-3 py-1.5">
                          <Input
                            size="sm"
                            placeholder={f.name}
                            value={getMappedDestColumn(f.name)}
                            onChange={(e) => updateMapping(f.name, e.target.value)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ConfigFieldsSection({ title, fields, values, onChange }) {
  return (
    <div className="mt-3 border-t border-[rgb(var(--border-line))] pt-3">
      <div className="mb-1.5 text-tiny font-emphasis text-text-secondary">{title}</div>
      <div className="grid gap-2 md:grid-cols-2">
        {fields.map((f) => (
          <div key={f.name}>
            <div className="mb-1 text-tiny text-text-tertiary">
              {f.name}
              {f.required && <span className="ml-1 text-danger">*</span>}
            </div>
            <Input
              size="sm"
              value={values?.[f.name] || ''}
              placeholder={f.description || f.name}
              onChange={(e) => onChange({ ...(values || {}), [f.name]: e.target.value })}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

function StepBindings({ draft, setDraft, catalogStreams }) {
  const sourceStreams = (catalogStreams[draft.source_connector_key] || [])
    .filter((s) => s.capabilities?.includes('read'))
  const destStreams = (catalogStreams[draft.dest_connector_key] || [])
    .filter((s) => s.write_config != null && ['tabular', 'resource'].includes(s.write_config.target_kind))
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const sharedDestFields = useMemo(() => getSharedDestinationFields(destStreams), [destStreams])
  const sharedDestFieldNames = useMemo(() => sharedDestFields.map((field) => field.name), [sharedDestFields])
  const defaultDestStreamKey = useMemo(() => getDefaultDestStreamKey(destStreams), [destStreams])

  // Apply the connection-level sync_mode to every selected stream binding so
  // backend validation (which keys off write_mode) stays in sync with the
  // AirByte-style radio at the top of the step.
  const syncMode = draft.sync_mode || 'replicate'
  const syncOption = SYNC_MODE_OPTIONS.find((o) => o.value === syncMode) || SYNC_MODE_OPTIONS[0]
  const targetWriteMode = syncOption.write_mode
  const setSyncMode = (nextValue) => {
    const nextOption = SYNC_MODE_OPTIONS.find((o) => o.value === nextValue)
    if (!nextOption) return
    setDraft((d) => {
      const bindings = d.bindings.map((binding) => {
        if (!binding.source_stream_key) return binding
        const destStream = destStreams.find((s) => s.stream_key === binding.dest_stream_key)
        // Resource-kind destinations can only append — clamp regardless of picker.
        const kind = destStream?.write_config?.target_kind || 'tabular'
        const modes = destStream?.write_config?.supported_modes || ['append']
        let writeMode = nextOption.write_mode
        if (kind === 'resource' || !modes.includes(writeMode)) writeMode = 'append'
        return { ...binding, write_mode: writeMode }
      })
      return { ...d, sync_mode: nextValue, bindings }
    })
  }

  const updateBinding = (index, next) => {
    setDraft((d) => {
      const bindings = [...d.bindings]
      bindings[index] = next
      return { ...d, bindings }
    })
  }

  const removeBinding = (index) => {
    setDraft((d) => {
      const bindings = d.bindings.filter((_, i) => i !== index)
      return { ...d, bindings: bindings.length > 0 ? bindings : [{ ...EMPTY_BINDING }] }
    })
  }

  const findBindingIndex = (streamKey) => draft.bindings.findIndex((binding) => binding.source_stream_key === streamKey)

  // Pick the best initial per-stream sync_mode given the connection-level
  // intent + what the stream's catalog actually supports. Falls back to
  // full_refresh variants when the stream has no cursor / primary key.
  const pickInitialPerStreamSyncMode = (stream) => {
    const hasCursor = !!stream.cursor_field
    const hasPK = !!stream.primary_key
    // Replicate Source preference: full_refresh_overwrite (a full mirror).
    if (syncMode === 'replicate') return 'full_refresh_overwrite'
    // Append Historical preference: incremental_append when cursor exists,
    // otherwise full_refresh_append. Dedup is opt-in via the per-stream dropdown.
    if (hasCursor && hasPK) return 'incremental_dedup'
    if (hasCursor) return 'incremental_append'
    return 'full_refresh_append'
  }

  const toggleStream = (streamKey, enabled) => {
    setDraft((d) => {
      const existingIndex = d.bindings.findIndex((binding) => binding.source_stream_key === streamKey)
      if (enabled) {
        if (existingIndex >= 0) return d
        const sourceStream = sourceStreams.find((s) => s.stream_key === streamKey)
        // Default destination is the first tabular stream (e.g. BigQuery 'rows').
        const destStream = destStreams.find((s) => s.stream_key === defaultDestStreamKey)
        const kind = destStream?.write_config?.target_kind || 'tabular'
        const supportedModes = destStream?.write_config?.supported_modes || ['append']

        // Resolve per-stream sync_mode + write_mode given both the source's
        // catalog (cursor/PK) and the destination's supported_modes.
        let perStreamSync = pickInitialPerStreamSyncMode(sourceStream)
        let perStreamOption = PER_STREAM_SYNC_MODES.find((o) => o.value === perStreamSync) || PER_STREAM_SYNC_MODES[3]
        let writeMode = perStreamOption.write_mode
        if (kind === 'resource' || !supportedModes.includes(writeMode)) {
          perStreamSync = 'full_refresh_append'
          writeMode = 'append'
        }

        // Pre-fill table_id from stream key + optional prefix (AirByte parity).
        const tableId = `${(d.stream_prefix || '').trim()}${streamKey}`.toLowerCase()
        const nextBinding = {
          ...EMPTY_BINDING,
          source_stream_key: streamKey,
          dest_stream_key: defaultDestStreamKey,
          dest_config: tableId ? { table_id: tableId } : {},
          sync_mode: perStreamSync,
          write_mode: writeMode,
          cursor_field: sourceStream?.cursor_field || null,
          primary_key: sourceStream?.primary_key ? [sourceStream.primary_key] : null,
          // null selected_fields = pass through every field (default).
          selected_fields: null,
        }
        const bindings = d.bindings.filter((binding) => binding.source_stream_key)
        return { ...d, bindings: [...bindings, nextBinding] }
      }

      if (existingIndex < 0) return d
      const bindings = d.bindings.filter((binding) => binding.source_stream_key !== streamKey)
      return { ...d, bindings: bindings.length > 0 ? bindings : [{ ...EMPTY_BINDING }] }
    })
  }

  // Change the per-stream sync mode picked in the table dropdown. Keeps
  // write_mode aligned with the chosen sync_mode and clamps to 'append' for
  // resource destinations (which only support append regardless of source).
  const setPerStreamSyncMode = (streamKey, nextSyncMode) => {
    const option = PER_STREAM_SYNC_MODES.find((o) => o.value === nextSyncMode)
    if (!option) return
    setDraft((d) => {
      const bindings = d.bindings.map((binding) => {
        if (binding.source_stream_key !== streamKey) return binding
        const destStream = destStreams.find((s) => s.stream_key === binding.dest_stream_key)
        const kind = destStream?.write_config?.target_kind || 'tabular'
        const supportedModes = destStream?.write_config?.supported_modes || ['append']
        let writeMode = option.write_mode
        if (kind === 'resource' || !supportedModes.includes(writeMode)) writeMode = 'append'
        return { ...binding, sync_mode: nextSyncMode, write_mode: writeMode }
      })
      return { ...d, bindings }
    })
  }

  const updateBindingByStreamKey = (streamKey, next) => {
    const index = findBindingIndex(streamKey)
    if (index >= 0) updateBinding(index, next)
  }

  const selectedBindings = draft.bindings.filter((binding) => binding.source_stream_key)

  return (
    <div className="space-y-5">
      {/* ── Sync mode picker (AirByte step 3 header) ─────────────────────── */}
      <div className="rounded-xl border border-[rgb(var(--border-line))] bg-surface-1 p-4 shadow-linear-sm">
        <div className="mb-1 text-small font-emphasis text-text-primary">Select sync mode</div>
        <p className="mb-3 text-tiny text-text-tertiary">How do you want data to be delivered to the destination?</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {SYNC_MODE_OPTIONS.map((opt) => {
            const selected = syncMode === opt.value
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setSyncMode(opt.value)}
                className={`flex items-start gap-3 rounded-xl border p-3 text-left transition-all ${
                  selected
                    ? 'border-brand/40 bg-brand/5 shadow-linear-sm'
                    : 'border-[rgb(var(--border-line))] hover:bg-surface-2'
                }`}
              >
                <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${selected ? 'border-brand bg-brand' : 'border-text-quaternary'}`}>
                  {selected && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-caption font-emphasis text-text-primary">{opt.label}</span>
                    {opt.recommended && (
                      <span className="rounded-full bg-brand/15 px-1.5 py-0.5 text-[10px] font-emphasis uppercase tracking-wider text-brand">Recommended</span>
                    )}
                  </div>
                  <p className="mt-0.5 text-tiny text-text-tertiary">{opt.description}</p>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Select streams (AirByte-style expandable inline catalog) ─────── */}
      <SyncCatalogTable
        sourceStreams={sourceStreams}
        destStreams={destStreams}
        bindings={draft.bindings.filter((b) => b.source_stream_key)}
        destAppId={draft.dest_connector_key}
        streamPrefix={draft.stream_prefix}
        defaultDestStreamKey={defaultDestStreamKey}
        onToggleStream={toggleStream}
        onUpdateBinding={(updated) => {
          const idx = findBindingIndex(updated.source_stream_key)
          if (idx >= 0) updateBinding(idx, updated)
        }}
      />


      {/* ── Advanced settings (per-stream config + field mapping) ───────── */}
      {selectedBindings.length > 0 && (
        <div className="rounded-xl border border-[rgb(var(--border-line))] bg-surface-1 shadow-linear-sm">
          <button
            type="button"
            onClick={() => setAdvancedOpen((open) => !open)}
            className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-surface-2"
          >
            <div>
              <div className="text-caption font-emphasis text-text-primary">Advanced settings</div>
              <p className="text-tiny text-text-tertiary">
                Per-stream destination overrides, field mapping, and source-config tuning. Defaults work for most cases.
              </p>
            </div>
            <ChevronDown className={`h-4 w-4 shrink-0 text-text-tertiary transition-transform ${advancedOpen ? 'rotate-180' : ''}`} />
          </button>
          {advancedOpen && (
            <div className="border-t border-[rgb(var(--border-line))] p-4">
              {sharedDestFields.length > 0 && (
                <div className="mb-4 rounded-lg border border-[rgb(var(--border-line))] bg-surface-2 p-3">
                  <div className="mb-1.5 text-tiny font-emphasis uppercase tracking-wider text-text-quaternary">Shared destination defaults</div>
                  <p className="mb-3 text-tiny text-text-tertiary">
                    Applied to every selected stream unless a stream-specific override is provided below.
                  </p>
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {sharedDestFields.map((field) => (
                      <div key={field.name}>
                        <div className="mb-1 text-tiny text-text-tertiary">
                          {field.name}
                          {field.required && <span className="ml-1 text-danger">*</span>}
                        </div>
                        <Input
                          size="sm"
                          value={draft.shared_dest_config?.[field.name] || ''}
                          placeholder={field.description || field.name}
                          onChange={(e) => setDraft((d) => ({
                            ...d,
                            shared_dest_config: { ...(d.shared_dest_config || {}), [field.name]: e.target.value },
                          }))}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-3">
                {selectedBindings.map((binding) => {
                  const index = findBindingIndex(binding.source_stream_key)
                  return (
                    <BindingRow
                      key={binding.source_stream_key}
                      binding={binding}
                      index={index}
                      sourceStreams={sourceStreams}
                      destStreams={destStreams}
                      sourceConnectorKey={draft.source_connector_key}
                      sourceCredentialId={draft.source_credential_id}
                      sharedDestFieldNames={sharedDestFieldNames}
                      hideSourceSelector
                      onChange={(next) => updateBinding(index, next)}
                      onRemove={() => removeBinding(index)}
                      canRemove={selectedBindings.length > 1}
                    />
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}


// ── Step: Configure connection (AirByte step 4) ─────────────────────────────
//
// Final step before submit. Mirrors AirByte's "Configure connection" panel:
// connection name, schedule, replication frequency, destination namespace
// (= dataset_id for warehouse destinations), and an optional stream prefix.
// Replaces the legacy separate Schedule + Review steps.

function StepConfigure({ draft, setDraft }) {
  const scheduleType = draft.schedule?.type || 'manual'
  const srcMeta = getAppMeta(draft.source_connector_key)
  const dstMeta = getAppMeta(draft.dest_connector_key)
  const defaultName = `${srcMeta?.title || draft.source_connector_key || 'Source'} → ${dstMeta?.title || draft.dest_connector_key || 'Destination'}`
  // Destination namespace = warehouse dataset/database name. For BigQuery the
  // backend reads dataset_id from shared_dest_config; for Sheets it's folder_id;
  // for others it's a no-op field. Keep the UI generic and store on shared_dest_config.
  const namespaceValue = draft.shared_dest_config?.dataset_id || ''
  const bindingCount = draft.bindings.filter((b) => b.source_stream_key && b.dest_stream_key).length

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-[rgb(var(--border-line))] bg-surface-1 p-4 shadow-linear-sm">
        <div className="mb-3 text-small font-emphasis text-text-primary">Configure connection</div>

        <ConfigRow
          label="Connection name"
          help="Name for your connection"
        >
          <Input
            value={draft.name}
            placeholder={defaultName}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          />
        </ConfigRow>

        <ConfigRow
          label="Schedule type"
          help="How you want your syncs to be triggered"
        >
          <Select
            value={scheduleType}
            onChange={(e) => {
              const next = e.target.value
              setDraft((d) => ({
                ...d,
                schedule: next === 'interval'
                  ? { type: 'interval', interval_hours: d.schedule?.interval_hours || 24 }
                  : next === 'cron'
                    ? { type: 'cron', cron: d.schedule?.cron || '' }
                    : { type: 'manual' },
              }))
            }}
          >
            {SCHEDULE_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label === 'Interval' ? 'Scheduled' : opt.label}</option>
            ))}
          </Select>
        </ConfigRow>

        {scheduleType === 'interval' && (
          <ConfigRow
            label="Replication frequency"
            help="How often your data will sync to your destination"
          >
            <Select
              value={draft.schedule?.interval_hours || 24}
              onChange={(e) => setDraft((d) => ({
                ...d,
                schedule: { ...d.schedule, type: 'interval', interval_hours: parseInt(e.target.value, 10) || 24 },
              }))}
            >
              {REPLICATION_FREQUENCY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </Select>
          </ConfigRow>
        )}

        {scheduleType === 'cron' && (
          <ConfigRow
            label="Cron expression"
            help="Standard 5-field cron (minute hour day month weekday)"
          >
            <Input
              placeholder="0 */6 * * *"
              value={draft.schedule?.cron || ''}
              onChange={(e) => setDraft((d) => ({ ...d, schedule: { ...d.schedule, type: 'cron', cron: e.target.value } }))}
            />
          </ConfigRow>
        )}

        <ConfigRow
          label="Destination namespace"
          help="The location where the replicated data will be stored in the destination (e.g. BigQuery dataset)"
        >
          <Input
            placeholder="dataset_id"
            value={namespaceValue}
            onChange={(e) => setDraft((d) => ({
              ...d,
              shared_dest_config: { ...(d.shared_dest_config || {}), dataset_id: e.target.value },
            }))}
          />
        </ConfigRow>

        <ConfigRow
          label="Stream prefix"
          help="Optional. Prefix text added to every stream name in the destination"
        >
          <Input
            placeholder="no prefix set"
            value={draft.stream_prefix || ''}
            onChange={(e) => setDraft((d) => ({ ...d, stream_prefix: e.target.value }))}
          />
        </ConfigRow>
      </div>

      <div className="rounded-xl border border-[rgb(var(--border-line))] bg-surface-1 px-4 py-3 text-tiny text-text-tertiary shadow-linear-sm">
        Ready to sync <span className="font-emphasis text-text-primary">{bindingCount}</span> stream(s) from
        <span className="font-emphasis text-text-primary"> {srcMeta?.title || draft.source_connector_key}</span> to
        <span className="font-emphasis text-text-primary"> {dstMeta?.title || draft.dest_connector_key}</span>.
      </div>
    </div>
  )
}

function ConfigRow({ label, help, children }) {
  return (
    <div className="grid gap-2 border-t border-[rgb(var(--border-line))] py-4 first:border-t-0 first:pt-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] md:items-start md:gap-6">
      <div>
        <div className="text-caption font-emphasis text-text-primary">{label}</div>
        {help && <p className="mt-0.5 text-tiny text-text-tertiary">{help}</p>}
      </div>
      <div>{children}</div>
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
  const configuredBindingCount = useMemo(
    () => draft.bindings.filter((binding) => binding.source_stream_key && binding.dest_stream_key).length,
    [draft.bindings],
  )

  const canNext = useMemo(() => {
    if (currentStep === 0) return !!(draft.source_connector_key && draft.source_credential_id)
    if (currentStep === 1) return !!(draft.dest_connector_key && draft.dest_credential_id)
    if (currentStep === 2) {
      // At least one stream must be toggled on (i.e. has a non-empty
      // source_stream_key + dest_stream_key). The wizard starts with a single
      // EMPTY_BINDING placeholder which should not count.
      const configured = draft.bindings.filter((b) => b.source_stream_key && b.dest_stream_key)
      return configured.length > 0
    }
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
      // The wizard tracks sync_mode (AirByte-style) + stream_prefix at the
      // connection level. The backend still operates on per-binding write_mode
      // + dest_config, so we resolve both into the API payload here.
      const { shared_dest_config, sync_mode, stream_prefix, ...draftPayload } = draft
      const syncOption = SYNC_MODE_OPTIONS.find((o) => o.value === sync_mode) || SYNC_MODE_OPTIONS[0]
      const prefix = (stream_prefix || '').trim()

      // Drop the empty placeholder binding the wizard starts with — only
      // toggled-on streams should reach the API. The backend rejects bindings
      // with empty source_stream_key / dest_stream_key.
      const activeBindings = draft.bindings.filter((b) => b.source_stream_key && b.dest_stream_key)
      const payload = {
        ...draftPayload,
        bindings: activeBindings.map(({ discovered_fields, dest_config, field_mapping, write_mode, sync_mode: bindingSyncMode, cursor_field, primary_key, selected_fields, ...rest }) => {
          const mapping = field_mapping || {}
          const hasMapping = Object.keys(mapping).length > 0
          const mergedDestConfig = { ...(draft.shared_dest_config || {}), ...(dest_config || {}) }

          // Auto-apply stream_prefix to table_id if user didn't override explicitly.
          if (prefix && rest.source_stream_key) {
            const currentTable = String(mergedDestConfig.table_id || '').trim()
            const defaultTable = rest.source_stream_key.toLowerCase()
            // Only prefix when table_id matches the default (or is empty).
            if (!currentTable || currentTable === defaultTable) {
              mergedDestConfig.table_id = `${prefix}${defaultTable}`
            }
          }

          let schemaFields = null
          if (Array.isArray(discovered_fields) && discovered_fields.length > 0) {
            if (hasMapping) {
              schemaFields = Object.entries(mapping).map(([destCol, srcKey]) => {
                const src = discovered_fields.find((f) => f.name === srcKey)
                return { name: destCol, type: src?.type || 'string' }
              })
            } else {
              schemaFields = discovered_fields.map((f) => ({ name: f.name, type: f.type }))
            }
          }

          // Resolve the per-binding sync_mode + write_mode. Per-stream sync_mode
          // (set in the table dropdown / Fields modal) wins; fall back to the
          // connection-level sync_mode the user picked at the top of step 3.
          const finalSyncMode = bindingSyncMode
            || (syncOption.value === 'replicate' ? 'full_refresh_overwrite' : 'full_refresh_append')
          const finalOption = PER_STREAM_SYNC_MODES.find((o) => o.value === finalSyncMode) || PER_STREAM_SYNC_MODES[3]

          const destStreamPayload = (catalogStreams[draft.dest_connector_key] || [])
            .find((s) => s.stream_key === rest.dest_stream_key)
          const kind = destStreamPayload?.write_config?.target_kind || 'tabular'
          const supportedModes = destStreamPayload?.write_config?.supported_modes || ['append']
          let resolvedWriteMode = write_mode || finalOption.write_mode
          if (kind === 'resource' || !supportedModes.includes(resolvedWriteMode)) {
            resolvedWriteMode = 'append'
          }

          return {
            ...rest,
            sync_mode: finalSyncMode,
            write_mode: resolvedWriteMode,
            cursor_field: cursor_field || null,
            primary_key: Array.isArray(primary_key) && primary_key.length > 0 ? primary_key : null,
            // selected_fields: null means pass-through; empty list means user
            // explicitly disabled every field (rare, but we preserve intent).
            selected_fields: Array.isArray(selected_fields) ? selected_fields : null,
            field_mapping: mapping,
            dest_config: schemaFields ? { ...mergedDestConfig, schema_fields: schemaFields } : mergedDestConfig,
          }
        }),
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
  }, [draft, catalogStreams, onSaved])

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
      case 0: return <StepSource draft={draft} setDraft={setDraft} credentials={credentials} sourceApps={sourceApps} />
      case 1: return <StepDestination draft={draft} setDraft={setDraft} credentials={credentials} destApps={destApps} />
      case 2: return <StepBindings draft={draft} setDraft={setDraft} catalogStreams={catalogStreams} />
      case 3: return <StepConfigure draft={draft} setDraft={setDraft} />
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
      description="Define source, destination, streams to sync, and connection settings."
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
                Follow the steps to define source, destination, select streams, and configure the connection.
              </p>
            </div>
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
                {dstMeta && (
                  <div className="flex items-center gap-2">
                    <span style={{ color: dstMeta.color }}>{dstMeta.icon && React.cloneElement(dstMeta.icon, { className: 'w-3.5 h-3.5' })}</span>
                    <span className="text-caption font-strong" style={{ color: dstMeta.color }}>{dstMeta.title}</span>
                  </div>
                )}
                {currentStep >= 2 && configuredBindingCount > 0 && (
                  <div className="text-tiny text-text-tertiary">{configuredBindingCount} binding(s)</div>
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
            {renderStepContent()}
          </div>
        </div>
      </div>
    </AppModalShell>
  )
}

export default PipelineWizard
