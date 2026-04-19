import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, Mapping, Optional
from uuid import UUID, uuid4

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from modules.credentials.backend.services.google_auth_service import encrypt_value


logger = logging.getLogger(__name__)

LEGACY_TARGET_KEYS = ("folder_id", "folder_name", "drive_id", "drive_name")
DESTINATION_NAME_MAP = {
    "gdrive": "Google Drive",
    "gsheets": "Google Sheets",
}
RESOURCE_TYPES = ("app_credential", "backup_flow", "data_pipeline")
SHARE_PERMISSIONS = ("view", "edit")


def _as_dict(value: Any) -> Dict[str, Any]:
    if isinstance(value, Mapping):
        return dict(value)
    if isinstance(value, str):
        raw_value = value.strip()
        if not raw_value:
            return {}
        try:
            decoded = json.loads(raw_value)
        except json.JSONDecodeError:
            return {}
        return dict(decoded) if isinstance(decoded, Mapping) else {}
    return {}


def _compact_dict(value: Dict[str, Any]) -> Dict[str, Any]:
    return {
        key: item
        for key, item in value.items()
        if item is not None and item != ""
    }


def _parse_uuid_or_none(value: Any) -> Optional[UUID]:
    if not value:
        return None
    try:
        return UUID(str(value))
    except (TypeError, ValueError):
        return None


async def _table_exists(db: AsyncSession, table_name: str) -> bool:
    result = await db.execute(
        text("SELECT to_regclass(:table_name)"),
        {"table_name": f"public.{table_name}"},
    )
    return result.scalar_one_or_none() is not None


async def _column_exists(db: AsyncSession, table_name: str, column_name: str) -> bool:
    result = await db.execute(
        text(
            """
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = :table_name
              AND column_name = :column_name
            """
        ),
        {"table_name": table_name, "column_name": column_name},
    )
    return result.scalar_one_or_none() is not None


async def _get_column_default(db: AsyncSession, table_name: str, column_name: str) -> str:
    result = await db.execute(
        text(
            """
            SELECT column_default
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = :table_name
              AND column_name = :column_name
            """
        ),
        {"table_name": table_name, "column_name": column_name},
    )
    return str(result.scalar_one_or_none() or "")


async def _lookup_user_id_by_email(db: AsyncSession, email: Optional[str]) -> Optional[UUID]:
    normalized = str(email or "").strip().lower()
    if not normalized or not await _table_exists(db, "users"):
        return None
    result = await db.execute(
        text(
            """
            SELECT id
            FROM users
            WHERE lower(email) = :email
            ORDER BY created_at ASC
            LIMIT 1
            """
        ),
        {"email": normalized},
    )
    return result.scalar_one_or_none()


async def _get_fallback_owner_id(db: AsyncSession) -> Optional[UUID]:
    if not await _table_exists(db, "users"):
        return None
    result = await db.execute(
        text(
            """
            SELECT id
            FROM users
            ORDER BY
                CASE WHEN status = 'active' THEN 0 ELSE 1 END,
                created_at ASC
            LIMIT 1
            """
        )
    )
    return result.scalar_one_or_none()


async def _app_credential_exists(db: AsyncSession, credential_id: Any) -> bool:
    parsed_id = _parse_uuid_or_none(credential_id)
    if parsed_id is None:
        return False
    result = await db.execute(
        text("SELECT 1 FROM app_credentials WHERE id = :credential_id"),
        {"credential_id": parsed_id},
    )
    return result.scalar_one_or_none() is not None


async def _find_matching_app_credential(
    db: AsyncSession,
    *,
    app_id: str,
    auth_mode: str,
    auth: Dict[str, Any],
    config: Optional[Dict[str, Any]] = None,
) -> Optional[UUID]:
    result = await db.execute(
        text(
            """
            SELECT id
            FROM app_credentials
            WHERE app_id = :app_id
              AND auth_mode = :auth_mode
              AND auth = CAST(:auth AS JSONB)
              AND COALESCE(config, '{}'::jsonb) = COALESCE(CAST(:config AS JSONB), '{}'::jsonb)
            ORDER BY created_at ASC
            LIMIT 1
            """
        ),
        {
            "app_id": app_id,
            "auth_mode": auth_mode,
            "auth": json.dumps(auth),
            "config": json.dumps(config) if config else None,
        },
    )
    return result.scalar_one_or_none()


async def _insert_app_credential(
    db: AsyncSession,
    *,
    credential_id: UUID,
    name: str,
    description: Optional[str],
    app_id: str,
    app_name: str,
    auth_mode: str,
    auth: Dict[str, Any],
    config: Optional[Dict[str, Any]],
    created_at: Any,
    updated_at: Any,
) -> None:
    created_at = created_at or datetime.now(timezone.utc)
    updated_at = updated_at or created_at
    await db.execute(
        text(
            """
            INSERT INTO app_credentials (
                id,
                name,
                description,
                app_id,
                app_name,
                auth_mode,
                auth,
                config,
                created_at,
                updated_at
            )
            VALUES (
                :id,
                :name,
                :description,
                :app_id,
                :app_name,
                :auth_mode,
                CAST(:auth AS JSONB),
                CAST(:config AS JSONB),
                :created_at,
                :updated_at
            )
            ON CONFLICT (id) DO NOTHING
            """
        ),
        {
            "id": credential_id,
            "name": name,
            "description": description,
            "app_id": app_id,
            "app_name": app_name,
            "auth_mode": auth_mode,
            "auth": json.dumps(auth),
            "config": json.dumps(config) if config else None,
            "created_at": created_at,
            "updated_at": updated_at,
        },
    )


async def _ensure_backup_flow_role_columns(db: AsyncSession) -> bool:
    if not await _table_exists(db, "backup_flows"):
        return False

    changed = False
    column_definitions = {
        "source_credential_id": "ALTER TABLE backup_flows ADD COLUMN source_credential_id UUID",
        "destination_credential_id": "ALTER TABLE backup_flows ADD COLUMN destination_credential_id UUID",
        "destination_target": "ALTER TABLE backup_flows ADD COLUMN destination_target JSONB",
    }

    for column_name, ddl in column_definitions.items():
        if await _column_exists(db, "backup_flows", column_name):
            continue
        await db.execute(text(ddl))
        changed = True
        logger.info("Added backup_flows.%s column for credential-based backup flows", column_name)

    await db.execute(
        text("CREATE INDEX IF NOT EXISTS idx_backup_flows_source_credential ON backup_flows (source_credential_id)")
    )
    await db.execute(
        text("CREATE INDEX IF NOT EXISTS idx_backup_flows_destination_credential ON backup_flows (destination_credential_id)")
    )
    return changed


async def _ensure_resource_owner_columns(db: AsyncSession) -> bool:
    changed = False

    owner_columns = {
        "app_credentials": "ALTER TABLE app_credentials ADD COLUMN owner_id UUID REFERENCES users(id) ON DELETE SET NULL",
        "backup_flows": "ALTER TABLE backup_flows ADD COLUMN owner_id UUID REFERENCES users(id) ON DELETE SET NULL",
    }

    for table_name, ddl in owner_columns.items():
        if not await _table_exists(db, table_name):
            continue
        if await _column_exists(db, table_name, "owner_id"):
            continue
        await db.execute(text(ddl))
        changed = True
        logger.info("Added %s.owner_id column", table_name)

    await db.execute(text("CREATE INDEX IF NOT EXISTS idx_app_credentials_owner_id ON app_credentials (owner_id)"))
    await db.execute(text("CREATE INDEX IF NOT EXISTS idx_backup_flows_owner_id ON backup_flows (owner_id)"))
    return changed


async def _ensure_resource_shares_table(db: AsyncSession) -> bool:
    changed = False

    if not await _table_exists(db, "resource_shares"):
        await db.execute(
            text(
                """
                CREATE TABLE resource_shares (
                    id SERIAL PRIMARY KEY,
                    resource_type VARCHAR(50) NOT NULL,
                    resource_id VARCHAR(64) NOT NULL,
                    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    permission VARCHAR(16) NOT NULL DEFAULT 'view',
                    shared_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
                    CONSTRAINT uq_resource_shares UNIQUE (resource_type, resource_id, user_id),
                    CONSTRAINT check_resource_share_resource_type CHECK (
                        resource_type IN ('app_credential', 'backup_flow', 'data_pipeline')
                    ),
                    CONSTRAINT check_resource_share_permission CHECK (
                        permission IN ('view', 'edit')
                    )
                )
                """
            )
        )
        changed = True
        logger.info("Created resource_shares table")

    await db.execute(
        text("CREATE INDEX IF NOT EXISTS idx_resource_shares_resource ON resource_shares (resource_type, resource_id)")
    )
    await db.execute(
        text("CREATE INDEX IF NOT EXISTS idx_resource_shares_user_id ON resource_shares (user_id)")
    )
    return changed


async def _ensure_resource_share_constraints(db: AsyncSession) -> bool:
    if not await _table_exists(db, "resource_shares"):
        return False

    await db.execute(
        text("ALTER TABLE resource_shares DROP CONSTRAINT IF EXISTS check_resource_share_resource_type")
    )
    await db.execute(
        text(
            """
            ALTER TABLE resource_shares ADD CONSTRAINT check_resource_share_resource_type
            CHECK (resource_type IN ('app_credential', 'backup_flow', 'data_pipeline'))
            """
        )
    )
    return True


async def _ensure_app_credential_registry_constraints(db: AsyncSession) -> bool:
    if not await _table_exists(db, "app_credentials"):
        return False

    await db.execute(text("ALTER TABLE app_credentials DROP CONSTRAINT IF EXISTS check_app_credential_app_id"))
    await db.execute(text("ALTER TABLE app_credentials DROP CONSTRAINT IF EXISTS check_app_credential_auth_mode"))
    return True


async def _migrate_legacy_source_connections(db: AsyncSession) -> int:
    if not await _table_exists(db, "source_connections"):
        return 0

    result = await db.execute(
        text(
            """
            SELECT id, name, description, app_id, app_name, domain, access_token_encrypted, config, created_at, updated_at
            FROM source_connections
            ORDER BY created_at ASC
            """
        )
    )
    rows = result.mappings().all()
    migrated_count = 0

    for row in rows:
        if await _app_credential_exists(db, row["id"]):
            continue

        config = _as_dict(row["config"])
        domain = str(row["domain"] or "").strip()
        if domain and not config.get("domain"):
            config["domain"] = domain

        await _insert_app_credential(
            db,
            credential_id=row["id"],
            name=row["name"],
            description=row["description"],
            app_id=row["app_id"],
            app_name=row["app_name"],
            auth_mode="access_token",
            auth={"access_token_encrypted": row["access_token_encrypted"]},
            config=_compact_dict(config) or None,
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )
        migrated_count += 1

    if migrated_count:
        logger.info("Migrated %s legacy source_connections row(s) into app_credentials", migrated_count)
    return migrated_count


def _split_legacy_destination_auth(
    auth: Dict[str, Any],
    *,
    default_auth_mode: Optional[str] = None,
) -> tuple[Dict[str, Any], str, Dict[str, Any]]:
    auth_payload = dict(auth)
    config_payload: Dict[str, Any] = {}

    for target_key in LEGACY_TARGET_KEYS:
        target_value = auth_payload.pop(target_key, None)
        if target_value not in (None, ""):
            config_payload[target_key] = target_value

    uses_platform_service_account = auth_payload.pop("uses_platform_service_account", None)
    if uses_platform_service_account is not None:
        config_payload["uses_platform_service_account"] = bool(uses_platform_service_account)

    if auth_payload.get("google_oauth_connection_id") and not auth_payload.get("connection_id"):
        auth_payload["connection_id"] = auth_payload["google_oauth_connection_id"]
    if auth_payload.get("google_oauth_email") and not auth_payload.get("email"):
        auth_payload["email"] = auth_payload["google_oauth_email"]

    raw_mode = str(
        auth_payload.pop("auth_mode", "")
        or auth_payload.pop("auth_method", "")
        or default_auth_mode
        or ""
    ).strip().lower()
    if raw_mode == "oauth":
        raw_mode = "google_oauth"

    if raw_mode == "service_account" or auth_payload.get("service_account_json_encrypted") or config_payload.get("uses_platform_service_account"):
        auth_mode = "service_account"
    else:
        auth_mode = "google_oauth"

    return _compact_dict(auth_payload), auth_mode, _compact_dict(config_payload)


async def _migrate_legacy_destination_profiles(db: AsyncSession) -> int:
    if not await _table_exists(db, "destination_profiles"):
        return 0

    result = await db.execute(
        text(
            """
            SELECT id, name, description, destination_type, auth_mode, auth, created_at, updated_at
            FROM destination_profiles
            ORDER BY created_at ASC
            """
        )
    )
    rows = result.mappings().all()
    migrated_count = 0

    for row in rows:
        if await _app_credential_exists(db, row["id"]):
            continue

        auth_payload, auth_mode, config_payload = _split_legacy_destination_auth(
            _as_dict(row["auth"]),
            default_auth_mode=str(row["auth_mode"] or "").strip().lower() or None,
        )

        await _insert_app_credential(
            db,
            credential_id=row["id"],
            name=row["name"],
            description=row["description"],
            app_id=row["destination_type"],
            app_name=DESTINATION_NAME_MAP.get(row["destination_type"], row["destination_type"]),
            auth_mode=auth_mode,
            auth=auth_payload,
            config=config_payload or None,
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )
        migrated_count += 1

    if migrated_count:
        logger.info("Migrated %s legacy destination_profiles row(s) into app_credentials", migrated_count)
    return migrated_count


def _extract_destination_target(destination: Dict[str, Any]) -> Dict[str, Any]:
    explicit_target = _as_dict(destination.get("target"))
    auth = _as_dict(destination.get("auth"))
    target: Dict[str, Any] = {}
    for target_key in LEGACY_TARGET_KEYS:
        target_value = explicit_target.get(target_key)
        if target_value in (None, ""):
            target_value = auth.get(target_key)
        if target_value not in (None, ""):
            target[target_key] = target_value
    return target


async def _resolve_legacy_source_credential_id(db: AsyncSession, source: Dict[str, Any]) -> Optional[UUID]:
    for key in ("credential_id", "source_connection_id"):
        legacy_id = _parse_uuid_or_none(source.get(key))
        if legacy_id and await _app_credential_exists(db, legacy_id):
            return legacy_id

    app_id = str(source.get("app") or "").strip().lower()
    if not app_id:
        return None

    auth_payload: Dict[str, Any] = {}
    if source.get("access_token_encrypted"):
        auth_payload["access_token_encrypted"] = source["access_token_encrypted"]
    elif source.get("access_token"):
        auth_payload["access_token_encrypted"] = encrypt_value(str(source["access_token"]))
    else:
        return None

    config_payload: Dict[str, Any] = {}
    skip_keys = {
        "credential_id",
        "source_connection_id",
        "app",
        "app_name",
        "access_token",
        "access_token_hash",
        "access_token_encrypted",
    }
    for key, value in source.items():
        if key in skip_keys or value in (None, ""):
            continue
        config_payload[key] = value

    config_payload = _compact_dict(config_payload)
    matched_id = await _find_matching_app_credential(
        db,
        app_id=app_id,
        auth_mode="access_token",
        auth=auth_payload,
        config=config_payload or None,
    )
    if matched_id is not None:
        return matched_id

    credential_id = uuid4()
    app_name = str(source.get("app_name") or app_id).strip() or app_id
    domain = str(config_payload.get("domain") or "").strip()
    if domain:
        name = f"{app_name} ({domain})"
    else:
        name = app_name

    await _insert_app_credential(
        db,
        credential_id=credential_id,
        name=name,
        description="Migrated from legacy backup flow source payload",
        app_id=app_id,
        app_name=app_name,
        auth_mode="access_token",
        auth=auth_payload,
        config=config_payload or None,
        created_at=None,
        updated_at=None,
    )
    logger.info("Created app_credentials row %s from legacy backup flow source payload", credential_id)
    return credential_id


async def _resolve_legacy_destination_credential(
    db: AsyncSession,
    destination: Dict[str, Any],
) -> tuple[Optional[UUID], Dict[str, Any]]:
    destination_target = _extract_destination_target(destination)

    for key in ("credential_id", "destination_profile_id"):
        legacy_id = _parse_uuid_or_none(destination.get(key))
        if legacy_id and await _app_credential_exists(db, legacy_id):
            return legacy_id, destination_target

    app_id = str(destination.get("type") or destination.get("destination_type") or "").strip().lower()
    if not app_id:
        return None, destination_target

    auth_payload, auth_mode, config_payload = _split_legacy_destination_auth(_as_dict(destination.get("auth")))
    config_payload.pop("folder_id", None)
    config_payload.pop("folder_name", None)
    config_payload.pop("drive_id", None)
    config_payload.pop("drive_name", None)

    if auth_mode == "google_oauth" and not auth_payload.get("connection_id"):
        return None, destination_target

    if auth_mode == "service_account" and not (
        auth_payload.get("service_account_json_encrypted")
        or auth_payload.get("service_account_email")
        or config_payload.get("uses_platform_service_account")
    ):
        return None, destination_target

    matched_id = await _find_matching_app_credential(
        db,
        app_id=app_id,
        auth_mode=auth_mode,
        auth=auth_payload,
        config=config_payload or None,
    )
    if matched_id is not None:
        return matched_id, destination_target

    credential_id = uuid4()
    app_name = str(destination.get("name") or DESTINATION_NAME_MAP.get(app_id, app_id)).strip() or app_id
    await _insert_app_credential(
        db,
        credential_id=credential_id,
        name=app_name,
        description="Migrated from legacy backup flow destination payload",
        app_id=app_id,
        app_name=app_name,
        auth_mode=auth_mode,
        auth=auth_payload,
        config=config_payload or None,
        created_at=None,
        updated_at=None,
    )
    logger.info("Created app_credentials row %s from legacy backup flow destination payload", credential_id)
    return credential_id, destination_target


async def _backfill_backup_flow_role_assignments(db: AsyncSession) -> int:
    if not await _table_exists(db, "backup_flows"):
        return 0

    has_source_json = await _column_exists(db, "backup_flows", "source")
    has_destination_json = await _column_exists(db, "backup_flows", "destination")
    if not has_source_json and not has_destination_json:
        return 0

    select_fields = [
        "id",
        "source_credential_id",
        "destination_credential_id",
        "destination_target",
    ]
    if has_source_json:
        select_fields.append("source")
    if has_destination_json:
        select_fields.append("destination")

    result = await db.execute(
        text(f"SELECT {', '.join(select_fields)} FROM backup_flows ORDER BY created_at ASC")
    )
    rows = result.mappings().all()
    updated_count = 0

    for row in rows:
        source_credential_id = row.get("source_credential_id")
        destination_credential_id = row.get("destination_credential_id")
        destination_target = _as_dict(row.get("destination_target"))

        if source_credential_id is None and has_source_json:
            source_credential_id = await _resolve_legacy_source_credential_id(db, _as_dict(row.get("source")))

        if not destination_target and has_destination_json:
            destination_target = _extract_destination_target(_as_dict(row.get("destination")))

        if destination_credential_id is None and has_destination_json:
            destination_credential_id, migrated_target = await _resolve_legacy_destination_credential(
                db,
                _as_dict(row.get("destination")),
            )
            if not destination_target and migrated_target:
                destination_target = migrated_target

        if row.get("source_credential_id") == source_credential_id and row.get("destination_credential_id") == destination_credential_id and _as_dict(row.get("destination_target")) == destination_target:
            continue

        await db.execute(
            text(
                """
                UPDATE backup_flows
                SET source_credential_id = :source_credential_id,
                    destination_credential_id = :destination_credential_id,
                    destination_target = CAST(:destination_target AS JSONB)
                WHERE id = :flow_id
                """
            ),
            {
                "flow_id": row["id"],
                "source_credential_id": source_credential_id,
                "destination_credential_id": destination_credential_id,
                "destination_target": json.dumps(destination_target) if destination_target else None,
            },
        )
        updated_count += 1

    if updated_count:
        logger.info("Backfilled credential role assignments for %s backup_flows row(s)", updated_count)
    return updated_count


async def _backfill_backup_flow_owners(db: AsyncSession) -> int:
    if not await _table_exists(db, "backup_flows"):
        return 0
    if not await _column_exists(db, "backup_flows", "owner_id"):
        return 0

    result = await db.execute(
        text(
            """
            SELECT id, owner_id, created_by, updated_by
            FROM backup_flows
            ORDER BY created_at ASC
            """
        )
    )
    rows = result.mappings().all()
    updated_count = 0
    fallback_owner_id = await _get_fallback_owner_id(db)

    for row in rows:
        if row["owner_id"] is not None:
            continue

        owner_id = await _lookup_user_id_by_email(db, row.get("created_by"))
        if owner_id is None:
            owner_id = await _lookup_user_id_by_email(db, row.get("updated_by"))
        if owner_id is None:
            owner_id = fallback_owner_id
        if owner_id is None:
            continue

        await db.execute(
            text("UPDATE backup_flows SET owner_id = :owner_id WHERE id = :flow_id"),
            {"owner_id": owner_id, "flow_id": row["id"]},
        )
        updated_count += 1

    if updated_count:
        logger.info("Backfilled owner_id for %s backup_flows row(s)", updated_count)
    return updated_count


async def _backfill_app_credential_owners(db: AsyncSession) -> int:
    if not await _table_exists(db, "app_credentials"):
        return 0
    if not await _column_exists(db, "app_credentials", "owner_id"):
        return 0

    result = await db.execute(
        text(
            """
            SELECT
                ac.id,
                ac.owner_id
            FROM app_credentials ac
            ORDER BY ac.created_at ASC
            """
        )
    )
    rows = result.mappings().all()
    owners_by_credential: Dict[UUID, set[UUID]] = {}
    refs_result = await db.execute(
        text(
            """
            SELECT credential_id, owner_id
            FROM (
                SELECT source_credential_id AS credential_id, owner_id
                FROM backup_flows
                WHERE source_credential_id IS NOT NULL
                  AND owner_id IS NOT NULL
                UNION ALL
                SELECT destination_credential_id AS credential_id, owner_id
                FROM backup_flows
                WHERE destination_credential_id IS NOT NULL
                  AND owner_id IS NOT NULL
            ) credential_refs
            """
        )
    )
    for row in refs_result.mappings().all():
        owners_by_credential.setdefault(row["credential_id"], set()).add(row["owner_id"])

    fallback_owner_id = await _get_fallback_owner_id(db)
    updated_count = 0
    for row in rows:
        if row["owner_id"] is not None:
            continue

        owner_candidates = owners_by_credential.get(row["id"], set())
        owner_id = next(iter(owner_candidates)) if len(owner_candidates) == 1 else None
        if owner_id is None:
            owner_id = fallback_owner_id
        if owner_id is None:
            continue

        await db.execute(
            text("UPDATE app_credentials SET owner_id = :owner_id WHERE id = :credential_id"),
            {"owner_id": owner_id, "credential_id": row["id"]},
        )
        updated_count += 1

    if updated_count:
        logger.info("Backfilled owner_id for %s app_credentials row(s)", updated_count)
    return updated_count


async def _ensure_user_permissions_default(db: AsyncSession) -> bool:
    if not await _table_exists(db, 'users'):
        return False
    if not await _column_exists(db, 'users', 'permissions'):
        return False

    current_default = await _get_column_default(db, 'users', 'permissions')
    if 'pipeline' in current_default:
        return False

    await db.execute(
        text(
            """
            ALTER TABLE users
            ALTER COLUMN permissions SET DEFAULT
            '{"backup":"none","apps":"none","pipeline":"none","automation":"none","settings":"none"}'::jsonb
            """
        )
    )
    logger.info('Updated users.permissions default to include the pipeline module')
    return True


async def _ensure_data_pipeline_tables(db: AsyncSession) -> bool:
    """Create data_pipelines and pipeline_runs tables if missing."""
    if await _table_exists(db, 'data_pipelines'):
        return False

    await db.execute(text("""
        CREATE TABLE data_pipelines (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name VARCHAR(255) NOT NULL,
            description VARCHAR(500),
            owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'draft',
            source_connector_key VARCHAR(50) NOT NULL,
            source_credential_id UUID REFERENCES app_credentials(id) ON DELETE RESTRICT,
            source_stream_key VARCHAR(100),
            source_streams JSONB NOT NULL DEFAULT '[]'::jsonb,
            source_config JSONB,
            dest_connector_key VARCHAR(50) NOT NULL,
            dest_credential_id UUID REFERENCES app_credentials(id) ON DELETE RESTRICT,
            dest_stream_key VARCHAR(100) NOT NULL,
            dest_config JSONB,
            write_mode VARCHAR(20) NOT NULL DEFAULT 'append',
            field_mapping JSONB,
            schedule JSONB,
            last_run_at TIMESTAMPTZ,
            last_run_status VARCHAR(20),
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT check_pipeline_status CHECK (status IN ('draft', 'active', 'paused', 'archived')),
            CONSTRAINT check_pipeline_write_mode CHECK (write_mode IN ('append', 'replace', 'upsert')),
            CONSTRAINT check_pipeline_last_run_status CHECK (last_run_status IS NULL OR last_run_status IN ('pending', 'running', 'completed', 'failed'))
        )
    """))
    await db.execute(text("CREATE INDEX ix_data_pipelines_owner_id ON data_pipelines(owner_id)"))

    await db.execute(text("""
        CREATE TABLE pipeline_runs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            pipeline_id UUID NOT NULL REFERENCES data_pipelines(id) ON DELETE CASCADE,
            status VARCHAR(20) NOT NULL,
            started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            completed_at TIMESTAMPTZ,
            records_read INTEGER,
            records_written INTEGER,
            error_count INTEGER,
            run_config JSONB,
            logs TEXT,
            error_message TEXT,
            triggered_by VARCHAR(100) NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT check_pipeline_run_status CHECK (status IN ('pending', 'running', 'completed', 'failed'))
        )
    """))
    await db.execute(text("CREATE INDEX ix_pipeline_runs_pipeline_id ON pipeline_runs(pipeline_id)"))

    await _ensure_resource_share_constraints(db)

    logger.info('Created data_pipelines and pipeline_runs tables')
    return True


async def _ensure_data_pipeline_columns(db: AsyncSession) -> bool:
    if not await _table_exists(db, 'data_pipelines'):
        return False

    changed = False
    if not await _column_exists(db, 'data_pipelines', 'source_stream_key'):
        await db.execute(text("ALTER TABLE data_pipelines ADD COLUMN source_stream_key VARCHAR(100)"))
        changed = True

    await db.execute(
        text(
            """
            UPDATE data_pipelines
            SET source_stream_key = NULLIF(source_streams->>0, '')
            WHERE source_stream_key IS NULL
              AND jsonb_typeof(source_streams) = 'array'
              AND jsonb_array_length(source_streams) >= 1
            """
        )
    )

    await db.execute(
        text(
            """
            UPDATE data_pipelines
            SET
                status = 'draft',
                source_config = jsonb_set(
                    COALESCE(source_config, '{}'::jsonb),
                    '{legacy_source_streams}',
                    source_streams,
                    true
                )
            WHERE jsonb_typeof(source_streams) = 'array'
              AND jsonb_array_length(source_streams) > 1
            """
        )
    )

    await _ensure_resource_share_constraints(db)
    return True


async def run_startup_schema_migrations(db: AsyncSession) -> None:
    """Upgrade legacy database structures to the current credential-based schema.

    This migration is intentionally idempotent because IntegrationHub currently
    relies on `create_all()` at startup rather than a dedicated migration tool.
    It lets existing Docker volumes with the legacy backup schema boot without
    requiring a destructive database reset.
    """

    changed = False
    if await _ensure_backup_flow_role_columns(db):
        changed = True
    if await _ensure_resource_owner_columns(db):
        changed = True
    if await _ensure_resource_shares_table(db):
        changed = True
    if await _ensure_resource_share_constraints(db):
        changed = True
    if await _ensure_user_permissions_default(db):
        changed = True
    if await _ensure_app_credential_registry_constraints(db):
        changed = True
    if await _migrate_legacy_source_connections(db):
        changed = True
    if await _migrate_legacy_destination_profiles(db):
        changed = True
    if await _backfill_backup_flow_role_assignments(db):
        changed = True
    if await _backfill_backup_flow_owners(db):
        changed = True
    if await _backfill_app_credential_owners(db):
        changed = True
    if await _ensure_data_pipeline_tables(db):
        changed = True
    if await _ensure_data_pipeline_columns(db):
        changed = True

    if changed:
        await db.commit()
        logger.info("Completed startup schema migration for legacy backup flow data")
