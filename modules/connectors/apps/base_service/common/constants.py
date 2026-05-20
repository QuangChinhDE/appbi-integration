APP_KEY = "service"
DISPLAY_NAME = "BaseVN Service"
API_PREFIX = "/extapi/v1"
SUCCESS_CODE = 1

ENDPOINTS = {
    "get_all_services": "/service/get.all",
    "get_all_compounds": "/compound/get.all",
    "get_all_groups": "/group/get.all",
    "get_service_blocks": "/service/get.stages",
    "get_all_tickets": "/ticket/get.all",
    "get_ticket_details": "/ticket/get.detail",
    "get_ticket_activity_logs": "/ticket/get.activity.logs",
    "get_possible_transitions": "/ticket/get.possible.actions",
    "create_ticket": "/ticket/create",
    "update_ticket": "/ticket/edit",
    "update_ticket_custom_fields": "/ticket/edit.custom.fields",
    "assign_ticket": "/ticket/assign",
    "execute_ticket": "/ticket/execute",
    "move_ticket_to_block": "/ticket/move.to.block",
    "move_ticket_back": "/ticket/move.back",
}

TICKET_ACTIONS = [
    "assign_ticket",
    "create_ticket",
    "execute_ticket",
    "get_all_tickets",
    "get_possible_transitions",
    "get_ticket_activity_logs",
    "get_ticket_details",
    "move_ticket_back",
    "move_ticket_to_block",
    "update_ticket",
    "update_ticket_custom_fields",
]

SERVICE_ACTIONS = [
    "get_all_services",
    "get_all_compounds",
    "get_all_groups",
    "get_service_blocks",
]