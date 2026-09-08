"""RBAC matrix (SRS 4.2).

The backend is the only authority. FE gating exists so the UI is not littered
with buttons that would 403; every endpoint re-checks here.

Two actions exist because the obvious six collapsed decisions that are not the
same decision:

* `EXECUTE` is not `PUBLISH`. Running a draft against a test endpoint and
  freezing the version that a schedule will fire for the next month are
  different amounts of authority (SRS 4.2 rule 3).
* `VIEW` is not `VIEW_DATA`. Seeing that a run failed at "Get customer" is
  operational; reading the customer record that came back is the payload. An
  Auditor reviewing what the platform was configured to do gets the first and
  not the second.
"""

from __future__ import annotations

from enum import Enum

from app.core.errors import ForbiddenError


class Role(str, Enum):
    OWNER = "OWNER"
    AUTOMATION_ADMIN = "AUTOMATION_ADMIN"
    AUTOMATION_BUILDER = "AUTOMATION_BUILDER"
    OPERATOR = "OPERATOR"
    ANALYST = "ANALYST"
    AUDITOR = "AUDITOR"
    PLATFORM_ADMIN = "PLATFORM_ADMIN"


class Module(str, Enum):
    WORKFLOWS = "workflows"
    CREDENTIALS = "credentials"
    EXECUTIONS = "executions"
    NODES = "nodes"
    MONITORING = "monitoring"
    ALERTS = "alerts"
    AUDIT = "audit"
    MEMBERS = "members"
    SETTINGS = "settings"


class Action(str, Enum):
    VIEW = "view"
    #: Read the payloads themselves: node input/output previews, log bodies.
    VIEW_DATA = "view_data"
    CREATE = "create"
    EDIT = "edit"
    #: Run a workflow, cancel a run, retry a run.
    EXECUTE = "execute"
    #: Freeze an immutable version, and activate/deactivate a trigger.
    PUBLISH = "publish"
    #: Attach a stored credential to a node. Never means "read the secret" --
    #: nothing does; the plaintext leaves the secret store only at execution
    #: time, inside the engine (SRS 12.5).
    USE = "use"
    DELETE = "delete"
    ADMIN = "admin"


_ALL = set(Action)
_RO = {Action.VIEW}

MATRIX: dict[Role, dict[Module, set[Action]]] = {
    Role.OWNER: {m: set(_ALL) for m in Module},
    Role.PLATFORM_ADMIN: {m: set(_ALL) for m in Module},
    Role.AUTOMATION_ADMIN: {
        Module.WORKFLOWS: {Action.VIEW, Action.VIEW_DATA, Action.CREATE, Action.EDIT,
                           Action.EXECUTE, Action.PUBLISH, Action.DELETE},
        Module.CREDENTIALS: {Action.VIEW, Action.CREATE, Action.EDIT, Action.USE,
                             Action.DELETE},
        Module.EXECUTIONS: {Action.VIEW, Action.VIEW_DATA, Action.EXECUTE},
        Module.NODES: _RO,
        Module.MONITORING: {Action.VIEW, Action.VIEW_DATA},
        Module.ALERTS: {Action.VIEW, Action.CREATE, Action.EDIT, Action.EXECUTE,
                        Action.DELETE},
        Module.AUDIT: _RO,
        Module.MEMBERS: _RO,
        Module.SETTINGS: {Action.VIEW, Action.EDIT},
    },
    # Builds and tests, but does not decide what production runs. Publish and
    # activate are the line: a builder can prove a workflow works, an admin
    # commits the workspace to it.
    Role.AUTOMATION_BUILDER: {
        Module.WORKFLOWS: {Action.VIEW, Action.VIEW_DATA, Action.CREATE, Action.EDIT,
                           Action.EXECUTE},
        Module.CREDENTIALS: {Action.VIEW, Action.CREATE, Action.EDIT, Action.USE},
        Module.EXECUTIONS: {Action.VIEW, Action.VIEW_DATA, Action.EXECUTE},
        Module.NODES: _RO,
        Module.MONITORING: _RO,
        Module.ALERTS: {Action.VIEW, Action.EXECUTE},
        Module.AUDIT: set(),
        Module.MEMBERS: set(),
        Module.SETTINGS: _RO,
    },
    # Watches production and intervenes: run, cancel, retry, acknowledge. No
    # editing, and no attaching credentials to anything.
    Role.OPERATOR: {
        Module.WORKFLOWS: {Action.VIEW, Action.EXECUTE},
        Module.CREDENTIALS: _RO,
        Module.EXECUTIONS: {Action.VIEW, Action.VIEW_DATA, Action.EXECUTE},
        Module.NODES: _RO,
        Module.MONITORING: {Action.VIEW, Action.VIEW_DATA},
        Module.ALERTS: {Action.VIEW, Action.EXECUTE},
        Module.AUDIT: set(),
        Module.MEMBERS: set(),
        Module.SETTINGS: _RO,
    },
    Role.ANALYST: {
        Module.WORKFLOWS: _RO,
        Module.CREDENTIALS: _RO,
        Module.EXECUTIONS: {Action.VIEW, Action.VIEW_DATA},
        Module.NODES: _RO,
        Module.MONITORING: _RO,
        Module.ALERTS: _RO,
        Module.AUDIT: set(),
        Module.MEMBERS: set(),
        Module.SETTINGS: _RO,
    },
    # Deliberately no VIEW_DATA anywhere: an auditor reviews configuration and
    # who changed it, not the payloads the workflows carried.
    Role.AUDITOR: {
        Module.WORKFLOWS: _RO,
        Module.CREDENTIALS: _RO,
        Module.EXECUTIONS: _RO,
        Module.NODES: _RO,
        Module.MONITORING: _RO,
        Module.ALERTS: _RO,
        Module.AUDIT: _RO,
        Module.MEMBERS: _RO,
        Module.SETTINGS: _RO,
    },
}


#: Roles a workspace can hand out. PLATFORM_ADMIN is a property of the account
#: (`users.is_platform_admin`), not a membership, so offering it in a role
#: picker would be a control that silently does nothing.
ASSIGNABLE_ROLES: tuple[Role, ...] = (
    Role.OWNER, Role.AUTOMATION_ADMIN, Role.AUTOMATION_BUILDER,
    Role.OPERATOR, Role.ANALYST, Role.AUDITOR,
)


def allowed(role: Role, module: Module, action: Action) -> bool:
    return action in MATRIX.get(role, {}).get(module, set())


def require(role: Role, module: Module, action: Action) -> None:
    if not allowed(role, module, action):
        raise ForbiddenError(
            f"Vai trò {role.value} không có quyền {action.value} trên {module.value}.",
            details={"module": module.value, "action": action.value, "role": role.value},
        )


def permission_map(role: Role) -> dict[str, list[str]]:
    """Serialised for the FE so it can hide (not enforce) unavailable actions."""
    return {
        module.value: sorted(a.value for a in MATRIX.get(role, {}).get(module, set()))
        for module in Module
    }
