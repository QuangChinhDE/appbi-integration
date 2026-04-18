from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class ModuleDependencyRule:
    module: str
    min_level: str = 'view'
    when_min_level: str = 'view'
    message: str = ''


@dataclass(frozen=True)
class ModuleDefinition:
    key: str
    label: str
    route: str | None = None
    description: str | None = None
    icon: str | None = None
    nav_order: int = 0
    levels: tuple[str, ...] = field(default_factory=tuple)
    feature_flag: str | None = None
    default_enabled: bool = True
    legacy_aliases: tuple[str, ...] = field(default_factory=tuple)
    dependencies: tuple[ModuleDependencyRule, ...] = field(default_factory=tuple)

    def to_frontend_payload(self) -> dict[str, Any]:
        return {
            'key': self.key,
            'label': self.label,
            'route': self.route,
            'description': self.description,
            'icon': self.icon,
            'nav_order': self.nav_order,
            'levels': list(self.levels),
        }


def _registry_file_path() -> Path:
    return Path(__file__).resolve().parents[3] / 'packages' / 'utils' / 'src' / 'module_registry.json'


def _coerce_bool(value: str | None, default: bool) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {'1', 'true', 'yes', 'on'}


@lru_cache(maxsize=1)
def _load_registry() -> tuple[ModuleDefinition, ...]:
    raw_payload = json.loads(_registry_file_path().read_text(encoding='utf-8'))
    raw_modules = raw_payload.get('modules') if isinstance(raw_payload, dict) else raw_payload
    modules: list[ModuleDefinition] = []

    if not isinstance(raw_modules, list):
        raise ValueError('module registry must contain a list of modules')

    for item in raw_modules:
        if not isinstance(item, dict):
            continue
        dependencies = tuple(
            ModuleDependencyRule(
                module=str(dep.get('module') or '').strip(),
                min_level=str(dep.get('min_level') or 'view').strip(),
                when_min_level=str(dep.get('when_min_level') or 'view').strip(),
                message=str(dep.get('message') or '').strip(),
            )
            for dep in item.get('dependencies', [])
            if isinstance(dep, dict) and str(dep.get('module') or '').strip()
        )
        levels = tuple(str(level).strip() for level in item.get('levels', []) if str(level).strip())
        modules.append(
            ModuleDefinition(
                key=str(item.get('key') or '').strip(),
                label=str(item.get('label') or item.get('key') or '').strip(),
                route=str(item.get('route')).strip() if item.get('route') else None,
                description=str(item.get('description')).strip() if item.get('description') else None,
                icon=str(item.get('icon')).strip() if item.get('icon') else None,
                nav_order=int(item.get('nav_order') or 0),
                levels=levels,
                feature_flag=str(item.get('feature_flag')).strip() if item.get('feature_flag') else None,
                default_enabled=bool(item.get('default_enabled', True)),
                legacy_aliases=tuple(
                    str(alias).strip() for alias in item.get('legacy_aliases', []) if str(alias).strip()
                ),
                dependencies=dependencies,
            )
        )

    return tuple(sorted((module for module in modules if module.key), key=lambda item: item.nav_order))


def get_registered_modules() -> tuple[ModuleDefinition, ...]:
    return _load_registry()


def get_registered_module_keys() -> list[str]:
    return [module.key for module in get_registered_modules()]


def get_module_definition(module_key: str) -> ModuleDefinition | None:
    normalized = str(module_key or '').strip()
    if not normalized:
        return None
    for module in get_registered_modules():
        if module.key == normalized:
            return module
    return None


def is_module_enabled(module_key: str) -> bool:
    module = get_module_definition(module_key)
    if module is None:
        return False
    if not module.feature_flag:
        return module.default_enabled
    return _coerce_bool(os.getenv(module.feature_flag), module.default_enabled)


def get_active_modules() -> tuple[ModuleDefinition, ...]:
    return tuple(module for module in get_registered_modules() if is_module_enabled(module.key))


def get_module_allowed_levels(*, active_only: bool = False) -> dict[str, list[str]]:
    modules = get_active_modules() if active_only else get_registered_modules()
    return {module.key: list(module.levels) for module in modules}


def get_active_module_payloads() -> list[dict[str, Any]]:
    return [module.to_frontend_payload() for module in get_active_modules()]


def get_dependency_message(module_key: str, dependency_key: str) -> str | None:
    module = get_module_definition(module_key)
    if module is None:
        return None
    for dependency in module.dependencies:
        if dependency.module == dependency_key and dependency.message:
            return dependency.message
    return None
