---
name: ui-review
description: Judge a screen visually rather than structurally — run the real application, look at it at three viewports, check every state including loading/empty/error/permission-denied, capture screenshots, report findings, fix, recheck. Use before claiming any frontend change is complete, and whenever asked whether the UI is finished or how it looks.
---

# UI review

A passing component test means the component renders. It says nothing about
whether the screen is usable. The first walkthrough of this product found five
real defects that **108 passing tests** could not see, all in the first two
minutes of use — and a second pass at three viewports found four more.

So: assertions answer "does it work". Only looking answers "is it pleasant",
and the two have different answers.

## 1. Know what you are judging against

Read the screen's acceptance criteria — `acceptance.md` in the change artefact,
or the relevant SRS section. Write down the two or three things a user must be
able to do here. A review without that becomes a list of opinions about
spacing.

## 2. Run the real application

```bash
docker compose up -d --build --wait      # the images — the deployed shape
# or, for iterating:
./run.sh up          # .\run.ps1 up
```

Fill it, or an empty deployment tells you nothing:

```bash
python scripts/demo_seed.py --base http://127.0.0.1:8000
```

That seeds seven workflows including **one that fails on purpose**, because the
error screen is part of the product and an untested error screen is a promise
nobody has kept.

**Look at the graph the product creates for you**, not one seeded through the
API. That single gap is why five defects survived 108 tests.

## 3. Look at it — at all three viewports

**1440×900**, **1280×800**, **390×844**. The suite asserts these; your eyes
have to visit them too.

```bash
cd e2e && node ux-walkthrough.mjs --headed --out ./ux-screenshots
```

That provisions a tenant, signs in and does what a new customer would do on
their first afternoon, screenshotting every step. It is not a test — it is the
looking. **Then open the screenshots.** Driving the browser and asserting on it
is not the same as reading what came out; capture them and read them.

## 4. Check each of these, per screen

Structure and craft:

- visual hierarchy — does the eye land on the primary action? A screen with no
  focal point is the defect no assertion catches
- spacing and alignment against the tokens; nothing arbitrary
- overflow — no horizontal document scroll; the primary action inside the
  viewport
- typography — nothing rendering below **12px**, *after* ancestor transforms. A
  12px label inside a canvas fitted at 0.75 reaches the eye at 9px
- canvas vs panel — at 1280, is the editor still mostly canvas?
- no empty bordered rectangle where content is absent; that reads as a field
  that failed to load

States — every one, and a screen missing any of them is not done:

- initial, loading (no layout jump), empty (says what to do next)
- populated, and with **long content**
- validation error — on the field, naming what to fix. Not reporting a field as
  unfilled while the panel visibly shows it set
- API failure — `remediation.action` as the primary CTA
- permission denied — why, not a blank screen
- disabled — visibly so, with the reason reachable
- engine unavailable — the product stays readable and says runs are paused
- a **failed** run — does the panel open on the error, or on an empty Output
  tab with the error one unmarked tab away?

## 5. Compare against the design system

`frontend/src/components/ui/` has the primitives. A one-off styled `<div>`
where `Button` exists is a finding. An arbitrary Tailwind value where a token
exists is a finding — it is invisible to a change of the scale, which is how
three hardcoded `text-[10px]` survived a type-scale fix.

Labels must come from `Field`, which wires the id both ways.

## 6. Report findings

Severity **BLOCKER / IMPORTANT / MINOR**, each with the screen, the viewport,
what a user sees, why it matters, and the concrete fix. Attach the screenshot.
"Spacing feels off" is not a finding; "the toolbar overflows at 390px and Run
is cut by the right edge" is.

## 7. Fix, then look again

Re-run the walkthrough and re-read the screenshots. Then:

```bash
cd e2e && npx playwright test 11-appearance.spec.ts
```

That asserts the measured invariants and compares twelve pixel baselines across
the three viewports. `--update-snapshots` accepts a deliberate change — **look
at the diff before you do**, every time. A baseline updated without being read
is a baseline that no longer means anything.

## What this cannot tell you

The appearance spec catches 10px text, a clipped button and a canvas squeezed
by its panels. It cannot tell you a page has no focal point or that a flow is
confusing. Those were all found by looking, and they still have to be looked
at. Do not report "the appearance suite is green" as a UI review.
