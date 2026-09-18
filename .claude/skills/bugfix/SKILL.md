---
name: bugfix
description: Fix a bug in this repository properly — reproduce it, write down expected behaviour, find the root cause, add a failing regression test, apply the smallest coherent fix, verify, and record what would prevent a recurrence. Use whenever something is reported broken, failing, or behaving wrongly.
---

# Bugfix

The discipline here is entirely about order. A fix applied before the bug is
reproduced is a guess, and a guess that makes the symptom go away is worse than
no fix because it closes the investigation.

## 1. Reproduce it

Before reading any code. Get to the smallest thing that reliably fails, and
write down the exact steps, inputs and environment.

If you cannot reproduce it, **say so** and say what you tried. Do not fix what
you cannot see failing. Common reasons it will not reproduce, in this repository:

- it only exists in the **images**, not the sources — run the container stack
  (`docker compose up -d --build --wait`), not `run.sh up`. Eleven defects here
  were of exactly this kind;
- it needs **two workspaces**, or an account that belongs to one of them;
- it needs **two writers**, or two concurrent requests — a sequential pair is
  answered by the service's own lookup and never reaches the race;
- it needs **two replicas** — a per-replica counter is correct at one;
- it needs a **real viewport** — a component test renders a portal without one;
- it needs the graph the **product** creates, not one seeded through the API.

## 2. Write down what should happen

One or two sentences, before you know the cause. This is the difference between
fixing a bug and changing behaviour: if you cannot state the correct behaviour
independently of the code, you cannot tell which one you are doing.

Check it against `spec.md` if a change artefact covers this area, and against
the SRS. If the spec says the current behaviour is correct, this is a feature
request — stop and say so.

## 3. Find the root cause

Not the place the exception surfaced — the reason it was reachable. Read the
surrounding code and the relevant ADR; several defects in this codebase were
three layers independently making the same well-meant wrong decision, and
fixing one layer looks like a fix and is not.

State the root cause in a sentence before you edit anything.

## 4. Write the regression test, and watch it fail

Before the fix. This is not optional and it is not ceremony: a test you never
saw fail is a test you are guessing about, and roughly half of "I added a
regression test" turns out to be a test that passes against the bug.

Put it where the defect is observable — [.claude/rules/testing.md](../../rules/testing.md)
has the table. A bug that only the browser suite can see needs a browser spec,
not a unit test that approximates it.

## 5. Apply the smallest coherent fix

Smallest, and **coherent** — if the root cause is in three layers, fix three
layers; that is one fix, not scope creep. What is out of bounds is the adjacent
cleanup, the rename, the refactor you noticed on the way. Those hide the fix
inside an unreviewable diff. Note them separately if they matter.

If the correct fix is large or architectural, stop and open a change artefact
under `docs/changes/` instead of doing it inline.

## 6. Verify

1. The new regression test — it must now pass.
2. The targeted suite for the area.
3. `python scripts/verify.py targeted <area>`.

Then think about what else that code path serves. A tenant filter, an
idempotency key, a redaction step — these have several callers, and fixing one
call site while the others stay wrong is how a defect comes back wearing a
different symptom.

## 7. Review for adjacent impact

Run `qa-reviewer` on the diff: it is built to ask what else breaks, what races,
what partial failure now does. For a fix in credentials, auth, webhooks, egress
or tenancy, security review is mandatory (see [REVIEW.md](../../../REVIEW.md)).

## 8. Record the root cause and the prevention

Say, in your report and — if a change artefact exists — in its `review.md`:

- what the root cause was;
- what the regression test is, and where;
- **what would have caught this earlier**, and whether that is now in place.

That last one is the point. Every defect is a gap in the harness as well as in
the code, and the repository's job is to learn structurally. If the answer is a
new guardrail, a new check, or a new kind of test, propose it — see
[docs/ai-sdlc/DEVELOPMENT_WORKFLOW.md](../../../docs/ai-sdlc/DEVELOPMENT_WORKFLOW.md)
on turning corrections into durable checks.

## Never

- change an expected value until the code produces it;
- delete or skip the failing test;
- `try/except` the error away;
- fix the symptom and leave the cause, without saying that is what you did.
