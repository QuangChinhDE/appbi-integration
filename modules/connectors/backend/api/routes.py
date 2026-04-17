import asyncio
import logging
from typing import Any, List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from modules.backup.shared.types import BackupSourceAppResponse
from modules.connectors.apps.request.common import RequestCredentials, RequestManagementClient
from modules.connectors.apps.service.common import ServiceCredentials, ServiceManagementClient
from modules.connectors.apps.wework.common import WeworkCredentials, WeworkManagementClient, merge_task_collections
from modules.connectors.apps.workflow.common import WorkflowCredentials, WorkflowManagementClient
from modules.connectors.backend.services.source_app_service import BackupSourceAppService
from packages.auth.src import require_permission
from packages.database.src import get_db


router = APIRouter(tags=["connectors"], dependencies=[Depends(require_permission('backup', 'edit'))])
logger = logging.getLogger(__name__)


def _format_preview_exception(exc: Exception) -> str:
    message = str(exc).strip()
    if message:
        return f"{type(exc).__name__}: {message}"
    return type(exc).__name__


def _workflow_preview_id(workflow: dict[str, Any]) -> str | None:
    value = workflow.get("id") or workflow.get("workflow_id")
    if value in (None, ""):
        return None
    return str(value)


def _workflow_preview_name(workflow: dict[str, Any]) -> str:
    workflow_id = _workflow_preview_id(workflow) or "unknown"
    return str(
        workflow.get("name")
        or workflow.get("workflow_name")
        or workflow.get("title")
        or f"Workflow {workflow_id}"
    )


def _job_preview_id(job: dict[str, Any]) -> str | None:
    value = job.get("id") or job.get("job_id") or job.get("hid")
    if value in (None, ""):
        return None
    return str(value)


def _job_preview_name(job: dict[str, Any]) -> str:
    job_id = _job_preview_id(job) or "unknown"
    return str(job.get("name") or job.get("job_name") or job.get("title") or f"Job {job_id}")


def _request_group_preview_id(group: dict[str, Any]) -> str | None:
    value = group.get("id") or group.get("group_id")
    if value in (None, ""):
        return None
    return str(value)


def _request_group_preview_name(group: dict[str, Any]) -> str:
    group_id = _request_group_preview_id(group) or "unknown"
    if group_id == "0":
        return "Đề xuất trực tiếp"
    return str(group.get("name") or group.get("group_name") or f"Group {group_id}")


def _request_preview_id(request: dict[str, Any]) -> str | None:
    value = request.get("id") or request.get("request_id")
    if value in (None, ""):
        return None
    return str(value)


def _request_preview_name(request: dict[str, Any]) -> str:
    request_id = _request_preview_id(request) or "unknown"
    return str(
        request.get("name")
        or request.get("title")
        or request.get("subject")
        or request.get("request_name")
        or f"Request {request_id}"
    )


def _wework_department_preview_id(department: dict[str, Any]) -> str | None:
    value = department.get("id") or department.get("dept_id")
    if value in (None, ""):
        return None
    return str(value)


def _wework_department_preview_name(department: dict[str, Any]) -> str:
    department_id = _wework_department_preview_id(department) or "unknown"
    return str(
        department.get("name")
        or department.get("dept_name")
        or department.get("title")
        or f"Department {department_id}"
    )


def _wework_project_preview_id(project: dict[str, Any]) -> str | None:
    value = project.get("id") or project.get("project_id")
    if value in (None, ""):
        return None
    return str(value)


def _wework_project_preview_name(project: dict[str, Any]) -> str:
    project_id = _wework_project_preview_id(project) or "unknown"
    return str(
        project.get("name")
        or project.get("project_name")
        or project.get("title")
        or f"Project {project_id}"
    )


def _wework_task_preview_id(task: dict[str, Any]) -> str | None:
    value = task.get("id") or task.get("task_id") or task.get("hid")
    if value in (None, ""):
        return None
    return str(value)


def _wework_task_preview_name(task: dict[str, Any]) -> str:
    task_id = _wework_task_preview_id(task) or "unknown"
    return str(
        task.get("name")
        or task.get("task_name")
        or task.get("title")
        or task.get("content")
        or f"Task {task_id}"
    )


@router.post("/api/connectors/service/preview")
async def preview_service_source(payload: dict[str, Any]):
    """Validate Service credentials and return a compact source snapshot for test scoping."""
    domain = str(payload.get("domain") or "").strip()
    access_token = str(payload.get("access_token") or "").strip()
    raw_service_ids = payload.get("service_ids") or []

    if isinstance(raw_service_ids, str):
        requested_service_ids = [item.strip() for item in raw_service_ids.split(",") if item.strip()]
    elif isinstance(raw_service_ids, list):
        requested_service_ids = [str(item).strip() for item in raw_service_ids if str(item).strip()]
    else:
        raise HTTPException(status_code=400, detail="service_ids must be a list of strings")

    try:
        ticket_sample_limit = max(int(payload.get("ticket_sample_limit") or 2), 1)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="ticket_sample_limit must be a positive integer") from exc

    try:
        detail_service_limit = min(max(int(payload.get("detail_service_limit") or 2), 1), 10)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="detail_service_limit must be a positive integer") from exc

    if not domain or not access_token:
        raise HTTPException(status_code=400, detail="domain and access_token are required")

    try:
        credentials = ServiceCredentials(domain=domain, access_token=access_token)
        async with ServiceManagementClient(credentials) as client:
            services = await client.get_all_services(selector="services")
            if not isinstance(services, list):
                services = []

            preview_semaphore = asyncio.Semaphore(4)
            summaries: list[dict[str, Any]] = []
            summary_by_id: dict[str, dict[str, Any]] = {}

            for service in services:
                if not isinstance(service, dict):
                    continue
                service_id = service.get("id") or service.get("service_id")
                if not service_id:
                    continue
                summary = {
                    "service_id": str(service_id),
                    "service_name": str(service.get("name") or service.get("service_name") or f"Service {service_id}"),
                    "group_id": service.get("group_id"),
                    "compound_id": service.get("compound_id"),
                    "stage_count": None,
                    "ticket_count": None,
                    "detail_loaded": False,
                    "preview_error": None,
                    "sample_tickets": [],
                }
                summaries.append(summary)
                summary_by_id[summary["service_id"]] = summary

            if requested_service_ids:
                detail_service_ids = [service_id for service_id in requested_service_ids if service_id in summary_by_id][:detail_service_limit]
            else:
                detail_service_ids = [summary["service_id"] for summary in summaries[:detail_service_limit]]

            async def hydrate_summary(summary: dict[str, Any]) -> None:
                service_id = summary["service_id"]
                async with preview_semaphore:
                    stages_task = client.get_service_blocks(str(service_id), selector="stages")
                    tickets_task = client.get_all_tickets(str(service_id), selector="tickets")

                    stages_result, tickets_result = await asyncio.gather(
                        stages_task,
                        tickets_task,
                        return_exceptions=True,
                    )

                preview_errors: list[str] = []
                if isinstance(stages_result, Exception):
                    formatted_error = _format_preview_exception(stages_result)
                    logger.warning(
                        "Service preview could not load stages for service_id=%s domain=%s: %s",
                        service_id,
                        domain,
                        formatted_error,
                    )
                    stages = []
                    preview_errors.append(f"stages: {formatted_error}")
                else:
                    stages = stages_result

                if isinstance(tickets_result, Exception):
                    formatted_error = _format_preview_exception(tickets_result)
                    logger.warning(
                        "Service preview could not load tickets for service_id=%s domain=%s: %s",
                        service_id,
                        domain,
                        formatted_error,
                    )
                    tickets = []
                    preview_errors.append(f"tickets: {formatted_error}")
                else:
                    tickets = tickets_result

                stage_list = stages if isinstance(stages, list) else []
                ticket_list = tickets if isinstance(tickets, list) else []
                sample_tickets = [ticket for ticket in ticket_list[:ticket_sample_limit] if isinstance(ticket, dict)]

                summary["stage_count"] = len(stage_list)
                summary["ticket_count"] = len(ticket_list)
                summary["detail_loaded"] = True
                summary["preview_error"] = "; ".join(preview_errors) if preview_errors else None
                summary["sample_tickets"] = [
                    {
                        "ticket_id": str(ticket.get("root_id") or ticket.get("id") or ""),
                        "ticket_code": ticket.get("root_code") or ticket.get("code") or ticket.get("id"),
                        "ticket_name": ticket.get("name") or ticket.get("title") or ticket.get("subject") or "Untitled ticket",
                    }
                    for ticket in sample_tickets
                ]

            await asyncio.gather(
                *(hydrate_summary(summary_by_id[service_id]) for service_id in detail_service_ids if service_id in summary_by_id)
            )

        return {
            "domain": credentials.domain,
            "service_count": len(summaries),
            "total_ticket_count": sum(int(item.get("ticket_count") or 0) for item in summaries),
            "partial_error_count": sum(1 for item in summaries if item.get("preview_error")),
            "detail_loaded_count": sum(1 for item in summaries if item.get("detail_loaded")),
            "ticket_count_complete": len(summaries) == sum(1 for item in summaries if item.get("detail_loaded")),
            "detail_service_ids": detail_service_ids,
            "services": summaries,
        }
    except Exception as exc:
        logger.exception("Service preview failed for domain=%s", domain)
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/api/connectors/workflow/preview")
async def preview_workflow_source(payload: dict[str, Any]):
    """Validate Workflow credentials and return a compact source snapshot for scoping."""
    domain = str(payload.get("domain") or "").strip()
    access_token = str(payload.get("access_token") or "").strip()
    raw_workflow_ids = payload.get("workflow_ids") or []

    if isinstance(raw_workflow_ids, str):
        requested_workflow_ids = [item.strip() for item in raw_workflow_ids.split(",") if item.strip()]
    elif isinstance(raw_workflow_ids, list):
        requested_workflow_ids = [str(item).strip() for item in raw_workflow_ids if str(item).strip()]
    else:
        raise HTTPException(status_code=400, detail="workflow_ids must be a list of strings")

    try:
        job_sample_limit = max(int(payload.get("job_sample_limit") or 2), 1)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="job_sample_limit must be a positive integer") from exc

    try:
        detail_workflow_limit = min(max(int(payload.get("detail_workflow_limit") or 5), 1), 20)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="detail_workflow_limit must be a positive integer") from exc

    if not domain or not access_token:
        raise HTTPException(status_code=400, detail="domain and access_token are required")

    try:
        credentials = WorkflowCredentials(domain=domain, access_token=access_token)
        async with WorkflowManagementClient(credentials) as client:
            workflows = await client.get_all_workflows()
            preview_semaphore = asyncio.Semaphore(4)
            summaries: list[dict[str, Any]] = []
            summary_by_id: dict[str, dict[str, Any]] = {}

            for workflow in workflows:
                if not isinstance(workflow, dict):
                    continue
                workflow_id = _workflow_preview_id(workflow)
                if not workflow_id:
                    continue
                summary = {
                    "workflow_id": workflow_id,
                    "workflow_name": _workflow_preview_name(workflow),
                    "stage_count": None,
                    "job_count": None,
                    "detail_loaded": False,
                    "preview_error": None,
                    "sample_jobs": [],
                }
                summaries.append(summary)
                summary_by_id[workflow_id] = summary

            if requested_workflow_ids:
                detail_workflow_ids = [workflow_id for workflow_id in requested_workflow_ids if workflow_id in summary_by_id][:detail_workflow_limit]
            else:
                detail_workflow_ids = [summary["workflow_id"] for summary in summaries[:detail_workflow_limit]]

            async def hydrate_summary(summary: dict[str, Any]) -> None:
                workflow_id = summary["workflow_id"]
                async with preview_semaphore:
                    stages_task = client.get_workflow_stages(workflow_id)
                    jobs_task = client.get_workflow_jobs(workflow_id)
                    stages_result, jobs_result = await asyncio.gather(
                        stages_task,
                        jobs_task,
                        return_exceptions=True,
                    )

                preview_errors: list[str] = []
                if isinstance(stages_result, Exception):
                    formatted_error = _format_preview_exception(stages_result)
                    logger.warning(
                        "Workflow preview could not load stages for workflow_id=%s domain=%s: %s",
                        workflow_id,
                        domain,
                        formatted_error,
                    )
                    stages = []
                    preview_errors.append(f"stages: {formatted_error}")
                else:
                    stages = stages_result

                if isinstance(jobs_result, Exception):
                    formatted_error = _format_preview_exception(jobs_result)
                    logger.warning(
                        "Workflow preview could not load jobs for workflow_id=%s domain=%s: %s",
                        workflow_id,
                        domain,
                        formatted_error,
                    )
                    jobs = []
                    preview_errors.append(f"jobs: {formatted_error}")
                else:
                    jobs = jobs_result

                stage_list = stages if isinstance(stages, list) else []
                job_list = jobs if isinstance(jobs, list) else []
                sample_jobs = [job for job in job_list[:job_sample_limit] if isinstance(job, dict)]

                summary["stage_count"] = len(stage_list)
                summary["job_count"] = len(job_list)
                summary["detail_loaded"] = True
                summary["preview_error"] = "; ".join(preview_errors) if preview_errors else None
                summary["sample_jobs"] = [
                    {
                        "job_id": _job_preview_id(job) or "",
                        "job_code": job.get("code") or job.get("job_code") or job.get("hid") or _job_preview_id(job),
                        "job_name": _job_preview_name(job),
                    }
                    for job in sample_jobs
                ]

            await asyncio.gather(
                *(hydrate_summary(summary_by_id[workflow_id]) for workflow_id in detail_workflow_ids if workflow_id in summary_by_id)
            )

        return {
            "domain": credentials.domain,
            "workflow_count": len(summaries),
            "total_job_count": sum(int(item.get("job_count") or 0) for item in summaries),
            "partial_error_count": sum(1 for item in summaries if item.get("preview_error")),
            "detail_loaded_count": sum(1 for item in summaries if item.get("detail_loaded")),
            "job_count_complete": len(summaries) == sum(1 for item in summaries if item.get("detail_loaded")),
            "detail_workflow_ids": detail_workflow_ids,
            "workflows": summaries,
        }
    except Exception as exc:
        logger.exception("Workflow preview failed for domain=%s", domain)
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/api/connectors/request/preview")
async def preview_request_source(payload: dict[str, Any]):
    """Validate Request credentials and return a compact group snapshot for scoping."""
    domain = str(payload.get("domain") or "").strip()
    access_token = str(payload.get("access_token") or "").strip()
    raw_group_ids = payload.get("group_ids") or []

    if isinstance(raw_group_ids, str):
        requested_group_ids = [item.strip() for item in raw_group_ids.split(",") if item.strip()]
    elif isinstance(raw_group_ids, list):
        requested_group_ids = [str(item).strip() for item in raw_group_ids if str(item).strip()]
    else:
        raise HTTPException(status_code=400, detail="group_ids must be a list of strings")

    try:
        request_sample_limit = max(int(payload.get("request_sample_limit") or 2), 1)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="request_sample_limit must be a positive integer") from exc

    try:
        detail_group_limit = min(max(int(payload.get("detail_group_limit") or 5), 1), 20)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="detail_group_limit must be a positive integer") from exc

    if not domain or not access_token:
        raise HTTPException(status_code=400, detail="domain and access_token are required")

    try:
        credentials = RequestCredentials(domain=domain, access_token=access_token)
        async with RequestManagementClient(credentials) as client:
            groups = await client.get_all_groups()
            preview_semaphore = asyncio.Semaphore(4)
            summaries: list[dict[str, Any]] = []
            summary_by_id: dict[str, dict[str, Any]] = {}

            for group in groups:
                if not isinstance(group, dict):
                    continue
                group_id = _request_group_preview_id(group)
                if not group_id:
                    continue
                summary = {
                    "group_id": group_id,
                    "group_name": _request_group_preview_name(group),
                    "request_count": None,
                    "detail_loaded": False,
                    "preview_error": None,
                    "sample_requests": [],
                    "is_direct": False,
                }
                summaries.append(summary)
                summary_by_id[group_id] = summary

            direct_summary = {
                "group_id": "0",
                "group_name": "Đề xuất trực tiếp",
                "request_count": None,
                "detail_loaded": False,
                "preview_error": None,
                "sample_requests": [],
                "is_direct": True,
            }
            summaries.append(direct_summary)
            summary_by_id["0"] = direct_summary

            if requested_group_ids:
                detail_group_ids = [group_id for group_id in requested_group_ids if group_id in summary_by_id][:detail_group_limit]
            else:
                detail_group_ids = [summary["group_id"] for summary in summaries[:detail_group_limit]]

            async def hydrate_summary(summary: dict[str, Any]) -> None:
                group_id = summary["group_id"]
                async with preview_semaphore:
                    requests_result = await asyncio.gather(
                        client.get_requests(group_id=group_id),
                        return_exceptions=True,
                    )

                request_result = requests_result[0]
                preview_errors: list[str] = []
                if isinstance(request_result, Exception):
                    formatted_error = _format_preview_exception(request_result)
                    logger.warning(
                        "Request preview could not load requests for group_id=%s domain=%s: %s",
                        group_id,
                        domain,
                        formatted_error,
                    )
                    request_list = []
                    preview_errors.append(f"requests: {formatted_error}")
                else:
                    request_list = request_result if isinstance(request_result, list) else []

                sample_requests = [request for request in request_list[:request_sample_limit] if isinstance(request, dict)]

                summary["request_count"] = len(request_list)
                summary["detail_loaded"] = True
                summary["preview_error"] = "; ".join(preview_errors) if preview_errors else None
                summary["sample_requests"] = [
                    {
                        "request_id": _request_preview_id(request) or "",
                        "request_code": request.get("code") or request.get("request_code") or request.get("hid") or _request_preview_id(request),
                        "request_name": _request_preview_name(request),
                    }
                    for request in sample_requests
                ]

            await asyncio.gather(
                *(hydrate_summary(summary_by_id[group_id]) for group_id in detail_group_ids if group_id in summary_by_id)
            )

        return {
            "domain": credentials.domain,
            "group_count": sum(1 for item in summaries if not item.get("is_direct")),
            "selectable_source_count": len(summaries),
            "includes_direct_requests": True,
            "total_request_count": sum(int(item.get("request_count") or 0) for item in summaries),
            "partial_error_count": sum(1 for item in summaries if item.get("preview_error")),
            "detail_loaded_count": sum(1 for item in summaries if item.get("detail_loaded")),
            "request_count_complete": len(summaries) == sum(1 for item in summaries if item.get("detail_loaded")),
            "detail_group_ids": detail_group_ids,
            "groups": summaries,
        }
    except Exception as exc:
        logger.exception("Request preview failed for domain=%s", domain)
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/api/connectors/wework/preview")
async def preview_wework_source(payload: dict[str, Any]):
    """Validate Wework credentials and return a compact project snapshot for scoping."""
    domain = str(payload.get("domain") or "").strip()
    access_token = str(payload.get("access_token") or "").strip()
    raw_project_ids = payload.get("project_ids") or []

    if isinstance(raw_project_ids, str):
        requested_project_ids = [item.strip() for item in raw_project_ids.split(",") if item.strip()]
    elif isinstance(raw_project_ids, list):
        requested_project_ids = [str(item).strip() for item in raw_project_ids if str(item).strip()]
    else:
        raise HTTPException(status_code=400, detail="project_ids must be a list of strings")

    try:
        task_sample_limit = max(int(payload.get("task_sample_limit") or 3), 1)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="task_sample_limit must be a positive integer") from exc

    try:
        detail_project_limit = min(max(int(payload.get("detail_project_limit") or 5), 1), 20)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="detail_project_limit must be a positive integer") from exc

    if not domain or not access_token:
        raise HTTPException(status_code=400, detail="domain and access_token are required")

    try:
        credentials = WeworkCredentials(domain=domain, access_token=access_token)
        async with WeworkManagementClient(credentials) as client:
            catalog_warning = None
            try:
                departments = await client.get_all_departments()
            except Exception as exc:
                formatted_error = _format_preview_exception(exc)
                logger.warning(
                    "Wework preview could not load departments for domain=%s: %s",
                    domain,
                    formatted_error,
                )
                departments = []
                catalog_warning = f"departments: {formatted_error}"

            department_name_by_id = {
                department_id: _wework_department_preview_name(department)
                for department in departments
                if (department_id := _wework_department_preview_id(department))
            }

            projects = await client.get_all_projects()
            preview_semaphore = asyncio.Semaphore(4)
            summaries: list[dict[str, Any]] = []
            summary_by_id: dict[str, dict[str, Any]] = {}

            for project in projects:
                if not isinstance(project, dict):
                    continue
                project_id = _wework_project_preview_id(project)
                if not project_id:
                    continue

                department_id = project.get("dept_id") or project.get("department_id") or project.get("group_id")
                department_id_text = str(department_id) if department_id not in (None, "") else None

                summary = {
                    "project_id": project_id,
                    "project_name": _wework_project_preview_name(project),
                    "department_id": department_id_text,
                    "department_name": department_name_by_id.get(department_id_text) if department_id_text else None,
                    "task_count": None,
                    "top_level_task_count": None,
                    "subtask_count": None,
                    "tasklist_count": None,
                    "detail_loaded": False,
                    "preview_error": None,
                    "sample_tasks": [],
                }
                summaries.append(summary)
                summary_by_id[project_id] = summary

            if requested_project_ids:
                detail_project_ids = [project_id for project_id in requested_project_ids if project_id in summary_by_id][:detail_project_limit]
            else:
                detail_project_ids = [summary["project_id"] for summary in summaries[:detail_project_limit]]

            async def hydrate_summary(summary: dict[str, Any]) -> None:
                project_id = summary["project_id"]
                async with preview_semaphore:
                    snapshot_result = await asyncio.gather(
                        client.get_project_snapshot(project_id),
                        return_exceptions=True,
                    )

                preview_errors: list[str] = []
                snapshot_payload = snapshot_result[0]
                if isinstance(snapshot_payload, Exception):
                    formatted_error = _format_preview_exception(snapshot_payload)
                    logger.warning(
                        "Wework preview could not load project details for project_id=%s domain=%s: %s",
                        project_id,
                        domain,
                        formatted_error,
                    )
                    snapshot = {"project": {}, "tasklists": [], "tasks": [], "subtasks": []}
                    preview_errors.append(f"project.get.full: {formatted_error}")
                else:
                    snapshot = snapshot_payload

                project_info = snapshot.get("project") or {}
                tasklists = snapshot.get("tasklists") or []
                tasks = snapshot.get("tasks") or []
                subtasks = snapshot.get("subtasks") or []
                merged_tasks = merge_task_collections(tasks, subtasks)

                department_id = summary.get("department_id") or project_info.get("dept_id") or project_info.get("department_id")
                department_id_text = str(department_id) if department_id not in (None, "") else None
                if department_id_text and not summary.get("department_name"):
                    summary["department_name"] = department_name_by_id.get(department_id_text)
                    summary["department_id"] = department_id_text

                summary["task_count"] = len(merged_tasks)
                summary["top_level_task_count"] = sum(
                    1
                    for task in merged_tasks
                    if str(task.get("parent_id") or "0") in ("0", "", "None", "null")
                )
                summary["subtask_count"] = sum(
                    1
                    for task in merged_tasks
                    if str(task.get("parent_id") or "0") not in ("0", "", "None", "null")
                )
                summary["tasklist_count"] = len(tasklists)
                summary["detail_loaded"] = True
                summary["preview_error"] = "; ".join(preview_errors) if preview_errors else None
                summary["sample_tasks"] = [
                    {
                        "task_id": _wework_task_preview_id(task) or "",
                        "task_name": _wework_task_preview_name(task),
                        "parent_id": str(task.get("parent_id") or "0"),
                    }
                    for task in merged_tasks[:task_sample_limit]
                ]

            await asyncio.gather(
                *(hydrate_summary(summary_by_id[project_id]) for project_id in detail_project_ids if project_id in summary_by_id)
            )

        return {
            "domain": credentials.domain,
            "department_count": len(department_name_by_id),
            "project_count": len(summaries),
            "total_task_count": sum(int(item.get("task_count") or 0) for item in summaries),
            "partial_error_count": sum(1 for item in summaries if item.get("preview_error")),
            "detail_loaded_count": sum(1 for item in summaries if item.get("detail_loaded")),
            "task_count_complete": len(summaries) == sum(1 for item in summaries if item.get("detail_loaded")),
            "detail_project_ids": detail_project_ids,
            "catalog_warning": catalog_warning,
            "projects": summaries,
        }
    except Exception as exc:
        logger.exception("Wework preview failed for domain=%s", domain)
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/api/source-apps", response_model=List[BackupSourceAppResponse])
async def list_source_apps(db: AsyncSession = Depends(get_db)):
    """List all active source app API definitions."""
    service = BackupSourceAppService(db)
    return await service.list_source_apps()


@router.get("/api/source-apps/{app_id}", response_model=BackupSourceAppResponse)
async def get_source_app(
    app_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Get full API step definitions for a specific source app."""
    service = BackupSourceAppService(db)
    app = await service.get_source_app(app_id)
    if not app:
        raise HTTPException(status_code=404, detail=f"Source app '{app_id}' not found")
    return app