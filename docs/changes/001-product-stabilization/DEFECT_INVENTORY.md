# Defect inventory — product stabilization

Every defect found in this pass. Severity per `plan.md`: **P0** blocker, **P1**
important, **P2** polish. Status is one of OPEN / FIXED / WONTFIX / TEST-ONLY.

Findings are recorded here **before** anything is fixed (Phase 6), so that a
fix can be checked against the defect as originally observed rather than
against a memory of it.

---

## Part 1 — the 9 E2E failures, classified

Reproduced on a clean disposable stack (`docker compose down -v` → `up
--build --wait`), with the E2E suite running **alone**: no `demo_seed.py`, no
`ux-walkthrough.mjs`, nothing else touching the admin account. `E2E_PASSWORD`
was aligned to this stack's `BOOTSTRAP_ADMIN_PASSWORD` so `global.setup` did
not burn a failed-login attempt.

**Result: 6 of the 9 reproduced. 3 did not.**

That is already the answer to the previous run's open question: the earlier
hypothesis ("all 9 were `demo_seed` pollution") was **wrong**. Six are real,
reproducible, and were never caused by contention.

### Why nobody noticed

Commit `9f533f8` ("Role names were never translated, and the fallback hid it")
translated role names and sidebar labels into Vietnamese — correct per the i18n
policy documented at the top of `frontend/src/lib/i18n.ts`, which states that
everything except a short keep-English list (Workflow, Webhook, Trigger,
Publish, Cron, Email, API, Beta, Workspace, Draft, Run) is Vietnamese,
*including every role name*.

The E2E assertions that matched those labels in English were not updated. CI
would have caught it on the next push — except CI's push trigger named `main`
while the repository's default branch is `master`, so **no push to the default
branch has ever run CI** (found and fixed in the first SDLC bootstrap,
`docs/ai-sdlc/BASELINE.md`). These six failures are the first visible
consequence of that gap.

---

### D-E01 — `/Audit log/` never matches the sidebar's Vietnamese label

| | |
|---|---|
| **Classification** | **TEST BUG** |
| **Severity** | P1 (blocks CI; hides real regressions behind a red suite) |
| **Spec/test** | `e2e/tests/01-shell.spec.ts:26` — `navigation › every module in the sidebar opens its page` |
| **Route** | `/audit` (reached from `/overview`) |
| **Role** | Owner |
| **Evidence** | `e2e/test-results/01-shell-navigation-every--ee524--the-sidebar-opens-its-page-chromium/test-failed-1.png` |
| **Expected** | the sidebar link for the audit module is found and opens `/audit` |
| **Actual** | the link is never found; the run stalls on the Node library page (the step before) |
| **Layer** | test |
| **Root cause** | the `JOURNEY` table gives both locales for every entry (`/Cảnh báo\|Alerts/`, `/Thư viện bước\|Node library/`) **except** audit, which is English-only: `[/Audit log/, /\/audit(\?\|$)/]`. The rendered label is `sidebar.audit` = `'Nhật ký hoạt động'` (i18n.ts:104). Confirmed by reading the screenshot. |
| **Product correct?** | **Yes.** Vietnamese is correct per the documented i18n policy; `'Audit log'` exists only in the `en` catalogue (i18n.ts:528). |
| **Regression coverage** | the fixed assertion is itself the coverage |
| **Status** | OPEN |

### D-E02 — `/Owner|Platform Admin/` never matches the translated role

| | |
|---|---|
| **Classification** | **TEST BUG** |
| **Severity** | P1 |
| **Spec/test** | `e2e/tests/01-shell.spec.ts:62` — `navigation › the workspace switcher shows the current role` |
| **Route** | `/overview` |
| **Role** | Owner |
| **Evidence** | `01-shell-navigation-the-wo-d540c-cher-shows-the-current-role-chromium/test-failed-1.png` |
| **Expected** | the switcher names the workspace and contains the role |
| **Actual** | the switcher correctly shows `E2E run mu6j5ey3` / **`Chủ sở hữu`**; the assertion wants `/Owner\|Platform Admin/` |
| **Layer** | test |
| **Root cause** | `role.OWNER` = `'Chủ sở hữu'` (i18n.ts:424). Same translation commit, same stale assertion. |
| **Product correct?** | **Yes** |
| **Status** | OPEN |

### D-E03 — the same `/Audit log/` regex, in the first-run test

| | |
|---|---|
| **Classification** | **TEST BUG** |
| **Severity** | P1 |
| **Spec/test** | `01-shell.spec.ts:148` — `a workspace with nothing in it › folds the advanced modules away, and offers them in one click` |
| **Route** | `/overview`, first-run workspace |
| **Role** | Owner of a freshly provisioned workspace |
| **Evidence** | `01-shell-a-workspace-with--ed929-nd-offers-them-in-one-click-chromium/test-failed-1.png` |
| **Expected** | after "Hiện toàn bộ chức năng", the audit link is visible |
| **Actual** | the screenshot shows the fold **working correctly** — Monitoring, Alerts, Node library and `Nhật ký hoạt động` are all revealed — but `/Audit log/` matches nothing |
| **Layer** | test |
| **Root cause** | as D-E01. Note the *earlier* assertion in the same test, `expect(...{name: /Audit log/}).toHaveCount(0)`, **passes for the wrong reason** — it is satisfied by the label never matching, not by the module being folded away. A negative assertion that can never fail is worse than no assertion. |
| **Product correct?** | **Yes** — the folding behaviour itself is visibly correct |
| **Status** | OPEN |

### D-E04 — first-run tests are coupled through a mutated password, and are not retry-safe

| | |
|---|---|
| **Classification** | **TEST BUG** (test isolation) |
| **Severity** | P1 |
| **Spec/test** | `01-shell.spec.ts:184` — `a workspace with nothing in it › the overview says what to do rather than showing six zeroes` |
| **Route** | `/login` → `/overview` |
| **Role** | Owner of the first-run workspace |
| **Evidence** | `01-shell-a-workspace-with--f0544-her-than-showing-six-zeroes-chromium/test-failed-1.png` |
| **Expected** | sign in as the first-run owner and see the empty-state overview |
| **Actual** | `Email hoặc mật khẩu không đúng.` — signing in as `firstrun-mu6j7105@example.com` fails |
| **Layer** | test |
| **Root cause** | the second test signs in with `'FirstRunChanged123'`, a password the **first** test set. When the first test fails, Playwright retries it in a fresh worker, `beforeAll` re-provisions a workspace with a **new** email (`mu6j7105` in the screenshot vs `mu6j6grr` in the first test's), and the new account still has its initial password. The second test then authenticates a user that never had its password changed. Confirmed by comparing the two screenshots' email addresses. |
| **Product correct?** | **Yes** — and the login error state renders correctly and legibly, which the screenshot also shows |
| **Status** | OPEN |

### D-E05 — `/Analyst/` never matches the translated role

| | |
|---|---|
| **Classification** | **TEST BUG** |
| **Severity** | P1 |
| **Spec/test** | `05-credentials-rbac.spec.ts:208` — `role gating › an Analyst sees the data but none of the buttons that would 403` |
| **Route** | `/overview` as an Analyst |
| **Role** | Analyst |
| **Evidence** | `05-credentials-rbac-role-g-32786--the-buttons-that-would-403-chromium/test-failed-1.png` |
| **Expected** | `getByText(/Analyst/)` visible |
| **Actual** | the switcher shows **`Phân tích`** |
| **Layer** | test |
| **Root cause** | `role.ANALYST` = `'Phân tích'` (i18n.ts:428). Same cause as D-E02. |
| **Product correct?** | **Yes** for the role label. But this screenshot revealed a genuine product defect — see **D-P01**. |
| **Status** | OPEN |

### D-E06 — Analyst editor test coupled to the previous test's password change

| | |
|---|---|
| **Classification** | **TEST BUG** (test isolation) |
| **Severity** | P1 |
| **Spec/test** | `05-credentials-rbac.spec.ts:249` — `role gating › an Analyst opening an editor gets no Publish or Run` |
| **Role** | Analyst |
| **Evidence** | `05-credentials-rbac-role-g-dfaaa-itor-gets-no-Publish-or-Run-chromium/` |
| **Expected** | sign in as the Analyst and open an editor read-only |
| **Actual** | cascade from D-E05 — signs in with `'AnalystChanged123'`, set by the preceding test |
| **Layer** | test |
| **Root cause** | identical coupling to D-E04: one test mutates the shared account's password, the next depends on that mutation having happened. |
| **Status** | OPEN |

### D-E07/08/09 — the three `02-auth` failures did **not** reproduce

| | |
|---|---|
| **Classification** | **TEST ISOLATION / DATA POLLUTION** (in the *previous* run, not this one) |
| **Severity** | P2 (no product defect; a real risk of future false failures) |
| **Specs** | `02-auth.spec.ts:67` sign-in reaches overview · `:82` signing out clears the session · `:100` forced password change for a newly invited account |
| **Evidence** | **absence** of any `test-results/02-auth-*` directory on the clean isolated run, against their presence in the previous contaminated run |
| **Root cause (previous run)** | the earlier run had `scripts/demo_seed.py` and `e2e/ux-walkthrough.mjs` driven against the **same singleton `admin@appbi.vn` account** while the suite held it. `demo_seed.py` additionally tries `--admin-password SmokeTestPass123!` first (`scripts/demo_seed.py:90`) — not this stack's bootstrap password — burning a failed-login attempt against the account each time. With `login_max_attempts = 8` and a 300s lockout (`config.py:86-87`), plus a 30/min per-IP login limit, concurrent form logins are exactly what tips these three auth-path tests over. |
| **Product correct?** | Not proven either way by this pass. The lockout and rate limit are deliberate security controls and behaved as designed. |
| **Protection added** | see **D-P05** — the suites now refuse to run against an account another suite is driving |
| **Status** | OPEN |

---

## Part 2 — product defects

### D-P01 — an empty state tells a read-only user to perform an action they cannot perform

| | |
|---|---|
| **Severity** | **P1** |
| **Area / route** | `/overview`, `/workflows`, `/executions`, `/credentials` |
| **Viewport** | all |
| **Role** | Analyst (any role lacking the corresponding `create`/`execute` permission) |
| **Evidence** | `05-credentials-rbac-role-g-32786--the-buttons-that-would-403-chromium/test-failed-1.png` — an Analyst's overview |
| **Reproduction** | sign in as an Analyst into a workspace with no workflows; open `/overview` |
| **Expected** | an empty state that describes the situation in terms the viewer can act on, or simply states it |
| **Actual** | "Chưa có workflow nào" followed by **"Tạo workflow đầu tiên: chọn bước bắt đầu, thêm vài bước xử lý rồi bấm Run để thử."** — *Create your first workflow: choose a starting step, add processing steps and press Run to try* — with no button, because the button is correctly permission-gated |
| **User impact** | a read-only user is instructed to do something the product will not let them do, and is given no way to do it. It reads as broken rather than as read-only. |
| **Layer** | frontend |
| **Root cause** | the `action` prop is gated by `can('workflows','create')` (`overview/page.tsx:98`, `workflows/page.tsx:109`) but `title`/`description` are unconditional. The same shape repeats on `/executions` (`'Chạy một workflow để thấy lịch sử ở đây.'` — an Analyst cannot run) and `/credentials` (`'Tạo một thông tin xác thực…'`). **One cause, four screens.** |
| **Regression coverage** | frontend component test asserting the permission-less variant renders no imperative copy |
| **Status** | OPEN |

### D-P02 — three mutations fail completely silently

| | |
|---|---|
| **Severity** | **P1** |
| **Area / route** | `/alerts` (acknowledge, acknowledge-all), `/workflows/[id]` (rename) |
| **Role** | any |
| **Reproduction** | make the request fail (403 from a role without `ops.manage`, a 409, or a dropped connection) and click Acknowledge |
| **Expected** | the failure is visible and says what happened |
| **Actual** | nothing at all happens on screen. The control looks like it did nothing. |
| **User impact** | the "controls that appear usable but do nothing" class. A user acknowledges an alert, sees no change and no error, and cannot tell whether the product is broken or slow. |
| **Layer** | frontend |
| **Root cause** | `QueryProvider.tsx` installs a `QueryCache` with an `onError` but **no `MutationCache`**, so a mutation with no local `onError` has no fallback whatsoever. Three mutations lack one: `alerts/page.tsx:82`, `alerts/page.tsx:86`, `workflows/[id]/page.tsx` (rename). `login` and `change-password` also omit `onError` but render `mutation.error` inline, which is correct and not a defect. |
| **Fix shape** | a default `MutationCache.onError` in `QueryProvider` — one primitive, not three call sites — leaving local handlers to take precedence |
| **Regression coverage** | frontend component test: a failing mutation with no local handler surfaces a toast |
| **Status** | OPEN |

### D-P03 — creating a workflow does not invalidate the workflow list

| | |
|---|---|
| **Severity** | **P1** |
| **Area / route** | `/workflows/new` → `/workflows` |
| **Role** | Owner/Builder |
| **Reproduction** | from `/workflows`, create a workflow, then return to `/workflows` within 15 seconds |
| **Expected** | the new workflow is in the list |
| **Actual** | the list renders from cache without it (`staleTime: 15_000`) |
| **User impact** | the exact defect class this repository has already been bitten by ("a created credential never appeared in the list"). A first-time customer creates a workflow, goes back to the list, and does not see it. |
| **Layer** | frontend |
| **Root cause** | `workflows/new/page.tsx:50` — `onSuccess: (workflow) => router.replace(...)` and nothing else. Every comparable mutation in the codebase invalidates `qk.workflows(workspaceId)`; this one does not. |
| **Status** | OPEN (to be confirmed visually in Phase 2 before fixing) |

### D-P04 — the first-run sidebar stays folded after the first workflow is created

| | |
|---|---|
| **Severity** | **P1** |
| **Area / route** | sidebar, immediately after first workflow creation |
| **Role** | Owner of a brand-new workspace |
| **Reproduction** | in a workspace with no workflows, create the first one |
| **Expected** | the navigation unfolds — the first workflow is exactly the event the fold is waiting for ("Once a workflow exists the whole navigation returns permanently", `Sidebar.tsx:154`) |
| **Actual** | the probe query (`Sidebar.tsx:158`, `staleTime: 60_000`) is never invalidated, so Monitoring / Alerts / Node library / Audit stay hidden until it expires or the page is reloaded |
| **User impact** | the product's own onboarding promise silently does not fire, for the one user it was designed for |
| **Layer** | frontend |
| **Root cause** | same as D-P03 — creation invalidates nothing. The probe key `qk.workflows(ws, {probe:'first-run'})` *would* be matched by invalidating `qk.workflows(ws)`, because the key design makes the unfiltered key a true prefix. The fix for D-P03 fixes this too. |
| **Status** | OPEN (to be confirmed visually) |

### D-P05 — `demo_seed.py` guesses a password and burns a lockout attempt

| | |
|---|---|
| **Severity** | **P2** |
| **Area** | `scripts/demo_seed.py` |
| **Reproduction** | run `demo_seed.py` against any stack whose `BOOTSTRAP_ADMIN_PASSWORD` is not the literal `SmokeTestPass123!` |
| **Expected** | it signs in, or fails with a clear message about which password it needs |
| **Actual** | it tries `SmokeTestPass123!`, fails (incrementing `failed_login_count` toward an 8-attempt, 300-second lockout), then tries `E2EOwnerPassword123` |
| **User impact** | operator-facing, not customer-facing: repeated seeding can lock the admin account, and it is the mechanism behind the previous run's three phantom failures (D-E07/08/09) |
| **Layer** | tooling |
| **Status** | OPEN |

### D-P06 — a first-time customer has no visible way to add a step

| | |
|---|---|
| **Severity** | **P1 — highest priority of this pass** |
| **Area / route** | `/workflows/[id]` — the editor, on first open |
| **Viewport** | desktop and laptop (≥ xl). Below xl is **not** affected |
| **Role** | any role that can edit |
| **Evidence** | `e2e/ux-screenshots/08-editor-first-open.png`, `09-editor-trigger-config.png` |
| **Reproduction** | create a workflow and open the editor for the first time on a ≥1280px screen |
| **Expected** | the way to add the second step is visible and says what it is |
| **Actual** | a large empty canvas, one trigger node, and an **unlabelled `+` icon** in the top-left corner. No palette, no "Thêm bước" button, no hint. The product's central action — build a multi-step workflow — has no legible affordance. |
| **User impact** | the "first integration" journey stalls at its first real step for a non-technical customer. They are not *trapped* (the `+` does work, and carries `title`/`aria-label`), which is the only reason this is not P0. |
| **Layer** | frontend |
| **Root cause** | `EditorPanels.tsx:124` — `PaletteRail` initialises `open` to **`false`**, while the sibling `InspectorAside` (line 225) initialises to `true`. The editor then deliberately renders the labelled "Thêm bước" button **only below xl** (`workflows/[id]/page.tsx:754`), on the stated reasoning that *"on a wide screen the palette is already on screen and a button that opens a dialog to show it again is one control too many"*. That reasoning is correct — but its premise is false, because the rail defaults collapsed. Wide screens therefore get **neither** the palette **nor** the button. |
| **Also explains** | `e2e/ux-walkthrough.mjs` has been crashing at step 09 for exactly this reason — it looks for the "Thêm bước" button that a wide viewport never renders. The walkthrough is not a test, so nothing reported it. |
| **Fix shape** | default `PaletteRail`'s `open` to `true`, matching the inspector and the editor's own stated assumption. One line, in the shared primitive. |
| **Regression coverage** | `e2e/tests/03-editor.spec.ts` assertion that a first open on a wide viewport offers a labelled way to add a step |
| **Status** | OPEN |

### D-P07 — raw error codes are shown to customers on the overview

| | |
|---|---|
| **Severity** | **P1** |
| **Area / route** | `/overview` — "Thất bại gần đây" (recent failures) |
| **Role** | any |
| **Evidence** | `e2e/audit-populated/overview--desktop-1440.png` |
| **Reproduction** | have a failed run, open `/overview` |
| **Expected** | the failure is described in words the customer can act on |
| **Actual** | the row reads `Gọi API đối tác · **NODE_NETWORK_UNREACHABLE**` — a raw SCREAMING_SNAKE enum as the primary descriptive text, on the first screen of the product, in an otherwise fully Vietnamese interface |
| **User impact** | the one place a customer looks to find out what is wrong answers in a machine identifier |
| **Layer** | frontend (with an i18n gap) |
| **Root cause** | `overview/page.tsx:170-172` renders `row.error_code` directly. The API (`monitoring.py:132`) returns only `error_code` — no message — so there is nothing else to render. There are **no `error.*` keys** in the i18n catalogue: error codes are normally shown as technical reference (`code: X`) *beside* the server's readable message (`ErrorRemediationCard.tsx:97`), which is correct there, but this screen has no message to pair with. |
| **Fix shape** | add `error.<CODE>` labels for the 23 backend error codes and translate with the existing `tf([...], fallback)` pattern, falling back to the raw code. Additive, no API change. |
| **Status** | OPEN |

### D-P08 — a remediation button is labelled with a raw enum

| | |
|---|---|
| **Severity** | **P2** |
| **Area** | any error card offering `INSPECT_EXECUTION` |
| **Reproduction** | make a run exceed `EXECUTION_MAX_RUNTIME_SECONDS` → `EXECUTION_TIMED_OUT` (`errors.py:237`) |
| **Expected** | a button labelled in the user's language |
| **Actual** | the button reads **`INSPECT_EXECUTION`** |
| **User impact** | on a timeout — already a bad moment — the one offered action is labelled in machine case |
| **Layer** | frontend (i18n) |
| **Root cause** | `INSPECT_EXECUTION` is the only one of the 19 backend remediation actions with **no** `remediation.*` key in either locale, and `resolveRemediation` does give it a destination, so a button renders and `tf()` falls back to the raw code. Verified by cross-checking all 19 emitted actions against the catalogue. |
| **Status** | OPEN |

### D-P09 — the forced-password-change screen has no heading, and states no password rules

| | |
|---|---|
| **Severity** | **P2** |
| **Area / route** | `/change-password` (and `/login`) |
| **Evidence** | `e2e/audit-demo/overview--desktop-1440.png` (every route redirects here), `findings.json` → `headings: []` |
| **Expected** | a page has a heading; a form that gates the whole product states its rules before rejecting you |
| **Actual** | "Bạn cần đổi mật khẩu" is rendered as ordinary text, not an `h1`/`h2`/`h3` — the only pages in the audit with no heading at all. The helper text states *policy* ("added users must change password on first login") rather than the *requirements*, which surface only after a failed submit. |
| **User impact** | accessibility (document outline, screen readers) on the second screen every new user meets; and a user can sit on a disabled button without being told why |
| **Layer** | frontend |
| **Status** | OPEN |

### D-P10 — the shell fires five requests it knows will be refused

| | |
|---|---|
| **Severity** | **P2** |
| **Area** | shell, while `password_change_required` is true |
| **Evidence** | `e2e/audit-demo/findings.json` — 5 × `403` per route: `/notifications/unread-count`, `/workflows?page_size=5`, `/overview`, `/workflows?limit=1`, `/engine/status` |
| **Expected** | a user who must change their password is not a user whose dashboard data is worth fetching |
| **Actual** | every navigation issues five requests that all 403, on every page load, for as long as the state lasts |
| **User impact** | none visible — `QueryCache.onError` deliberately ignores 403 — but it is console noise on a first-run path, wasted round trips, and it makes real 403s harder to spot in an operator's logs |
| **Layer** | frontend |
| **Status** | OPEN (P2 — worth fixing, not worth risking the shell's redirect logic during this pass) |

---

## Summary

| ID | Severity | Class | Status | Fixed in |
|---|---|---|---|---|
| D-E01 | P1 | TEST BUG — stale i18n assertion | **FIXED** | `01-shell.spec.ts` JOURNEY accepts both locales |
| D-E02 | P1 | TEST BUG — stale i18n assertion | **FIXED** | switcher assertion accepts `Chủ sở hữu` |
| D-E03 | P1 | TEST BUG — stale i18n assertion (+ vacuous negative assertion) | **FIXED** | both audit-link assertions accept both locales |
| D-E04 | P1 | TEST BUG — inter-test password coupling, not retry-safe | **FIXED** | `signInSettlingPassword()` in `fixtures.ts` |
| D-E05 | P1 | TEST BUG — stale i18n assertion | **FIXED** | analyst role assertion accepts `Phân tích` |
| D-E06 | P1 | TEST BUG — inter-test password coupling | **FIXED** | same helper |
| D-E07/08/09 | P2 | TEST ISOLATION — not reproducible in isolation | **NOT A DEFECT** | pollution in the earlier run; see D-P05 |
| D-P01 | P1 | PRODUCT — empty-state copy ignores permissions (4 screens) | **FIXED** | 4 call sites + 8 i18n keys |
| D-P02 | P1 | PRODUCT — mutations fail silently (3 call sites, 1 cause) | **FIXED** | `MutationCache` default in `QueryProvider` |
| D-P03 | P1 | PRODUCT — create does not invalidate the list | **FIXED** | `workflows/new` invalidates `qk.workflows(ws)` |
| D-P04 | P1 | PRODUCT — first-run nav stays folded | **FIXED** | same invalidation (the probe key shares the prefix) |
| D-P05 | P2 | TOOLING — seed script burns a lockout attempt | OPEN | deferred, see below |
| **D-P06** | **P1 (top)** | **PRODUCT — no visible way to add a step on first open** | **FIXED** | the labelled button now renders whenever the rail is collapsed (2nd attempt — see below) |
| D-P07 | P1 | PRODUCT — raw error codes shown on the overview | **FIXED** | 23 `errorCode.*` labels × 2 locales |
| D-P08 | P2 | PRODUCT — remediation button labelled with a raw enum | **FIXED** | `remediation.INSPECT_EXECUTION` added |
| D-P09 | P2 | PRODUCT — change-password has no heading, states no rules | OPEN | deferred, see below |
| D-P10 | P2 | PRODUCT — five refused requests per page load in a first-run state | OPEN | deferred, see below |
| D-P11 | P1 | **REGRESSION I INTRODUCED** — palette closed itself after the first step | **FIXED** | superseded by the D-P06 rework below |
| D-P13 | P1 | **REGRESSION I INTRODUCED** — opening the palette by default took 224px of canvas | **FIXED** | caught by `11-appearance.spec.ts`; reworked so the canvas keeps its width |
| D-P14 | P2 | **PRODUCT** — the mutation floor toasted a pending password change, which the shell already redirects | **FIXED** | 403 `PASSWORD_CHANGE_REQUIRED` exempted (re-review MINOR) |
| D-P15 | P2 | **MY OWN TESTS** — three negative assertions could pass vacuously behind a fixed sleep | **FIXED** | anchored on the mutation actually reaching error state; proven to fail when the mutation is neutered |
| D-P16 | P2 | **MAINTAINABILITY** — persist and set-state were two calls that could drift apart | **FIXED** | collapsed into `openStepPicker()` |
| D-P12 | P2 | TOOLING — `ux-walkthrough.mjs` assumed the below-`xl` palette and hung 30s on every desktop run | **FIXED** | handles both surfaces via `[data-palette="rail"]` |

### D-P06's fix took two attempts, and both wrong turns were caught by evidence

**Attempt 1** opened the palette rail by default on a workflow that was still
just its trigger. It produced two regressions of its own:

- **D-P11** — `defaultOpen` was derived from the graph and fed to an effect
  keyed on it, so the moment the user added their first step the value flipped
  and **the palette closed itself one click after they found it**. Caught by
  reading `ux-after/13-editor-incomplete-state.png`; nothing in typecheck, lint
  or the component suite noticed.
- **D-P13** — opening the rail costs 224px of a 1280px window, and
  `11-appearance.spec.ts` asserts how much of the editor is canvas precisely to
  stop that. Its comment is explicit: *"Idle first: nothing selected, so the
  inspector must not be mounted at all and **the palette must be shut**."* The
  collapsed default was a considered decision, not an oversight, and attempt 1
  quietly reversed it. Caught by the appearance suite failing at both 1440×900
  and 1280×800.

The rule in `.claude/rules/testing.md` says there are exactly two readings of a
failing test: the implementation is wrong, or an approved spec changed. No spec
had changed here, so **the implementation was wrong** — the fix, not the
assertion, had to move.

**Attempt 2** keeps the rail shut by default and renders the labelled
"Thêm bước" button whenever it is collapsed — on every width, not only below
`xl`. The button is an overlay on the canvas, so it costs no layout width. The
editor's original reasoning ("above `xl` the palette is already on screen, so a
button would be one control too many") was right about the principle and wrong
about the premise; making the rail controlled by the editor lets the button
appear exactly when the premise is false.

Result: a first-time user gets a prominent labelled affordance
(`ux-after3/08-editor-first-open.png`) **and** the canvas keeps its full width.
Strictly better than both the original behaviour and attempt 1.

### D-P11 — the first attempt's regression, and how it was caught

The first fix for D-P06 derived `defaultOpen` from the graph and passed it to
an effect keyed on that value. The moment the user added their first step,
`defaultOpen` flipped to `false`, the effect re-ran, and **the palette closed
itself one click after the user found it** — a worse experience than the defect
being fixed.

Nothing in typecheck, lint or the component suite caught it. It was caught by
looking at `ux-after/13-editor-incomplete-state.png` and noticing the rail was
collapsed again. The default is now captured once in a ref, and
`ux-after2/12-editor-http-added.png` shows the palette still open after the
step is added.

This is the whole argument for UI_VISUAL evidence in one example: a correct
diff, a passing suite, and a regression that only a screenshot showed.

### Deferred, with reasons

- **D-P05** (`demo_seed.py` guesses a password): operator tooling, not
  customer-facing. The fix is to fail with a clear message naming the env var
  rather than guessing a second password. Deferred because it touches the seed
  path that the verification runs themselves depend on, and this pass should
  not change the tool it is being measured with mid-flight.
- **D-P09** (no heading on `/change-password`): real but small, and the page is
  otherwise clear. Grouped with the visual-consistency work rather than done
  piecemeal here.
- **D-P10** (five refused requests in the forced-change state): invisible to
  the user, and the fix touches the shell's redirect/query wiring, which is
  exactly the sort of change that should not be made on the same pass as a
  batch of UI fixes without its own verification.

### Observation, not filed as a defect

`OPEN_FIELD` is emitted by the backend for `EXPRESSION_INVALID` and has an i18n
label, but `resolveRemediation` gives it no destination, so no button renders
and the label is unreachable. In the editor the field in question is already on
screen, so the missing button costs the user nothing — but the label and the
action have drifted apart, and one of the two is dead. Worth resolving
deliberately rather than by accident.

**No P0 found.** Nothing encountered so far makes a core journey *impossible*,
corrupts data, crosses a tenant boundary or exposes a secret. D-P06 comes
closest — it stalls the first integration journey for a non-technical user —
but the affordance does exist and does work once found, so P1 is the honest
classification.

### What the automated surface audit did *not* find

Worth recording, because it bounds where the remaining risk is. Across 12
routes × 3 viewports, twice (empty workspace and populated tenant):

- **no** uncaught page errors, **no** console errors (on the populated tenant);
- **no** failed API requests other than Next.js RSC prefetch aborts, which are
  normal navigation behaviour;
- **no** horizontal overflow at any viewport;
- **no** text rendering below 12px after ancestor transforms;
- headings present on every populated route except `/change-password` (D-P09).

The defects above are therefore concentrated in *interaction and copy*, not in
layout or plumbing — which is consistent with a product whose appearance suite
already measures geometry and whose component tests already cover decisions.
