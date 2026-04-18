APP_KEY = "crm"
DISPLAY_NAME = "Base CRM"
API_PREFIX_LEAD = ""
API_PREFIX_DEAL = "/sales/v1"

SUCCESS_CODES = {0, "0"}  # CRM uses error_code === 0 for success

LEAD_ENDPOINTS = {
    "lead_list": "/lead/list",
    "lead_get": "/lead/get",
    "lead_services": "/lead/services",
    "lead_gets_byphone": "/lead/gets.byphone",
    "lead_feed_list": "/lead/feed/list",
    "lead_feed_note": "/lead/feed/note",
    "lead_feed_calllog": "/lead/feed/calllog",
    "lead_feed_meetinglog": "/lead/feed/meetinglog",
    "lead_feed_log": "/lead/feed/log",
}

DEAL_ENDPOINTS = {
    "pipeline_all": "/pipeline/all",
    "pipeline_get": "/pipeline/get",
    "pipeline_get_stages": "/pipeline/get.stages",
    "pipeline_get_segments": "/pipeline/get.segments",
    "pipeline_get_logs": "/pipeline/get.logs",
    "pipeline_deals": "/pipeline/deals",
    "deal_create": "/deal/create",
    "deal_get": "/deal/get",
    "deal_get_activities": "/deal/get.activities",
    "deal_edit_basic": "/deal/edit.basic",
    "deal_edit_owner": "/deal/edit.owner",
    "deal_edit_status": "/deal/edit.status",
    "deal_remove": "/deal/remove",
    "account_create": "/account/create",
    "account_get": "/account/get",
    "account_get_activities": "/account/get.activities",
    "account_list": "/account/list",
    "account_service_all": "/account/service/all",
    "account_service_get_segments": "/account/service/get.segments",
    "account_edit": "/account/edit",
    "account_edit_owner": "/account/edit.owner",
    "account_edit_followers": "/account/edit.followers",
    "account_remove": "/account/remove",
    "contact_create": "/contact/create",
    "contact_get": "/contact/get",
    "contact_get_activities": "/contact/get.activities",
    "contact_list": "/contact/list",
    "contact_service_all": "/contact/service/all",
    "contact_service_get_segments": "/contact/service/get.segments",
    "contact_edit": "/contact/edit",
    "contact_edit_owner": "/contact/edit.owner",
    "contact_edit_status": "/contact/edit.status",
    "feed_create_note": "/feed/create/note",
    "feed_create_calllog": "/feed/create/calllog",
    "feed_create_meetinglog": "/feed/create/meetinglog",
    "feed_create_quicklog": "/feed/create/quicklog",
}
