import asyncio
import logging
from typing import Any, List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from modules.backup.shared.types import BackupSourceAppResponse
from modules.connectors.apps.service.common import ServiceCredentials, ServiceManagementClient
from modules.connectors.backend.services.source_app_service import BackupSourceAppService
from packages.database.src import get_db


router = APIRouter(tags=["connectors"])
logger = logging.getLogger(__name__)


def _format_preview_exception(exc: Exception) -> str:
    message = str(exc).strip()
    if message:
        return f"{type(exc).__name__}: {message}"
    return type(exc).__name__


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