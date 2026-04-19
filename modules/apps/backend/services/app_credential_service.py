"""Unified credential service owned by the Apps module.

The Apps module stores role-neutral credentials. A credential knows which
integration it is for (app_id) and how it authenticates (auth_mode). It does
NOT know or care whether it will be used as a backup source or destination —
that choice lives in the Backup module.
"""

import json
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from modules.connectors.backend.shared.catalog import get_connector
from packages.auth.src.resource_permissions import (
    apply_resource_scope,
    batch_effective_permissions,
    fetch_owner_email_lookup,
    get_effective_permission,
)
from modules.apps.shared.types import (
    GOOGLE_STYLE_APPS,
    SOURCE_STYLE_APPS,
    SUPPORTED_APPS,
    AppCredentialApplyResponse,
    AppCredentialCreate,
    AppCredentialDetail,
    AppCredentialListItem,
    AppCredentialUpdate,
)
from modules.credentials.backend.services.google_auth_service import (
    AppConfigService,
    decrypt_value,
    encrypt_value,
    resolve_destination_google_auth_mode,
)
from packages.database.src.models import AppCredential, GoogleConnection, ResourceType, User


APPS_REQUIRING_DOMAIN = {
    "request", "workflow", "wework", "service",
    "crm", "hrm", "table", "goal", "income", "meeting", "payroll", "timeoff",
}


class AppCredentialService:
    def __init__(self, db: AsyncSession):
        self.db = db

    # ── Helpers ────────────────────────────────────────────────────────────
    @staticmethod
    def _parse_uuid(raw_value: str, label: str = "credential") -> UUID:
        try:
            return UUID(str(raw_value))
        except (TypeError, ValueError) as exc:
            raise ValueError(f"Invalid {label} ID") from exc

    @staticmethod
    def _resolve_app_name(app_id: str, app_name: Optional[str]) -> str:
        return (app_name or SUPPORTED_APPS.get(app_id) or app_id).strip()

    @staticmethod
    def _get_connector_definition(app_id: str):
        connector = get_connector(app_id)
        if connector is None:
            raise ValueError(f"Unsupported app_id: {app_id}")
        return connector

    @classmethod
    def _materialize_registry_secrets(
        cls,
        credential: AppCredential,
        *,
        include_google_service_account_reference: bool = True,
    ) -> Dict[str, Any]:
        connector = cls._get_connector_definition(credential.app_id)
        auth = dict(credential.auth or {})
        config = dict(credential.config or {})
        materialized: Dict[str, Any] = {}

        for field in connector.auth_spec.fields:
            source = auth if field.storage == 'auth' else config
            if field.secret:
                encrypted = source.get(f"{field.name}_encrypted")
                if encrypted:
                    try:
                        materialized[field.name] = decrypt_value(encrypted)
                    except Exception as exc:
                        raise ValueError(
                            f"Failed to decrypt {field.name} for this credential. "
                            "Edit the credential and re-enter the secret to repair it."
                        ) from exc
            else:
                value = source.get(field.name)
                if value not in (None, ''):
                    materialized[field.name] = value

        if include_google_service_account_reference and auth.get("service_account_json_encrypted"):
            materialized["service_account_json_encrypted"] = auth["service_account_json_encrypted"]

        for extra_key in ("connection_id", "email", "display_name", "picture_url", "service_account_email"):
            if auth.get(extra_key) not in (None, ''):
                materialized[extra_key] = auth[extra_key]

        return materialized

    @classmethod
    def _materialize_auth_for_edit_v2(cls, credential: AppCredential) -> Dict[str, Any]:
        auth = cls._materialize_registry_secrets(
            credential,
            include_google_service_account_reference=credential.app_id in GOOGLE_STYLE_APPS,
        )
        if credential.app_id in GOOGLE_STYLE_APPS:
            auth.pop("service_account_json", None)
        return auth

    # ── View builders ──────────────────────────────────────────────────────
    @classmethod
    def _preview(cls, credential: AppCredential) -> Dict[str, Any]:
        connector = cls._get_connector_definition(credential.app_id)
        auth = dict(credential.auth or {})
        config = dict(credential.config or {})
        preview: Dict[str, Any] = {}
        for field in connector.auth_spec.fields:
            if field.secret:
                continue
            source = auth if field.storage == 'auth' else config
            value = source.get(field.name)
            if value not in (None, ''):
                preview[field.name] = value
        if credential.app_id in SOURCE_STYLE_APPS:
            return preview
        preview.update({
            "email": auth.get("email") or auth.get("google_oauth_email") or auth.get("service_account_email"),
            "display_name": auth.get("display_name"),
            "picture_url": auth.get("picture_url"),
            "folder_name": config.get("folder_name"),
            "drive_name": config.get("drive_name"),
            "uses_platform_service_account": bool(config.get("uses_platform_service_account")),
        })
        return {key: value for key, value in preview.items() if value is not None}

    @classmethod
    def _build_list_item(
        cls,
        credential: AppCredential,
        *,
        owner_email: Optional[str] = None,
        user_permission: Optional[str] = None,
    ) -> AppCredentialListItem:
        return AppCredentialListItem(
            id=credential.id,
            name=credential.name,
            description=credential.description,
            owner_email=owner_email,
            user_permission=user_permission,
            app_id=credential.app_id,
            app_name=credential.app_name,
            auth_mode=credential.auth_mode,
            preview=cls._preview(credential),
            config=dict(credential.config or {}) or None,
            created_at=credential.created_at,
            updated_at=credential.updated_at,
        )

    @classmethod
    def _build_detail(
        cls,
        credential: AppCredential,
        *,
        owner_email: Optional[str] = None,
        user_permission: Optional[str] = None,
    ) -> AppCredentialDetail:
        list_item = cls._build_list_item(
            credential,
            owner_email=owner_email,
            user_permission=user_permission,
        )
        auth = cls._materialize_auth_for_edit_v2(credential)
        return AppCredentialDetail(**list_item.model_dump(), auth=auth)

    @classmethod
    def _materialize_auth_for_edit(cls, credential: AppCredential) -> Dict[str, Any]:
        """Return a view of auth suitable for the edit form. Sensitive tokens
        are decrypted for source-style apps; Google destinations expose opaque
        references (connection_id / service_account_email) since raw secrets
        stay encrypted."""
        auth = dict(credential.auth or {})
        if credential.app_id in SOURCE_STYLE_APPS:
            encrypted = auth.pop("access_token_encrypted", None)
            if encrypted:
                try:
                    auth["access_token"] = decrypt_value(encrypted)
                except Exception as exc:
                    # Surface the failure instead of silently returning an
                    # empty token — that caused Backup to report "missing
                    # access token" with no hint the credential is actually
                    # corrupted or encrypted with a different SECRET_KEY.
                    raise ValueError(
                        "Failed to decrypt access token for this credential. "
                        "The SECRET_KEY may have changed or the credential row is corrupted. "
                        "Edit the credential and re-enter the access token to fix it."
                    ) from exc
            return auth
        # Google destinations: never return raw service_account_json; strip it.
        auth.pop("service_account_json_encrypted", None)
        return auth

    # ── CRUD ───────────────────────────────────────────────────────────────
    async def list_credentials(self, current_user: User, app_id: Optional[str] = None) -> List[AppCredentialListItem]:
        stmt = select(AppCredential).order_by(
            AppCredential.updated_at.desc(), AppCredential.created_at.desc()
        )
        stmt = apply_resource_scope(
            stmt,
            AppCredential,
            ResourceType.APP_CREDENTIAL,
            current_user,
            module='apps',
        )
        if app_id:
            stmt = stmt.where(AppCredential.app_id == app_id)
        result = await self.db.execute(stmt)
        items = result.scalars().all()
        owner_lookup = await fetch_owner_email_lookup(self.db, (item.owner_id for item in items))
        perm_map = await batch_effective_permissions(
            self.db,
            current_user,
            items,
            module='apps',
            resource_type=ResourceType.APP_CREDENTIAL,
        )
        return [
            self._build_list_item(
                item,
                owner_email=owner_lookup.get(item.owner_id),
                user_permission=perm_map.get(str(item.id), 'none'),
            )
            for item in items
        ]

    async def get_credential(self, credential_id: str, current_user: User) -> Optional[AppCredentialDetail]:
        model = await self._get_model(credential_id)
        if not model:
            return None
        owner_lookup = await fetch_owner_email_lookup(self.db, (model.owner_id,))
        user_permission = await get_effective_permission(
            self.db,
            current_user,
            model,
            module='apps',
            resource_type=ResourceType.APP_CREDENTIAL,
        )
        return self._build_detail(
            model,
            owner_email=owner_lookup.get(model.owner_id),
            user_permission=user_permission,
        )

    async def get_credential_snapshot(self, credential_id: str, current_user: User) -> Optional[AppCredentialApplyResponse]:
        model = await self._get_model(credential_id)
        if not model:
            return None
        auth = self._materialize_auth_for_edit_v2(model)
        if model.app_id in GOOGLE_STYLE_APPS:
            auth.pop("service_account_json_encrypted", None)
            if model.auth.get("service_account_json_encrypted"):
                auth["uses_stored_service_account_key"] = True
        owner_lookup = await fetch_owner_email_lookup(self.db, (model.owner_id,))
        user_permission = await get_effective_permission(
            self.db,
            current_user,
            model,
            module='apps',
            resource_type=ResourceType.APP_CREDENTIAL,
        )
        return AppCredentialApplyResponse(
            id=model.id,
            owner_email=owner_lookup.get(model.owner_id),
            user_permission=user_permission,
            app_id=model.app_id,
            app_name=model.app_name,
            auth_mode=model.auth_mode,
            auth=auth,
            config=dict(model.config or {}),
        )

    async def create_credential(self, payload: AppCredentialCreate, current_user: User) -> AppCredentialDetail:
        auth, auth_mode, config = await self._prepare_auth_and_config(
            app_id=payload.app_id,
            raw_auth=dict(payload.auth or {}),
            raw_config=dict(payload.config or {}),
        )
        model = AppCredential(
            name=payload.name.strip(),
            description=(payload.description or "").strip() or None,
            owner_id=current_user.id,
            app_id=payload.app_id,
            app_name=self._resolve_app_name(payload.app_id, payload.app_name),
            auth_mode=auth_mode,
            auth=auth,
            config=config or None,
        )
        self.db.add(model)
        await self.db.commit()
        await self.db.refresh(model)
        return self._build_detail(
            model,
            owner_email=current_user.email,
            user_permission='full',
        )

    async def update_credential(
        self, credential_id: str, payload: AppCredentialUpdate, current_user: User
    ) -> Optional[AppCredentialDetail]:
        model = await self._get_model(credential_id)
        if not model:
            return None

        if payload.name is not None:
            model.name = payload.name.strip()
        if payload.description is not None:
            model.description = payload.description.strip() or None
        if payload.app_name is not None:
            model.app_name = self._resolve_app_name(model.app_id, payload.app_name)

        merged_auth_input: Optional[Dict[str, Any]]
        merged_config_input: Optional[Dict[str, Any]]
        if payload.auth is not None or payload.config is not None:
            merged_auth_input = dict(payload.auth or {}) if payload.auth is not None else None
            merged_config_input = dict(payload.config or {}) if payload.config is not None else None
            # For fields that are not being edited, start from the stored values
            # (auth still encrypted; we want prepare step to re-run with any new
            # plaintext secrets mixed in).
            current_auth = dict(model.auth or {})
            current_config = dict(model.config or {})
            next_auth_input = dict(current_auth)
            if merged_auth_input is not None:
                next_auth_input.update(merged_auth_input)
            next_config_input = (
                merged_config_input if merged_config_input is not None else dict(current_config)
            )
            auth, auth_mode, config = await self._prepare_auth_and_config(
                app_id=model.app_id,
                raw_auth=next_auth_input,
                raw_config=next_config_input,
            )
            model.auth = auth
            model.auth_mode = auth_mode
            model.config = config or None

        await self.db.commit()
        await self.db.refresh(model)
        owner_lookup = await fetch_owner_email_lookup(self.db, (model.owner_id,))
        user_permission = await get_effective_permission(
            self.db,
            current_user,
            model,
            module='apps',
            resource_type=ResourceType.APP_CREDENTIAL,
        )
        return self._build_detail(
            model,
            owner_email=owner_lookup.get(model.owner_id),
            user_permission=user_permission,
        )

    async def delete_credential(self, credential_id: str) -> bool:
        model = await self._get_model(credential_id)
        if not model:
            return False
        await self.db.delete(model)
        await self.db.commit()
        return True

    async def get_credential_model(self, credential_id: str) -> Optional[AppCredential]:
        return await self._get_model(credential_id)

    async def _get_model(self, credential_id: str) -> Optional[AppCredential]:
        parsed_id = self._parse_uuid(credential_id)
        result = await self.db.execute(
            select(AppCredential).where(AppCredential.id == parsed_id)
        )
        return result.scalar_one_or_none()

    # ── Auth preparation ────────────────────────────────────────────────────
    async def _prepare_auth_and_config(
        self,
        *,
        app_id: str,
        raw_auth: Dict[str, Any],
        raw_config: Dict[str, Any],
    ) -> Tuple[Dict[str, Any], str, Dict[str, Any]]:
        connector = self._get_connector_definition(app_id)
        if app_id in GOOGLE_STYLE_APPS:
            return await self._prepare_google_style(app_id, raw_auth, raw_config)
        return self._prepare_registry_style(connector, raw_auth, raw_config)

    @staticmethod
    def _prepare_registry_style(
        connector,
        auth: Dict[str, Any],
        config: Dict[str, Any],
    ) -> Tuple[Dict[str, Any], str, Dict[str, Any]]:
        prepared_auth: Dict[str, Any] = {}
        prepared_config: Dict[str, Any] = {}
        handled_auth_keys: set[str] = set()
        handled_config_keys: set[str] = set()

        for field in connector.auth_spec.fields:
            source = auth if field.storage == 'auth' else config
            target = prepared_auth if field.storage == 'auth' else prepared_config
            handled_keys = handled_auth_keys if field.storage == 'auth' else handled_config_keys
            handled_keys.add(field.name)
            handled_keys.add(f"{field.name}_encrypted")

            if field.secret:
                plaintext = str(source.get(field.name) or '').strip()
                existing_encrypted = source.get(f"{field.name}_encrypted")
                if plaintext:
                    target[f"{field.name}_encrypted"] = encrypt_value(plaintext)
                elif existing_encrypted:
                    target[f"{field.name}_encrypted"] = existing_encrypted
                elif field.required:
                    raise ValueError(f"{field.name} is required for {connector.connector_key} credentials")
                continue

            value = source.get(field.name)
            if isinstance(value, str):
                value = value.strip()
            if field.required and value in (None, ''):
                raise ValueError(f"{field.name} is required for {connector.connector_key} credentials")
            if value not in (None, ''):
                target[field.name] = value

        for key, value in auth.items():
            if key not in handled_auth_keys and value not in (None, ''):
                prepared_auth[key] = value
        for key, value in config.items():
            if key not in handled_config_keys and value not in (None, ''):
                prepared_config[key] = value

        auth_mode = 'token_password' if connector.auth_spec.auth_type == 'token_password' else 'access_token'
        return prepared_auth, auth_mode, prepared_config

    @staticmethod
    def _prepare_source_style(
        app_id: str, auth: Dict[str, Any], config: Dict[str, Any]
    ) -> Tuple[Dict[str, Any], str, Dict[str, Any]]:
        domain = str(config.get("domain") or "").strip()
        if app_id in APPS_REQUIRING_DOMAIN and not domain:
            raise ValueError(f"domain is required for {app_id} credentials")

        plaintext_token = str(auth.get("access_token") or "").strip()
        existing_encrypted = auth.get("access_token_encrypted")
        if plaintext_token:
            encrypted = encrypt_value(plaintext_token)
        elif existing_encrypted:
            encrypted = existing_encrypted
        else:
            raise ValueError("access_token is required")

        prepared_config = {"domain": domain} if domain else {}
        # Preserve any opaque extra config the caller sent.
        for key, value in config.items():
            if key == "domain":
                continue
            prepared_config[key] = value

        return {"access_token_encrypted": encrypted}, "access_token", prepared_config

    async def _prepare_google_style(
        self, app_id: str, auth: Dict[str, Any], config: Dict[str, Any]
    ) -> Tuple[Dict[str, Any], str, Dict[str, Any]]:
        working_auth = dict(auth or {})
        # Harmonize alt field names.
        if working_auth.get("google_oauth_connection_id") and not working_auth.get("connection_id"):
            working_auth["connection_id"] = working_auth["google_oauth_connection_id"]
        if working_auth.get("google_oauth_email") and not working_auth.get("email"):
            working_auth["email"] = working_auth["google_oauth_email"]

        # Encrypt a freshly supplied service account JSON if any.
        raw_service_account = working_auth.pop("credentials_json", None)
        if not raw_service_account:
            raw_service_account = working_auth.pop("service_account_json", None)
        if raw_service_account:
            service_account_text = (
                raw_service_account if isinstance(raw_service_account, str)
                else json.dumps(raw_service_account)
            )
            working_auth["service_account_json_encrypted"] = encrypt_value(service_account_text)

        auth_mode = resolve_destination_google_auth_mode(working_auth)

        if auth_mode == "google_oauth":
            connection_id = working_auth.get("connection_id")
            if not connection_id:
                raise ValueError("Select a saved Google OAuth connection for this credential")
            parsed = self._parse_uuid(connection_id, label="Google connection")
            connection = await self.db.get(GoogleConnection, parsed)
            if not connection:
                raise ValueError("Selected Google connection was not found")
            working_auth["connection_id"] = str(connection.id)
            working_auth["email"] = working_auth.get("email") or connection.email
            working_auth["display_name"] = (
                working_auth.get("display_name") or connection.display_name or connection.email
            )
            working_auth["picture_url"] = working_auth.get("picture_url") or connection.picture_url or ""
            prepared_auth = {
                "connection_id": working_auth["connection_id"],
                "email": working_auth.get("email"),
                "display_name": working_auth.get("display_name"),
                "picture_url": working_auth.get("picture_url"),
            }
        else:
            uses_platform = not bool(working_auth.get("service_account_json_encrypted"))
            if uses_platform:
                platform_config = await AppConfigService(self.db).get_platform_service_account_config()
                if not platform_config.get("configured"):
                    raise ValueError("Shared platform service account is not configured")
                working_auth["service_account_email"] = (
                    working_auth.get("service_account_email")
                    or platform_config.get("service_account_email")
                )
            prepared_auth = {
                "service_account_email": working_auth.get("service_account_email"),
            }
            if working_auth.get("service_account_json_encrypted"):
                prepared_auth["service_account_json_encrypted"] = working_auth["service_account_json_encrypted"]

        connector = self._get_connector_definition(app_id)

        # Config keeps the per-credential target defaults and platform flag.
        prepared_config: Dict[str, Any] = {}
        for key in ("folder_id", "folder_name", "drive_id", "drive_name", "project_id", "dataset_id"):
            value = config.get(key) if key in config else working_auth.get(key)
            if isinstance(value, str):
                value = value.strip()
            if value not in (None, ""):
                prepared_config[key] = value
        if auth_mode == "service_account":
            prepared_config["uses_platform_service_account"] = not bool(
                working_auth.get("service_account_json_encrypted")
            )

        for field in connector.auth_spec.fields:
            if field.storage != 'config' or not field.required:
                continue
            if prepared_config.get(field.name) in (None, ''):
                raise ValueError(f"{field.name} is required for {app_id} credentials")

        return prepared_auth, auth_mode, prepared_config

    # ── Backup integration ─────────────────────────────────────────────────
    async def build_source_runtime(self, credential_id: UUID) -> Dict[str, Any]:
        """Return the shape old flow.source JSONB used to carry — built fresh
        from the stored AppCredential. Called by Backup runner code."""
        model = await self.db.get(AppCredential, credential_id)
        if not model:
            raise ValueError("Source credential not found")
        if model.app_id not in SOURCE_STYLE_APPS:
            raise ValueError(f"Credential {model.id} is not a source-style app")
        config = dict(model.config or {})
        auth = dict(model.auth or {})
        return {
            "credential_id": str(model.id),
            "app": model.app_id,
            "app_name": model.app_name,
            "domain": config.get("domain"),
            "access_token_encrypted": auth.get("access_token_encrypted"),
        }

    async def build_destination_runtime(
        self, credential_id: UUID, target: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        model = await self.db.get(AppCredential, credential_id)
        if not model:
            raise ValueError("Destination credential not found")
        if model.app_id not in GOOGLE_STYLE_APPS:
            raise ValueError(f"Credential {model.id} is not a destination-style app")
        auth = dict(model.auth or {})
        config = dict(model.config or {})
        merged_auth = {**auth}
        # Expose config fields inside auth for the runner's convenience (it
        # historically reads folder_id / drive_id from auth).
        for key in ("folder_id", "folder_name", "drive_id", "drive_name", "uses_platform_service_account"):
            if key in config:
                merged_auth.setdefault(key, config[key])
        if target:
            for key in ("folder_id", "folder_name", "drive_id", "drive_name"):
                if target.get(key) not in (None, ""):
                    merged_auth[key] = target[key]
        merged_auth["auth_mode"] = model.auth_mode
        merged_auth["auth_method"] = "oauth" if model.auth_mode == "google_oauth" else model.auth_mode
        return {
            "credential_id": str(model.id),
            "type": model.app_id,
            "name": model.app_name,
            "auth": merged_auth,
        }
