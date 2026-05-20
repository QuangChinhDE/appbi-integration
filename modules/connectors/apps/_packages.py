from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterator


APPS_ROOT = Path(__file__).resolve().parent
DEFINITION_DIR_NAME = "definition"
MANIFEST_FILENAME = "manifest.yaml"

_IGNORED_PACKAGE_DIRS = {"__pycache__"}

LEGACY_BASE_APP_ALIASES: dict[str, str] = {
    "crm": "base_crm",
    "goal": "base_goal",
    "hrm": "base_hrm",
    "income": "base_income",
    "meeting": "base_meeting",
    "payroll": "base_payroll",
    "request": "base_request",
    "service": "base_service",
    "table": "base_table",
    "timeoff": "base_timeoff",
    "wework": "base_wework",
    "workflow": "base_workflow",
}


@dataclass(frozen=True)
class ConnectorAppPackage:
    """Filesystem contract for one connector app package."""

    connector_key: str
    root: Path

    @property
    def package_name(self) -> str:
        return self.root.name

    @property
    def definition_dir(self) -> Path:
        return self.root / DEFINITION_DIR_NAME

    @property
    def connector_path(self) -> Path:
        return self.root / "connector.py"

    @property
    def common_dir(self) -> Path:
        return self.root / "common"

    @property
    def automation_dir(self) -> Path:
        return self.root / "automation"

    @property
    def frontend_dir(self) -> Path:
        return self.root / "frontend"

    @property
    def manifest_candidates(self) -> tuple[Path, ...]:
        # Prefer the normalized definition folder; keep the root manifest path
        # for apps that have not migrated yet.
        return (
            self.definition_dir / MANIFEST_FILENAME,
            self.root / MANIFEST_FILENAME,
        )

    @property
    def manifest_path(self) -> Path | None:
        for candidate in self.manifest_candidates:
            if candidate.exists():
                return candidate
        return None

    def to_payload(self) -> dict[str, object]:
        return {
            "connector_key": self.connector_key,
            "package_name": self.package_name,
            "root": str(self.root),
            "definition_dir": str(self.definition_dir),
            "has_manifest": self.manifest_path is not None,
            "has_connector": self.connector_path.exists(),
            "has_common": self.common_dir.exists(),
            "has_automation": self.automation_dir.exists(),
            "has_frontend": self.frontend_dir.exists(),
        }


def canonical_connector_key(connector_key: str | None) -> str:
    normalized = str(connector_key or "").strip().lower()
    if normalized and (APPS_ROOT / normalized).exists():
        return normalized
    return LEGACY_BASE_APP_ALIASES.get(normalized, normalized)


def connector_key_aliases(connector_key: str | None) -> set[str]:
    canonical = canonical_connector_key(connector_key)
    aliases = {canonical}
    aliases.update(
        legacy_key
        for legacy_key, canonical_key in LEGACY_BASE_APP_ALIASES.items()
        if canonical_key == canonical
        and not (APPS_ROOT / legacy_key).exists()
    )
    return aliases


def iter_app_packages(apps_root: Path = APPS_ROOT) -> Iterator[ConnectorAppPackage]:
    if not apps_root.exists():
        return
    for child in sorted(apps_root.iterdir(), key=lambda item: item.name):
        if (
            not child.is_dir()
            or child.name in _IGNORED_PACKAGE_DIRS
            or child.name.startswith("_")
            or child.name.startswith(".")
        ):
            continue
        yield ConnectorAppPackage(connector_key=child.name, root=child)


def get_app_package(connector_key: str, apps_root: Path = APPS_ROOT) -> ConnectorAppPackage:
    normalized = canonical_connector_key(connector_key)
    exact_root = apps_root / normalized
    return ConnectorAppPackage(connector_key=normalized, root=exact_root)
