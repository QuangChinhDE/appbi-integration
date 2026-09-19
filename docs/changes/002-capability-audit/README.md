# 002 — Capability and stability audit

An audit, not an implementation. No product code was changed.

You rejected "READY WITH KNOWN LIMITATIONS", and the rejection was correct.
That verdict measured one thing (do the automated checks pass for the scope
that exists?) and reported it as if it measured three. This change splits it.

## Readiness, in three dimensions

| Dimension | Verdict | Basis |
|---|---|---|
| **Product UX readiness** | **READY FOR INTERNAL PILOT** | 136 e2e, 39 smoke, 264 backend, 81 frontend, 68 engine tests green at fingerprint `7683f6da3b47`, plus a walked UI review. This is the only dimension the earlier verdict actually measured |
| **Capability readiness** | **NOT READY** | 9 certified nodes. **9 of 15** reference workflows a real customer would build cannot be assembled at all — no split/aggregate/sort/dedupe, no loop, no database, no email, no non-JSON parsing |
| **Runtime stability** | **NOT PROVEN** | Of 85 stability rows, **19 asserted, 11 partial, 55 untested**. There is no composition test layer at all; nothing is tested under concurrency; the engine has never been killed mid-run |

"NOT PROVEN" rather than "NOT READY" for the third is deliberate: the evidence
says the tests do not exist, not that the behaviour is broken. Wave 0 turns
that into a real answer.

## The deliverables

| # | Document | What it settles |
|---|---|---|
| 1, 2 | [NODE_CAPABILITY_MATRIX.md](NODE_CAPABILITY_MATRIX.md) | Capability gap by user case, and the Minimum Practical Node Catalog (9 + 7 = 16) |
| 3 | [ENGINE_VERSION_RECOMMENDATION.md](ENGINE_VERSION_RECOMMENDATION.md) | **Stay on 1.14.1**, with the named triggers for revisiting |
| 4, 6 | [WORKFLOW_STABILITY_MATRIX.md](WORKFLOW_STABILITY_MATRIX.md) | 85 stability rows, each marked against the tests that exist |
| 5 | [REFERENCE_WORKFLOWS.md](REFERENCE_WORKFLOWS.md) | Fifteen workflows as the acceptance criterion for the whole expansion |
| 7, 8 | [IMPLEMENTATION_WAVES.md](IMPLEMENTATION_WAVES.md) | Five waves, 42–64 days, risk per wave |

## Three corrections to the brief

Each was checked against the installed runtime or the repository, not inferred.

1. **OAuth2 blocks only Microsoft.** Postgres, MySQL, SMTP, Slack (bot token),
   Google Sheets (service account), GitHub and GitLab (PAT) all have
   first-class non-OAuth2 credential paths. The real prerequisite is **new
   credential types** in the product store — which is Wave 2, and smaller.
2. **The transform pack is one node on this line.** `itemLists@3` exposes
   `concatenateItems, limit, removeDuplicates, sort, splitOutItems, summarize`.
   The split into separate Aggregate/Sort/Limit/Split-Out nodes happened after
   1.14 — which is what your screenshot shows. One certification buys six
   operations.
3. **There is no unfinished engine migration.** The 1.12x work you remember is
   ADR-024's spike, and it *completed with a rejection*: 4 of 5 contract files
   fail, 69 advisories (7 critical) against 29, 1065 packages against 618, and
   an ESM entry point that does not resolve. Option B is not "finish it", it is
   "start one".

## The main recommendation

**Do Wave 0 before certifying anything.** It adds no nodes. It writes the six
reference workflows that the *current* nine nodes can already build, and closes
the HTTP-status gap where the frontend ships remediations for error codes
nothing proves the engine emits.

It is also the direct test of your hypothesis. If the existing nine-node
product has composition defects, that is worth knowing before seven more nodes
are stacked on top — and right now nobody knows either way.

## Status

Audit complete, awaiting your agreement on the matrix. Per your instruction, no
node certification starts until then; after that, batches of 3–5 through
`/engine-node` with contract tests, composition tests, real UI configuration
and a reference workflow each.
