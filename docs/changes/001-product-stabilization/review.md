# Review — Product reality check and stabilization

## Reviewers run

| Reviewer | Run? | Findings |
|---|---|---|
| product-reviewer | **N/A** | this pass had no `spec.md`-defined new behaviour to check a diff against; the product-correctness question was answered directly by walking Journeys A and B in the deployed product and reading the screenshots (`acceptance.md`) |
| architecture-reviewer | **Yes** | 0 BLOCKER · 1 IMPORTANT · 4 MINOR |
| qa-reviewer | **Yes** | 0 BLOCKER · 2 IMPORTANT · 6 MINOR |
| ui-reviewer | **N/A as an agent** | the UI review was done directly and at length — 3 audit runs × 12 routes × 3 viewports, plus 30 journey screenshots, with the individual screenshots read and listed in `acceptance.md`. Two defects (D-P06, D-P11) were found *only* by reading them |
| security review | **N/A** | no change touches credentials, auth, webhook, egress, secrets or tenancy. The architecture reviewer confirmed the diff contains no backend, service, schema or query change |

Both reviewers ran against fingerprint `f5e7007ca12b`. **Every finding below
was then acted on, which makes both reviews stale** — they are reported here as
the record of what was found, not as current evidence. The final state is
covered by the verification below.

## Findings and resolutions

### IMPORTANT — the mutation error floor did not exempt 401 *(both reviewers, independently)*

`QueryProvider`'s new `MutationCache.onError` toasted every failure, including
401. The sibling `QueryCache` handler ten lines above explicitly returns early
on 401 with the comment *"401 is handled by the shell (redirect to login)"* —
but that is only true on the query path. The qa-reviewer traced the concrete
scenario: a session expires while `/alerts` is open, the user clicks
Acknowledge, and gets a toast carrying an authorization message and a trace id
on a screen that is not redirecting, for a problem whose only answer is "sign
in again".

Two independent reviewers converging on the same line is the strongest signal
this pass produced.

**Resolved.** 401 is now exempted, with the reasoning written next to it.
Regression test: `stays quiet on 401, which belongs to the shell`, proven to
fail when the exemption is removed.

### IMPORTANT — the riskiest changes had no test that would fail without them *(qa-reviewer)*

`DEFECT_INVENTORY.md` claimed *"frontend component test: a failing mutation
with no local handler surfaces a toast"* as D-P02's regression coverage. That
test did not exist. The original `stabilization.test.tsx` asserted catalogue
contents and a primitive's rendering — reverting the `MutationCache`, the
`invalidateQueries` and the add-step button condition would all have left the
suite green.

This is the exact failure the harness exists to prevent, committed in the
harness's own change artefact.

**Resolved.** Added behavioural tests that drive the real `QueryProvider`:
a failing mutation with no handler toasts; one with a local `onError` does not;
one marked `errorHandledInline` does not; a 401 does not. Plus a prefix test
for `qk.workflows(ws)` against the list, the first-run probe and the overview
slice — the load-bearing claim behind D-P03/D-P04. Both new groups were proven
to fail against the reverted fixes before being trusted.

### MINOR — opening the rail from the button did not persist *(both reviewers)*

`PaletteRail.toggle` wrote `localStorage`; the editor's new add-step button set
React state only. So the rail a first-time user opened was shut again on the
next visit, and on any resize across `xl` that unmounted it — contradicting the
component's own docstring, for precisely the user the button was added for.

**Resolved.** `rememberPaletteOpen()` exported from `EditorPanels` and called
by the button, so both entry points persist through one function.

### MINOR — the opt-out guard could be switched off wholesale *(qa-reviewer)*

`if (mutation.options.onError) return;` becomes unconditionally true if anybody
sets `defaultOptions.mutations.onError`, silently disabling the floor.

**Resolved as documentation, not code.** Guarding on a `meta` marker instead
would require marking ~21 existing call sites that already handle their own
errors, and getting one wrong means a double toast. The footgun is now written
next to the check, including the per-call `mutate(vars, {onError})` case the
guard cannot see. Accepted risk, explicitly recorded.

### MINOR — stale comment in `ux-walkthrough.mjs` *(architecture-reviewer)*

Described the rail as "expanded by default", which was true only of the
abandoned first attempt. **Resolved.**

### Accepted without change, with reasons

- **Add-step button flashes on first paint** for a user who persisted the rail
  open (`useState(false)` → effect reports `true`). Real, cosmetic, and fixing
  it properly needs a tri-state "unknown" that complicates the mount path. Not
  worth that on this pass.
- **`signInSettlingPassword` reads a >10s sign-in as a wrong password.** Test
  helper only. The qa-reviewer independently traced the lockout arithmetic and
  confirmed it does not trip (one extra failed attempt per fresh account, 8
  allowed, and a retry re-provisions).
- **Lost redundancy on the forced-password-change assertion** in two specs.
  `02-auth.spec.ts:100` still owns that assertion outright, so coverage is not
  lost — only duplicated coverage is.
- **A failed rename leaves the rejected name in the header.** Pre-existing,
  and now *audible* rather than silent thanks to the mutation floor, which is
  a strict improvement. A proper fix restores `summary.name` on error and
  belongs with the D-P09/D-P10 polish batch.

## Residual risks

- Three P2 defects remain open by decision: **D-P05** (`demo_seed.py` guesses a
  password and burns a lockout attempt), **D-P09** (`/change-password` has no
  heading and states no password rules), **D-P10** (five refused requests per
  page load while a password change is pending). Reasons in
  `DEFECT_INVENTORY.md`.
- **No test was removed, skipped or weakened.** The six e2e assertion changes
  correct expectations that had gone stale against the documented vi-first i18n
  policy; the architecture reviewer verified this independently and confirmed
  no coverage was lost.
- The **root cause of D-E07/08/09** is now understood and is an operational
  trap rather than a product defect: `scripts/smoke.py` and the browser suite
  both drive `admin@appbi.vn` and settle its password to *different* values, so
  running them against one stack in the wrong order breaks the second. CI never
  sees it because they run in separate jobs on separate stacks. Recorded here
  because the next person to run both locally will hit it.

## Verification

See the session report. Final certification ran from a torn-down, rebuilt
stack (`docker compose down -v` → `up --build --wait`) at fingerprint
`c067b0c2e9f1`.

## Done?

- [x] no BLOCKER open
- [x] every IMPORTANT fixed (both, from two independent reviewers)
- [x] the acceptance journeys were walked in the running product, screenshots read
- [x] UI looked at — 3 audit runs plus 30 journey screenshots
- [ ] reviewers re-run after the fixes — **not done**; both reviews are stale by
      their own contract, and this is stated plainly rather than papered over
- [x] verification reported truthfully, including what did not run
