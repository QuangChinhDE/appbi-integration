import React from 'react'
import { APP_CATALOG, getAppMeta } from '@modules/apps/frontend/constants'


const PIPELINE_STEPS = [
  { key: 'source', label: 'Define source' },
  { key: 'destination', label: 'Define destination' },
  { key: 'streams', label: 'Select streams' },
  { key: 'configure', label: 'Configure connection' },
]

export const WRITE_MODE_OPTIONS = [
  { value: 'append', label: 'Append', description: 'Add new rows — keep existing data intact.' },
  { value: 'replace', label: 'Replace', description: 'Clear target, then write all records.' },
  { value: 'upsert', label: 'Upsert', description: 'Insert new rows, update existing by primary key.' },
]

// AirByte-style high-level sync mode picked at the top of the Select streams step.
// Replicate Source: keep the destination as an up-to-date copy → replace mode.
// Append Historical Changes: track changes over time → append mode.
export const SYNC_MODE_OPTIONS = [
  {
    value: 'replicate',
    label: 'Replicate Source',
    description: 'Maintain an up-to-date copy of your source data in the destination.',
    recommended: true,
    write_mode: 'replace',
  },
  {
    value: 'append_history',
    label: 'Append Historical Changes',
    description: 'Track changes to your data over time. Changes are appended to the destination.',
    write_mode: 'append',
  },
]

export const SCHEDULE_TYPE_OPTIONS = [
  { value: 'manual', label: 'Manual', description: 'Run on demand only.' },
  { value: 'interval', label: 'Scheduled', description: 'Run every N hours.' },
  { value: 'cron', label: 'Cron', description: 'Custom cron expression.' },
]

// Replication frequency presets for the "Scheduled" type (mirrors AirByte UX).
export const REPLICATION_FREQUENCY_OPTIONS = [
  { value: 1, label: 'Every hour' },
  { value: 2, label: 'Every 2 hours' },
  { value: 3, label: 'Every 3 hours' },
  { value: 6, label: 'Every 6 hours' },
  { value: 8, label: 'Every 8 hours' },
  { value: 12, label: 'Every 12 hours' },
  { value: 24, label: 'Every 24 hours' },
]

export const PIPELINE_STATUS_VARIANT = {
  draft:    'warning',
  active:   'success',
  paused:   'warning',
  archived: 'neutral',
}

export const PIPELINE_STATUS_LABEL = {
  draft:    'Draft',
  active:   'Active',
  paused:   'Paused',
  archived: 'Archived',
}

export const RUN_STATUS_VARIANT = {
  pending:   'warning',
  running:   'info',
  completed: 'success',
  failed:    'danger',
}

export const RUN_STATUS_LABEL = {
  pending:   'Pending',
  running:   'Running',
  completed: 'Completed',
  failed:    'Failed',
}

export const RUN_STATUS_PROGRESS = {
  completed: 'success',
  failed:    'exception',
  running:   'active',
  pending:   'normal',
}

export function formatDateTime(value) {
  const parsed = new Date(value || '')
  if (Number.isNaN(parsed.getTime())) return '-'
  return parsed.toLocaleString('en-GB', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

export function formatDateLabel(value) {
  const parsed = new Date(value || '')
  if (Number.isNaN(parsed.getTime())) return '-'
  return parsed.toLocaleDateString('en-GB')
}

export { PIPELINE_STEPS }
