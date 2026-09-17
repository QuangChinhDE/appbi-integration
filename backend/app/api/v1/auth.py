"""Authentication and session routes."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, EmailStr, Field

from app.api.deps import CtxDep, SessionDep, UserDep
from app.core import rate_limit
from app.core.config import settings
from app.core.errors import ForbiddenError, RateLimitedError
from app.core.security import decode_session_token, issue_session_token
from app.services import access

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1)
    new_password: str = Field(min_length=1)


def _set_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        settings.session_cookie_name,
        token,
        max_age=settings.session_ttl_seconds,
        httponly=True,
        # Lax rather than Strict: the product is opened from links in alert
        # emails, and Strict would drop the session on that first navigation.
        samesite="lax",
        secure=settings.session_cookie_secure,
        path="/",
    )


@router.post("/login")
async def login(
    payload: LoginRequest, request: Request, response: Response, session: SessionDep
) -> dict:
    ip = request.client.host if request.client else None

    # Per-IP, on top of the per-account lockout. The account lockout stops
    # somebody guessing one password; it does nothing about one source trying
    # one password against a thousand accounts, which is what credential
    # stuffing actually looks like. Shared across replicas for the same reason
    # the webhook limit is (SRS 68.2).
    if ip:
        allowed, _ = await rate_limit.check(
            f"login:{ip}",
            limit=settings.login_rate_limit_per_minute,
            window_seconds=60,
        )
        if not allowed:
            raise RateLimitedError(
                "Quá nhiều lần đăng nhập từ địa chỉ này. Hãy thử lại sau một phút.")

    user, token = await access.authenticate(
        session, email=payload.email, password=payload.password, ip=ip)
    await session.commit()

    _set_cookie(response, token)
    claims = decode_session_token(token)
    workspace_id = uuid.UUID(claims["ws"]) if claims.get("ws") else None
    return await access.session_payload(session, user, workspace_id)


@router.post("/logout")
async def logout(response: Response) -> dict:
    response.delete_cookie(settings.session_cookie_name, path="/")
    return {"ok": True}


@router.get("/me")
async def me(
    session: SessionDep,
    user: UserDep,
    request: Request,
) -> dict:
    """The session payload.

    Answers even when the account must change its password -- the shell needs a
    reply it can act on, and failing here left a signed-in user staring at a
    blank page (see the change-password redirect in the FE shell).
    """
    token = request.cookies.get(settings.session_cookie_name)
    authorization = request.headers.get("authorization")
    if not token and authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    claims = decode_session_token(token) if token else {}
    header = request.headers.get("X-Workspace-Id")
    workspace_id = None
    for candidate in (header, claims.get("ws")):
        if candidate:
            try:
                workspace_id = uuid.UUID(str(candidate))
                break
            except (TypeError, ValueError):
                continue
    return await access.session_payload(session, user, workspace_id)


@router.post("/change-password")
async def change_password(
    payload: ChangePasswordRequest,
    response: Response,
    session: SessionDep,
    user: UserDep,
) -> dict:
    token = await access.change_password(
        session, user, current=payload.current_password, new=payload.new_password)
    await session.commit()
    # A fresh session: the change revoked every token issued before it,
    # including the caller's own.
    _set_cookie(response, token)
    claims = decode_session_token(token)
    workspace_id = uuid.UUID(claims["ws"]) if claims.get("ws") else None
    return await access.session_payload(session, user, workspace_id)


@router.post("/switch-workspace/{workspace_id}")
async def switch_workspace(
    workspace_id: uuid.UUID,
    response: Response,
    session: SessionDep,
    user: UserDep,
) -> dict:
    memberships = await access.reachable(session, user)
    if not any(m.workspace_id == workspace_id for m in memberships):
        raise ForbiddenError("Bạn không truy cập được workspace này.")
    token = issue_session_token(user.id, workspace_id, user.session_version)
    _set_cookie(response, token)
    return await access.session_payload(session, user, workspace_id)


@router.get("/permissions")
async def permissions(ctx: CtxDep) -> dict:
    from app.core.permissions import serialise

    return {"role": ctx.role.value, "permissions": serialise(ctx.effective_permissions())}
