# Spec — Product reality check and stabilization

This is a stabilization pass, so the spec is not new behaviour. It is the
**standard the existing product is being held to**: what a customer must be
able to observe, against which each screen and journey is judged. Where the
product already meets a clause, that clause is a regression guard. Where it
does not, that gap is a defect with an id in `DEFECT_INVENTORY.md`.

Authoritative source for product behaviour remains
`BA_SRS_AppBI_Workflow_Automation_n8n_Core.md` and `docs/adr/index.md`. This
document restates only the observable clauses this pass verifies.

## Primary flow — the first integration

1. A customer signs in. If the account has never changed its password, the
   product requires that before anything else, and says so.
2. The overview tells them, without reading documentation: whether the system
   is healthy, whether anything failed, and what to do next.
3. They create a workflow. It opens with a usable starting graph whose trigger
   step is named for the trigger it actually is.
4. They configure a trigger. If it is a webhook, its URL is **on the screen**.
   If it is a schedule, its next run is on the screen.
5. They add an action, configure it, and map fields against real data.
6. Validation reports only genuine problems. A field visibly filled in is
   never reported as unfilled.
7. Saving a draft mutates nothing published.
8. Running a draft returns promptly, and the result shows per-node status and
   the actual data each node produced.
9. Publishing creates an immutable version and does **not** activate it.
10. Activating binds one exact published version and says which.
11. A real trigger fires an execution which appears in history, bound to the
    version that ran.

## Alternate flows

- An empty workspace's overview says what to do rather than rendering zeroes.
- A workflow that has never been published shows no "unpublished changes"
  warning — it has nothing to contrast against.
- A one-node workflow is not auto-zoomed to fill the canvas.
- A draft edited by a second writer produces a conflict the user can actually
  resolve: Reload must fetch, not return the cached copy.
- Rollback activates an older version. It never creates a new one and never
  rewrites history.

## Failure behaviour

Every failure a customer can reach must answer three questions on the screen
they are already on: *what failed*, *why*, and *what now*.

| Failure | Expected |
|---|---|
| Invalid credentials | a clear message, no stack trace, no raw parse error |
| Session expired | returned to sign-in with the reason, not a blank screen |
| Validation failure | on the field, naming what to fix |
| A node fails at runtime | the run panel opens on the **error**, the failing node is identifiable on the canvas, the message is the normalized product error |
| Engine unavailable | the product stays readable; status says runs are paused; execution actions respond honestly rather than hanging |
| Permission denied | why, not a blank screen or a silent no-op |
| API returns a non-JSON body | handled as an error, never surfaced as a raw `SyntaxError` |

Errors carry `remediation.action` where one exists, and that action reaches
somewhere that helps (SRS 34).

## Permissions

The backend is authoritative; the UI is an affordance. For every role
(Owner, Builder, Operator, Analyst, Auditor, platform admin):

- an action the role cannot perform is either not offered, or is visibly
  disabled with the reason reachable — never offered and then refused;
- the API refuses independently of what the UI showed;
- a role change takes effect on the account's **next request**, with no
  re-login; a revoked membership takes effect immediately.

## Data behaviour

- The product database is the system of record for execution history.
- Every tenant-scoped read names its workspace. Switching workspaces evicts
  the previous tenant's cache — no stale rows from workspace A may render
  under workspace B, even briefly.
- An execution's graph is frozen at creation; a retry re-runs the sealed
  original input, never the redacted preview.
- No plaintext secret appears in any product-facing response or screen, at any
  point, including validation errors and execution logs.

## Lifecycle effects

Publish and Activate stay separate operations. A published version is never
mutated. A run names the exact version it ran and continues to name it after
the draft moves on.

## UI states

Every screen this pass audits is checked against the states that apply to it:
initial, loading, empty, populated, long content, validation error, API error,
permission denied, disabled, stale data, engine unavailable, slow response,
destructive-action confirmation, success feedback.

**A screen missing a state that applies to it is a defect**, even when the
happy path works.

## Non-functional constraints

- No horizontal document overflow at 1440×900, 1280×800 or 390×844.
- No text reaching the eye below 12px, measured after the cumulative scale of
  transformed ancestors.
- The primary action is inside the viewport at every supported width.
- At 1280 the editor is mostly canvas, not panel.
- Auto-zoom floor: 1 on a phone, 0.5 on a desktop.

## Compatibility

Fixes must not require re-publishing existing workflows, invalidate stored
graphs, or change the meaning of an existing published version. Any fix that
would is a compatibility break and must say so explicitly.
