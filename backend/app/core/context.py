"""Per-request identity and tenant context.

Every service takes one of these. `workspace_id` comes from the authenticated
session or from a header naming a workspace the caller can reach — never from a
request body. That is the tenant-isolation guarantee (guardrail 19, SRS 32.1).
"""

from __future__ import annotations

import dataclasses
import uuid
from dataclasses import dataclass

from app.core.permissions import Action, Module, Role, require


@dataclass(slots=True)
class RequestContext:
    user_id: uuid.UUID | None
    workspace_id: uuid.UUID
    role: Role
    trace_id: str
    email: str | None = None
    full_name: str | None = None
    is_platform_admin: bool = False
    ip_address: str | None = None
    user_agent: str | None = None
    timezone: str = "Asia/Bangkok"

    def require(self, module: Module, action: Action) -> None:
        require(self.role, module, action)

    def can(self, module: Module, action: Action) -> bool:
        from app.core.permissions import allowed

        return allowed(self.role, module, action)

    def for_workspace(self, workspace_id: uuid.UUID) -> "RequestContext":
        """The same caller, addressed at a different workspace.

        For platform-admin work that writes into a tenant it is not currently
        operating in -- provisioning records `workspace.provisioned` in the
        audit log of the workspace it just created, so a customer's own trail
        starts with who created it.

        Only widens the *workspace*, never the authority: the role and the
        platform-admin flag are carried over unchanged, so this cannot be used
        to escalate. It is a copy, so nothing the request already resolved is
        mutated underneath it.
        """
        return dataclasses.replace(self, workspace_id=workspace_id)

    @classmethod
    def system(
        cls, workspace_id: uuid.UUID, trace_id: str, timezone: str = "Asia/Bangkok"
    ) -> "RequestContext":
        """Context for background workers and the webhook gateway: full rights,
        no user attribution. The audit row it writes says SYSTEM, not a name."""
        return cls(
            user_id=None,
            workspace_id=workspace_id,
            role=Role.PLATFORM_ADMIN,
            trace_id=trace_id,
            full_name="system",
            timezone=timezone,
            is_platform_admin=True,
        )
