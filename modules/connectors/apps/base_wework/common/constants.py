APP_KEY = "wework"
DISPLAY_NAME = "BaseVN WeWork"
API_PREFIX = "/extapi/v3"

SUCCESS_CODES = {1, 200, True, "1", "200", "ok", "success", "true"}

ENDPOINTS = {
    "get_all_departments": "/dept/list",
    "get_department": "/dept/get",
    "get_all_projects": "/project/list",
    "get_project_full": "/project/get.full",
    "get_task": "/task/get",
    "get_project_tasks": "/task/project",
    "get_tasklist": "/tasklist/get",
    "create_department": "/dept/create",
    "create_project": "/project/create",
    "create_task": "/task/create",
    "create_subtask": "/subtask/create",
}