from datetime import datetime
from typing import Any, Dict, Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from modules.connectors.backend.shared.catalog import (
    get_google_style_app_ids,
    get_source_style_app_ids,
    get_supported_app_names,
    get_supported_auth_modes,
)


# Apps is a role-neutral credential registry. Which apps exist, how they
# authenticate, and how they group (Base vs Google) is defined in the
# connectors catalog. These helpers are the ONLY way any non-connectors
# module should read that list.

def _supported_apps() -> Dict[str, str]:
    return get_supported_app_names()


def _source_style_apps() -> set[str]:
    return get_source_style_app_ids()


def _google_style_apps() -> set[str]:
    return get_google_style_app_ids()


class _DerivedSet(frozenset):
    """Read-through proxy so legacy `SUPPORTED_APPS[app_id]` / `app in SOURCE_STYLE_APPS`
    usages keep working after the registry changes at import time.

    We intentionally don't cache: the connectors module owns truth, and a
    reload there should be visible immediately.
    """

    def __new__(cls, loader):  # type: ignore[override]
        instance = super().__new__(cls)
        instance._loader = loader
        return instance

    def __contains__(self, item: object) -> bool:  # type: ignore[override]
        return item in self._loader()

    def __iter__(self):  # type: ignore[override]
        return iter(self._loader())

    def __len__(self) -> int:  # type: ignore[override]
        return len(self._loader())


class _DerivedMap(dict):
    def __new__(cls, loader):
        return super().__new__(cls)

    def __init__(self, loader):  # type: ignore[override]
        super().__init__()
        self._loader = loader

    def _snapshot(self) -> Dict[str, str]:
        return self._loader()

    def __contains__(self, key: object) -> bool:  # type: ignore[override]
        return key in self._snapshot()

    def __getitem__(self, key: str) -> str:  # type: ignore[override]
        return self._snapshot()[key]

    def get(self, key, default=None):  # type: ignore[override]
        return self._snapshot().get(key, default)

    def keys(self):  # type: ignore[override]
        return self._snapshot().keys()

    def values(self):  # type: ignore[override]
        return self._snapshot().values()

    def items(self):  # type: ignore[override]
        return self._snapshot().items()

    def __iter__(self):  # type: ignore[override]
        return iter(self._snapshot())

    def __len__(self) -> int:  # type: ignore[override]
        return len(self._snapshot())


SUPPORTED_APPS: Dict[str, str] = _DerivedMap(_supported_apps)
SOURCE_STYLE_APPS = _DerivedSet(_source_style_apps)
GOOGLE_STYLE_APPS = _DerivedSet(_google_style_apps)
SUPPORTED_AUTH_MODES = _DerivedSet(get_supported_auth_modes)


class AppCredentialCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = Field(None, max_length=500)
    app_id: str = Field(..., description="Must be a registered connector key")
    app_name: Optional[str] = Field(None, max_length=100)
    auth: Dict[str, Any] = Field(default_factory=dict)
    config: Optional[Dict[str, Any]] = None

    @field_validator("app_id")
    def validate_app_id(cls, value: str) -> str:
        normalized = str(value or "").strip().lower()
        supported = _supported_apps()
        if normalized not in supported:
            raise ValueError("app_id must be one of: " + ", ".join(sorted(supported)))
        return normalized


class AppCredentialUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = Field(None, max_length=500)
    app_name: Optional[str] = Field(None, max_length=100)
    auth: Optional[Dict[str, Any]] = None
    config: Optional[Dict[str, Any]] = None


class AppCredentialListItem(BaseModel):
    id: UUID
    name: str
    description: Optional[str] = None
    owner_email: Optional[str] = None
    user_permission: Optional[str] = None
    app_id: str
    app_name: str
    auth_mode: str
    # Non-secret preview data, useful for list rendering. Shape depends on the
    # connector's auth spec (e.g. Base apps surface domain; Google apps surface
    # email / folder / drive).
    preview: Dict[str, Any] = Field(default_factory=dict)
    config: Optional[Dict[str, Any]] = None
    created_at: datetime
    updated_at: datetime


class AppCredentialDetail(AppCredentialListItem):
    # Sensitive fields materialized for the edit form. Base apps include the
    # decrypted access_token; Google apps include full auth metadata.
    auth: Dict[str, Any] = Field(default_factory=dict)


class AppCredentialApplyResponse(BaseModel):
    """Runtime payload consumers use to execute a flow with this credential."""
    id: UUID
    owner_email: Optional[str] = None
    user_permission: Optional[str] = None
    app_id: str
    app_name: str
    auth_mode: str
    auth: Dict[str, Any]
    config: Dict[str, Any] = Field(default_factory=dict)
