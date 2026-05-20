import React, { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Key, Crosshair } from 'lucide-react'
import {
  flexRender, getCoreRowModel, getExpandedRowModel, useReactTable,
} from '@tanstack/react-table'

import { Input, Select } from '@packages/ui/src/components/common/ui'

// Per-stream sync mode options shown in the table row dropdown.
// Mirrors AirByte's SyncMode dropdown:
//   - incremental_dedup: Incremental | Append + Deduped (cursor + PK)
//   - full_refresh_overwrite: Full refresh | Overwrite
//   - incremental_append: Incremental | Append (cursor only)
//   - full_refresh_append: Full refresh | Append (fallback)
const PER_STREAM_SYNC_MODES = [
  { value: 'incremental_dedup', label: 'Incremental | Append + Deduped', requires_cursor: true, requires_primary_key: true },
  { value: 'full_refresh_overwrite', label: 'Full refresh | Overwrite', requires_cursor: false, requires_primary_key: false },
  { value: 'incremental_append', label: 'Incremental | Append', requires_cursor: true, requires_primary_key: false },
  { value: 'full_refresh_append', label: 'Full refresh | Append', requires_cursor: false, requires_primary_key: false },
]

// Map our backend sync_mode to the (write_mode) destination needs at runtime.
// Resource-kind destinations clamp everything to 'append' (only operation they
// support); the wizard does the clamping on submit, but we mirror the mapping
// here so the dropdown reflects what will actually run.
const SYNC_MODE_TO_WRITE_MODE = {
  incremental_dedup: 'upsert',
  full_refresh_overwrite: 'replace',
  incremental_append: 'append',
  full_refresh_append: 'append',
}

// Build a flat list of fields for one stream including nested dotted paths.
// AirByte uses subRows on the stream row; here we pre-compute the tree so the
// table can expand top-level fields and reveal their children (object types).
function buildFieldTree(schemaFields) {
  if (!Array.isArray(schemaFields) || schemaFields.length === 0) return []
  // Group by top-level: { topName: { field, children: [{name: full, type}] } }
  const groups = new Map()
  for (const f of schemaFields) {
    const head = String(f.name).split('.')[0]
    if (!groups.has(head)) {
      groups.set(head, { topField: null, children: [] })
    }
    const entry = groups.get(head)
    if (f.name === head) {
      entry.topField = { ...f, isNested: false }
    } else {
      entry.children.push({ ...f, isNested: true })
    }
  }
  // If a nested-only group exists without an explicit top entry (rare), infer one.
  const out = []
  for (const [head, { topField, children }] of groups.entries()) {
    const top = topField || { name: head, field_type: 'object', isNested: false }
    out.push({ ...top, children })
  }
  return out
}


// Cell helpers --------------------------------------------------------------

function CursorPill() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-brand/15 px-2 py-0.5 text-tiny font-emphasis text-brand">
      <Crosshair className="h-3 w-3" />
      Cursor
    </span>
  )
}

function PKPill() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-warning/20 px-2 py-0.5 text-tiny font-emphasis text-warning-text">
      <Key className="h-3 w-3" />
      Primary key
    </span>
  )
}


// SyncCatalogTable -----------------------------------------------------------

/**
 * AirByte-style expandable catalog: namespace → streams → fields → nested.
 * Renders one big table where each stream row can expand to show its field
 * rows inline; field rows expose cursor radio + PK checkbox + selection
 * checkbox. Mirrors `airbyte-platform/airbyte-webapp/src/area/connection/
 * components/SyncCatalogTable`.
 */
export default function SyncCatalogTable({
  sourceStreams,
  destStreams,
  bindings,
  destAppId,
  streamPrefix,
  onToggleStream,
  onUpdateBinding,
  defaultDestStreamKey,
}) {
  const [globalFilter, setGlobalFilter] = useState('')
  const [hideDisabled, setHideDisabled] = useState(false)
  const [expanded, setExpanded] = useState({})

  // Pre-compute table data as an array of stream rows. Each stream row carries
  // its binding (or undefined) and a `subRows` array of field rows. We can't
  // pass nested arrays of arbitrary shape to react-table without subRows.
  const data = useMemo(() => {
    return sourceStreams.map((stream) => {
      const binding = bindings.find((b) => b.source_stream_key === stream.stream_key)
      const fields = buildFieldTree(stream.schema_fields)
      const subRows = fields.map((f) => ({
        rowType: 'field',
        streamKey: stream.stream_key,
        field: f,
        // Nested children of this object field become grand-subRows.
        subRows: (f.children || []).map((child) => ({
          rowType: 'nested',
          streamKey: stream.stream_key,
          field: child,
        })),
      }))
      return {
        rowType: 'stream',
        stream,
        binding,
        subRows,
      }
    })
  }, [sourceStreams, bindings])

  // Filter rows. We do client-side filter (hideDisabled + name search) before
  // handing to react-table; react-table's globalFilter would also work but
  // explicit filtering keeps the parent/child relationships intact.
  const filteredData = useMemo(() => {
    const q = globalFilter.trim().toLowerCase()
    return data
      .filter(({ stream, binding }) => {
        if (hideDisabled && !binding) return false
        if (!q) return true
        return [stream.display_name, stream.stream_key]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q))
      })
  }, [data, globalFilter, hideDisabled])

  // Per-stream sync mode change handler. Keeps write_mode aligned and clamps
  // resource destinations to 'append' regardless of the picker.
  const setStreamSyncMode = (streamKey, nextSyncMode) => {
    const binding = bindings.find((b) => b.source_stream_key === streamKey)
    if (!binding) return
    const destStream = destStreams.find((s) => s.stream_key === binding.dest_stream_key)
    const kind = destStream?.write_config?.target_kind || 'tabular'
    const supportedModes = destStream?.write_config?.supported_modes || ['append']
    let writeMode = SYNC_MODE_TO_WRITE_MODE[nextSyncMode] || 'append'
    if (kind === 'resource' || !supportedModes.includes(writeMode)) writeMode = 'append'
    onUpdateBinding({ ...binding, sync_mode: nextSyncMode, write_mode: writeMode })
  }

  const setStreamCursor = (streamKey, fieldName) => {
    const binding = bindings.find((b) => b.source_stream_key === streamKey)
    if (!binding) return
    onUpdateBinding({ ...binding, cursor_field: fieldName })
  }

  const togglePrimaryKey = (streamKey, fieldName) => {
    const binding = bindings.find((b) => b.source_stream_key === streamKey)
    if (!binding) return
    const current = Array.isArray(binding.primary_key) ? binding.primary_key : []
    const next = current.includes(fieldName)
      ? current.filter((n) => n !== fieldName)
      : [...current, fieldName]
    onUpdateBinding({ ...binding, primary_key: next.length > 0 ? next : null })
  }

  const toggleField = (streamKey, fieldName) => {
    const binding = bindings.find((b) => b.source_stream_key === streamKey)
    if (!binding) return
    const allNames = (() => {
      const set = new Set()
      const stream = sourceStreams.find((s) => s.stream_key === streamKey)
      for (const f of stream?.schema_fields || []) set.add(f.name)
      return Array.from(set)
    })()
    const currentSelected = binding.selected_fields // null = all selected
    let next
    if (!currentSelected) {
      // First disable: materialize the full list minus this field.
      next = allNames.filter((n) => n !== fieldName)
    } else if (currentSelected.includes(fieldName)) {
      next = currentSelected.filter((n) => n !== fieldName)
    } else {
      next = [...currentSelected, fieldName]
    }
    // When user re-selects everything, collapse back to null (= all).
    const allSelected = next.length === allNames.length
    onUpdateBinding({ ...binding, selected_fields: allSelected ? null : next })
  }

  const table = useReactTable({
    data: filteredData,
    columns: [], // Headers/cells rendered manually below so the AirByte-like
                 // layout has finer control over cells per rowType.
    state: { expanded },
    onExpandedChange: setExpanded,
    getSubRows: (row) => row.subRows,
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
  })

  return (
    <div className="rounded-xl border border-[rgb(var(--border-line))] bg-surface-1 p-4 shadow-linear-sm">
      <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex-1">
          <div className="mb-1.5 text-small font-emphasis text-text-primary">Select streams</div>
          <Input
            value={globalFilter}
            placeholder="Search stream name"
            onChange={(e) => setGlobalFilter(e.target.value)}
          />
        </div>
        <label className="inline-flex items-center gap-2 pt-6 text-tiny text-text-tertiary lg:pt-0">
          <input
            type="checkbox"
            className="h-4 w-4 accent-brand"
            checked={hideDisabled}
            onChange={(e) => setHideDisabled(e.target.checked)}
          />
          Hide disabled streams
        </label>
      </div>

      <div className="overflow-hidden rounded-xl border border-[rgb(var(--border-line))] bg-surface-1 shadow-linear-sm">
        <table className="min-w-full divide-y divide-[rgb(var(--border-line))]">
          <thead className="bg-surface-2 sticky top-0 z-10">
            <tr>
              <th className="w-12 px-3 py-3 text-left text-tiny font-emphasis uppercase tracking-[0.14em] text-text-quaternary">Sync</th>
              <th className="w-8 px-1 py-3" />
              <th className="px-3 py-3 text-left text-tiny font-emphasis uppercase tracking-[0.14em] text-text-quaternary">Stream / Field</th>
              <th className="px-3 py-3 text-left text-tiny font-emphasis uppercase tracking-[0.14em] text-text-quaternary">Sync mode</th>
              <th className="px-3 py-3 text-left text-tiny font-emphasis uppercase tracking-[0.14em] text-text-quaternary">Primary key</th>
              <th className="px-3 py-3 text-left text-tiny font-emphasis uppercase tracking-[0.14em] text-text-quaternary">Cursor field</th>
              <th className="px-3 py-3 text-right text-tiny font-emphasis uppercase tracking-[0.14em] text-text-quaternary">Fields</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[rgb(var(--border-line))]">
            {table.getRowModel().rows.map((row) => {
              const original = row.original
              if (original.rowType === 'stream') {
                return (
                  <StreamRow
                    key={`stream-${original.stream.stream_key}`}
                    row={row}
                    stream={original.stream}
                    binding={original.binding}
                    destStreams={destStreams}
                    onToggleStream={onToggleStream}
                    onSyncModeChange={setStreamSyncMode}
                  />
                )
              }
              if (original.rowType === 'field') {
                return (
                  <FieldRow
                    key={`field-${original.streamKey}-${original.field.name}`}
                    row={row}
                    streamKey={original.streamKey}
                    field={original.field}
                    binding={bindings.find((b) => b.source_stream_key === original.streamKey)}
                    onToggleField={toggleField}
                    onSetCursor={setStreamCursor}
                    onTogglePK={togglePrimaryKey}
                  />
                )
              }
              if (original.rowType === 'nested') {
                return (
                  <NestedFieldRow
                    key={`nested-${original.streamKey}-${original.field.name}`}
                    streamKey={original.streamKey}
                    field={original.field}
                    binding={bindings.find((b) => b.source_stream_key === original.streamKey)}
                    onToggleField={toggleField}
                  />
                )
              }
              return null
            })}
            {filteredData.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-caption text-text-tertiary">
                  No streams match the current filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}


// StreamRow -----------------------------------------------------------------

function StreamRow({ row, stream, binding, destStreams, onToggleStream, onSyncModeChange }) {
  const enabled = !!binding
  const hasCursor = !!stream.cursor_field
  const hasPK = !!stream.primary_key
  const cursorField = binding?.cursor_field || stream.cursor_field || null
  const pkList = binding?.primary_key || (stream.primary_key ? [stream.primary_key] : [])
  const fieldCount = Array.isArray(stream.schema_fields) ? stream.schema_fields.length : 0
  const selectedCount = binding?.selected_fields?.length ?? fieldCount
  const expandToggle = row.getToggleExpandedHandler()
  const isExpanded = row.getIsExpanded()
  const canExpand = row.getCanExpand()

  return (
    <tr className={enabled ? 'bg-brand/5' : ''}>
      <td className="px-3 py-3">
        <input
          type="checkbox"
          className="h-4 w-4 accent-brand"
          checked={enabled}
          onChange={(e) => onToggleStream(stream.stream_key, e.target.checked)}
        />
      </td>
      <td className="px-1 py-3">
        {canExpand && enabled && (
          <button
            type="button"
            onClick={expandToggle}
            className="text-text-tertiary transition-transform hover:text-text-primary"
            aria-expanded={isExpanded}
          >
            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        )}
      </td>
      <td className="px-3 py-3">
        <div className="text-caption font-emphasis text-text-primary">{stream.display_name}</div>
        <div className="text-tiny text-text-tertiary font-mono">{stream.stream_key}</div>
      </td>
      <td className="px-3 py-3">
        <Select
          value={binding?.sync_mode || 'full_refresh_append'}
          disabled={!enabled}
          onChange={(e) => onSyncModeChange(stream.stream_key, e.target.value)}
        >
          {PER_STREAM_SYNC_MODES.map((opt) => {
            const cursorMissing = opt.requires_cursor && !hasCursor
            const pkMissing = opt.requires_primary_key && !hasPK
            const unsupported = cursorMissing || pkMissing
            const reason = cursorMissing ? ' (no cursor_field)'
              : pkMissing ? ' (no primary_key)' : ''
            return (
              <option key={opt.value} value={opt.value} disabled={unsupported}>
                {opt.label}{reason}
              </option>
            )
          })}
        </Select>
      </td>
      <td className="px-3 py-3 text-tiny text-text-tertiary font-mono">
        {pkList.length > 0 ? (
          <span className="inline-flex items-center gap-1">
            <Key className="h-3 w-3 text-warning" />
            {pkList.join(', ')}
          </span>
        ) : (
          <span className="text-text-quaternary">—</span>
        )}
      </td>
      <td className="px-3 py-3 text-tiny text-text-tertiary font-mono">
        {cursorField ? (
          <span className="inline-flex items-center gap-1">
            <Crosshair className="h-3 w-3 text-brand" />
            {cursorField}
          </span>
        ) : (
          <span className="text-text-quaternary">—</span>
        )}
      </td>
      <td className="px-3 py-3 text-right text-tiny text-text-tertiary">
        {enabled && fieldCount > 0 ? `${selectedCount}/${fieldCount}` : (fieldCount || '—')}
      </td>
    </tr>
  )
}


// FieldRow (top-level field of a selected stream) ---------------------------

function FieldRow({ row, streamKey, field, binding, onToggleField, onSetCursor, onTogglePK }) {
  // Only render field rows for selected (enabled) streams so the table stays
  // compact when the user hasn't picked anything yet.
  if (!binding) return null
  const enabled = binding.selected_fields == null || binding.selected_fields.includes(field.name)
  const isCursor = (binding.cursor_field || '') === field.name
  const isPK = Array.isArray(binding.primary_key) && binding.primary_key.includes(field.name)
  const isObject = field.field_type === 'object' && Array.isArray(field.children) && field.children.length > 0
  const expandToggle = row.getToggleExpandedHandler()
  const isExpanded = row.getIsExpanded()

  return (
    <tr className={enabled ? '' : 'opacity-50'}>
      <td className="px-3 py-2">
        <input
          type="checkbox"
          className="h-3.5 w-3.5 accent-brand"
          checked={enabled}
          onChange={() => onToggleField(streamKey, field.name)}
        />
      </td>
      <td className="px-1 py-2 pl-8">
        {isObject && (
          <button
            type="button"
            onClick={expandToggle}
            className="text-text-tertiary transition-transform hover:text-text-primary"
            aria-expanded={isExpanded}
          >
            {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        )}
      </td>
      <td className="px-3 py-2 pl-6">
        <div className="flex items-center gap-2 text-tiny font-mono text-text-secondary">
          <span className="text-text-quaternary">└</span>
          {field.name}
        </div>
      </td>
      <td className="px-3 py-2 text-tiny text-text-tertiary">{field.field_type || 'string'}</td>
      <td className="px-3 py-2">
        <label className="inline-flex items-center gap-1.5 text-tiny text-text-tertiary">
          <input
            type="checkbox"
            className="h-3.5 w-3.5 accent-warning"
            checked={isPK}
            disabled={!enabled}
            onChange={() => onTogglePK(streamKey, field.name)}
          />
          {isPK && <PKPill />}
        </label>
      </td>
      <td className="px-3 py-2">
        <label className="inline-flex items-center gap-1.5 text-tiny text-text-tertiary">
          <input
            type="radio"
            name={`cursor-${streamKey}`}
            className="h-3.5 w-3.5 accent-brand"
            checked={isCursor}
            disabled={!enabled}
            onChange={() => onSetCursor(streamKey, field.name)}
          />
          {isCursor && <CursorPill />}
        </label>
      </td>
      <td className="px-3 py-2" />
    </tr>
  )
}


// NestedFieldRow (children of an object field) ------------------------------

function NestedFieldRow({ streamKey, field, binding, onToggleField }) {
  if (!binding) return null
  const enabled = binding.selected_fields == null || binding.selected_fields.includes(field.name)
  return (
    <tr className={enabled ? '' : 'opacity-50'}>
      <td className="px-3 py-1.5">
        <input
          type="checkbox"
          className="h-3 w-3 accent-brand"
          checked={enabled}
          onChange={() => onToggleField(streamKey, field.name)}
        />
      </td>
      <td className="px-1 py-1.5" />
      <td className="px-3 py-1.5 pl-12">
        <div className="flex items-center gap-2 text-tiny font-mono text-text-tertiary">
          <span className="text-text-quaternary">└</span>
          {field.name}
        </div>
      </td>
      <td className="px-3 py-1.5 text-tiny text-text-quaternary">{field.field_type || 'string'}</td>
      <td className="px-3 py-1.5" />
      <td className="px-3 py-1.5" />
      <td className="px-3 py-1.5" />
    </tr>
  )
}
