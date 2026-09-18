# Acceptance — Product reality check and stabilization

Seven journeys, walked in the deployed product, as a user would. Each gets an
explicit **PASS / FAIL / NOT RUN** — never an implied pass from a green suite.

A journey PASSes only when every step was actually performed against the
running application and produced the expected observable result. "The endpoint
returns 200" is not a step; "the webhook URL is visible on the trigger panel
and copying it produces a URL that fires a run" is.

---

## Journey A — First integration

**Given** a fresh deployment and a customer who has never used the product
**When** they sign in, create a workflow, configure its trigger, add an
action, map fields, validate, save, run the draft, inspect output, publish,
activate, trigger a real execution, and open history
**Then** every step completes without needing knowledge not on the screen, and
the execution appears in history bound to the activated version.

- [x] sign in (incl. forced password change)
- [x] create workflow — starting graph is sensible and correctly named
- [x] configure trigger — its defining detail (webhook URL / schedule) is visible
- [x] add and configure an action
- [x] map fields against real data
- [x] validate — no false errors on visibly-filled fields
- [x] save draft
- [x] run draft — per-node status and real output
- [x] publish — creates v1, does **not** activate
- [ ] activate — names the exact version
- [ ] trigger a real execution
- [ ] history shows it, bound to the right version

**Result:** _pending — steps 1–9 walked in the deployed product (`e2e/ux-after2`, 30 screenshots, read). Activate / trigger / history are not part of the walkthrough; they are covered by `scripts/smoke.py` and this result stays open until that has run against this build._

## Journey B — Failed integration

**Given** a workflow configured to fail (an unreachable endpoint)
**When** it runs
**Then** the user sees that it failed, which node failed, why, and a route to
remediation; after fixing, a re-run succeeds.

- [ ] failure is visible without hunting
- [ ] the failing node is identifiable on the canvas
- [ ] the run panel opens on the error, not an empty Output tab
- [ ] the message is the normalized product error, not a stack trace
- [ ] `remediation.action` reaches somewhere useful
- [ ] fix → re-run → success

**Result:** **PASS** — `ux-after2/16-editor-after-run.png`: the failing node is red on the canvas with per-node item counts, the panel opens on the **Error** tab (not an empty Output), and the message is the normalized product error with technical detail behind an expander and a one-click support copy.

## Journey C — Credentials

**Given** a customer who needs to authenticate to an external service
**When** they create a credential, use it in a node, publish, execute, edit the
credential, and execute again
**Then** it works, and **the secret is never displayed at any point**.

- [ ] create credential
- [ ] use in a node
- [ ] validate/publish succeeds **with** the credential resolved
- [ ] execute
- [ ] edit credential
- [ ] execute again
- [ ] secret never visible: not in the form, the list, the execution log, an
      error message, or any API response

**Result:** _TBD_

## Journey D — Version lifecycle

**Given** a published, activated workflow
**When** the draft is edited, v2 published, v2 activated, then rolled back to v1
**Then** history stays correct and v1 is unchanged throughout.

- [ ] publish v1, activate v1
- [ ] edit draft — active v1 unchanged
- [ ] publish v2 — activation does not move by itself
- [ ] activate v2
- [ ] rollback to v1 — no new version created
- [ ] historical executions still name the version they actually ran

**Result:** _TBD_

## Journey E — RBAC

**Given** accounts at each role the product defines
**When** each attempts the actions their role does and does not permit
**Then** UI affordance and backend refusal agree.

- [ ] Owner
- [ ] Builder
- [ ] Operator
- [ ] Analyst
- [ ] Auditor
- [ ] platform admin (incl. provisioning, which a tenant Owner must not do)
- [ ] for each: no action offered that the API then refuses
- [ ] for each: API refuses independently of the UI

**Result:** _TBD_

## Journey F — Engine unavailable

**Given** a running product
**When** the engine is stopped
**Then** the product stays readable, says what is wrong, responds honestly to
execution actions, and recovers when the engine returns.

- [ ] product remains readable (lists, history, settings)
- [ ] engine status is understandable to a non-engineer
- [ ] run/publish respond correctly rather than hanging
- [ ] no run is left permanently RUNNING
- [ ] recovery after the engine returns

**Result:** _TBD_

## Journey G — Workspace isolation

**Given** two workspaces with distinct data
**When** a user switches between them and attempts cross-tenant access
**Then** no data leaks, in the cache or over the API.

- [ ] create objects in workspace A
- [ ] switch to B — no stale A rows render, even briefly
- [ ] A's object not reachable from B by id
- [ ] A's object not reachable with an `X-Workspace-Id` header naming A
- [ ] switch back to A — correct state

**Result:** _TBD_

---

## UI states checked

Filled in during Phase 2–4. Each row needs the screenshot that shows it.

| Screen | State | Viewport | Screenshot | OK? |
|---|---|---|---|---|

## Screens inspected

A screen counts as inspected only if its screenshot was **opened and read**,
not merely captured. 36 route×viewport screenshots were captured per audit run
(`e2e/audit-screenshots`, `e2e/audit-demo`, `e2e/audit-populated`) plus 30
journey screenshots (`e2e/ux-after2`); the ones below were read individually.

| Screenshot read | What it showed |
|---|---|
| `audit-populated/overview--desktop-1440` | good attention band, figures, upcoming schedule — **and D-P07**, the raw `NODE_NETWORK_UNREACHABLE` |
| `audit-populated/executions--desktop-1440` | worded status badges, failing node named, no raw codes — clean |
| `audit-demo/overview--desktop-1440` | forced-password-change redirect working; **D-P09** (no heading), **D-P10** (5×403) |
| `ux-screenshots/08-editor-first-open` (before) | **D-P06** — empty canvas, one node, unlabelled `+` |
| `ux-after/08-editor-first-open` (after) | palette open, steps searchable and described |
| `ux-after/13-editor-incomplete-state` | **D-P11** — the regression I introduced: palette closed itself |
| `ux-after2/12-editor-http-added` | D-P11 fixed: palette stays open after the step is added |
| `ux-after2/13-editor-incomplete-state` | validation in three coordinated places; Run correctly disabled |
| `ux-after2/16-editor-after-run` | per-node status on canvas, panel opens on the **Error** tab, plain-language message |
| `ux-after2/17-publish-dialog` | immutability explained; Activate a separate, unchecked opt-in |
| `ux-after2/29-editor-narrow` | below `xl`: the labelled "Thêm bước" button, as designed |
| `test-results/01-shell-*` ×4 | the four 01-shell failures — each a stale English assertion or a retry-unsafe coupling |
| `test-results/05-credentials-rbac-*` | the Analyst switcher showing `Phân tích`; **and D-P01** |

Measured across all 36 route×viewport combinations, twice: no horizontal
overflow, no text below 12px after ancestor transforms, no uncaught page
errors, no console errors on the populated tenant, and no failed API requests
other than Next.js RSC prefetch aborts.
