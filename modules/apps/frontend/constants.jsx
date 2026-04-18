import React from 'react'

import { APPS, DESTINATION_OPTIONS } from '@modules/backup/frontend/constants'

const GDRIVE = DESTINATION_OPTIONS.find((option) => option.id === 'gdrive')
const GSHEETS = DESTINATION_OPTIONS.find((option) => option.id === 'gsheets')

/** Catalog of every app the Apps module can hold a credential for.
 * Both the in-modal picker and any list/filter UIs should read from here. */
export const APP_CATALOG = [
  {
    id: 'request',
    title: APPS.request.name,
    description: 'Base Request — save multiple token credentials for reuse.',
    icon: APPS.request.icon,
    color: APPS.request.color,
    role: 'source',
  },
  {
    id: 'service',
    title: APPS.service.name,
    description: 'Base Service — save multiple token credentials for reuse.',
    icon: APPS.service.icon,
    color: APPS.service.color,
    role: 'source',
  },
  {
    id: 'workflow',
    title: APPS.workflow.name,
    description: 'Base Workflow — save multiple token credentials for reuse.',
    icon: APPS.workflow.icon,
    color: APPS.workflow.color,
    role: 'source',
  },
  {
    id: 'wework',
    title: APPS.wework.name,
    description: 'Base WeWork — save multiple token credentials for reuse.',
    icon: APPS.wework.icon,
    color: APPS.wework.color,
    role: 'source',
  },
  {
    id: 'gdrive',
    title: GDRIVE?.title || 'Google Drive',
    description: GDRIVE?.desc || 'Save multiple Drive storage profiles, pick one per backup flow.',
    icon: GDRIVE?.icon,
    color: GDRIVE?.color || '#1a73e8',
    role: 'destination',
  },
  {
    id: 'gsheets',
    title: GSHEETS?.title || 'Google Sheets',
    description: GSHEETS?.desc || 'Save multiple Sheets storage profiles, pick one per backup flow.',
    icon: GSHEETS?.icon,
    color: GSHEETS?.color || '#0f9d58',
    role: 'destination',
  },
]

export const SOURCE_APP_IDS = new Set(APP_CATALOG.filter((app) => app.role === 'source').map((app) => app.id))
export const DESTINATION_APP_IDS = new Set(APP_CATALOG.filter((app) => app.role === 'destination').map((app) => app.id))

export function getAppMeta(appId) {
  return APP_CATALOG.find((app) => app.id === appId)
}
