# Architecture rules (repository-wide)

Scope: everything. The canonical numbered list is SRS §2.1; this file says what
each guardrail means for code you are about to write, and what enforces it.

## The boundary

- `workflow-engine/` is the **only** place that may import `n8n-workflow`,
  `n8n-core`, `n8n-nodes-base` or anything `@n8n/*`. Backend, frontend and e2e
  must not import them or declare them as dependencies.
  *Enforced:* `scripts/guardrails.py`, CI `guardrails`.
- No n8n type (`INode`, `IRun`, `WorkflowExecute`, `n8n-nodes-base.*`) may
  appear in a domain service, a schema, or a product-facing API contract.
  `engine_binding` is served to platform admins only (guardrail 9).
- Everything crossing to the engine goes through `WorkflowEngineAdapter`
  (`backend/app/engine/`). No service calls the engine directly, and nothing
  outside the adapter knows the engine's address or token.
- The browser reaches `/api/v1/**` and `/hooks/{key}`. Nothing else.
  *Enforced:* no published engine port in compose, no Ingress path in the
  Kubernetes overlay, a NetworkPolicy accepting only `api` and `worker`, and
  tests over each.

## Identity and the two graphs

- The product graph and the n8n graph are **separate models**. Translation
  happens in exactly one place: `workflow-engine/src/compiler/`. A second
  translation site anywhere else is an architectural defect, not a shortcut.
- The product schema stores no engine identity — no `n8n_workflow_id`, no node
  type strings as product keys. If an implementation ever needs an engine-side
  handle, it is an opaque ref held at the adapter layer.
  *Enforced:* `scripts/guardrails.py` over `backend/migrations/versions/`.
- `engine_type = N8N_CORE` is a product concept (which *kind* of engine a
  workspace is bound to) and is not a violation.

## Workflow lifecycle

Three distinct concepts, and conflating any two is a BLOCKER:

| Concept | Mutable? | Table |
|---|---|---|
| workflow identity | stable | `workflows` |
| draft | mutable | the draft row |
| published version | **immutable** | `workflow_versions` |

- Saving a draft mutates no runtime state.
- **Publish and Activate are separate operations.** Publishing freezes a
  version; activating points a trigger at one. Never merge them, never make one
  imply the other.
- Nothing in the codebase updates a `workflow_versions` row. Rollback
  *activates an older version*; it does not rewrite history.
- A trigger fires one explicit active version.

## Execution

- The **product database is the system of record** for execution history. The
  engine keeps none.
- The execution record exists *before* asynchronous dispatch, and the graph is
  frozen onto that row at creation. A run names the exact artefact it ran.
- The product API never blocks on execution completion.
- Engine loss must not leave runs permanently `RUNNING` — the worker's
  reconciliation pass owns that (ADR-010).
- Retry re-executes the **frozen** input, never a UI preview and never a
  redacted payload (ADR-026, ADR-027).
- Manual, webhook and scheduled runs converge on the same execution path.
- One `Idempotency-Key` means one run, enforced by a partial unique index, not
  a read-then-write (ADR-019).

## Tenancy

`workspace_id` is the security boundary, enforced in the backend. Every query
touching tenant data names it; the exceptions are allow-listed and each carries
a written reason.
*Enforced:* `backend/tests/test_tenant_isolation.py` walks the AST of every
service module; `e2e/tests/07-tenancy.spec.ts` proves it across two real
tenants.

Platform-admin reach is separate from workspace role: creating a tenant needs
the platform flag, not an Owner role (ADR-022).

## Pins

`compatibility.yaml` and `node-lock.json` are the release contract. Nothing may
say `latest` or use a caret range for the runtime. Changing a pin is a change
artefact with a compatibility analysis and a green contract suite — never a side
effect (ADR-013, ADR-024).
*Enforced:* `scripts/certify.py --check`, and a hook that refuses the edit
without an approved migration artefact.

## When a rule is wrong

Some of these will eventually be wrong. The route is a change artefact under
`docs/changes/` arguing the case, and an ADR — not an edit to the check that
enforces it. Silencing the guard and calling the work done is the failure mode
this repository is built against.
