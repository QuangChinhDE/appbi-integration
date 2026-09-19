# Engine version: stay on 1.14 for the pilot

**Recommendation: Option A.** Keep `n8n-core` / `n8n-workflow` /
`n8n-nodes-base` at `1.14.1`, expand the catalogue here, and revisit the line
only when something we need is on the other side of it.

You were right to ask this before we certify 7 more nodes — certifying on one
line and then migrating would mean re-certifying everything. But the premise
needs one correction first.

## There is no unfinished migration to finish

The "research/tooling for a ~1.12x line, migration unfinished" is, as far as
the repository goes, **a completed spike that concluded no**. What exists:

| Artefact | What it actually is |
|---|---|
| ADR-024's upgrade table | A **measured** comparison of three upgrade targets against the pin. Finished, with a decision. |
| `workflow-engine/tests/spike/bootstrap-probe.ts` | The original Phase-A go/no-go probe for embedding `WorkflowExecute` at all. Unrelated to any upgrade. |
| `scripts/vendor_npm.py`, `scripts/mirror_bundle.py` | Supply-chain tooling — vendoring and registry mirroring for the **current** pin. |

`git log --all` and `git branch -a` show no migration branch, and no file in
the tree references a 1.12x target as in-progress. So Option B is not
"finish the migration"; it is "start one", and the spike already says what it
would cost.

## What the spike measured

From ADR-024, in throwaway trees rather than in the project:

| Target | Contract tests | `npm audit` total | axios advisory |
|---|---|---|---|
| **`1.14.1` (the pin)** | 61 pass | 31 | high, reachable |
| `n8n-core@1.40.0` | 61 pass | **38** (4 critical) | still high (its axios is 1.6.7, inside the advisory range) |
| `core@1.122.46` + `nodes-base@1.121.50` | **4 of 5 files fail** | **69** (7 critical) | clear |
| **`1.14.1` + `overrides.axios@1.18.0`** | 61 pass | **29** | **clear** |

The 1.12x line does fix axios and mysql2 — and brings 1065 packages instead of
618, seven critical advisories instead of zero-reachable, and an
`n8n-workflow` ESM entry point whose internal imports do not resolve
(`dist/esm/logger-proxy`). ADR-013 adds the architectural cost: from `1.122`
the package set pulls `@n8n/backend-common`, `@n8n/config`, `@n8n/di`,
`@n8n/decorators`, `@sentry/*` and `@aws-sdk/client-s3` — the n8n
application's own service container, into a process that wants only
`WorkflowExecute`.

**Newer is measurably not safer here**, and the override already bought the
security outcome the upgrade was supposed to buy.

## Assessed against your criteria

| Criterion | 1.14.1 (Option A) | Migrate first (Option B) |
|---|---|---|
| **Compatibility** | 61 contract tests green; 9 nodes certified against it | 4 of 5 contract files fail today; ESM resolution is a build defect, not a flake |
| **Available nodes** | All 7 in the Minimum Practical Catalogue exist and load. `itemLists@3` gives six operations in one node | Marginally more, mostly the *split* of `itemLists` into six nodes — more certification work for the same capability |
| **Current contract failures** | **0** | **4 of 5 files** |
| **Dependency / security surface** | 618 packages, 29 advisories, 16 of 18 audited packages never loaded (allowlist is closed), axios cleared by override | 1065 packages, 69 advisories, 7 critical |
| **Migration effort** | none | Re-verify the compiler (ADR-023 pins execution order and condition types), re-certify all 9 nodes, re-baseline 15 golden workflows, fix the ESM build |
| **Licensing** | Unchanged. SUL, internal delivery only; `ee_source_loaded_by_runtime: false` proven by a runtime test | **Must be re-proven.** The deep-import that keeps Enterprise `ObjectStore` out of the process is specific to this line's entry point |
| **Re-certification time** | none | Everything in `/engine-node` × 9, before a single new capability ships |

## The one argument for migrating first, and why it does not win yet

It is real: certify 7 nodes on 1.14, migrate later, and you re-certify 16
instead of 9. That is the cost of deferring.

It does not win **now** because:

1. Migration today is not a version bump, it is a repair job — 4 of 5 contract
   files fail before any new node is involved. Doing that first blocks all
   capability work behind a task with no estimate.
2. The capability gap is not caused by the version. Every P0/P1 node in the
   matrix exists on 1.14.1 and loads. Nothing the pilot needs is on the other
   side of the upgrade.
3. Certifying `item_lists` as **one product node with an operation field**
   (see the matrix) makes the most valuable certification migration-resilient:
   when upstream splits it into six nodes, the mapper absorbs the change and
   the product `node_key` is unaffected.

## What would change this answer

Write these down so the decision is revisited on evidence, not on age:

- A pilot customer needs a node that **only** exists after 1.14 (nothing in the
  current 15 reference workflows does).
- **OAuth2 becomes a pilot requirement** — i.e. a Microsoft-shop customer. The
  refresh flow is product work either way, but a newer line's OAuth2 helpers
  may change the build-versus-adopt answer.
- A **reachable** advisory appears in the pinned tree that an `override` cannot
  fix. That is the trigger ADR-024 already names.
- Durable wait/resume gets scheduled. If we are rebuilding execution-state
  handling anyway, doing it against the line we intend to keep is cheaper.

## Consequence for the plan

Waves 1–3 in `IMPLEMENTATION_WAVES.md` all assume 1.14.1. The engine pin,
`compatibility.yaml` and `node-lock.json` must not move during them — a change
there is its own artefact under ADR-013, and the `PreToolUse` guard will refuse
the edit without one.
