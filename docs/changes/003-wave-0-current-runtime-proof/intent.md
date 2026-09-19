# Intent — Wave 0: Current Runtime Proof

## The problem

The product ships nine certified nodes and a green test suite, and we cannot
answer the question a customer's first week will ask:

> When these nine nodes are composed into a real workflow and meet real data
> and real failures, is the result trustworthy?

The stabilization pass (001) reported READY WITH KNOWN LIMITATIONS. That
verdict measured whether the automated checks pass for the scope that exists.
It did not measure whether the scope behaves. The capability audit (002) then
found that of 73 stability rows, **41 are untested**, there is **no composition
test layer at all**, nothing is tested under concurrency, and the reconciler
that ADR-010 exists to provide has **never been exercised against a real engine
kill**.

The specific, named risk: *tests are green, and when a PM or a customer builds
a real workflow they discover either a missing node or a composition that runs
wrong.* Adding nodes first would stack capability on an unverified base and
make every later defect harder to localise.

## What this change does

**Proves or breaks the current nine-node product. It certifies no new node.**

Four checkpoints:

| | Scope |
|---|---|
| **0A** | HTTP status semantics and expression evaluation — engine outcome through to product error code, remediation and UI |
| **0B** | Composition of the current nodes, asserting item count at every node rather than final output |
| **0C** | Reference workflows W01–W06 and W08a, built **through the real UI** |
| **0D** | Real engine loss: stop, kill mid-run, restart — and observe reconciliation and what the UI says |

## Why this and not more capability

Three arguments, in order of weight:

1. **The product already ships promises nothing verifies.** The frontend has
   labels and remediations for `NODE_AUTHENTICATION_FAILED`,
   `NODE_RATE_LIMITED` and eight other codes. No test asserts the engine ever
   emits them. A remediation that never fires is worse than no remediation: it
   is a support path that looks present and is not.
2. **The 002 audit was itself wrong three times** — an invented workflow count,
   an invented row total, and `split_in_batches` at P0 on an unmeasured
   assumption that a one-afternoon spike disproved. All three were summary
   claims over detail nobody had checked. That is evidence about how much of
   the remaining "known" state is assumption.
3. **It is version-independent.** Its tests assert on the normalized product
   DTO rather than `IRun`, so they survive an eventual move to `release-v1`
   (ADR-032). Nothing here has to be redone by a migration.

## What success looks like

Not "the suites are green". Wave 0 succeeds when each stability row in scope
carries **PASS, FAIL or NOT RUN with evidence**, every defect found has a
regression test written *before* its fix, and the answer to the opening
question is backed by a fingerprint rather than by an opinion.

A Wave 0 that finds many defects is a success. A Wave 0 that finds none and
says so without having driven the real deployment is the failure this whole
harness exists to prevent.

## Explicitly out of scope

- **Certifying any new node.** Not `item_lists`, not `date_time`, not one.
- Engine version migration (ADR-032 — revisit triggers are recorded there).
- The credential-type framework (Wave 2).
- Full chaos, concurrency and scale (Wave 4). Only the three basic engine-loss
  scenarios are pulled forward, because they test architecture that already
  claims to work.
- Performance or load testing.

## Deliverables

1. W01–W06 and W08a run through the UI
2. HTTP status / error matrix, actual results
3. Expression matrix, actual results
4. Composition matrix, actual results
5. Engine-loss results
6. Defect inventory
7. PASS / FAIL / NOT RUN per row, no inference
8. Final fingerprint
9. Revised Minimum Practical Node Catalog, based on what happened
10. Re-estimated Waves 1–4

Waves 1–4 remain uncommitted until (10) exists.
