"""Normalized error envelope (SRS 23.2) and the error UX matrix (SRS 34).

Nothing raw from the engine reaches the browser. Every failure becomes one of
these codes, carrying a human message and — where one exists — the next action
the UI turns into a button. A stack trace, an n8n error class name or a node
type is never part of that.
"""

from __future__ import annotations

from enum import Enum
from typing import Any


class ErrorCategory(str, Enum):
    AUTHENTICATION = "AUTHENTICATION"
    PERMISSION = "PERMISSION"
    VALIDATION = "VALIDATION"
    CONFIGURATION = "CONFIGURATION"
    EXPRESSION = "EXPRESSION"
    NETWORK = "NETWORK"
    RATE_LIMIT = "RATE_LIMIT"
    TIMEOUT = "TIMEOUT"
    CONFLICT = "CONFLICT"
    NOT_FOUND = "NOT_FOUND"
    QUOTA = "QUOTA"
    ENGINE = "ENGINE"
    CANCELLED = "CANCELLED"
    NODE = "NODE"
    UNKNOWN = "UNKNOWN"


class AppError(Exception):
    """Every failure the FE can see travels as one of these."""

    status_code = 400
    code = "BAD_REQUEST"
    category = ErrorCategory.VALIDATION
    message = "Yêu cầu không hợp lệ."

    def __init__(
        self,
        message: str | None = None,
        *,
        code: str | None = None,
        category: ErrorCategory | None = None,
        status_code: int | None = None,
        remediation: dict[str, Any] | None = None,
        technical_message: str | None = None,
        constraints: list[dict[str, Any]] | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        self.message = message or self.message
        self.code = code or self.code
        self.category = category or self.category
        self.status_code = status_code or self.status_code
        self.remediation = remediation
        self.technical_message = technical_message
        self.constraints = constraints
        self.details = details
        super().__init__(self.message)

    def to_envelope(self, trace_id: str) -> dict[str, Any]:
        body: dict[str, Any] = {
            "code": self.code,
            "message": self.message,
            "category": self.category.value,
            "trace_id": trace_id,
        }
        if self.remediation:
            body["remediation"] = self.remediation
        if self.technical_message:
            body["technical_message"] = self.technical_message
        if self.constraints:
            body["constraints"] = self.constraints
        if self.details:
            body["details"] = self.details
        return {"error": body}


class ValidationError(AppError):
    status_code = 422
    code = "VALIDATION_FAILED"
    category = ErrorCategory.VALIDATION
    message = "Dữ liệu nhập không hợp lệ."


class NotFoundError(AppError):
    status_code = 404
    code = "RESOURCE_NOT_FOUND"
    category = ErrorCategory.NOT_FOUND
    message = "Không tìm thấy tài nguyên."


class UnauthorizedError(AppError):
    status_code = 401
    code = "UNAUTHENTICATED"
    category = ErrorCategory.AUTHENTICATION
    message = "Phiên đăng nhập không hợp lệ hoặc đã hết hạn."


class ForbiddenError(AppError):
    status_code = 403
    code = "PERMISSION_DENIED"
    category = ErrorCategory.PERMISSION
    message = "Bạn không có quyền thực hiện thao tác này."


class ConflictError(AppError):
    status_code = 409
    code = "RESOURCE_CONFLICT"
    category = ErrorCategory.CONFLICT
    message = "Trạng thái tài nguyên đã thay đổi."


class DraftConflictError(ConflictError):
    """Two people edited the same draft.

    Distinct from a generic conflict because the UI has a specific answer for
    it: show the server revision and let the user reload or compare, rather
    than silently overwriting somebody's work (SRS 78).
    """

    code = "DRAFT_VERSION_CONFLICT"
    message = "Draft đã được cập nhật bởi người khác. Vui lòng tải lại."


class ResourceInUseError(ConflictError):
    code = "RESOURCE_IN_USE"
    message = "Tài nguyên đang được sử dụng."


class WorkflowRunningError(ConflictError):
    code = "WORKFLOW_ALREADY_RUNNING"
    message = "Workflow đang có một lần chạy chưa kết thúc."


class QuotaExceededError(AppError):
    status_code = 429
    code = "QUOTA_EXCEEDED"
    category = ErrorCategory.QUOTA
    message = "Đã đạt giới hạn số lần chạy đồng thời."


class RateLimitedError(AppError):
    status_code = 429
    code = "RATE_LIMITED"
    category = ErrorCategory.RATE_LIMIT
    message = "Bạn thao tác quá nhanh. Vui lòng thử lại sau."


class EngineUnavailableError(AppError):
    status_code = 503
    code = "ENGINE_UNAVAILABLE"
    category = ErrorCategory.ENGINE
    message = "Dịch vụ thực thi đang tạm gián đoạn."


class EngineIncompatibleError(AppError):
    status_code = 503
    code = "ENGINE_INCOMPATIBLE"
    category = ErrorCategory.ENGINE
    message = "Runtime hiện tại chưa tương thích với phiên bản workflow này."


class EngineOperationError(AppError):
    status_code = 502
    code = "ENGINE_OPERATION_FAILED"
    category = ErrorCategory.ENGINE
    message = "Engine không thực hiện được thao tác này."


# SRS 34: code -> (http status, category, message, remediation action).
# The FE renders `remediation.action` as the primary CTA on the error card, so
# a code without an action is a code the user cannot act on -- worth noticing
# when adding one.
ERROR_UX_MATRIX: dict[str, tuple[int, ErrorCategory, str, str | None]] = {
    "WORKFLOW_INVALID": (
        422, ErrorCategory.VALIDATION,
        "Workflow chưa hợp lệ.", "SHOW_INVALID_NODES"),
    "NODE_UNSUPPORTED": (
        422, ErrorCategory.CONFIGURATION,
        "Bước này chưa được hỗ trợ.", "REPLACE_NODE"),
    "CREDENTIAL_REQUIRED": (
        422, ErrorCategory.CONFIGURATION,
        "Chưa chọn thông tin xác thực cho bước này.", "CHOOSE_CREDENTIAL"),
    "CREDENTIAL_INVALID": (
        400, ErrorCategory.AUTHENTICATION,
        "Thông tin xác thực không còn hợp lệ.", "UPDATE_CREDENTIAL"),
    "EXPRESSION_INVALID": (
        422, ErrorCategory.EXPRESSION,
        "Biểu thức chưa hợp lệ.", "OPEN_FIELD"),
    "EXPRESSION_EVALUATION_FAILED": (
        400, ErrorCategory.EXPRESSION,
        "Không thể tính giá trị ở bước này.", "INSPECT_INPUT"),
    "NODE_AUTHENTICATION_FAILED": (
        400, ErrorCategory.AUTHENTICATION,
        "Không thể xác thực với dịch vụ ở bước này.", "UPDATE_CREDENTIAL"),
    "NODE_TIMEOUT": (
        504, ErrorCategory.TIMEOUT,
        "Dịch vụ phản hồi quá lâu.", "RETRY_OR_CHECK_ENDPOINT"),
    "NODE_RATE_LIMITED": (
        429, ErrorCategory.RATE_LIMIT,
        "Dịch vụ đang giới hạn số yêu cầu.", "RETRY_LATER"),
    "NODE_CONFIGURATION_INVALID": (
        422, ErrorCategory.CONFIGURATION,
        "Cấu hình của bước này chưa hợp lệ.", "EDIT_NODE"),
    "NODE_NETWORK_UNREACHABLE": (
        400, ErrorCategory.NETWORK,
        "Không kết nối được tới dịch vụ ở bước này.", "CHECK_ENDPOINT"),
    "NODE_EXECUTION_FAILED": (
        400, ErrorCategory.NODE,
        "Một bước trong workflow đã thất bại.", "INSPECT_NODE"),
    "EGRESS_BLOCKED": (
        422, ErrorCategory.CONFIGURATION,
        "Địa chỉ này bị chính sách mạng của hệ thống chặn.", "EDIT_NODE"),
    "WORKFLOW_ALREADY_RUNNING": (
        409, ErrorCategory.CONFLICT,
        "Workflow đang chạy.", "VIEW_EXECUTION"),
    "DRAFT_VERSION_CONFLICT": (
        409, ErrorCategory.CONFLICT,
        "Draft đã được người khác cập nhật.", "RELOAD_DRAFT"),
    "WORKFLOW_NOT_PUBLISHED": (
        409, ErrorCategory.CONFLICT,
        "Workflow chưa có phiên bản nào được publish.", "PUBLISH_WORKFLOW"),
    "ENGINE_UNAVAILABLE": (
        503, ErrorCategory.ENGINE,
        "Dịch vụ thực thi đang tạm gián đoạn.", "RETRY_LATER"),
    "ENGINE_INCOMPATIBLE": (
        503, ErrorCategory.ENGINE,
        "Runtime chưa tương thích với phiên bản này.", "CONTACT_ADMIN"),
    "EXECUTION_CANCELLED": (
        200, ErrorCategory.CANCELLED,
        "Lần chạy đã được hủy.", None),
    "EXECUTION_TIMED_OUT": (
        504, ErrorCategory.TIMEOUT,
        "Lần chạy vượt quá thời gian tối đa cho phép.", "INSPECT_EXECUTION"),
    "ENGINE_INTERRUPTED": (
        500, ErrorCategory.ENGINE,
        "Lần chạy bị ngắt vì runtime không còn phản hồi.", "RETRY_EXECUTION"),
    "WEBHOOK_AUTH_FAILED": (
        401, ErrorCategory.AUTHENTICATION,
        "Webhook không được xác thực.", "CHECK_WEBHOOK_SECRET"),
    "SCHEDULE_INVALID": (
        422, ErrorCategory.VALIDATION,
        "Lịch chạy không hợp lệ.", "EDIT_SCHEDULE"),
}


def remediation_for(code: str | None) -> dict[str, str] | None:
    """The next action for an error code, or None when there isn't one.

    The same matrix that gives an API envelope its `remediation` also has to
    reach a *failed execution*, which is where a user actually meets most of
    these codes. It did not: the run panel could only offer a next step for
    NODE_AUTHENTICATION_FAILED, because the node error carried no remediation
    and the frontend had hardcoded the one case it cared about (Wave 0C,
    D-W0-10).

    Deriving it here rather than in the frontend keeps one answer to "what
    should the user do about this code" -- the API, the worker and the editor
    all read the same table.
    """
    if not code:
        return None
    entry = ERROR_UX_MATRIX.get(code)
    if entry is None or entry[3] is None:
        return None
    return {"action": entry[3]}


def error_from_matrix(code: str, **kwargs: Any) -> AppError:
    """Build an AppError from the UX matrix so wording stays uniform.

    A code that is not in the matrix still produces a usable envelope; it just
    has no remediation, which is the honest answer for an unclassified failure.
    """
    status, category, message, action = ERROR_UX_MATRIX.get(
        code, (400, ErrorCategory.UNKNOWN, "Đã xảy ra lỗi.", None)
    )
    remediation = kwargs.pop("remediation", None)
    resource_id = kwargs.pop("resource_id", None)
    if remediation is None and action:
        remediation = {"action": action}
        if resource_id:
            remediation["resource_id"] = str(resource_id)
    return AppError(
        kwargs.pop("message", None) or message,
        code=code,
        category=category,
        status_code=kwargs.pop("status_code", None) or status,
        remediation=remediation,
        **kwargs,
    )
