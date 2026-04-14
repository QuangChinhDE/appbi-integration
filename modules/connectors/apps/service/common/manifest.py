from modules.connectors.apps.service.common.constants import SERVICE_ACTIONS, TICKET_ACTIONS
from modules.connectors.apps.service.common.operation_specs import (
    SERVICE_AUTOMATION_OPERATION_SPECS,
    SERVICE_BACKUP_OPERATION_SPECS,
    SERVICE_CONNECTION_SPEC,
)


SERVICE_CONNECTOR_MANIFEST = {
    "key": "service",
    "display_name": "BaseVN Service",
    "auth": {
        "type": "token",
        "fields": ["domain", "access_token"],
        "docs": "https://service.{domain}/extapi/v1",
        "test_connection": SERVICE_CONNECTION_SPEC,
    },
    "supports": {
        "backup": True,
        "automation": True,
        "webhook_trigger": True,
    },
    "backup": {
        "catalog_resources": ["services", "compounds", "groups"],
        "service_resources": ["stages", "tickets", "ticket_details", "activity_logs"],
        "operations": SERVICE_BACKUP_OPERATION_SPECS,
    },
    "automation": {
        "resources": {
            "service": SERVICE_ACTIONS,
            "ticket": TICKET_ACTIONS,
        },
        "operations": SERVICE_AUTOMATION_OPERATION_SPECS,
        "triggers": ["incoming_webhook"],
    },
}