from importlib import import_module
from typing import Awaitable, Callable

from modules.connectors.apps._packages import canonical_connector_key


BackupRunner = Callable[[str, str], Awaitable[None]]


_RUNNER_SPECS: dict[str, tuple[str, str]] = {
    'base_workflow': ('modules.backup.backend.extractors.workflow_extractor', 'run_workflow_backup'),
    'base_service': ('modules.backup.backend.extractors.service_extractor', 'run_service_backup'),
    'base_wework': ('modules.backup.backend.extractors.wework_extractor', 'run_wework_backup'),
    'base_request': ('modules.backup.backend.extractors.request_extractor', 'run_request_backup'),
}

_DEFAULT_RUNNER_SPEC = (
    'modules.backup.backend.extractors.generic_connector_extractor',
    'run_generic_connector_backup',
)


def get_backup_runner(app_id: str | None) -> BackupRunner:
    module_name, function_name = _RUNNER_SPECS.get(canonical_connector_key(app_id), _DEFAULT_RUNNER_SPEC)
    module = import_module(module_name)
    return getattr(module, function_name)
