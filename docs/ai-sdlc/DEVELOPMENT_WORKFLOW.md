# Development workflow

How work is done in this repository, for both people and AI agents. Specific to
this codebase; there is no general philosophy here.

The shape of every substantial change:

```
intent → spec → plan → build → verify → review → acceptance → full verify → Done
```

An agent must not go `prompt → code → "done"`. Small obvious fixes may take a
lighter path, but they still verify themselves.

---

## Feature

`/feature`. Full procedure in `.claude/skills/feature/SKILL.md`.

1. **Intent** — the user problem, who has it, what is out of scope, what success
   looks like. `docs/changes/<NNN>-<slug>/intent.md`.
2. **Spec** — observable behaviour: primary flow, alternates, failures,
   permissions, lifecycle effects, UI states, API implications.
3. **Plan** — impacted files, the layers touched (all ten rows answered),
   architecture decisions, migrations, security impact, test plan, risks.
   Specific enough to review the diff against.
4. **Acceptance** — written now, not afterwards. Concrete scenarios and the
   journey to walk.
5. **Build** — against the approved scope. Read the existing implementation
   first; most "new" things have a precedent here.
6. **Verify continuously** — `python scripts/verify.py quick` plus the targeted
   test, after each meaningful piece.
7. **Review** — the reviewer agents, independently. Findings in `review.md`.
8. **Acceptance journey** — walked in the running product, not asserted.
9. **Full verify** — `python scripts/verify.py full`, recorded verbatim.
10. **Done** — against `DEFINITION_OF_DONE.md`, with no BLOCKER open.

## Bug

`/bugfix`.

```
reproduce → write down expected behaviour → find the root cause
→ regression test (watch it fail) → smallest coherent fix
→ verify → review for adjacent impact → record cause and prevention
```

Reproduce **first**. If it will not reproduce, the usual reasons here are: it
only exists in the images, it needs two workspaces, two writers, two replicas, a
real viewport, or the graph the product creates rather than one seeded through
the API.

Write the regression test **before** the fix. A test you never saw fail is a
test you are guessing about.

## UI

`/ui-review`.

```
implement → run the real app → seed it → look at it at three viewports
→ findings → fix → look again → 11-appearance.spec.ts
```

1440×900, 1280×800, 390×844. Check every state, including the failed run and
the permission-denied screen. **Capture the screenshots and read them** —
driving a browser and asserting on it is not looking at it.

A passing component test means the component renders. It does not mean the
screen is usable, and the difference has cost this product eleven real defects.

## Engine

```
compile → run against the real pinned runtime → normalize the result
→ compare against the expected product DTO
```

Never against a mock; a mock proves the mock works. Assert on the normalized
product result, never on `IRun` — snapshotting upstream's shape fails on changes
that do not affect the product and passes on ones that do.

Adding a node is `/engine-node`: nine pieces, or it is not certified. Changing
the n8n version is not part of any of this — see below.

## Sensitive change

Engine pins, migrations, CI, deployment config, security-sensitive code, guard
scripts, and anything that removes or disables a test.

```
explicit change plan → additional review → verification → release concerns
```

A `PreToolUse` hook (`scripts/claude_guard.py`) intercepts these. It **denies**
an engine-pin edit outright and **asks** on the rest, with the reason. The hook
is not an obstacle to route around: if it fires, the thing it describes is the
work.

An engine migration additionally needs a compatibility analysis, an exact
dependency inventory, compiler verification, certified-node verification, the
fifteen golden tests green against the new runtime, a security and licensing
review, and its own change artefact (ADR-013). Declare it with
`APPBI_ENGINE_MIGRATION=<change-slug>`, where that artefact exists.

Licensing is a release gate, not a coding question. `commercial_gate` is
`NOT_REVIEWED` and n8n's Sustainable Use Licence covers internal delivery only
(ADR-015).

---

## Verification, in one place

```bash
python scripts/verify.py quick               # while working
python scripts/verify.py targeted <area>     # before review
python scripts/verify.py full                # before Done
```

**A stage that could not run is NOT RUN, never a pass.** `verify.py` exits
non-zero rather than call an incomplete run green.

## Review, in one place

[REVIEW.md](../../REVIEW.md). Eleven dimensions, which are mandatory for which
kind of change, and the rule that a BLOCKER blocks. Use the reviewer agents
rather than re-reading your own diff — asking the context that wrote the code
whether the code is right shares every assumption that produced the defect.

---

## When a correction recurs

This is how the repository learns, and it is the part most easily skipped.

The first time a mistake happens, fix it. **The second time, documentation has
already failed** — escalate it to something mechanical. Pick the cheapest rung
that actually catches it:

| Rung | Use when | Where |
|---|---|---|
| **Architectural rule** | a human or agent needs context to decide well | `.claude/rules/*.md` |
| **Regression test** | the mistake is observable in code or behaviour | the suite that can see it — `.claude/rules/testing.md` |
| **Guard / hook** | it is a static property of a file, a path or a command | `scripts/guardrails.py`, `scripts/claude_guard.py` |
| **Agent eval case** | it is a judgement failure a rule did not prevent | `docs/ai-sdlc/evals/` |

Prefer the lowest rung that works. A rule is context and does not enforce; a
test and a guard do.

### Recording an eval case

There is no eval framework here yet, and building one before there are cases to
run would be inventing infrastructure. What exists is the place and the habit:
when a correction recurs and none of the first three rungs fit, add a markdown
file under `docs/ai-sdlc/evals/` with

- the prompt or situation,
- what the agent did,
- what it should have done,
- which rule or guard should have prevented it, and why it did not.

Candidates, all of which have a guard or a rule today and would otherwise be
exactly this: the frontend calling the engine; a missing tenant filter; merging
Publish and Activate; a node added without a compiler mapping; the n8n version
changed during unrelated work; a test deleted for a green build; a secret
exposed; a forbidden action rendered; UI called done with no error or loading
state; a masked payload stored as execution input.

When enough cases accumulate to be worth running, they are already written down
in a runnable shape. Until then, they are the record of what this repository has
actually learned — which is more than an empty framework would be.
