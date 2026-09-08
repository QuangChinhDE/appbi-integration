"""Tenant provisioning from the command line.

    python -m app.provision list
    python -m app.provision create --name "Acme Corp" --owner ops@acme.com
    python -m app.provision create --name "Acme" --owner a@b.com \
        --slug acme --timezone Asia/Bangkok --max-concurrent 20 --engine default
    python -m app.provision quota   <workspace-id> --max-concurrent 50
    python -m app.provision engine  <workspace-id> --engine eu-west-1
    python -m app.provision status  <workspace-id> --status SUSPENDED

The same service the API route calls, so the two cannot drift. It exists
because onboarding a customer must not require the API to be up, reachable, or
holding a session -- during an incident, or on the very first deploy, a shell
on the database is what an operator has.

The acting identity is a real platform-admin account, named with `--as`
(default: the first platform admin found). Audit rows say who did it, and
"somebody with a shell" is not an acceptable answer to that question.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import uuid

from sqlalchemy import select

from app.core.context import RequestContext
from app.core.db import SessionLocal
from app.core.errors import AppError
from app.core.logging import configure_logging, new_trace_id
from app.core.permissions import Role
from app.models.identity import User
from app.services import provisioning


async def _acting_context(session, email: str | None) -> RequestContext:
    """A context for a real platform-admin account.

    Refuses rather than inventing a system identity: every write this tool
    makes lands in an audit log, and an audit row whose actor is "the CLI"
    answers nothing when somebody asks who created a tenant.
    """
    if email:
        user = await session.scalar(
            select(User).where(User.email == email.strip().lower()))
        if user is None:
            raise SystemExit(f"No such account: {email}")
        if not user.is_platform_admin:
            raise SystemExit(f"{user.email} is not a platform admin.")
    else:
        user = await session.scalar(
            select(User)
            .where(User.is_platform_admin.is_(True), User.is_active.is_(True))
            .order_by(User.created_at)
        )
        if user is None:
            raise SystemExit(
                "No platform admin account exists. Run `python -m app.bootstrap` "
                "first, or pass --as with an existing admin's email.")

    return RequestContext(
        user_id=user.id,
        # Provisioning addresses each workspace explicitly, so the context's
        # own workspace is only the identity's home. A platform admin reaches
        # every active workspace, so this is never load-bearing here.
        workspace_id=uuid.UUID(int=0),
        role=Role.PLATFORM_ADMIN,
        trace_id=new_trace_id(),
        email=user.email,
        full_name=user.full_name,
        is_platform_admin=True,
    )


async def _create(args) -> int:
    async with SessionLocal() as session:
        ctx = await _acting_context(session, args.acting_as)
        result = await provisioning.provision_workspace(
            session,
            ctx,
            name=args.name,
            slug=args.slug,
            owner_email=args.owner,
            owner_full_name=args.owner_name,
            owner_password=args.owner_password,
            timezone=args.timezone,
            max_concurrent_executions=args.max_concurrent,
            engine_name=args.engine,
        )
        await session.commit()

        print("\n" + "=" * 68)
        print("  Workspace provisioned")
        print(f"  name:      {result.workspace.name}")
        print(f"  slug:      {result.workspace.slug}")
        print(f"  id:        {result.workspace.id}")
        print(f"  timezone:  {result.workspace.timezone}")
        print(f"  quota:     {result.workspace.max_concurrent_executions or 'default'}")
        print(f"  owner:     {result.owner.email}")
        if result.generated_password:
            print(f"  password:  {result.generated_password}")
            print("  This password is shown once and must be changed on first sign-in.")
        else:
            print("  password:  (unchanged -- this account already existed)")
        print("=" * 68 + "\n")
    return 0


async def _list(args) -> int:
    async with SessionLocal() as session:
        ctx = await _acting_context(session, args.acting_as)
        body = await provisioning.list_workspaces(session, ctx)

    rows = body["items"]
    if not rows:
        print("No workspaces.")
        return 0

    width = max(len(r["slug"]) for r in rows)
    print(f"{'SLUG'.ljust(width)}  {'STATUS'.ljust(9)}  {'QUOTA'.ljust(7)}  OWNERS")
    for row in rows:
        quota = str(row["max_concurrent_executions"] or "-")
        print(f"{row['slug'].ljust(width)}  {row['status'].ljust(9)}  "
              f"{quota.ljust(7)}  {', '.join(row['owners']) or '(none)'}")
        print(f"{' ' * width}  {row['id']}")
    return 0


async def _quota(args) -> int:
    async with SessionLocal() as session:
        ctx = await _acting_context(session, args.acting_as)
        body = await provisioning.set_quota(
            session, ctx, uuid.UUID(args.workspace_id),
            max_concurrent_executions=args.max_concurrent)
        await session.commit()
    print(f"{body['slug']}: max_concurrent_executions = "
          f"{body['max_concurrent_executions'] or 'default'}")
    return 0


async def _engine(args) -> int:
    async with SessionLocal() as session:
        ctx = await _acting_context(session, args.acting_as)
        body = await provisioning.set_engine(
            session, ctx, uuid.UUID(args.workspace_id), engine_name=args.engine)
        await session.commit()
    print(f"{body['slug']}: engine = {args.engine}")
    return 0


async def _status(args) -> int:
    async with SessionLocal() as session:
        ctx = await _acting_context(session, args.acting_as)
        body = await provisioning.set_status(
            session, ctx, uuid.UUID(args.workspace_id), status=args.status)
        await session.commit()
    print(f"{body['slug']}: status = {body['status']}")
    return 0


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m app.provision",
        description="Create and administer tenants.")
    parser.add_argument(
        "--as", dest="acting_as", default=None, metavar="EMAIL",
        help="platform admin to act as (default: the first one)")
    sub = parser.add_subparsers(dest="command", required=True)

    create = sub.add_parser("create", help="provision a new workspace")
    create.add_argument("--name", required=True)
    create.add_argument("--owner", required=True, metavar="EMAIL")
    create.add_argument("--owner-name", default=None)
    create.add_argument(
        "--owner-password", default=None,
        help="omit to have one generated and printed once")
    create.add_argument("--slug", default=None)
    create.add_argument("--timezone", default="Asia/Bangkok")
    create.add_argument("--max-concurrent", type=int, default=None)
    create.add_argument("--engine", default=None, metavar="NAME")
    create.set_defaults(run=_create)

    listing = sub.add_parser("list", help="list every workspace")
    listing.set_defaults(run=_list)

    quota = sub.add_parser("quota", help="change a concurrency ceiling")
    quota.add_argument("workspace_id")
    quota.add_argument("--max-concurrent", type=int, default=None)
    quota.set_defaults(run=_quota)

    engine = sub.add_parser("engine", help="move a tenant to another engine")
    engine.add_argument("workspace_id")
    engine.add_argument("--engine", required=True, metavar="NAME")
    engine.set_defaults(run=_engine)

    state = sub.add_parser("status", help="suspend or reinstate a tenant")
    state.add_argument("workspace_id")
    state.add_argument(
        "--status", required=True, choices=["ACTIVE", "SUSPENDED", "ARCHIVED"])
    state.set_defaults(run=_status)

    return parser


async def main() -> int:
    configure_logging()
    args = _parser().parse_args()
    try:
        return await args.run(args)
    except AppError as exc:
        # The product's own errors, printed as a message rather than a
        # traceback: "slug already exists" is an operator's mistake, not a bug.
        print(f"error [{exc.code}]: {exc.message}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
