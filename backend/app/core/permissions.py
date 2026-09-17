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


# ── per-member overrides ──────────────────────────────────────────────────
#
# A role is a preset, not the whole system. `MATRIX[role]` is where every
# membership starts; `effective()` is what a membership actually carries once
# an administrator has edited it. NULL/absent overrides mean "exactly the
# preset", which is what every membership meant before this existed -- so
# nothing has to migrate, and a preset improved here still reaches everybody
# who never departed from it.

def effective(
    role: Role, overrides: dict | None = None, *, is_platform_admin: bool = False,
) -> dict[Module, set[Action]]:
    """What a membership may actually do, as every reader must see it.

    Resolution, in order:

    1. a platform administrator holds everything, membership or not;
    2. a module named in `overrides` wins outright, including when it names no
       actions at all -- an explicit empty list is a revocation and must
       survive being resolved;
    3. anything `overrides` does not mention falls back to the preset named by
       `role`, so a module added to the product after somebody's permissions
       were last edited arrives with a sensible default rather than silence.
    """
    if is_platform_admin:
        return {module: set(_ALL) for module in Module}

    resolved = {module: set(actions) for module, actions in MATRIX.get(role, {}).items()}
    for module in Module:
        resolved.setdefault(module, set())

    for key, raw in (overrides or {}).items():
        module = _as_module(key)
        if module is None:
            continue
        resolved[module] = _as_actions(raw)
    return resolved


def _as_module(key: object) -> Module | None:
    try:
        return Module(str(key))
    except ValueError:
        return None


def _as_actions(raw: object) -> set[Action]:
    """Actions from a stored or submitted JSON value.

    Fails towards *less*: anything that is not a recognised action name is
    dropped rather than guessed at, so a stored map that has gone stale can
    only narrow access, never widen it.
    """
    if not isinstance(raw, (list, tuple, set)):
        return set()
    out: set[Action] = set()
    for item in raw:
        try:
            out.add(Action(str(item)))
        except ValueError:
            continue
    return out


def parse_overrides(raw: dict | None) -> dict[str, list[str]]:
    """Validate an incoming override map into its stored shape.

    Raises rather than trimming: this is what an administrator just submitted,
    and silently storing less than they asked for is how a permission editor
    lies about what it saved.
    """
    if not raw:
        return {}
    stored: dict[str, list[str]] = {}
    for key, value in raw.items():
        module = _as_module(key)
        if module is None:
            raise ValueError(f"Unknown module: {key}")
        if not isinstance(value, (list, tuple, set)):
            raise ValueError(f"Permissions for {module.value} must be a list of actions.")
        actions: set[Action] = set()
        for item in value:
            try:
                actions.add(Action(str(item)))
            except ValueError:
                raise ValueError(f"Unknown action: {item}") from None
        stored[module.value] = sorted(a.value for a in actions)
    return stored


def serialise(perms: dict[Module, set[Action]]) -> dict[str, list[str]]:
    """`effective()`'s result, in the same shape `permission_map` returns."""
    return {module.value: sorted(a.value for a in perms.get(module, set())) for module in Module}


def allowed_effective(perms: dict[Module, set[Action]], module: Module, action: Action) -> bool:
    return action in perms.get(module, set())


def require_effective(
    perms: dict[Module, set[Action]], module: Module, action: Action, role: Role,
) -> None:
    if not allowed_effective(perms, module, action):
        raise ForbiddenError(
            f"Vai trò {role.value} không có quyền {action.value} trên {module.value}.",
            details={"module": module.value, "action": action.value, "role": role.value},
        )


# ── the organisation axis ──────────────────────────────────────────────────
#
# A workspace role answers "what may this person do inside this workspace"; an
# organisation role answers "which workspaces exist, who may open them". They
# are deliberately separate: collapsing them would mean a workspace created
# today needed a membership row for every administrator before anyone could
# see it.

class OrgRole(str, Enum):
    ORG_OWNER = "ORG_OWNER"
    ORG_ADMIN = "ORG_ADMIN"
    ORG_MEMBER = "ORG_MEMBER"


#: `CREATE` makes a workspace (a department) inside the organisation; `ADMIN`
#: manages organisation members. `DELETE` is reserved to ORG_OWNER -- it is
#: what separates owning the organisation from running it day to day.
ORG_MATRIX: dict[OrgRole, set[Action]] = {
    OrgRole.ORG_OWNER: {Action.VIEW, Action.CREATE, Action.EDIT, Action.DELETE, Action.ADMIN},
    OrgRole.ORG_ADMIN: {Action.VIEW, Action.CREATE, Action.EDIT, Action.ADMIN},
    OrgRole.ORG_MEMBER: {Action.VIEW},
}

#: Organisation roles that carry implicit OWNER inside every workspace the
#: organisation holds. This is the whole point of the layer.
ORG_ROLES_WITH_WORKSPACE_ACCESS: frozenset[OrgRole] = frozenset(
    {OrgRole.ORG_OWNER, OrgRole.ORG_ADMIN})


def org_allowed(role: OrgRole | None, action: Action) -> bool:
    if role is None:
        return False
    return action in ORG_MATRIX.get(role, set())


def org_require(role: OrgRole | None, action: Action) -> None:
    if not org_allowed(role, action):
        raise ForbiddenError(
            f"Vai trò tổ chức {role.value if role else 'không có'} không có quyền "
            f"{action.value}.",
            code="ORG_ACTION_DENIED",
            details={"scope": "organization", "action": action.value,
                     "role": role.value if role else "none"},
        )


def org_permissions(role: OrgRole | None) -> list[str]:
    """Serialised for the FE beside the workspace permission map, never merged
    into it: the two answer different questions."""
    return sorted(a.value for a in ORG_MATRIX.get(role, set())) if role else []
