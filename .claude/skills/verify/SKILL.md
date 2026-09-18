---
name: verify
description: Run this repository's verification at the right depth — quick while working, targeted for one subsystem, full before Done — and report the result truthfully including stages that did not run. Use whenever asked to verify, check, or confirm that a change works, or before declaring anything complete.
---

# Verification

One entry point, three depths. The depths exist because "did I break anything"
and "may this be released" are different questions, and a single command
answering both gets run at the wrong depth every time.

```bash
python scripts/verify.py quick
python scripts/verify.py targeted <backend|frontend|engine|deployment|guardrails|e2e>
python scripts/verify.py full
```

Add `-v` to stream output while debugging a failure.

## Which depth

| Depth | When | Roughly |
|---|---|---|
| **quick** | between edits, many times a session | lint, typecheck, the pure-logic suites, guardrails. No database, no containers, no build |
| **targeted** | after finishing work in one area, and before review | that subsystem end to end, plus guardrails |
| **full** | before claiming Done; before a release | everything, including the browser suite against the images |

`quick` is a working aid and is **never** sufficient for Done. Say so when you
report it.

## What each depth covers

**quick** — `ruff` + `pytest` in `backend/`; `typecheck`/`lint`/`test` in
`frontend/`; `typecheck`/`test` + `certify.py --check` in `workflow-engine/`;
`scripts/guardrails.py`.

**targeted `<area>`** adds, per area:

- `backend` — the migration round-trip, `alembic check`, schema drift (needs
  `DATABASE_URL`)
- `frontend` — `npm run build`. Run it: `output: 'standalone'` bakes config at
  build time, and a defect that exists only in the built image is invisible to
  the dev server
- `engine` — `npm run build`
- `deployment` — manifest/alert/production-doctor tests, the refusal of the
  unedited production template, `docker compose config`, `kubectl kustomize`
- `e2e` — the Playwright suite (needs Docker and the stack up)

**full** — all of the above, in that order.

## The rule that makes this worth anything

**A stage that could not run reports SKIP, and SKIP is NOT RUN — never a pass.**

`verify.py` exits:

- `0` — everything ran and passed
- `1` — something **failed**; the summary names the stage
- `2` — everything that ran passed, but stages were skipped and you did not
  pass `--allow-skips`

Exit 2 is deliberate. On a machine with no Docker, `full` cannot honestly
report a green repository, and a wrapper that returned 0 there would launder "I
did not check" into "I checked". If you must proceed, pass `--allow-skips` and
**reproduce the SKIP list verbatim** in your report.

Never write "tests pass" about a command you did not execute.

## When a stage fails

1. Read the tail `verify.py` printed; re-run that one stage with `-v` if you
   need more.
2. Decide whether the **implementation** is wrong or an expectation is
   genuinely obsolete. Almost always the former. See
   [.claude/rules/testing.md](../../rules/testing.md) — there is no third case.
3. Fix the implementation. Do not weaken the check, widen a tolerance, skip the
   test, or mock out a contract test.
4. Re-run the targeted stage, then the depth you were at.

A failing guardrail is not a bug in the guardrail. If you genuinely believe a
rule is wrong, that is a change artefact under `docs/changes/`, not an edit to
`scripts/guardrails.py`.

## Reporting

Report per stage, using exactly **PASS / FAIL / NOT RUN**, and say which depth
you ran. For example:

```
verify.py targeted backend:
  PASS     backend: lint, unit tests (260 passed)
  NOT RUN  backend: migrations — DATABASE_URL not set
  PASS     guardrails
```

Do not summarise that as "backend verified".
