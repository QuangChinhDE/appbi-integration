import { APPS } from './constants'

export const ACTIVE_BACKUP_RUN_STATUSES = ['pending', 'running']

export function supportsBackupFlowRun(appId) {
  return Boolean(appId && APPS[appId]?.supportsRun)
}

export function isBackupRunActive(status) {
  return ACTIVE_BACKUP_RUN_STATUSES.includes(status)
}

export function getBackupRunSummary(run, fallbackAppId = null) {
  const details = run?.execution_details || {}
  const appId = details.app || fallbackAppId
  const summaryBuilder = appId ? APPS[appId]?.runHistorySummary : null

  if (typeof summaryBuilder === 'function') {
    return summaryBuilder(details)
  }

  return details.structure_path || ''
}