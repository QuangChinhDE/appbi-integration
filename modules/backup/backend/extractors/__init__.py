"""Backup extractors.

All backups go through the generic connector extractor — it reads streams
via the shared ConnectorRuntimeService and writes files through Google Drive.
Per-app extractor modules were removed when the connector contract landed.
"""
from modules.backup.backend.extractors.generic_connector_extractor import run_generic_connector_backup

__all__ = ["run_generic_connector_backup"]
