---
name: feature
description: Build a substantial feature in this repository end to end — intent, spec, plan, implementation, continuous verification, independent review, acceptance journey, full verification. Use when asked to add or change product behaviour that is more than a one-line fix. Produces the change artefact under docs/changes/ that review and Done are judged against.
---

# Feature development

This procedure exists so that "implementation complete" means something. Do not
skip to step 7 because the change looks small; if it is genuinely small, use
the light path at the bottom.

## 1. Read the task, and find out whether it is one task

State back, in two or three sentences: what user problem this solves, who is
affected, and what is explicitly **not** in scope. If the request contains two
features, say so and ask which one — a spec covering two things reviews as
neither.

## 2. Open the change artefact

```
docs/changes/<NNN>-<short-slug>/
```

`NNN` is the next number in `docs/changes/`. Copy `docs/changes/_template/`.
If an artefact for this work already exists, continue it — do not start a
second.

## 3. Write intent.md, then spec.md, then plan.md

In that order, and do not write code before `plan.md` exists. Each template
says what it must answer. Two rules:

- `spec.md` is **observable behaviour** — what a user or an API client can see.
  Primary flow, alternate flows, failure behaviour, permissions, lifecycle
  effects, UI states, API implications. Not implementation, unless the
  architecture forces it.
- `plan.md` must be specific enough that somebody else can later hold the diff
  against it. "Update the workflow service" is not a plan; the file and the
  function are.

Write `acceptance.md` now too, while you still think the feature is simple.
Writing it afterwards produces scenarios shaped like the code you happened to
write.

## 4. Read the existing implementation first

Find how this is done today. This codebase has strong conventions and 31 ADRs;
most "new" things have a precedent, and matching it is cheaper than inventing.
Specifically check: is there already a service for this, a query key, an error
code, an i18n entry, a primitive component.

## 5. Name every layer the change touches

Go through this list explicitly and write the answer into `plan.md`. "None" is
a fine answer; *not having asked* is not.

| Layer | Question |
|---|---|
| frontend | new screen, state, or i18n string? |
| API | new route, or a change to a response shape? |
| domain/service | where does the rule live? |
| DB | migration? Does `alembic check` stay clean? |
| worker | dispatch, schedule tick, reconciliation, retention? |
| engine | compiler, allowlist, DTO, status vocabulary? |
| security | credentials, secrets, webhook, egress, tenancy? |
| monitoring | a new metric, an alert, a runbook section? |
| audit | does this action belong in the audit log? |
| tests | which suite can actually observe this working? |

## 6. Name the invariants in play

Which of the twenty guardrails (SRS §2.1) does this touch? Write them down by
number. If the change appears to require violating one, **stop and say so** —
that is a conversation, not a judgement call. The five most easily broken are
listed in `CLAUDE.md`.

## 7. Implement, against the approved scope only

Build what `plan.md` says. If you discover the plan was wrong, update
`plan.md` and note the deviation — do not silently build something else.
Resist adjacent refactoring; it makes the diff unreviewable and hides the
feature inside it.

## 8. Verify continuously

After each meaningful piece:

```bash
python scripts/verify.py quick
```

and the targeted test for what you just touched. Do not save verification for
the end; a broken guardrail found now costs a minute and found at step 11 costs
a rewrite.

## 9. Independent review

Run the reviewers that apply — see [REVIEW.md](../../../REVIEW.md) for which
dimensions are mandatory for what kind of change:

- `product-reviewer` — does this actually solve the intended flow?
- `architecture-reviewer` — boundaries, lifecycle, tenancy, versioning
- `qa-reviewer` — adversarial: edge cases, races, partial failure, recovery
- `ui-reviewer` — if any UI changed

They review the **diff against intent, spec, plan, acceptance and the repository
rules** — not whether it compiles. Do not ask yourself whether your own code
looks right; that is not review. Record every finding in `review.md`.

## 10. Walk the acceptance journey

Actually walk it, in the running product. Not "the endpoint returns 200" — the
journey in `acceptance.md`, in order, as a user. For workflow work that
typically means: create → configure → validate → save → run → inspect data →
publish → activate → trigger a real execution → read history → diagnose a
failure. Include only the stages the feature really has.

If UI changed, `/ui-review` is part of this step, not a substitute for it.

## 11. Full verification

```bash
python scripts/verify.py full
```

Record the result in `review.md` verbatim, including every **SKIP as NOT RUN**.
Never write that a stage passed if it did not run.

## 12. Decide whether it is Done — honestly

Against [docs/ai-sdlc/DEFINITION_OF_DONE.md](../../../docs/ai-sdlc/DEFINITION_OF_DONE.md).

**It is not Done if any BLOCKER is open.** An IMPORTANT finding is either fixed
or written into `review.md` with a strong reason for deferring it and who
carries it. Downgrading a finding so the checklist closes is the specific
dishonesty this procedure exists to prevent.

Report what is Done, what is deferred, and what did not run. That report is the
deliverable as much as the code is.

---

## The light path, for genuinely small changes

A typo, a copy fix, a one-line bug with an obvious cause: no artefact needed.
Still required — a regression test if it was a bug, the targeted suite, and
`verify.py quick`. "Small" describes the diff, never the amount of verification.

If you find yourself arguing that something substantial qualifies as small, it
does not.
