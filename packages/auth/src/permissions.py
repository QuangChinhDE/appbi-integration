from __future__ import annotations

from typing import Dict, List

from packages.auth.src.module_registry import (
    get_dependency_message,
    get_module_allowed_levels,
    get_module_definition,
    get_registered_modules,
    get_registered_module_keys,
)


LEVEL_ORDER: Dict[str, int] = {'none': 0, 'view': 1, 'edit': 2, 'full': 3}

MODULES: List[str] = get_registered_module_keys()
MODULE_ALLOWED_LEVELS: Dict[str, List[str]] = get_module_allowed_levels()
ACTIVE_MODULE_ALLOWED_LEVELS: Dict[str, List[str]] = get_module_allowed_levels(active_only=True)

BACKUP_APPS_PERMISSION_MESSAGE = get_dependency_message('backup', 'apps') or (
    'Backup edit and full access require Apps view or higher because Backup reuses saved '
    'sources and destinations from Apps.'
)
PIPELINE_APPS_PERMISSION_MESSAGE = get_dependency_message('pipeline', 'apps') or (
    'Pipeline edit and full access require Apps view or higher because Pipeline reuses saved '
    'source and destination credentials from Apps.'
)

LEGACY_APP_MODULES: List[str] = list(
    (getattr(get_module_definition('apps'), 'legacy_aliases', ()) or ('sources', 'destinations'))
)


def _highest_permission_level(levels: List[str]) -> str:
    resolved = 'none'
    for level in levels:
        if LEVEL_ORDER.get(level, 0) > LEVEL_ORDER.get(resolved, 0):
            resolved = level
    return resolved


def _best_allowed_level(module: str, preferred_levels: List[str], fallback: str = 'none') -> str:
    allowed = MODULE_ALLOWED_LEVELS.get(module, ['none'])
    for level in preferred_levels:
        if level in allowed:
            return level
    if fallback in allowed:
        return fallback
    return allowed[0] if allowed else 'none'


def _resolve_apps_permission(stored: dict | None) -> str:
    if not isinstance(stored, dict):
        return 'none'

    candidates: List[str] = []
    for module in ['apps', *LEGACY_APP_MODULES]:
        value = stored.get(module)
        if value in MODULE_ALLOWED_LEVELS['apps']:
            candidates.append(value)

    if not candidates:
        return 'none'
    return _highest_permission_level(candidates)


PRESETS: Dict[str, Dict[str, str]] = {
    'admin': {
        module.key: _best_allowed_level(module.key, ['full', 'edit', 'view', 'none'])
        for module in get_registered_modules()
    },
    'editor': {
        module.key: (
            'none'
            if module.key == 'settings'
            else _best_allowed_level(module.key, ['edit', 'view', 'none'])
        )
        for module in get_registered_modules()
    },
    'viewer': {
        module.key: (
            'none'
            if module.key == 'settings'
            else _best_allowed_level(module.key, ['view', 'none'])
        )
        for module in get_registered_modules()
    },
    'minimal': {
        module.key: (
            _best_allowed_level(module.key, ['view', 'none'])
            if module.key == 'backup'
            else 'none'
        )
        for module in get_registered_modules()
    },
}


def default_permissions() -> Dict[str, str]:
    return {module: 'none' for module in MODULES}


def normalize_permissions(stored: dict | None) -> Dict[str, str]:
    normalized = default_permissions()
    normalized['apps'] = _resolve_apps_permission(stored)
    if isinstance(stored, dict):
        for module in MODULES:
            if module == 'apps':
                continue
            value = stored.get(module)
            if value in MODULE_ALLOWED_LEVELS[module]:
                normalized[module] = value
    return normalized


def get_user_permissions(user) -> Dict[str, str]:
    return normalize_permissions(getattr(user, 'permissions', None))


def has_permission(permissions: dict | None, module: str, min_level: str = 'view') -> bool:
    normalized = normalize_permissions(permissions)
    return LEVEL_ORDER.get(normalized.get(module, 'none'), 0) >= LEVEL_ORDER.get(min_level, 0)


def validate_permissions(permissions: Dict[str, str]) -> None:
    for module, level in permissions.items():
        if module not in MODULES:
            raise ValueError(f'Invalid module: {module}')
        if level not in MODULE_ALLOWED_LEVELS[module]:
            raise ValueError(
                f"Invalid level '{level}' for module '{module}'. Allowed: {MODULE_ALLOWED_LEVELS[module]}"
            )


def validate_permission_dependencies(permissions: Dict[str, str]) -> None:
    normalized = normalize_permissions(permissions)

    for module in get_registered_modules():
        current_level = normalized.get(module.key, 'none')
        for dependency in module.dependencies:
            required_level = dependency.min_level or 'view'
            when_min_level = dependency.when_min_level or 'view'
            dependency_level = normalized.get(dependency.module, 'none')
            if LEVEL_ORDER.get(current_level, 0) < LEVEL_ORDER.get(when_min_level, 0):
                continue
            if LEVEL_ORDER.get(dependency_level, 0) >= LEVEL_ORDER.get(required_level, 0):
                continue
            raise ValueError(
                dependency.message
                or (
                    f"{module.label} {when_min_level} and above require {dependency.module} "
                    f"{required_level} or higher."
                )
            )