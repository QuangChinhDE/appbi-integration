"""Backup extractor package.

Keep this package lightweight. Individual runner modules import database and
network dependencies, so eager imports here make unit tests and tooling pay for
the whole runtime just to import a helper module.
"""

__all__ = ["run_generic_connector_backup"]


def __getattr__(name: str):
    if name == "run_generic_connector_backup":
        from modules.backup.backend.extractors.generic_connector_extractor import (
            run_generic_connector_backup,
        )

        return run_generic_connector_backup
    raise AttributeError(name)

