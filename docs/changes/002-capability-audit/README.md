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
| 7, 8 | [IMPLEMENTATION_WAVES.md](IMPLEMENTATION_WAVES.md) | Six waves, ~45–69 days indicative, risk per wave. **Only Wave 0 is approved or plannable** |
| — | [SPIKE_FANOUT_FINDINGS.md](SPIKE_FANOUT_FINDINGS.md) | Measured: basic App-to-App fan-out needs no loop node |

## Review round 1 — four corrections

The audit was reviewed and four things in it were wrong or unproven. All are
fixed above; recording them here because a roadmap built on an unchecked
premise is the thing this change exists to prevent.

1. **The engine-version history was contradictory** and this audit read only
   half of it. ADR-024 (08 Sep) rejected `core@1.122.46`; commit `10a59c5`
   (18 Sep) measured and *chose* `release-v1` (`1.122.48 / 1.120.31 /
   1.121.53`) at **65 of 68 tests passing**, migration unfinished. Two
   different candidates, and the later decision was recorded only in a commit
   message. Reconciled permanently in **ADR-032**, which supersedes ADR-024 on
   the version question. The `1.14.1` recommendation stands, on better grounds:
   two of the three remaining failures are the no-Enterprise-source assertion,
   a licensing gate (ADR-015) — and nothing we want to do next is waiting on
   the migration either way.
2. **"`item_lists` unblocks 11 of 15 workflows" was an invented number.** The
   real count is **5** (now 4, after the spike). Corrected, not re-derived.
3. **`split_in_batches` was not P0.** A spike against the real runtime proved
   basic fan-out needs no loop node at all: an array response already becomes
   one item per element and a downstream HTTP node already runs once per item,
   correctly paired, 100 for 100. Demoted to its own late wave.
4. **Runtime auth support was being read as product readiness.** The matrix now
   tracks `Runtime auth path` and `Customer credential UX` separately. Google
   Sheets is the case in point: a service account works technically and still
   puts a five-step GCP setup, ending in sharing a sheet with a machine email,
   in front of a non-technical customer. **Not onboarding-ready.**

## Three corrections to the original brief

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
3. ~~There is no unfinished engine migration.~~ **This was wrong** — see
   correction 1 above and ADR-032. There *is* a chosen target (`release-v1`) at
   65/68, but the work exists nowhere in the repository.

## The main recommendation

**Do Wave 0 before certifying anything.** It adds no nodes. It writes the six
reference workflows that the *current* nine nodes can already build, and closes
the HTTP-status gap where the frontend ships remediations for error codes
nothing proves the engine emits.

It is also the direct test of your hypothesis. If the existing nine-node
product has composition defects, that is worth knowing before seven more nodes
are stacked on top — and right now nobody knows either way.

## Status

**Wave 0 is approved and scoped** (HTTP semantics, expressions, current-node
composition, basic engine loss, W01–W06 + W08a, and ten named deliverables).
No new node is certified in it.

Waves 1–4 are **not** a delivery commitment. They are re-estimated from Wave 0's
measured effort before the capability roadmap is committed. Node certification
then proceeds in batches of 3–5 through `/engine-node`, each with contract
tests, composition tests, real UI configuration and a reference workflow.
