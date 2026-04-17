from __future__ import annotations

from typing import Dict, List


LEVEL_ORDER: Dict[str, int] = {'none': 0, 'view': 1, 'edit': 2, 'full': 3}

MODULES: List[str] = [
    'backup',
    'apps',
    'automation',
    'settings',
]

MODULE_ALLOWED_LEVELS: Dict[str, List[str]] = {
    'backup': ['none', 'view', 'edit', 'full'],
    'apps': ['none', 'view', 'edit', 'full'],
    'automation': ['none', 'view', 'edit', 'full'],
    'settings': ['none', 'full'],
}

LEGACY_APP_MODULES: List[str] = ['sources', 'destinations']


def _highest_permission_level(levels: List[str]) -> str:
    resolved = 'none'
    for level in levels:
        if LEVEL_ORDER.get(level, 0) > LEVEL_ORDER.get(resolved, 0):
            resolved = level
    return resolved


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
        'backup': 'full',
        'apps': 'full',
        'automation': 'full',
        'settings': 'full',
    },
    'editor': {
        'backup': 'edit',
        'apps': 'edit',
        'automation': 'edit',
        'settings': 'none',
    },
    'viewer': {
        'backup': 'view',
        'apps': 'view',
        'automation': 'view',
        'settings': 'none',
    },
    'minimal': {
        'backup': 'view',
        'apps': 'none',
        'automation': 'none',
        'settings': 'none',
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