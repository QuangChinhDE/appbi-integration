APP_KEY = "workflow"
DISPLAY_NAME = "BaseVN Workflow"
API_PREFIX = "/extapi/v1"

SUCCESS_CODES = {1, 200, True, "1", "200", "ok", "success", "true"}

ENDPOINTS = {
    "get_all_workflows": "/workflows/get",
    "get_workflow": "/workflow/get",
    "get_workflow_stages": "/workflow/stages",
    "get_workflow_jobs": "/workflow/jobs",
    "get_job": "/job/get",
    "get_job_custom_table": "/job/custom.table",
    "get_job_posts": "/job/post/load",
    "get_job_comments": "/job/comment/load",
}