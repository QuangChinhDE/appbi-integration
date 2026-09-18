# Intent — Product reality check and stabilization

## What problem are we solving?

A non-technical customer opening AppBI Integration today meets an application
whose automated suites are largely green but whose lived experience has not
been examined end to end. The last certification run found the browser suite
failing (127 passed, 9 failed) and produced **no** UI_VISUAL or UI_JOURNEY
evidence at all — nobody has looked at the product as a user this cycle.

The problem is not "tests are red". It is that we cannot currently answer:
*if a real customer tries to build and operate an integration today, what is
broken, confusing, unfinished, visually wrong, inconsistent or unreliable?*

## Who is affected?

- **A first-time customer** (Workspace Owner) building their first
  integration: create → configure → validate → run → publish → activate →
  trigger → read history. Every friction here is the product's first
  impression.
- **An operator** diagnosing a failed run at 3am, who needs the error screen
  to say what broke and what to do.
- **A Builder / Analyst / Auditor** hitting the RBAC surface, who must see
  affordances that match what the backend will actually allow.
- **A platform admin** onboarding a second tenant, who must never see
  tenant A's data in tenant B.

## Why now?

`v1.0.0-rc1` is a release candidate for an internal pilot. A pilot's whole
purpose is to expose the product to people who did not build it. Nine unexplained
E2E failures and zero visual evidence means we would be asking pilot users to do
our first walkthrough for us.

## Explicitly out of scope

- Redesigning the product, or introducing a new design language. The existing
  AppBI design system and primitives in `frontend/src/components/ui/` are the
  vocabulary.
- New product features. Nothing that is not already specified in the SRS.
- The n8n engine migration (ADR-013) — the runtime stays at 1.14.1.
- Broad refactors unrelated to an identified defect.
- Further SDLC/harness work. That is finished and committed at `72d8dfa`;
  the harness is now a tool for this task, not the task.
- The ADR-030 carried security exceptions (no RLS, and the second recorded
  gap). Those are deliberate, scoped to the internal pilot, and re-opened by a
  decision to sell — not by this pass.

## What does success look like?

1. Each of the 9 E2E failures is **classified** with a confirmed root cause (or
   an explicit UNKNOWN), not a hypothesis — reproduced on a clean, isolated
   stack with no `demo_seed.py` contention.
2. A durable `DEFECT_INVENTORY.md` exists, with every defect carrying
   reproduction, expected/actual, user impact, layer, root cause and status.
3. Every P0 is fixed and proven fixed by re-running the user scenario, not by
   reading the diff.
4. Seven product journeys (A–G) each have an explicit PASS / FAIL / NOT RUN.
5. UI_VISUAL and UI_JOURNEY evidence exists: screenshots captured **and read**,
   at the viewports the product supports.
6. A final, honest readiness verdict — READY FOR INTERNAL PILOT / READY WITH
   KNOWN LIMITATIONS / NOT READY — with all evidence at one repository
   fingerprint.

## Guardrails in play

Fixes must not violate SRS §2.1. Most relevant to UI/product work here:

- **1, 15** — the frontend calls `/api/v1` and `/hooks` only; the engine stays
  unreachable.
- **9** — no raw n8n node type in a product-facing response.
- **16** — the normalized error contract; the FE never parses a stack trace.
- **17, 18** — published versions immutable; a run binds its exact version.
  Anything touching publish/activate is checked by `guardrails.py`.
- **19** — every tenant query names its workspace (Journey G).
- **20** — reuse the AppBI design system; do not invent one-off styling.

If a fix appears to require breaking one of these, that is a conversation, not
a judgement call.
