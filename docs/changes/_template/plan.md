# Plan — <change name>

> How it will be built, specifically enough that somebody else can hold the diff
> against this document. If the plan turns out to be wrong, update it here and
> note the deviation — do not silently build something else.

## Impacted files and modules

> Path by path. "Update the workflow service" is not a plan;
> `backend/app/services/workflows.py` — add `publish_version()` is.
>
> | Path | Change |
> |---|---|

## Layers touched

> Fill in every row. "None" is a fine answer; not having asked is not.
>
> | Layer | Change |
> |---|---|
> | frontend | |
> | API | |
> | domain/service | |
> | DB | |
> | worker | |
> | engine | |
> | security | |
> | monitoring | |
> | audit | |
> | tests | |

## Architecture decisions

> The choices a reviewer should evaluate rather than rediscover, and what you
> rejected. If this contradicts an ADR, say which and why. If it deserves a new
> ADR, say so — `docs/adr/index.md` records what was rejected, not only what was
> chosen.

## Migrations

> The migration, whether it reverses, what happens to existing rows, and how
> `alembic check` and `scripts/schema_drift.py` will be satisfied. Never edit an
> applied migration; add a new one.

## API changes

> Additive or breaking. If breaking, the compatibility story.

## Security impact

> Secrets, tenancy, permissions, webhook auth, egress. If none, say "none, and
> here is why" — the empty answer and the unasked question must look different.
> If any, security review is mandatory (REVIEW.md dimension 6).

## Test plan

> Which suite covers what, and **why that suite is the one that can observe it**
> — see the table in `.claude/rules/testing.md`. A defect only the browser suite
> can see is not covered by a unit test that approximates it.
>
> | Behaviour | Suite | Why this one |
> |---|---|---|

## Rollout and compatibility

> Does this need a migration before the deploy, a flag, an ordering between
> services? Can it be rolled back?

## Explicit non-goals

> Carried from intent.md, plus anything ruled out while planning.

## Risks

> | Risk | Likelihood | Caught by |
> |---|---|---|
