import {
  LEGACY_APP_MODULES,
  getDefaultPermissionShape,
  getDependencyMessage,
  getModuleDependencyRules,
  getNavigableModules,
  getRegisteredModule,
  getRegisteredModules,
  getPermissionDependencyMessages,
} from './moduleRegistry'

export const LEVEL_ORDER = {
  none: 0,
  view: 1,
  edit: 2,
  full: 3,
}

export const BACKUP_APPS_PERMISSION_MESSAGE = getDependencyMessage('backup', 'apps')
  || 'Backup edit and full access require Apps view or higher because Backup reuses saved sources and destinations from Apps.'

export const PIPELINE_APPS_PERMISSION_MESSAGE = getDependencyMessage('pipeline', 'apps')
  || 'Pipeline edit and full access require Apps view or higher because Pipeline reuses saved source and destination credentials from Apps.'

export const PERMISSION_DEPENDENCY_MESSAGES = getPermissionDependencyMessages()

function resolveAppsPermission(permissions) {
  const candidates = ['apps', ...LEGACY_APP_MODULES]
    .map((module) => permissions?.[module])
    .filter((level) => LEVEL_ORDER[level] !== undefined)

  return candidates.reduce((resolved, level) => (
    (LEVEL_ORDER[level] || 0) > (LEVEL_ORDER[resolved] || 0) ? level : resolved
  ), 'none')
}

export function normalizePermissions(permissions) {
  const normalized = getDefaultPermissionShape()
  normalized.apps = resolveAppsPermission(permissions)

  for (const module of getRegisteredModules()) {
    if (module.key === 'apps') continue
    const nextLevel = permissions?.[module.key]
    if (Array.isArray(module.levels) && module.levels.includes(nextLevel)) {
      normalized[module.key] = nextLevel
    }
  }

  return normalized
}

function dependencyRules() {
  return getModuleDependencyRules()
}

function hasDependencyConflict(normalized, rule) {
  return (LEVEL_ORDER[normalized?.[rule.owner]] || 0) >= (LEVEL_ORDER[rule.when_min_level] || 0)
    && (LEVEL_ORDER[normalized?.[rule.module]] || 0) < (LEVEL_ORDER[rule.min_level] || 0)
}

export function hasBackupAppsPermissionConflict(permissions) {
  const normalized = normalizePermissions(permissions)
  const rule = dependencyRules().find((item) => item.owner === 'backup' && item.module === 'apps')
  return Boolean(rule && hasDependencyConflict(normalized, rule))
}

export function hasPipelineAppsPermissionConflict(permissions) {
  const normalized = normalizePermissions(permissions)
  const rule = dependencyRules().find((item) => item.owner === 'pipeline' && item.module === 'apps')
  return Boolean(rule && hasDependencyConflict(normalized, rule))
}

export function resolvePermissionDependencies(permissions) {
  const normalized = normalizePermissions(permissions)

  for (const rule of dependencyRules()) {
    if (!hasDependencyConflict(normalized, rule)) continue

    const currentLevel = normalized?.[rule.module] || 'none'
    const requiredLevel = rule.min_level || 'view'
    normalized[rule.module] = (LEVEL_ORDER[currentLevel] || 0) >= (LEVEL_ORDER[requiredLevel] || 0)
      ? currentLevel
      : requiredLevel
  }

  return normalized
}

export function hasPermission(permissions, module, minLevel = 'view') {
  const normalized = normalizePermissions(permissions)
  const currentLevel = normalized?.[module] || 'none'
  return (LEVEL_ORDER[currentLevel] || 0) >= (LEVEL_ORDER[minLevel] || 0)
}

export function isModuleEnabled(activeModules, moduleKey) {
  const modules = Array.isArray(activeModules)
    ? activeModules
    : getRegisteredModules()
  return modules.some((module) => (module?.key || module?.module) === moduleKey)
}

export function hasModuleAccess(activeModules, permissions, module, minLevel = 'view') {
  if (module && !isModuleEnabled(activeModules, module)) {
    return false
  }
  return hasPermission(permissions, module, minLevel)
}

export function getFirstAccessibleRoute(permissions, activeModules = null) {
  const match = getNavigableModules(activeModules).find((item) => hasPermission(permissions, item.key, 'view'))
  return match?.route || null
}

export function getModuleRoute(moduleKey) {
  return getRegisteredModule(moduleKey)?.route || null
}