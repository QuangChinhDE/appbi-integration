# Backend rules

Scope: `backend/`. FastAPI, SQLAlchemy async, Alembic, Python 3.12.
Architecture-wide rules are in [architecture.md](architecture.md); this file is
about writing backend code correctly.

## Layering

```
app/api/v1/*.py     HTTP only: auth, validation, status codes, serialisation
app/services/*.py   the domain. Where a rule lives
app/models/*.py     the product schema
app/engine/         WorkflowEngineAdapter — the one door to the engine
app/core/           config, errors, redaction, permissions, rate limit, secrets
app/workers/        dispatch, schedule tick, reconciliation, retention
```

- Business rules belong in `services/`, not in a route handler and not in the
  frontend. A route that makes a decision is a rule the API cannot reuse and
  the worker cannot honour.
- `services/graph.py` is **pure**: no database session, no engine, no I/O. Keep
  it that way — it is why graph validation is fast and exhaustively tested.
- A route never imports from `app/engine/` internals; it calls a service.

## Tenancy — the rule that is easiest to break silently

Every query touching tenant data filters on `workspace_id`. Not "the caller
already has the right workspace" — the filter, in the query.

```python
# wrong: looks correct, returns another tenant's row
await session.get(Credential, credential_id)

# right
select(Credential).where(
    Credential.id == credential_id,
    Credential.workspace_id == workspace_id,
)
```

A lookup by id alone is how `derive_health` once returned workspace B's
credential *name* inside workspace A's health message. `test_tenant_isolation.py`
walks the AST of every module in `app/services/` and fails on a tenant-table
query with no `workspace_id`. Crossing the boundary deliberately means adding
to that allow-list **with a written reason**, in the same commit.

Reach: workspace role and the platform-admin flag are different authorities.
`reachable()` is not either/or — the first admin has a membership row *and*
platform reach, and treating it as a choice is a bug that only shows up with
two workspaces (ADR-022).

## Errors

Use `app/core/errors.py`. Every error is a normalized envelope with a stable
code, a category and — wherever the user can act — `remediation.action`, which
the frontend renders as the primary CTA (SRS 34). Do not invent an ad-hoc shape,
do not leak a stack trace or an n8n error class, and do not raise a bare
`HTTPException` where a coded error exists.

An unclassified failure gets no `remediation`. That is the honest answer; a
fabricated remediation sends the user somewhere that does not help.

## RBAC

The backend is the authority. Check permission in the service or a dependency
— never rely on the UI having hidden the button. The matrix is tested
(`test_policy.py`); extend the test when you extend the matrix.

## Versions, execution, idempotency

- Never write to a `workflow_versions` row after creation.
- Create the execution record, freeze the graph onto it, *then* dispatch.
- Idempotency is a database constraint. Do not "optimise" it into a lookup:
  two concurrent requests both read nothing and both insert (ADR-019).
- Rate limits and quotas count in Postgres, atomically. An in-process counter
  multiplies by the replica count and changes when somebody scales the
  deployment (ADR-020, ADR-028).

## Migrations

- Model change ⇒ migration, in the same commit. `alembic check` is the gate.
- A migration must apply, `downgrade base`, and re-apply. CI runs exactly that.
- Never edit an applied migration; add a new one.
- No n8n identifier reaches the schema (guardrail 5).
- After a schema change run `python scripts/schema_drift.py` against a real
  migrated database. "There is one head" is a claim; the drift report is
  evidence.
- Editing `backend/migrations/` triggers a hook asking for the migration
  verification. Answer it.

## Secrets

Plaintext never leaves through a product-facing response — `{configured,
masked_hint}`. Secrets resolve only at execution time. See
[security.md](security.md).

## Verifying

```bash
python scripts/verify.py targeted backend
```

Or directly, in `backend/`: `ruff check app tests`, then `pytest -q`. The unit
suite needs no database and runs in seconds; there is no excuse for not having
run it.
