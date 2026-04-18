export const LEVEL_ORDER = {
  none: 0,
  view: 1,
  edit: 2,
  full: 3,
}

export const BACKUP_APPS_PERMISSION_MESSAGE = 'Backup edit and full access require Apps view or higher because Backup reuses saved sources and destinations from Apps.'

const LEGACY_APP_MODULES = ['sources', 'destinations']

export const MODULE_ROUTE_ORDER = [
  { module: 'backup', path: '/backup' },
  { module: 'apps', path: '/apps' },
  { module: 'automation', path: '/automation' },
  { module: 'settings', path: '/settings' },
]

function resolveAppsPermission(permissions) {
  const candidates = ['apps', ...LEGACY_APP_MODULES]
    .map((module) => permissions?.[module])
    .filter((level) => LEVEL_ORDER[level] !== undefined)

  return candidates.reduce((resolved, level) => (
    (LEVEL_ORDER[level] || 0) > (LEVEL_ORDER[resolved] || 0) ? level : resolved
  ), 'none')
}

export function normalizePermissions(permissions) {
  return {
    backup: permissions?.backup || 'none',
    apps: resolveAppsPermission(permissions),
    automation: permissions?.automation || 'none',
    settings: permissions?.settings || 'none',
  }
}

function hasBackupAppsDependencyConflict(normalized) {
  return (LEVEL_ORDER[normalized.backup] || 0) >= LEVEL_ORDER.edit && (LEVEL_ORDER[normalized.apps] || 0) < LEVEL_ORDER.view
}

export function hasBackupAppsPermissionConflict(permissions) {
  return hasBackupAppsDependencyConflict(normalizePermissions(permissions))
}

export function resolvePermissionDependencies(permissions) {
  const normalized = normalizePermissions(permissions)

  if (hasBackupAppsDependencyConflict(normalized)) {
    normalized.apps = 'view'
  }

  return normalized
}

export function hasPermission(permissions, module, minLevel = 'view') {
  const normalized = normalizePermissions(permissions)
  const currentLevel = normalized?.[module] || 'none'
  return (LEVEL_ORDER[currentLevel] || 0) >= (LEVEL_ORDER[minLevel] || 0)
}

export function getFirstAccessibleRoute(permissions) {
  const match = MODULE_ROUTE_ORDER.find((item) => hasPermission(permissions, item.module, 'view'))
  return match?.path || null
}