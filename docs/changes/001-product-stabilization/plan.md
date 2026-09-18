# Plan — Product reality check and stabilization

## Shape of the work

This is an investigation that produces fixes, not a fix list decided up front.
The plan is therefore a plan for *how to find out*, plus the constraints any
resulting fix must respect. Impacted files cannot be enumerated before Phase 1
and Phase 2 have run; this document is updated as defects are identified, and
the deviation record below is where that happens.

## Phases

| Phase | Output |
|---|---|
| 1 | The 9 E2E failures reproduced on a clean isolated stack and classified (PRODUCT BUG / TEST BUG / TEST ISOLATION / ENVIRONMENT / NOT REPRODUCIBLE) |
| 2–4 | A full UI walkthrough at 1440×900, 1280×800, 390×844, with screenshots captured **and read**, plus a state matrix per screen |
| 5 | Journeys A–G executed end to end against the deployed product |
| 6 | `DEFECT_INVENTORY.md` — every defect with reproduction, impact, layer, root cause, status |
| 7 | Root-cause grouping: shared primitives fixed once, not patched per screen |
| 8 | Fixes in waves — P0 functional, P1 product/UX, P2 polish |
| 9 | Visual consistency audit across the whole product |
| 10 | Re-certification from a second fresh disposable stack |

## Environment discipline

The previous run's e2e result is suspect because `demo_seed.py` was run
manually into the platform admin's account while the suite ran its own
fixtures, and `ux-walkthrough.mjs` was started concurrently against the same
singleton admin credential.

This pass therefore:

- tears down to an empty volume (`docker compose down -v`) before Phase 1;
- runs the E2E suite **alone** — no seeding, no walkthrough, nothing else
  touching the admin account;
- only then seeds demo data, for the human walkthrough in Phase 2;
- tears down again before the Phase 10 re-certification, so the final evidence
  comes from a stack that no exploratory work has touched.

## Layers touched

Unknown until Phase 1–5 complete. Filled in per defect in
`DEFECT_INVENTORY.md`, and summarised here as waves land.

| Layer | Change |
|---|---|
| frontend | TBD — expected to carry most defects |
| API | TBD |
| domain/service | TBD |
| DB | none expected; a migration would be a scope escalation |
| worker | TBD |
| engine | none expected; the runtime is pinned |
| security | TBD; any finding here escalates to mandatory security review |
| monitoring | TBD |
| audit | TBD |
| tests | a regression test per machine-observable defect |

## Architecture decisions

None anticipated. This pass fixes defects within the existing architecture. If
a defect's correct fix turns out to be architectural, it stops and becomes its
own change artefact with an ADR rather than being done inline here.

## Migrations

None planned. A schema change would mean a defect whose fix is a data-model
change — that escalates rather than proceeding inline.

## API changes

Only where a defect's root cause is in the API contract (e.g. a response
missing a field a screen needs). Additive where possible. No n8n type may enter
a product-facing contract (guardrails 2, 9).

## Security impact

Expected: none by intent. But Journey C (credentials) and Journey G (workspace
isolation) directly probe the security surface, and Phase 3's credentials and
audit audits look for plaintext leakage. **Any finding in credentials, auth,
webhook, egress or tenancy makes security review mandatory** (REVIEW.md
dimension 6) before that fix is Done.

## Test plan

| Behaviour | Suite | Why this one |
|---|---|---|
| A defect visible only in the deployed images | `e2e/tests/` | the only suite that runs the images rather than the sources |
| A defect in a component's decision logic | `frontend/tests/` | fast, and where port/permission/remediation logic already lives |
| A defect in a service rule, tenancy filter or projection | `backend/tests/` | pure logic, seconds, no database needed |
| A defect in execution semantics | `workflow-engine/tests/contract/` | real pinned runtime; a mock would prove the mock |
| A visual/layout defect | `e2e/tests/11-appearance.spec.ts` | measures rendered geometry and the 12px floor after transforms |
| A defect only a human can see (hierarchy, confusion) | the walkthrough + read screenshots | no assertion catches "this page has no focal point" |

Every machine-observable defect gets a regression test **written before the
fix and watched failing** (`.claude/rules/testing.md`).

## Rollout and compatibility

No migration, so no ordering constraint. Every fix should be independently
revertible. Existing stored graphs, published versions and saved triggers must
keep working — a fix that requires re-publishing existing workflows is a
compatibility break and needs saying so explicitly.

## Explicit non-goals

Carried from `intent.md`: no redesign, no new features, no engine migration, no
unrelated refactors, no further SDLC work, no reopening ADR-030.

## Risks

| Risk | Likelihood | Caught by |
|---|---|---|
| A "fix" for a UI symptom masks a backend defect | medium | root-cause grouping in Phase 7; qa-reviewer |
| Fixing one screen's stale data breaks another's caching | medium | `qk` prefix rules in `queryKeys.ts`; targeted frontend suite; re-walk the journey |
| A visual fix regresses the 12px floor or canvas share | low | `11-appearance.spec.ts` measured invariants |
| Scope creep from "while I'm here" refactors | **high** | the non-goals above; every change traced to a DEFECT_INVENTORY id |
| The 9 E2E failures turn out to be test bugs, and fixing tests hides a product bug | medium | classify before fixing (Phase 1); never weaken an assertion |
| Exploratory seeding pollutes the final evidence | medium | Phase 10 runs on a second, untouched fresh stack |

## Deviation record

Updated as the plan changes. Nothing yet — Phase 0 complete, Phase 1 starting.
