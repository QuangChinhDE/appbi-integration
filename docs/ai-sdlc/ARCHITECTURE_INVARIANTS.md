# Architecture invariants

The twenty numbered guardrails are canonical in
[SRS §2.1](../../BA_SRS_AppBI_Workflow_Automation_n8n_Core.md). This file maps
each to **what enforces it**, because an invariant nothing checks is a wish.

Three columns of enforcement, and the distinction matters:

- **Mechanical** — a script, a test or a constraint fails. The rule holds
  whether or not anyone remembers it.
- **Structural** — the system is built so the violation is not expressible
  (no published port; nothing writes that row).
- **Documented** — a rule an agent or a person has to follow. Real, but it
  depends on attention.

---

## The twenty guardrails

| # | Invariant | Enforced by | Kind |
|---|---|---|---|
| 1 | The FE must not call n8n directly | no published engine port; no Ingress path; NetworkPolicy; `guardrails.py` checks the FE carries no engine address; asserted by tests | structural + mechanical |
| 2 | The backend must not depend on n8n types | `guardrails.py` over imports and declared dependencies; CI | mechanical |
| 3 | The product is the system of record for workflows | no n8n metadata database exists to be a rival | structural |
| 4 | V1 needs no n8n metadata DB | the engine has no database, and none is deployed | structural |
| 5 | No `n8n_workflow_id` on a product workflow | `guardrails.py` over `backend/migrations/versions/` | mechanical |
| 6 | Trigger ownership is the product's | the product owns the scheduler and the webhook gateway (ADR-004, ADR-005); the engine runs neither | structural |
| 7 | Credential ownership is the product's | secrets in the product vault; contract test asserts no credential value appears in an engine result | mechanical |
| 8 | The node catalogue is the product's | `node_registry.json`; the FE renders only from it | structural |
| 9 | No raw n8n node type in the public API | `engine_binding` served only to platform admins | documented + tested |
| 10 | Only the engine imports n8n packages | `guardrails.py`, CI | mechanical |
| 11 | Versions must be pinned | `certify.py --check`; `claude_guard.py` **denies** a pin edit; `npm ci` | mechanical |
| 12 | No `.ee` / Enterprise-only source | `no-enterprise-source.test.ts` asserts nothing matching `.ee.` reaches `require.cache`; `guardrails.py` checks module specifiers | mechanical |
| 13 | Code node, community nodes, arbitrary execution disabled | the allowlist loads individual compiled files, never the directory loader | structural |
| 14 | Wait/resume and long-lived execution out of scope | not implemented | structural |
| 15 | The engine service is internal only | no published port in compose; no Ingress; NetworkPolicy accepting only `api` and `worker`; each asserted | structural + mechanical |
| 16 | The product error contract is normalized | `app/core/errors.py`; the error-UX matrix test | mechanical |
| 17 | A published version is immutable | nothing in the codebase updates a `workflow_versions` row | structural |
| 18 | A run binds to the exact version | the graph is frozen onto the execution row at creation | structural |
| 19 | Workspace scope is the security boundary | `test_tenant_isolation.py` walks the AST of every service module; `07-tenancy.spec.ts` across two real tenants; a composite FK | mechanical |
| 20 | The FE reuses the AppBI design system | primitives in `components/ui/`; the appearance suite measures the result | documented + mechanical |

## Beyond the twenty

Invariants the ADRs added, with the same question asked of each:

| Invariant | Enforced by | Kind |
|---|---|---|
| Publish and Activate stay separate | nothing implies the other | structural + documented |
| One `Idempotency-Key` means one run | partial unique index on `(workspace_id, workflow_id, idempotency_key)` (ADR-019) | mechanical |
| A rate limit means the same number at every replica | counted in Postgres, one atomic statement; two-replica browser test (ADR-020) | mechanical |
| Validation describes credentials without disclosing them | `guardrails.py` checks both halves; a unit test and a contract test (ADR-016) | mechanical |
| A redacted value is a view, never the data | ADR-027 | **documented only** |
| Payloads are redacted before storage | twice — engine side and product side | structural |
| Execution history survives engine loss | the worker's reconciliation pass (ADR-010) | mechanical |
| A label is associated with its control | `Field` generates the id; no call site can forget | structural |
| Every alert names a runbook section that exists | `test_alert_rules.py` | mechanical |
| A release can say what it was built from | `release_gate.py` refuses a dirty tree, a missing report, a suite reporting zero passes | mechanical |
| A commercial release is blocked while the licence review is open | `release_gate.py --delivery commercial` refuses; CI asserts the refusal (ADR-015) | mechanical |
| The pinned tree cannot drift | `certify.py --check`; `claude_guard.py` | mechanical |
| A node is certified, not imported | nine pieces; `certify.py` checks five of them | mechanical + documented |
| The product graph and the n8n graph are separate models | one compiler, in `src/compiler/` | **documented only** |
| CI gates the default branch | `guardrails.py` compares the push trigger to `.git/HEAD` | mechanical |

## What is documented only

These are the thin places, and they are listed rather than buried:

- **A redacted value must never become execution input.** The masked object is
  right there and looks usable. Nothing stops it; ADR-027 asks.
- **One compiler.** Nothing prevents a second translation site from appearing
  outside `src/compiler/`.
- **Publish/Activate separation** is structural today only because nothing
  currently couples them. A change could couple them without any check failing.
- **Guardrail 9** — an `engine_binding` leaking into a non-admin response would
  not be caught by a test today.
- **Two security exceptions** (ADR-030) are carried deliberately for the
  internal pilot: no row-level security, standing on a composite foreign key and
  twelve asserted cross-tenant routes. Neither survives opening the product to
  customers.

Each is a candidate for the next guard. `DEVELOPMENT_WORKFLOW.md` describes how
a recurring correction becomes one.
