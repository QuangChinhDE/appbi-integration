# BaseVN Service Connector

This connector adapts the API operations from the external `n8n-nodes-basevn-service`
repository into the platform connector structure.

- `common/`: authentication, transport, manifest, and shared client helpers
- `common/schemas.py`: platform-native input contracts for backup and automation operations
- `common/operation_specs.py`: serializable operation metadata for future UI forms and test runners
- `backup/`: read-side extractors for future Service backup flows
- `automation/`: action and trigger helpers for future workflow automation

The external n8n node source remains available under `external/n8n-nodes-basevn-service`
as the reference implementation for endpoint behavior and payload shape.

This module no longer mirrors n8n field collections directly. The internal contract is now:

- normalized credentials in `auth.py`
- validated input schemas in `common/schemas.py`
- plain operation specs in `common/operation_specs.py`

Key normalization rules:

- `domain` accepts `base.com.vn`, `service.base.com.vn`, or a full URL and is normalized to the base domain
- assignee-like fields accept either a comma-separated string or a string list
- custom fields accept either a mapping or a list of `{name, value}` entries, then add `service_` or `custom_` prefixes automatically

Intentionally omitted from the system contract:

- `create_ticket.custom_field_ids`: the original n8n node exposed this helper in the UI, but it was not actually sent in the `/ticket/create` payload. In this connector, only `custom_fields` is treated as authoritative for ticket creation.