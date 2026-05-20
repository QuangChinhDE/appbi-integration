SERVICE_CONNECTION_SPEC = {
    "test_connection_operation": "get_all_groups",
    "notes": [
        "Use the Base Account access_token_v2 value as access_token.",
        "Pass only the base domain such as base.com.vn; protocol and service. prefix are normalized internally.",
    ],
    "required_fields": [
        {
            "name": "domain",
            "type": "string",
            "example": "base.com.vn",
        },
        {
            "name": "access_token",
            "type": "string",
            "example": "v2_xxxxxxxxxxxxx",
        },
    ],
}

SERVICE_BACKUP_OPERATION_SPECS = {
    "extract_catalog": {
        "summary": "Fetch the global catalog of services, compounds, and groups.",
        "input_schema": None,
        "api_calls": ["service/get.all", "compound/get.all", "group/get.all"],
    },
    "extract_service_inventory": {
        "summary": "Fetch stages and tickets for a single service.",
        "input_schema": "ExtractServiceInventoryInput",
        "required_fields": ["service_id"],
        "api_calls": ["service/get.stages", "ticket/get.all"],
    },
    "extract_ticket": {
        "summary": "Fetch one ticket and optionally enrich it with activity logs or possible actions.",
        "input_schema": "ExtractTicketInput",
        "required_fields": ["ticket_id"],
        "optional_fields": ["username", "include_possible_actions", "activity_log_filters"],
        "api_calls": ["ticket/get.detail", "ticket/get.activity.logs", "ticket/get.possible.actions"],
    },
    "extract_snapshot": {
        "summary": "Fetch inventories for multiple services and optionally hydrate each ticket with details.",
        "input_schema": "ExtractSnapshotInput",
        "required_fields": ["service_ids"],
        "optional_fields": ["include_ticket_details"],
        "api_calls": ["service/get.stages", "ticket/get.all", "ticket/get.detail"],
    },
}

SERVICE_AUTOMATION_OPERATION_SPECS = {
    "get_all_services": {
        "summary": "List all services visible to the token.",
        "input_schema": None,
        "api_calls": ["service/get.all"],
    },
    "get_all_compounds": {
        "summary": "List all compounds visible to the token.",
        "input_schema": None,
        "api_calls": ["compound/get.all"],
    },
    "get_all_groups": {
        "summary": "List all groups visible to the token.",
        "input_schema": None,
        "api_calls": ["group/get.all"],
    },
    "get_service_blocks": {
        "summary": "List stages for a service.",
        "input_schema": "ServiceBlocksInput",
        "required_fields": ["service_id"],
        "api_calls": ["service/get.stages"],
    },
    "get_all_tickets": {
        "summary": "List tickets for a service.",
        "input_schema": "ServiceTicketsInput",
        "required_fields": ["service_id"],
        "api_calls": ["ticket/get.all"],
    },
    "get_ticket_details": {
        "summary": "Get details for a ticket.",
        "input_schema": "TicketDetailsInput",
        "required_fields": ["ticket_id"],
        "api_calls": ["ticket/get.detail"],
    },
    "get_ticket_activity_logs": {
        "summary": "Get activity logs across tickets with optional time filters.",
        "input_schema": "TicketActivityLogFilters",
        "optional_fields": ["absolute_time", "item_per_page", "last_update_from", "last_update_to"],
        "defaults": {
            "absolute_time": 1,
            "item_per_page": 50,
        },
        "api_calls": ["ticket/get.activity.logs"],
    },
    "get_possible_transitions": {
        "summary": "Get transition actions available to a user for a ticket.",
        "input_schema": "TicketTransitionInput",
        "required_fields": ["ticket_id", "username"],
        "api_calls": ["ticket/get.possible.actions"],
    },
    "create_ticket": {
        "summary": "Create a ticket in a specific service block.",
        "input_schema": "CreateTicketInput",
        "required_fields": ["username", "service_id", "block_id", "name"],
        "optional_fields": ["assignees", "followers", "managers", "root_content", "custom_fields"],
        "notes": [
            "custom_fields is the authoritative place for service_* values.",
            "The n8n-only custom_field_ids helper is intentionally omitted because it was not sent in the original /ticket/create payload.",
        ],
        "api_calls": ["ticket/create"],
    },
    "update_ticket": {
        "summary": "Update core ticket fields.",
        "input_schema": "UpdateTicketInput",
        "required_fields": ["service_id", "ticket_id", "username", "name"],
        "optional_fields": ["assignees", "current_ticket_block_id", "followers", "root_content"],
        "api_calls": ["ticket/edit"],
    },
    "update_ticket_custom_fields": {
        "summary": "Update ticket custom fields.",
        "input_schema": "UpdateTicketCustomFieldsInput",
        "required_fields": ["service_id", "ticket_id", "username", "custom_field_ids", "custom_fields"],
        "api_calls": ["ticket/edit.custom.fields"],
    },
    "assign_ticket": {
        "summary": "Assign one or more executors to a ticket.",
        "input_schema": "AssignTicketInput",
        "required_fields": ["ticket_id", "username", "assignees"],
        "api_calls": ["ticket/assign"],
    },
    "execute_ticket": {
        "summary": "Execute a ticket step and optionally submit ticket or block custom fields.",
        "input_schema": "ExecuteTicketInput",
        "required_fields": ["ticket_id", "username"],
        "optional_fields": [
            "current_ticket_block_id",
            "custom_field_ids",
            "intent",
            "name",
            "note",
            "ticket_custom_fields",
            "block_custom_fields",
        ],
        "api_calls": ["ticket/execute"],
    },
    "move_ticket_to_block": {
        "summary": "Move a ticket to a chosen branch or stage.",
        "input_schema": "MoveTicketToBlockInput",
        "required_fields": ["ticket_id", "username", "next_block_id"],
        "optional_fields": ["assignees", "current_ticket_block_id", "managers"],
        "api_calls": ["ticket/move.to.block"],
    },
    "move_ticket_back": {
        "summary": "Move a ticket back to the previous stage.",
        "input_schema": "MoveTicketBackInput",
        "required_fields": ["ticket_id", "username"],
        "optional_fields": ["current_ticket_block_id"],
        "api_calls": ["ticket/move.back"],
    },
}


__all__ = [
    "SERVICE_AUTOMATION_OPERATION_SPECS",
    "SERVICE_BACKUP_OPERATION_SPECS",
    "SERVICE_CONNECTION_SPEC",
]