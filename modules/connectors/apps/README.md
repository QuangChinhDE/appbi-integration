# Connector App Packages

`modules/connectors/apps/<app-id>` is the app-definition boundary for an external
system. Business modules such as Backup, Pipeline, and Automation should bind a
credential and call the shared connector runtime; app-specific API behavior
belongs inside the app package.

Base products use explicit `base_*` app ids, e.g. `base_workflow`,
`base_service`, `base_crm`. Do not collapse them to generic names such as
`workflow` or `crm`; those names are reserved for non-Base apps that may be
added later.

Legacy short ids are accepted only as read-time aliases while no exact package
with that name exists. New definitions and payloads must use the canonical
folder name.

## Standard Layout

```text
modules/connectors/apps/<app-id>/
  definition/
    catalog.py             # Packaged ConnectorDefinition for the app.
    manifest.yaml          # Optional declarative API, stream, schema, and capability definition.
  common/
    auth.py                # Credential normalization and auth payload models.
    client.py              # Low-level API client when declarative runtime is not enough.
    constants.py           # Endpoint maps, API prefixes, status codes.
    schemas.py             # Optional app-specific input/output schemas.
    rules.py               # Optional app-specific data rules or transforms.
  automation/
    actions.py             # Optional Automation actions.
    triggers.py            # Optional Automation triggers.
  frontend/
    CredentialForm.jsx     # Required app-owned credential UI entrypoint.
  connector.py             # Runtime adapter implementing BaseConnector.
  README.md                # Optional app notes and operational constraints.
```

## Rules

- `definition/catalog.py` is the required packaged definition boundary for
  every app until it moves fully to declarative runtime.
- `definition/manifest.yaml` is the preferred declarative source for stream and
  endpoint metadata. Root-level `manifest.yaml` remains supported only for
  migration.
- `connector.py` should be a thin runtime adapter. Heavy API behavior belongs in
  `definition/` or `common/`.
- Business modules must not import app internals for generic integration work.
  Direct imports from `common/` are allowed only for specialized app flows that
  have not moved to shared runtime yet.
- `frontend/CredentialForm.jsx` may wrap a shared form implementation, but the
  import boundary should stay inside the app package.
- New storage providers or destination apps should be added as connector app
  packages, not as Backup-specific code paths.
