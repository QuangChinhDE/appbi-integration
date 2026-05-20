from __future__ import annotations

from typing import Any, Mapping


def extract_service_custom_fields(payload: Mapping[str, Any]) -> dict[str, Any]:
    return {
        key: value
        for key, value in payload.items()
        if key.startswith("service_")
    }


def normalize_service_webhook_payload(
    body: Mapping[str, Any],
    *,
    mode: str = "body",
    headers: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    if mode == "full":
        return {
            "headers": dict(headers or {}),
            "body": dict(body),
        }

    if mode == "ticket_info":
        custom_fields = extract_service_custom_fields(body)
        normalized = {
            "id": body.get("id"),
            "type": body.get("type"),
            "name": body.get("name"),
            "content": body.get("content"),
            "status": body.get("status"),
            "username": body.get("username"),
            "user_id": body.get("user_id"),
            "root_id": body.get("root_id"),
            "root_name": body.get("root_name"),
            "root_content": body.get("root_content"),
            "block_id": body.get("block_id"),
            "block_metatype": body.get("block_metatype"),
            "service_id": body.get("service_id"),
            "group_id": body.get("group_id"),
            "prev_id": body.get("prev_id"),
            "created_at": body.get("since"),
            "updated_at": body.get("last_update"),
            "started_at": body.get("start_ticket_at"),
            "link": body.get("link"),
            "followers": body.get("followers"),
        }
        if custom_fields:
            normalized["custom_fields"] = custom_fields
        return normalized

    return dict(body)