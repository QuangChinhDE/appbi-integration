import React from 'react'
import { APP_CATALOG, getAppMeta } from '@modules/apps/frontend/constants'


const PIPELINE_STEPS = [
  { key: 'source', label: 'Source' },
  { key: 'destination', label: 'Destination' },
  { key: 'mapping', label: 'Field Mapping' },
  { key: 'schedule', label: 'Schedule' },
  { key: 'review', label: 'Review & Create' },
]

export const WRITE_MODE_OPTIONS = [
  { value: 'append', label: 'Append', description: 'Add new rows — keep existing data intact.' },
  { value: 'replace', label: 'Replace', description: 'Clear target, then write all records.' },
  { value: 'upsert', label: 'Upsert', description: 'Insert new rows, update existing by primary key.' },
]

export const SCHEDULE_TYPE_OPTIONS = [
  { value: 'manual', label: 'Manual', description: 'Run on demand only.' },
  { value: 'interval', label: 'Interval', description: 'Run every N hours.' },
  { value: 'cron', label: 'Cron', description: 'Custom cron expression.' },
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
