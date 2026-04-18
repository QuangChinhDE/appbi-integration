import rawRegistry from '@packages/utils/src/module_registry.json'

const RAW_MODULES = Array.isArray(rawRegistry?.modules) ? rawRegistry.modules : []

export const MODULE_REGISTRY = [...RAW_MODULES].sort((left, right) => {
  const leftOrder = Number(left?.nav_order || 0)
  const rightOrder = Number(right?.nav_order || 0)
  return leftOrder - rightOrder
})

const MODULE_MAP = new Map(MODULE_REGISTRY.map((module) => [module.key, module]))

const APPS_MODULE = MODULE_MAP.get('apps')
export const LEGACY_APP_MODULES = Array.isArray(APPS_MODULE?.legacy_aliases) && APPS_MODULE.legacy_aliases.length > 0
  ? APPS_MODULE.legacy_aliases
  : ['sources', 'destinations']

export function getRegisteredModules() {
  return MODULE_REGISTRY
}

export function getRegisteredModule(moduleKey) {
  return MODULE_MAP.get(moduleKey) || null
}

export function getNavigableModules(modules = null) {
  const source = Array.isArray(modules) ? modules : MODULE_REGISTRY
  return [...source]
    .filter((module) => Boolean(module?.route))
    .sort((left, right) => Number(left?.nav_order || 0) - Number(right?.nav_order || 0))
}

export function getDefaultPermissionShape() {
  return Object.fromEntries(MODULE_REGISTRY.map((module) => [module.key, 'none']))
}

export function getModuleLabel(moduleKey) {
  return getRegisteredModule(moduleKey)?.label || moduleKey
}

export function getModuleDependencyRules() {
  return MODULE_REGISTRY.flatMap((module) => (
    Array.isArray(module.dependencies)
      ? module.dependencies
        .filter((dependency) => dependency?.module)
        .map((dependency) => ({
          owner: module.key,
          ownerLabel: module.label,
          module: dependency.module,
          min_level: dependency.min_level || 'view',
          when_min_level: dependency.when_min_level || 'view',
          message: dependency.message || '',
        }))
      : []
  ))
}

export function getPermissionDependencyMessages() {
  return [...new Set(
    getModuleDependencyRules()
      .map((rule) => rule.message)
      .filter(Boolean),
  )]
}

export function getDependencyMessage(ownerModule, dependencyModule) {
  return getModuleDependencyRules().find(
    (rule) => rule.owner === ownerModule && rule.module === dependencyModule,
  )?.message || null
}

export function isRegisteredModule(moduleKey) {
  return MODULE_MAP.has(moduleKey)
}