from importlib import import_module
from typing import Awaitable, Callable


BackupRunner = Callable[[str, str], Awaitable[None]]


_RUNNER_SPECS: dict[str, tuple[str, str]] = {
    'workflow': ('modules.backup.backend.extractors.workflow_extractor', 'run_workflow_backup'),
    'service': ('modules.backup.backend.extractors.service_extractor', 'run_service_backup'),
    'wework': ('modules.backup.backend.extractors.wework_extractor', 'run_wework_backup'),
    'request': ('modules.backup.backend.extractors.request_extractor', 'run_request_backup'),
}

_DEFAULT_RUNNER_SPEC = (
    'modules.backup.backend.extractors.generic_connector_extractor',
    'run_generic_connector_backup',
)


def get_backup_runner(app_id: str | None) -> BackupRunner:
    module_name, function_name = _RUNNER_SPECS.get(app_id or '', _DEFAULT_RUNNER_SPEC)
    module = import_module(module_name)
    return getattr(module, function_name)