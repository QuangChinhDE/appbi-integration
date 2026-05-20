APP_KEY = "onedrive"
DISPLAY_NAME = "OneDrive"

GRAPH_API = "https://graph.microsoft.com/v1.0"
TOKEN_ENDPOINT_TEMPLATE = "https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"

ROOT_ITEM_ID = "root"
FOLDER_MIME = "application/vnd.microsoft.graph.folder"
XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

DEFAULT_GRAPH_SCOPES = (
    "offline_access",
    "Files.ReadWrite.All",
    "User.Read",
)

