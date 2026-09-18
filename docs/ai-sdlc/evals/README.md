# Eval cases

Recurring AI mistakes, written down in a shape that can later be run.

This directory is deliberately not a framework. Building one before there are
cases to run would be inventing infrastructure; what is needed first is the
habit and the place.

## When something goes here

Only after a correction has **recurred**, and only when the first three rungs in
[DEVELOPMENT_WORKFLOW.md](../DEVELOPMENT_WORKFLOW.md#when-a-correction-recurs)
do not fit — that is, when the mistake is a judgement failure rather than
something a rule, a test or a static guard can catch.

Prefer the lower rungs. A guard that refuses the edit is worth more than an eval
that notices it afterwards.

## One file per case

`NNN-short-slug.md`:

```markdown
# <what went wrong>

**Recurred:** <dates or sessions>

## The situation
The prompt, or the state of the repository, that led to it.

## What the agent did

## What it should have done

## Which rule or guard should have caught it
…and why it did not. This is the most valuable section: usually the answer is
that the rule existed but was not scoped to the path being edited, or the guard
matched prose rather than behaviour.

## Escalation
What was added as a result — a rule, a test, a guard — or why nothing could be.
```

## Already mechanised

These were candidates and are now enforced, so they are not eval cases. They are
listed because a regression in any of them means the guard was weakened, and
that is worth noticing:

| Mistake | Now caught by |
|---|---|
| the frontend calling the engine | `scripts/guardrails.py`; no published port |
| n8n imported outside the engine | `scripts/guardrails.py`, CI |
| the n8n version changed during unrelated work | `scripts/claude_guard.py` (deny) |
| a test deleted or disabled for a green build | `scripts/claude_guard.py` (ask) |
| a missing tenant filter | `backend/tests/test_tenant_isolation.py` (AST walk) |
| an engine identifier in the product schema | `scripts/guardrails.py` |
| a secret echoed by the API | contract test, smoke test |
| an enterprise-licensed module imported | contract test over `require.cache` |
| CI gating a branch that does not exist | `scripts/guardrails.py` |

Still carried by documentation alone, and therefore the most likely first real
eval cases: merging Publish and Activate; adding a node without all nine
certification pieces; storing a masked payload as execution input; calling UI
done with no error or loading state.
