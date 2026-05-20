from __future__ import annotations

from importlib import import_module
from typing import Iterable

from modules.connectors.apps._packages import get_app_package, iter_app_packages
from modules.connectors.backend.shared.contracts import ConnectorDefinition


DEFAULT_CONNECTOR_ORDER: tuple[str, ...] = (
    'base_service',
    'base_request',
    'base_workflow',
    'base_wework',
    'gsheets',
    'gdrive',
    'onedrive',
    'bigquery',
    'base_crm',
    'base_hrm',
    'base_table',
    'base_goal',
    'base_income',
    'base_meeting',
    'base_payroll',
    'base_timeoff',
)


def load_connector_definition(connector_key: str) -> ConnectorDefinition:
    package = get_app_package(connector_key)
    module_name = f"modules.connectors.apps.{package.package_name}.definition"
    module = import_module(module_name)
    definition = getattr(module, "CONNECTOR_DEFINITION", None)
    if definition is None:
        raise RuntimeError(f"{module_name} does not expose CONNECTOR_DEFINITION")
    if not isinstance(definition, ConnectorDefinition):
        raise TypeError(f"{module_name}.CONNECTOR_DEFINITION is not a ConnectorDefinition")
    return definition


def load_packaged_connector_definitions(
    connector_order: Iterable[str] = DEFAULT_CONNECTOR_ORDER,
) -> tuple[ConnectorDefinition, ...]:
    definitions: list[ConnectorDefinition] = []
    seen: set[str] = set()

    for connector_key in connector_order:
        definitions.append(load_connector_definition(connector_key))
        seen.add(connector_key)

    for package in iter_app_packages():
        if package.connector_key in seen:
            continue
        definition_module = package.definition_dir / "__init__.py"
        if not definition_module.exists():
            continue
        definitions.append(load_connector_definition(package.connector_key))
        seen.add(package.connector_key)

    return tuple(definitions)
