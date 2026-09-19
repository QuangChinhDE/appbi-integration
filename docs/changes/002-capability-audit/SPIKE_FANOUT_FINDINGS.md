# Spike: does basic fan-out need `split_in_batches`?

**Answer: no. `split_in_batches` is not P0, and the matrix was wrong to say so.**

Measured, not reasoned. `workflow-engine/tests/spike/fan-out.spike.test.ts`,
against the real pinned runtime (n8n 1.14.1), using **only the nine nodes
certified today**. 5 of 5 assertions pass.

## What was run

```
manual_trigger -> http_request (list endpoint) -> http_request (detail endpoint)
```

No Split Out. No Split In Batches. The list endpoint returns a JSON array of N
rows; the detail endpoint records every request it receives.

## Results

| # | Case | Result |
|---|---|---|
| 1 | A JSON array response of 10 becomes **10 items** | PASS |
| 2 | Downstream HTTP runs **once per item**, each carrying that item's own `id`, in order | PASS |
| 3 | 100 items produce **100 distinct requests**, no batching node | PASS |
| 4 | A **nested** `{data: [...]}` response produces **1 item** and **1 request** | PASS |
| 5 | An **empty** array produces **0 requests** and status **SUCCEEDED** | PASS |

Result 2 is the important one: the pairing is correct, not merely the count.
Requests arrived as `/item/1 … /item/10` in order, so each execution of the
downstream node saw its own item rather than the first one ten times.

## What this changes

**`split_in_batches` moves P0 -> P2.** The runtime already fans out one item
per array element, so the defining App-to-App pattern — "call API B once per
row of API A" — needs no loop node at all. What `split_in_batches` is actually
for is narrower and should be stated that way:

- batching N calls into groups to stay under a rate limit,
- a controlled loop where each iteration depends on the last,
- deliberately pacing a large fan-out.

Those are real, but none of them is required to build a working integration,
and the node carries the highest certification risk in the catalogue (loop
semantics tied to the compiler's pinned execution order, ADR-023). **It should
not be in the first batch.**

**`item_lists` stays P0**, and result 4 is why. A nested `{data: [...]}`
response — at least as common as a top-level array — arrives as a single item
and does need `splitOut`. Had that case also fanned out, `item_lists` would
have lost its splitOut justification too; it did not. Sort, dedupe, limit and
summarize are unaffected by this spike and remain uncovered by any other node.

## Two things found along the way

1. **Stability row 1.1 is partly answered, and the answer is good.** An empty
   array ends SUCCEEDED with zero downstream calls rather than looking like a
   failure. That was listed as an untested risk; it now has one data point at
   the engine level. It is still untested end to end (what the *UI* shows for a
   zero-item run is a separate question, and stays in Wave 0).

2. **Expression syntax is a sharp edge worth a product answer.** The first
   version of this spike wrote `http://host/item/={{ $json.id }}` and the
   engine sent the braces to the server as literal URL-encoded text — a
   **silent** wrong result, status SUCCEEDED, 200 back. The `=` prefix marks
   the *whole field* as an expression and must lead the string. A user will
   make this mistake. It belongs in Wave 0's expression matrix as its own row:
   *an expression that is not recognised as one should be detectable, not
   silently sent as text.*

## Note: this spike is now part of the standing suite

`vitest.config.ts` includes `tests/**/*.test.ts`, so this file runs with every
engine verification — the contract suite is **73 assertions across 8 files**,
not 68 across 7. That is deliberate and left in place: the fan-out semantics it
pins are exactly what an engine upgrade must keep true, and they are now
asserted rather than assumed. It is documented as a spike because of *why* it
was written, not because it is throwaway.

## Consequence for the reference workflows

**W08 was mis-specified.** It was written as the flagship Tier-2 workflow
needing `item_lists` + `split_in_batches`; its core — fan-out and per-item
pairing — is buildable today and now belongs in **Wave 0**. What remains
genuinely Tier 2 is the nested-array variant (`item_lists`) and the
rate-limited variant (`split_in_batches`).

This is the same class of error the audit was written to prevent, caught by
measuring instead of assuming. It is also an argument for Wave 0 as a whole:
the assumptions in a capability matrix are cheap to check and were not checked.
