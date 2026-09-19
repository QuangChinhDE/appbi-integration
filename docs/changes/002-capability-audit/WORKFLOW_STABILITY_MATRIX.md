# Workflow stability matrix

Your point stands: 68 engine contract tests prove the **nine certified nodes
behave**, not that a workflow a customer assembles is stable. This matrix
enumerates what "stable" has to mean, and marks each row against what the
suites actually assert today.

Coverage was read off the tests, not assumed:

| Suite | File | Assertions |
|---|---|---|
| golden workflows | `contract/golden-workflows.test.ts` | 25 |
| api | `contract/api.test.ts` | 15 |
| error normalizer | `contract/error-normalizer.test.ts` | 11 |
| egress | `contract/egress.test.ts` | 8 |
| filter | `contract/filter-node.test.ts` | 5 |
| enterprise / reachability | 2 files | 4 |

**Legend.** OK = asserted today (test named). PART = the mechanism is covered
but not this case. GAP = not covered.

---

## 1. Input shapes

The most common cause of "it worked in preview and broke on real data".

| # | Case | Cov | Where / gap |
|---|---|---|---|
| 1.1 | 0 items (empty upstream result) | **GAP** | **Nothing asserts what a node does with an empty stream.** An HTTP node fed zero items runs zero times and every downstream branch is empty — the product should report SUCCEEDED with 0 items, not look like a failure |
| 1.2 | 1 item | OK | `start -> edit fields sets a field on every item` |
| 1.3 | N items | OK | `multi-item input propagates through every node` |
| 1.4 | Nested object / array field | **GAP** | Expressions reaching `$json.a.b[0].c` |
| 1.5 | `null` in a referenced field | PART | `a missing path ... resolves to null` covers *missing*, not *present-and-null* — a different code path |
| 1.6 | Missing field entirely | OK | as above |
| 1.7 | Type surprise (number arrives as string) | PART | `an IF on a number compares numerically` and `... not on its spelling` cover IF. Not covered for `edit_fields`, `filter`, `switch` |
| 1.8 | Unicode / emoji / RTL in a value | **GAP** | Matters for a Vietnamese-language product: encoding through the HTTP body, the preview, and the stored execution payload |
| 1.9 | Very long string (~1 MB in one field) | **GAP** | Payload vault and preview truncation |
| 1.10 | Heterogeneous items (item 1 has a field item 2 lacks) | **GAP** | Real API pagination produces this constantly |

## 2. Expressions

| # | Case | Cov | Where / gap |
|---|---|---|---|
| 2.1 | Reference a named earlier node | OK | `an expression can read a named earlier node` |
| 2.2 | Syntactically invalid | OK | `EXPRESSION_INVALID` |
| 2.3 | Valid syntax, runtime failure (`.toUpperCase()` on a number) | **GAP** | Must be `EXPRESSION_EVALUATION_FAILED` — a code the frontend already has a label for, so the path is assumed to exist and is never asserted |
| 2.4 | Reference a node that did not run (rejected IF branch) | **GAP** | **High risk.** The most natural user mistake right after adding a branch |
| 2.5 | Reference a node that does not exist | **GAP** | Should fail at validation, before publish — not at run time |
| 2.6 | Date / number / string built-ins | **GAP** | Becomes load-bearing the moment `date_time` is certified |
| 2.7 | Expression in a credential-bearing field | **GAP** | Must not become a way to interpolate a secret into a URL |

## 3. Branching and merging

| # | Case | Cov | Where / gap |
|---|---|---|---|
| 3.1 | IF true / false | OK | two goldens |
| 3.2 | IF leaves the other branch empty | OK | `... and leaves false empty` |
| 3.3 | Switch named branches + fallback | OK | two goldens |
| 3.4 | Merge of two branches | OK | `two branches merge back into one stream` |
| 3.5 | Merge where one input **never ran** | OK | `an IF into a Merge does not execute the branch the condition rejected` |
| 3.6 | Merge where one input is **empty but did run** | **GAP** | Different from 3.5, and behaves differently |
| 3.7 | Nested branching (IF inside an IF branch) | **GAP** | Depth 2+ is untested anywhere |
| 3.8 | Branch that terminates (no downstream node) | **GAP** | Should be valid, not an error |
| 3.9 | Filter's second (discarded) output | OK | `filter-node.test.ts` + the ADR-026 preview rule |
| 3.10 | Diamond: split then rejoin at one node | **GAP** | Execution-order sensitive (ADR-023) |

## 4. HTTP status and failure modes

`http_request` is the node every workflow touches, so this is the
highest-value block in the matrix.

| # | Case | Cov | Expected product behaviour |
|---|---|---|---|
| 4.1 | 200 JSON | OK | `http request performs a real request` |
| 4.2 | 200 text/plain | **GAP** | One item with the body as a string — not a parse error |
| 4.3 | 200 with invalid JSON body | **GAP** | A classified error, not an engine exception |
| 4.4 | 204 no content | **GAP** | One empty item, SUCCEEDED |
| 4.5 | 400 | PART | `an HTTP error becomes a product error code` covers the class; individual statuses are not distinguished |
| 4.6 | 401 | **GAP** | Must be `NODE_AUTHENTICATION_FAILED` with the *update credential* remediation — the difference between a user fixing it and filing a ticket |
| 4.7 | 403 | **GAP** | Same family, different remediation |
| 4.8 | 404 | **GAP** | Configuration, not auth |
| 4.9 | 409 | **GAP** | |
| 4.10 | 429 | **GAP** | Must be `NODE_RATE_LIMITED`; the label exists, the behaviour is unasserted. Interacts with `split_in_batches` |
| 4.11 | 500 | PART | as 4.5 |
| 4.12 | Timeout | OK | `a slow endpoint produces NODE_TIMEOUT` |
| 4.13 | DNS failure | OK | `a DNS failure is classified, and names the host` |
| 4.14 | Connection refused | OK | `a refused connection is classified` |
| 4.15 | Redirect (3xx followed) | **GAP** | The policy exists in the egress guard; no end-to-end assertion |
| 4.16 | **Redirect to a private address** | **GAP** | **Security-relevant.** The egress suite blocks a *direct* private address; a public URL that 302s to `169.254.169.254` is the actual SSRF shape |
| 4.17 | Large response (over the ceiling) | **GAP** | The ceiling exists; the refusal is unasserted |
| 4.18 | continue-on-error | OK | `continue-on-error keeps the workflow running past a failed request` |
| 4.19 | Credential revoked between publish and run | **GAP** | Resolution fails at execution time; must be a classified error, not a crash |

## 5. Composition contracts

Risk-based, as you asked — not the Cartesian product. With 16 nodes the full
pair set is 240; these are the ~20 pairs where the *interaction* can fail even
though both nodes pass alone.

| Pair | Why this pair and not another |
|---|---|
| `split_in_batches` -> `http_request` | The defining loop. Termination, per-iteration counts, and a 429 inside the loop |
| `split_in_batches` -> `if` | A branch inside a loop: does the loop still terminate when a branch is empty? |
| `item_lists`(splitOut) -> `http_request` | 1 item becomes N requests — fan-out correctness |
| `http_request` -> `item_lists`(splitOut) | The pagination shape: one response, many rows |
| `item_lists`(splitOut) -> `item_lists`(removeDuplicates) | Two operations of the same node in one graph; ordering |
| `item_lists`(sort) -> `item_lists`(limit) | "Top 10" — the order must survive the limit |
| `http_request` -> `item_lists`(summarize) | Aggregation over a real response |
| `filter` -> `item_lists`(summarize) | Aggregating an **empty** stream — the classic empty-group bug |
| `switch` -> `merge` | Three inputs, two of them empty |
| `date_time` -> `if` | Date comparison in a condition — the timezone surface |
| `date_time` -> `http_request` | A formatted date in a query string |
| `xml` -> `item_lists`(splitOut) | The SOAP/RSS shape |
| `http_request` -> `xml` | A non-JSON body reaching the parser |
| `edit_fields` -> `postgres` | Types crossing into SQL (a string `"3"` into an integer column) |
| `postgres` -> `item_lists`(splitOut) | Rows to items |
| `http_request` -> `postgres` | The canonical "sync an API into a table" |
| `item_lists`(removeDuplicates) -> `postgres` | Dedupe before upsert |
| `filter` -> `email_send` | **A side effect behind a condition** — the no-items case must send zero emails, not one empty one |
| `split_in_batches` -> `email_send` | Must not send one mail per batch by accident |

(`if -> merge` is already golden, so it is not repeated here.)

## 6. Chaos and recovery

| # | Case | Cov | Gap |
|---|---|---|---|
| 6.1 | Engine down at dispatch | PART | `ENGINE_UNAVAILABLE` exists; no test drives a really stopped container |
| 6.2 | Engine dies **mid-run** | **GAP** | The reconciler should flip the run to `ENGINE_INTERRUPTED`. This is ADR-010's whole purpose and is untested against a real kill |
| 6.3 | Engine restarts, run does not resume | **GAP** | And the UI must say so |
| 6.4 | Engine returns a malformed response | **GAP** | The adapter must not propagate an n8n shape |
| 6.5 | Engine timeout at the adapter | **GAP** | Distinct from a node timeout (4.12) |
| 6.6 | Worker restart with a run in flight | **GAP** | |
| 6.7 | Duplicate dispatch of one execution | PART | `the same idempotency key does not start a second run` is engine-side; the worker path is not asserted |
| 6.8 | Two worker replicas | PART | `test_deployment_manifests` asserts the shape; there is no runtime proof |
| 6.9 | Schedule overlap (tick N+1 while N runs) | **GAP** | The per-workflow concurrency ceiling is 1 — the e2e suite *relies* on this and never *tests* it |
| 6.10 | Missed tick (worker down over the window) | **GAP** | Catch up or skip? A product decision first, then a test |
| 6.11 | Timezone / DST boundary | PART | Backend unit tests cover schedule arithmetic; no end-to-end run across a DST edge |
| 6.12 | Cron boundary (00:00, month end) | PART | same |
| 6.13 | Double-click **Run** | **GAP** | Browser-level. `Idempotency-Key` should absorb it — unproven from the UI |
| 6.14 | Double **Publish** | **GAP** | Must not create two versions |
| 6.15 | Concurrent draft edit (two tabs) | PART | `DRAFT_VERSION_CONFLICT` exists and the banner was fixed in 001; there is no two-client test |
| 6.16 | Publish while a run is executing | **GAP** | The running execution binds the **old** version. That is guardrail 17/18, and nothing proves it under concurrency |
| 6.17 | Credential updated mid-execution | **GAP** | The run should keep the value it resolved at start |

## 7. Workload and scale

| # | Case | Cov | Note |
|---|---|---|---|
| 7.1 | 1 / 10 items | OK | implicitly |
| 7.2 | 100 items | **GAP** | |
| 7.3 | 1000 items | **GAP** | Where preview truncation, payload-vault size and UI rendering all first bite |
| 7.4 | 5-node graph | OK | goldens |
| 7.5 | 10-node graph | **GAP** | |
| 7.6 | 20-node graph | **GAP** | Validation, canvas rendering and the run-detail panel at that size |
| 7.7 | 1000 items x 20 nodes | **GAP** | Not a benchmark — a *does it complete and stay under the stale threshold* check |

**These are budget checks, not performance tests.** One assertion each: it
completes, it is classified correctly, and the recorded payload stays inside
its ceiling.

---

## The gap, summarised (deliverable 6)

Of the **85** rows above: **19 OK**, **11 PART**, **55 GAP**.

The shape of the gap matters more than the number:

1. **What is well covered is one node at a time.** Every golden workflow is
   three or four nodes and one concern. That is exactly why the suite is green
   and your scepticism is right.
2. **The biggest hole is HTTP status semantics** (§4). The frontend already
   ships labels and remediations for `NODE_AUTHENTICATION_FAILED`,
   `NODE_RATE_LIMITED` and friends, and **nothing asserts the engine ever emits
   them**. A remediation that never fires is worse than none.
3. **Nothing is tested under concurrency** (§6.13–6.17). The product's
   correctness claims about Publish/Activate and version binding are
   single-threaded claims.
4. **Chaos is designed but never exercised** (§6.2–6.5). ADR-010's reconciler is
   the product's answer to engine loss, and no test has ever killed the engine.
5. **Scale is entirely unmeasured** (§7).
6. **§5 does not exist at all.** There is no composition test layer — it is a
   new suite, not an extension of an existing one.

---

## What this does not cover

Stated so it is not mistaken for completeness: no load or performance testing
beyond §7's budget checks, no multi-region, no upgrade/migration testing of
stored executions, no accessibility audit, no penetration test. Rows §4.16 and
§2.7 are security-relevant and should additionally go through the security
reviewer, not only a test.
