"""Schedule arithmetic (SRS 17.4).

Pure functions, no database. Timezone-aware because a daily schedule that
silently runs in UTC is the classic version of this bug: "every day at 02:00"
fires at 09:00 for a workspace in Asia/Bangkok, and nobody notices for a week.
"""

from __future__ import annotations

from datetime import datetime, time, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from croniter import croniter

from app.core.errors import ValidationError
from app.models.enums import ScheduleType

MIN_INTERVAL_SECONDS = 60


def resolve_zone(name: str | None, fallback: str = "Asia/Bangkok") -> ZoneInfo:
    try:
        return ZoneInfo(name or fallback)
    except (ZoneInfoNotFoundError, ValueError):
        raise ValidationError(
            f"Múi giờ '{name}' không hợp lệ.",
            code="SCHEDULE_INVALID", details={"field": "timezone"}) from None


def validate(config: dict[str, Any], *, workspace_timezone: str) -> dict[str, Any]:
    """Normalize and check a schedule config, returning what to persist."""
    raw_type = str(config.get("schedule_type") or "INTERVAL").upper()
    try:
        schedule_type = ScheduleType(raw_type)
    except ValueError:
        raise ValidationError(
            f"Kiểu lịch '{raw_type}' không hợp lệ.", code="SCHEDULE_INVALID") from None

    zone_name = str(config.get("timezone") or workspace_timezone)
    resolve_zone(zone_name)

    normalized: dict[str, Any] = {
        "schedule_type": schedule_type.value,
        "timezone": zone_name,
        "overlap_policy": str(config.get("overlap_policy") or "SKIP_IF_RUNNING"),
    }

    if schedule_type is ScheduleType.INTERVAL:
        seconds = int(config.get("interval_seconds") or 0)
        if seconds < MIN_INTERVAL_SECONDS:
            raise ValidationError(
                f"Chu kỳ tối thiểu là {MIN_INTERVAL_SECONDS} giây.",
                code="SCHEDULE_INVALID", details={"field": "interval_seconds"})
        normalized["interval_seconds"] = seconds

    elif schedule_type is ScheduleType.DAILY:
        raw = str(config.get("time_of_day") or "02:00")
        try:
            hour, minute = (int(part) for part in raw.split(":", 1))
            time(hour, minute)
        except (ValueError, TypeError):
            raise ValidationError(
                "Giờ chạy phải theo định dạng HH:MM.",
                code="SCHEDULE_INVALID", details={"field": "time_of_day"}) from None
        normalized["time_of_day"] = f"{hour:02d}:{minute:02d}"

    else:  # CRON
        expression = str(config.get("cron_expression") or "").strip()
        if not croniter.is_valid(expression):
            raise ValidationError(
                "Biểu thức cron không hợp lệ.",
                code="SCHEDULE_INVALID", details={"field": "cron_expression"})
        normalized["cron_expression"] = expression

    return normalized


def next_run_at(
    config: dict[str, Any], *, after: datetime | None = None
) -> datetime:
    """The next fire time, in UTC.

    `after` defaults to now. For INTERVAL this is `after + interval`, which
    means the interval is measured from the last computation rather than from a
    fixed epoch — deliberate, because a paused-then-resumed schedule should not
    fire immediately for every tick it missed (SRS 67: catch-up policy is
    "skip", not "replay").
    """
    base = (after or datetime.now(timezone.utc)).astimezone(timezone.utc)
    schedule_type = ScheduleType(str(config.get("schedule_type") or "INTERVAL"))
    zone = resolve_zone(config.get("timezone"))

    if schedule_type is ScheduleType.INTERVAL:
        return base + timedelta(seconds=int(config.get("interval_seconds") or 3600))

    if schedule_type is ScheduleType.DAILY:
        hour, minute = (int(p) for p in str(config.get("time_of_day") or "02:00").split(":"))
        local = base.astimezone(zone)
        candidate = local.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if candidate <= local:
            candidate += timedelta(days=1)
        return candidate.astimezone(timezone.utc)

    local = base.astimezone(zone)
    cursor = croniter(str(config["cron_expression"]), local)
    return cursor.get_next(datetime).astimezone(timezone.utc)


def preview(config: dict[str, Any], *, count: int = 3) -> list[datetime]:
    """The next N fire times. The editor MUST show these (SRS 17.4).

    Showing them is the cheapest correctness check available to a user: a cron
    expression nobody can read becomes obviously wrong when the panel says the
    next run is in eleven months.
    """
    out: list[datetime] = []
    cursor = datetime.now(timezone.utc)
    for _ in range(max(1, count)):
        cursor = next_run_at(config, after=cursor)
        out.append(cursor)
    return out


def describe(config: dict[str, Any]) -> str:
    """A short human sentence, always naming the timezone."""
    schedule_type = str(config.get("schedule_type") or "INTERVAL")
    zone = config.get("timezone") or "UTC"
    if schedule_type == "INTERVAL":
        seconds = int(config.get("interval_seconds") or 3600)
        if seconds % 86400 == 0:
            return f"Mỗi {seconds // 86400} ngày"
        if seconds % 3600 == 0:
            return f"Mỗi {seconds // 3600} giờ"
        return f"Mỗi {max(1, seconds // 60)} phút"
    if schedule_type == "DAILY":
        return f"Hằng ngày {config.get('time_of_day', '02:00')} ({zone})"
    return f"Cron {config.get('cron_expression', '')} ({zone})"
