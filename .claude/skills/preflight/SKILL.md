---
name: preflight
description: Required before implementation begins on a substantial feature or bugfix — checks the active change artefact exists and is read, inspects the current implementation, names affected layers and invariants, classifies risk, checks git status, records a starting verification baseline and fingerprint, and declares the active change so the preflight write-gate stops asking. Use at the start of any non-trivial change, before the first product-code edit.
---

# Preflight

`scripts/claude_guard.py` asks before every edit to product code
(`backend/app/**`, `frontend/src/**`, `workflow-engine/src/**`, excluding
tests) until this has run, or a light-path fix is explicitly declared for
something genuinely small. This skill is what satisfies that gate honestly —
running it because the gate demands it and then skipping the substance
defeats the point.

## 1. Identify the change artefact

If `docs/changes/<slug>/` already exists for this work, use it. Otherwise
create it (`/feature` does this too, if you are about to run that instead):

```bash
mkdir -p docs/changes/<NNN>-<short-slug>
cp docs/changes/_template/*.md docs/changes/<NNN>-<short-slug>/
```

## 2. Read intent, spec, plan, acceptance

All four, in that order, even if you wrote them yourself minutes ago. If any
is still the unfilled template, stop and fill it in before touching code —
that is the actual work this gate exists to force, not paperwork around it.

## 3. Inspect the current implementation

Read the code this change will touch before writing anything. Most things in
this repository have a precedent; find it.

## 4. Identify affected layers

Fill in the layers table from `plan.md` explicitly: frontend, API,
domain/service, DB, worker, engine, security, monitoring, audit, tests. "None"
is a fine answer for a row; not having looked is not.

## 5. Identify architectural invariants in play

Which of the twenty numbered guardrails (SRS §2.1) does this touch, by number?
Cross-check against [ARCHITECTURE_INVARIANTS.md](../../../docs/ai-sdlc/ARCHITECTURE_INVARIANTS.md)
— if a "documented-only" invariant is in play, say so explicitly; nothing
mechanical will catch a violation there.

## 6. Classify risk

| Risk | Examples |
|---|---|
| **LOW** | isolated presentational or copy change, no behaviour change |
| **MEDIUM** | an ordinary frontend or backend feature, no lifecycle/tenancy/security surface |
| **HIGH** | workflow lifecycle, execution semantics, tenancy, credentials, auth, webhook, migrations, worker, engine/compiler, CI/deployment |
| **CRITICAL** | n8n runtime migration, a security boundary, the commercial/release gate, a destructive data migration |

**A small diff at HIGH or CRITICAL risk still gets the full verification and
review that risk level requires.** Risk is about the invariant touched, not
the line count — a two-line change to a tenancy filter is HIGH.

## 7. Check git status

```bash
git status --porcelain
python scripts/repo_fingerprint.py
```

If the tree is already dirty with unrelated changes, say so and decide
whether to stash them, commit them separately, or fold them into this change's
scope explicitly — do not silently mix them into a diff nobody will recognise
as one change.

## 8. Run the baseline verification for the areas this will touch

```bash
python scripts/verify.py targeted <area>   # for each layer named in step 4
```

This is not busywork: it is the "was the repository healthy before I started"
record. If a targeted area already fails before you touch anything, that is a
pre-existing defect, not something your diff will be blamed for — but it needs
to be true and recorded, not assumed.

## 9. Record the starting fingerprint

```bash
python scripts/repo_fingerprint.py
```

Note it in your own working notes (not necessarily in the change artefact) so
you can tell, later, exactly how much the tree has moved since this preflight.

## 10. Declare the active change

```bash
echo "<slug>" > .claude/active-change
```

This is what satisfies `claude_guard.py`'s preflight gate for the rest of the
session — product-code edits stop being asked-about, and
`scripts/completion_gate.py` will require review evidence (architecture,
qa, and ui if frontend is touched) before allowing a completion claim,
because an active change means this is being treated as substantial work.

## 11. Produce the preflight result

State back, briefly: the change artefact path, the layers affected, the
invariants in play, the risk classification, the baseline verification result
(with any pre-existing failures named), and the starting fingerprint. Then
proceed to implementation under `/feature` or `/bugfix`.

## The light path

For something genuinely small — a copy fix, an obvious one-line bug with an
established root cause — a full change artefact is disproportionate. Declare
it instead:

```bash
echo '{"reason": "<why this qualifies>", "declared_at": "<ISO time>"}' \
  > .claude/light-change.json
```

The guard caps this at 5 touched product files under one declaration; past
that it insists on a real preflight, because a light path that keeps growing
is not a light fix. The light path still requires the targeted test and final
verification — it skips the artefact, not the proof.

If you are unsure whether something qualifies as light, it does not. Run
preflight.
