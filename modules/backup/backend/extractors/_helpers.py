"""
Shared utility helpers for backup extractors.

These were originally defined in request/backup/extractor.py and imported
by all four extractors. Now centralised in the backup module.
"""
from __future__ import annotations

import re
from datetime import datetime
from io import BytesIO
from typing import Any, Iterable, Optional

import pandas as pd


def sanitize_name(name: str) -> str:
    """Remove characters that are invalid in folder/file names."""
    return re.sub(r'[/\\:*?"<>|]', "_", name or "").strip(". ")


def truncate_name(name: str, max_length: int = 50) -> str:
    if len(name) <= max_length:
        return name
    return name[:max_length] + "..."


def ts_to_str(timestamp: Any) -> str:
    """Convert Unix timestamp → 'dd/MM/yyyy HH:MM:SS' string."""
    try:
        if timestamp:
            return datetime.fromtimestamp(int(timestamp)).strftime("%d/%m/%Y %H:%M:%S")
    except Exception:
        pass
    return ""


def extract_usernames(users: Any) -> str:
    if not users or not isinstance(users, list):
        return ""
    return ", ".join(
        filter(None, [u.get("username", "") for u in users if isinstance(u, dict)])
    )


def count_table_fields(form: Any) -> int:
    if not form or not isinstance(form, list):
        return 0
    return sum(
        1
        for item in form
        if isinstance(item, dict) and item.get("type") in ["input-table", "select-master"]
    )


def strip_html(text: str) -> str:
    return re.sub(r"<[^>]+>", "", text or "").strip()


def build_excel_bytes(
    df: pd.DataFrame,
    *,
    hyperlink_columns: Iterable[str] | None = None,
) -> bytes:
    buf = BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        df.to_excel(writer, index=False)

        worksheet = writer.book.active
        header_index = {
            str(cell.value): idx
            for idx, cell in enumerate(worksheet[1], start=1)
            if cell.value not in (None, "")
        }
        for column_name in hyperlink_columns or ():
            column_index = header_index.get(str(column_name))
            if not column_index:
                continue
            for row_index in range(2, worksheet.max_row + 1):
                cell = worksheet.cell(row=row_index, column=column_index)
                url = str(cell.value or '').strip()
                if not url:
                    continue
                cell.hyperlink = url
                cell.style = 'Hyperlink'

    buf.seek(0)
    return buf.read()


def is_google_sheets_destination(destination_type: Optional[str]) -> bool:
    return str(destination_type or "").strip().lower() == "gsheets"


def normalize_google_sheet_filename(filename: str) -> str:
    lowered = filename.lower()
    for extension in (".xlsx", ".xls", ".csv", ".tsv"):
        if lowered.endswith(extension):
            return filename[: -len(extension)]
    return filename
