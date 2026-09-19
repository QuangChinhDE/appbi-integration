# Reference workflows

Fifteen workflows a real customer would plausibly build. They are the
acceptance criterion for the capability expansion: **the catalogue is not
"done" because 16 nodes are certified; it is done when these fifteen run.**

Each is an end-to-end test built the way a user builds it — **through the UI,
not seeded through the API**. That distinction is not pedantry: every existing
browser spec seeds its graph through the API, which is precisely why nobody had
ever looked at the graph the product creates for you, and five real defects
lived there (`docs/changes/001-product-stabilization/DEFECT_INVENTORY.md`).

## What every one of them asserts

Not "it went green". Seven assertions each, per your list:

1. **Item count at each step** — the single most sensitive indicator that a
   composition is wrong. A loop that runs twice produces plausible output.
2. **Actual content** of at least one field, not just a non-empty result.
3. **Which branch was taken**, where there is a branch.
4. **Execution state** — SUCCEEDED / FAILED / the specific error code.
5. **Error state**, where the workflow is meant to fail: the code *and* the
   remediation offered.
6. **Retry**: re-running a failed execution re-uses the frozen input
   (ADR-026/027) and reaches the same verdict.
7. **History and UI preview**: the run appears in history bound to the version
   that ran, and each node's preview shows the items it actually produced.

Where a workflow has no branch or is not meant to fail, that assertion is
marked **N/A with a reason**, not silently dropped.

---

## The fifteen

`New` lists the nodes from the Minimum Practical Catalogue that the workflow
needs. `Matrix` names the stability rows it exercises.

### Tier 1 — buildable with the 9 nodes certified today

These can be written **now**, before any new node, and they are the honest test
of whether the current product is stable. Writing them first also means the
capability work lands on a suite that already catches composition defects.

| # | Workflow | New | Matrix rows |
|---|---|---|---|
| **W01** | **Fetch and store.** Manual trigger -> HTTP GET a public JSON list -> Edit Fields normalises three keys -> finish. The "hello world" a user builds first | — | 1.2, 1.3, 4.1, 7.2 |
| **W02** | **Conditional alert.** Schedule -> HTTP GET -> IF `status != "ok"` -> true branch sets an alert field; false branch ends | — | 3.1, 3.2, 3.8, 6.11 |
| **W03** | **Route by category.** Webhook -> Switch on `type` (three branches + fallback) -> each branch edits a distinct field -> Merge | — | 3.3, 3.4, 3.6, 3.10 |
| **W04** | **Filter then act.** Manual -> HTTP GET 50 items -> Filter to a subset -> Edit Fields. Asserts the *discarded* output is not read (ADR-026) | — | 3.9, 1.1 (filter to zero) |
| **W05** | **Failure and remediation.** Manual -> HTTP GET an endpoint returning 401 -> run fails with `NODE_AUTHENTICATION_FAILED`, the UI offers *update credential*, and a retry after fixing the credential succeeds | — | 4.6, 4.19, and assertion 6 |
| **W06** | **Webhook idempotency.** The same signed delivery sent twice produces exactly one execution | — | 6.7, 6.13 |

### Tier 2 — needs the transform and flow-control nodes

| # | Workflow | New | Matrix rows |
|---|---|---|---|
| **W07** | **Paginate and flatten.** Manual -> HTTP GET returning `{data: [...]}` -> Split Out -> Remove Duplicates -> Sort -> Limit 10. The "top 10 unique" shape | `item_lists` | 5.4, 5.5, 5.6, 1.10 |
| **W08** | **Fan-out per row.** HTTP GET a list -> Split Out -> Split In Batches (size 10) -> HTTP GET per item -> Merge. **The defining App-to-App pattern.** Asserts loop termination and per-iteration counts | `item_lists`, `split_in_batches` | 5.1, 5.3, 4.10, 7.3 |
| **W09** | **Daily window report.** Schedule 07:00 Asia/Ho_Chi_Minh -> Date Time computes "yesterday" -> HTTP GET with that date in the query -> Summarize (count + sum) -> Edit Fields | `item_lists`, `date_time` | 5.11, 5.12, 2.6, 6.11, 6.12 |
| **W10** | **Empty is not failure.** Schedule -> HTTP GET returning `[]` -> Filter -> Summarize -> IF `count > 0`. Must end SUCCEEDED with zero items and send nothing | `item_lists` | **1.1**, 5.8, 3.8 |
| **W11** | **Non-JSON partner feed.** Manual -> HTTP GET an XML/RSS endpoint -> XML parse -> Split Out -> Edit Fields | `xml` | 5.13, 5.14, 4.2 |
| **W12** | **Loop with a branch inside.** Split In Batches -> IF -> HTTP POST on the true branch only -> back to the loop. Termination when every item takes the false branch | `split_in_batches` | 5.2, 3.7 |

### Tier 3 — needs an integration node (and therefore a new credential type)

| # | Workflow | New | Matrix rows |
|---|---|---|---|
| **W13** | **API into a table.** Schedule -> HTTP GET -> Edit Fields -> Postgres upsert. Asserts type coercion crossing into SQL and that a second run upserts rather than duplicating | `postgres` | 5.15, 5.17, 1.7 |
| **W14** | **Notify a human, once.** Schedule -> Postgres SELECT -> Filter to rows needing attention -> Email Send. Zero rows must send **zero** emails, and a retry must not re-send | `postgres`, `email_send` | **5.19**, 6.17, assertion 6 |
| **W15** | **Resilience.** A long-running W08 with the engine killed mid-run: the execution becomes `ENGINE_INTERRUPTED`, the UI says runs are paused and stays readable, and after the engine returns a fresh run succeeds | `item_lists`, `split_in_batches` | **6.2, 6.3**, 6.1 |

---

## Why these fifteen

- **W05, W10, W14 and W15 are the ones that matter most**, and they are the
  ones a "happy path" catalogue expansion would never produce. They cover the
  failure path, the empty path, the side-effect path and the engine-loss path
  respectively.
- **W08 is the single most representative workflow in the set.** If it works,
  the product can do App-to-App integration; if it does not, the catalogue size
  is irrelevant.
- Tier 1 needs no new node at all. **Six of the fifteen are writable today**,
  which is the fastest available answer to "is the existing 9-node product
  actually stable?" — and it is an answer we do not currently have.

## Coverage back to the catalogue

| Node | Reference workflows needing it |
|---|---|
| `item_lists` | W07, W08, W09, W10, W15 — **5** |
| `split_in_batches` | W08, W12, W15 — **3** |
| `date_time` | W09 — 1 (and every future scheduled workflow) |
| `postgres` | W13, W14 — 2 |
| `email_send` | W14 — 1 |
| `xml` | W11 — 1 |
| `slack` / `google_sheets` | **0** — which is why the matrix says to pick one by asking the pilot customer rather than certifying both |

The last row is the useful one: it shows the minimum catalogue is minimal.
Nothing in it is there for completeness, and the one item without a reference
workflow is flagged as a question rather than a decision.
