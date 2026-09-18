# AppBI Workflow Automation — repository constitution

This is the short version, and it is binding. It exists so that every session
starts knowing the same things. Detail lives in the files it links to; do not
copy that detail back here.

**Memory is context, not enforcement.** Nothing in this file stops anybody.
The rules that actually hold are `scripts/guardrails.py`, the test suites, the
`.claude/settings.json` hooks and the CI jobs. If you find yourself relying on
this file alone to prevent a mistake, that rule is not yet enforced — say so.

---

## What this product is

AppBI Workflow Automation: a workflow automation product that embeds **n8n as
an internal execution runtime**, pinned at **1.14.1**. It is not an n8n
reskin. The product owns the workflow, its versions, its triggers, its
credentials and its execution history. n8n contributes exactly one thing: the
semantics of running a graph.

```
browser → frontend → api (product API / control plane) → postgres
                       │
                       └─ WorkflowEngineAdapter ─→ engine (the only n8n importer)
worker ── dispatch, schedule tick, reconciliation, retention
```

### What n8n is allowed to own
Execution semantics only: item propagation, branching, merging, expression
evaluation, node behaviour — behind `WorkflowEngineAdapter`.

### What n8n is forbidden to own
Workflow identity, drafts, versions, the scheduler, the webhook gateway,
credentials and secrets, execution history, the node catalogue, tenancy, RBAC,
audit, the UI, and any part of the public API. There is no n8n metadata
database, and there must never be one.

---

## The invariants

The canonical list is the twenty numbered guardrails in
[SRS §2.1](BA_SRS_AppBI_Workflow_Automation_n8n_Core.md#21-guardrails-bắt-buộc).
Cite them by number. The five violated most easily by an agent in a hurry:

1. **The frontend calls `/api/v1` and `/hooks`. Never the engine.** (1, 15)
2. **Only `workflow-engine/` imports n8n.** Not the backend, not the frontend,
   not the tests. No n8n type reaches a domain service or a product API
   contract. (2, 10)
3. **Publish and Activate are different operations**, and a published version
   is immutable. A run binds to the exact version it executed, and editing a
   draft afterwards does not change history. (9, 17, 18)
4. **Every tenant-scoped query names its `workspace_id`.** The backend is the
   authority; permission-gated UI is a convenience. (19)
5. **Secrets never come back out.** Product responses carry
   `{configured, masked_hint}`. A redacted value is a view, never the data, and
   never execution input. (7, ADR-027)

Full text with rationale: [docs/ai-sdlc/ARCHITECTURE_INVARIANTS.md](docs/ai-sdlc/ARCHITECTURE_INVARIANTS.md).
Decisions and what was rejected: [docs/adr/index.md](docs/adr/index.md) — 31 ADRs.

---

## Scoped rules

Read the one covering the code you are touching. Each is also loaded
automatically via the `CLAUDE.md` in that directory.

| Area | Rules |
|---|---|
| Repository-wide architecture | [.claude/rules/architecture.md](.claude/rules/architecture.md) |
| `backend/` | [.claude/rules/backend.md](.claude/rules/backend.md) |
| `frontend/` | [.claude/rules/frontend.md](.claude/rules/frontend.md) |
| `workflow-engine/` | [.claude/rules/workflow-engine.md](.claude/rules/workflow-engine.md) |
| Credentials, auth, webhooks, egress | [.claude/rules/security.md](.claude/rules/security.md) |
| Any test change | [.claude/rules/testing.md](.claude/rules/testing.md) |

## Procedures

`/feature`, `/bugfix`, `/verify`, `/ui-review`, `/engine-node` —
see [.claude/skills/](.claude/skills/). Adding an n8n node is `/engine-node`,
a certification exercise, not an import.

---

## Where things are

| Path | What it is |
|---|---|
| `backend/app/api/` | `/api/v1/**` and the public `/hooks/{key}` gateway |
| `backend/app/services/` | the domain; `graph.py` is pure — no DB, no engine |
| `backend/app/engine/` | `WorkflowEngineAdapter`. The boundary |
| `backend/app/models/` | product schema; three tables for "a workflow" |
| `backend/migrations/` | Alembic |
| `workflow-engine/src/compiler/` | product graph → n8n `Workflow`. The only translation layer |
| `workflow-engine/src/nodes/` | the allowlist and the product's own start node |
| `workflow-engine/tests/contract/` | golden workflows against the real pinned runtime |
| `frontend/src/` | Next.js 15; design system inherited from AppBI Pipeline |
| `e2e/tests/` | Playwright, against the **images** |
| `compatibility.yaml`, `node-lock.json` | the pins and the certified node set |
| `docs/changes/` | one directory per substantial change |

---

## Verifying

```bash
python scripts/verify.py quick               # seconds; run it while working
python scripts/verify.py targeted <area>     # backend|frontend|engine|deployment|guardrails|e2e
python scripts/verify.py full                # release quality
```

A stage that could not run reports **SKIP**, and `verify` exits non-zero rather
than call an incomplete run green. **Report SKIPs as NOT RUN.** Never describe a
command you did not execute as passing.

Underlying commands, if you need one directly: `ruff check app tests` and
`pytest` in `backend/`; `npm run typecheck|lint|test|build` in `frontend/`;
`npm run typecheck|test|build` in `workflow-engine/`; `python
scripts/certify.py --check`; `./run.sh test|smoke|e2e` (or `.\run.ps1`).

---

## Definition of Done

Full checklist: [docs/ai-sdlc/DEFINITION_OF_DONE.md](docs/ai-sdlc/DEFINITION_OF_DONE.md).
The summary — a change is Done when, and not before:

- intent / spec / plan exist for substantial work, and the diff matches the plan
  or the deviation is written down;
- lint and typecheck pass; the relevant suites pass;
- engine behaviour changed ⇒ contract tests pass against the **real pinned
  runtime**; schema changed ⇒ migration applies, rolls back, re-applies, and
  `alembic check` is clean;
- UI changed ⇒ it has been **looked at** in a browser, across the states in
  [.claude/rules/frontend.md](.claude/rules/frontend.md). A rendering component
  is not a finished feature;
- the acceptance journey in `acceptance.md` has been walked;
- the reviewers in [REVIEW.md](REVIEW.md) have run, and **no BLOCKER is open**;
- verification status is reported truthfully, SKIPs included.

Mark anything genuinely inapplicable **N/A with a reason**. "Not applicable"
and "forgotten" must not look the same.

---

## Prohibited shortcuts

Doing any of these makes the change wrong, however green the build:

- deleting, skipping or weakening a test to get a pass — fix the implementation
  ([testing.md](.claude/rules/testing.md));
- replacing an engine contract test with a mock;
- changing an n8n version, or `compatibility.yaml` / `node-lock.json`, as a side
  effect of unrelated work — that is its own change artefact (ADR-013);
- making a node executable without a compiler mapping, an allowlist entry, a
  golden test and both locales;
- bypassing `WorkflowEngineAdapter`, or publishing the engine's port;
- putting an n8n identifier in a product-facing model or the product schema;
- collapsing Publish and Activate;
- removing a tenant filter, a security check or a redaction step;
- returning a plaintext secret, or storing a masked payload as execution input;
- weakening a commercial-release gate. `licensing.commercial_gate` is
  `NOT_REVIEWED`; n8n's Sustainable Use Licence covers **internal delivery
  only** (ADR-015). This is a release concern, not something to reason around;
- `npm install` in `workflow-engine/` — use `npm ci`; the lockfile is the pin.

Declaring "implementation complete" because the code was written and it
compiled is the specific failure this whole harness exists to prevent.
