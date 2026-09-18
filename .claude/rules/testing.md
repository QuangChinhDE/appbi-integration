# Testing rules

Scope: `backend/tests/`, `frontend/tests/`, `workflow-engine/tests/`, `e2e/`.

## A test is evidence about behaviour

It is not an obstacle. When a test fails there are exactly two possibilities,
and you must establish which before touching anything:

1. **The implementation is wrong.** Fix the implementation. This is the default
   and usually the truth.
2. **The expectation is obsolete because an approved spec changed.** Only then
   does the test change — and the spec change must already exist in a
   `docs/changes/<change>/spec.md`, not in your reasoning.

There is no third case. "The test is being difficult" is case 1 wearing a
disguise.

## Never

- delete or skip a meaningful test to get a green build;
- weaken an assertion, widen a tolerance, or change an expected value to
  whatever the code now produces;
- replace a real runtime contract test with a mock to make it pass;
- `try/except` or `.catch()` around a failure so the test proceeds;
- mark a test `skip`/`xfail`/`.skip()` without a written reason **and** a
  tracked follow-up in `docs/changes/`;
- disable an E2E spec without documenting why, where, and what now covers it.

Removing or disabling a test triggers a hook that asks for justification. That
justification goes in the change artefact's `review.md` under residual risks,
prominently — not in a commit message nobody re-reads.

Deleting a test that is genuinely obsolete (the behaviour it covered was
removed, by spec) is legitimate. Say which spec, in the same commit.

## What the suites are for

They catch different classes of defect, which is why there are five and why
running the fast one is not evidence about the others.

| Suite | Where | What only it can catch |
|---|---|---|
| backend unit | `backend/tests/` | graph rules, schedule/timezone arithmetic, the RBAC matrix, redaction, the wire form of an engine request. No database — seconds |
| artefact tests | `backend/tests/test_{deployment_manifests,alert_rules,tenant_isolation,production_doctor,release_gate}.py` | defects in things that are not code: a manifest that comes up healthy and cannot dispatch, an alert naming a metric nobody publishes, a service query with no tenant filter |
| engine contract | `workflow-engine/tests/contract/` | execution semantics against the **real pinned runtime**. What an n8n upgrade must keep green |
| frontend component | `frontend/tests/` | the parts that carry a decision rather than markup — which ports a node offers, whether publish is allowed, where a remediation sends the user |
| browser / e2e | `e2e/tests/` | anything that exists only in the **deployed shape**: a build-time-baked proxy target, a container that cannot reach its API, a missing tenant filter, a rate limit that doubles at two replicas |

The browser suite is the only one that runs the **images** rather than the
sources. It has found eleven defects every other suite was structurally unable
to see. A green unit suite is not evidence about the deployment.

## Write the test that would have failed

- Changed behaviour ⇒ a changed or added test. A behaviour change with no test
  movement means either the behaviour was untested or it did not change.
- **Fixed a bug ⇒ a regression test**, and write it *before* the fix so you have
  watched it fail. A fix you never saw fail is a fix you are guessing about.
- New node or engine semantics ⇒ a golden contract test against the real
  runtime. Assert the **normalized product result**, never `IRun`: snapshotting
  upstream's shape fails on changes that do not affect the product and passes on
  ones that do.
- New tenant-scoped query ⇒ it is covered by the AST walk automatically. If you
  add to that allow-list, add the reason.
- New user journey ⇒ a browser spec, and seed it the way a **user** would.
  Every test seeding its graph through the API is exactly why nobody had ever
  looked at the graph the product creates for you, and five real defects lived
  there.

## Order of verification

1. **While working:** the targeted test for what you touched, then
   `python scripts/verify.py quick`.
2. **Before review:** `python scripts/verify.py targeted <area>` for every area
   the diff touches.
3. **Before Done:** `python scripts/verify.py full`.

A stage that could not run is **NOT RUN**, never a pass. `verify.py` exits
non-zero rather than call an incomplete run green, and `--allow-skips` requires
you to report the SKIPs verbatim. Never write "tests pass" about a command you
did not execute.

## Flakiness

A flaky test is a defect report about the product or the harness, not noise to
retry past. The browser suite runs one at a time because the per-workflow
concurrency ceiling is one — do not parallelise it to make it faster.
