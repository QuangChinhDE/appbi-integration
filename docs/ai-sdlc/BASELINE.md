# Baseline audit

**HEAD:** `d182975` on `ai-sdlc-bootstrap` · **Fingerprint at last full
re-verification:** `7a74c7d80e8b0c…` (`python scripts/repo_fingerprint.py`) ·
**Product version:** 1.0.0 (`v1.0.0-rc1`) · **Engine:** n8n 1.14.1

This is the second audit. The first bootstrapped the development harness
(intent/spec/plan/review artefacts, scoped rules, reviewer agents, CI/branch
fixes); this one hardened the harness's evidence discipline (fingerprinting,
staleness detection, the completion gate) and re-ran verification honestly
against the corrected vocabulary below.

## Vocabulary — read this before reading a single row

The first version of this document used a broad **PASS** for several rows
where only a narrower property had actually been checked. That is corrected
here. States used below:

| State | Means |
|---|---|
| **VERIFIED** | a specific command was run, against a specific repository state, and its result is cited (evidence record, fingerprint, or command output) |
| **PARTIALLY VERIFIED** | some real evidence exists, but it proves less than the row's heading suggests — the gap is named explicitly |
| **NOT VERIFIED** | coverage exists (a suite, a test, a check) but it was not executed to produce this claim — a suite existing is not the suite having passed |
| **FAIL** | executed and failed |
| **BLOCKED** | cannot be executed in this environment, and why |
| **N/A** | genuinely does not apply, with the reason |

**"No defects found" is never used as a synonym for "not tested."** Where a
suite did not run, the row says NOT VERIFIED and names what did not run,
never "no defects found."

---

## Area matrix

| Area | State | Evidence | Risk | Required action |
|---|---|---|---|---|
| **Development harness** | **VERIFIED** | `.claude/`, `CLAUDE.md`, `REVIEW.md`, `docs/ai-sdlc/`, `scripts/{verify,guardrails,claude_guard,repo_fingerprint,evidence,record_review,session_context,completion_gate}.py` exist and were exercised live this session (see "Proof of freshness" below) | low | keep current as the code moves; this file's own claims are the test of whether that is happening |
| **Repository fingerprinting** | **VERIFIED** | `scripts/repo_fingerprint.py`: same clean tree → identical hash across repeated runs; a one-line append to README.md changes it; reverting restores the original hash exactly; staged and unstaged changes both count; `.claude/evidence/` is provably excluded. All four properties demonstrated live, commands and output in this session's transcript | low | none |
| **Evidence staleness detection** | **VERIFIED** | `scripts/evidence.py`: a record made `CURRENT`, then a source edit made it `STALE` (exit 1), then a revert restored `CURRENT` (exit 0) — demonstrated live for both `verification` and `review` kinds | low | none |
| **Backend** | **VERIFIED** | `verify.py targeted backend` against a live database: **264 tests passed** (up from 260 — 4 new regression/invariant tests added this session), `ruff` clean, migration round-trip clean, `alembic check` clean, no schema drift. Evidence: `verification/backend`, fingerprint `7a74c7d8…`, 2026-09-18T03:49:58Z | low | none |
| **Frontend** | **VERIFIED** | `verify.py targeted frontend`: typecheck, lint, 34 component tests, `next build` all pass. Evidence: `verification/frontend`, same fingerprint, 03:50:59Z | low | none |
| **Engine** | **VERIFIED** | `verify.py targeted engine`: typecheck, build, **68 contract tests against the real pinned runtime**, `certify.py --check`. Evidence: `verification/engine`, same fingerprint, 03:51:30Z. Live `/readyz` on the running stack separately confirmed `engine_version: n8n-core@1.14.1` | low | none |
| **Node contracts** | **VERIFIED** (existing 9), **N/A** (other 285) | `certify.py --check` cross-checks registry ↔ compatibility ↔ installed tree ↔ compiler for the 9 certified nodes. The other 285 are correctly uncertified, not a gap — `/engine-node` is the path, `docs/node-catalog-backlog.md` the queue | low | new nodes via `/engine-node` only |
| **Architectural guardrails** | **VERIFIED** | `scripts/guardrails.py`, 9 checks, all pass. Two are new this session (**"one compiler"**, **"Publish != Activate"**) and both were proven to actually fire by injecting the violation they name and watching them fail, then reverting — see "Proof of freshness" | low | none |
| **Deployment** | **VERIFIED** | `verify.py targeted deployment`: manifest/alert/production-doctor tests, the production template correctly refused, `docker compose config`, `kubectl kustomize` all pass. Evidence: `verification/deployment`, same fingerprint, 03:51:43Z. Live `docker compose ps`: engine exposes `8099/tcp` with no host mapping (guardrail 15, confirmed in the running deployment, not only in the compose file) | low | none |
| **E2E / browser suite** | **FAIL, root cause identified — environment state, not a code regression** | `verify.py targeted e2e` was actually run against the live dev stack (non-destructive `clean-install.spec.ts` excluded by default). `global.setup.ts:36` ("sign in as the workspace owner") failed; 1 of 135 tests ran, 134 did not. Cause: `global.setup.ts` tries only the bootstrap default password and the suite's own post-first-run password — this stack has been running 16+ hours across many prior manual sessions and its admin credential no longer matches either. This is a property of a long-lived, non-disposable stack, not a defect this session introduced or found in the product. **Evidence: `verification/e2e`, status FAIL, fingerprint `9e22ace8…`.** A second, real defect was found and fixed in the course of getting this far: `scripts/verify.py` crashed with `UnicodeEncodeError` reporting a failing stage's output on Windows (fixed by `reconfigure(errors="replace")` on stdout/stderr) | medium | run against a stack whose credentials are known (fresh `docker compose up` on an empty volume, or export `E2E_PASSWORD`/`E2E_SETTLED_PASSWORD` matching this stack's actual current admin password) |
| **Security** | **VERIFIED for the mechanisms checked; PARTIALLY VERIFIED overall** | Secrets never echoed (contract + smoke, not re-run this session — see below); redaction in both layers; HMAC + replay + constant-time on `/hooks`; tenant isolation by AST walk (`test_tenant_isolation.py`, passing in the 264); **new this session:** `retry()` now has a direct regression test proving it forwards the sealed original payload, not the redacted preview, and `public_view()` now has a direct test (plus an AST check on the router) proving `engine_binding` cannot reach a non-admin response — both previously "documented-only". `scripts/smoke.py` (39 checks incl. secret-never-echoed against a running deployment) was **not** re-run this session — NOT VERIFIED for that specific claim today, though it is wired into CI | medium | run `scripts/smoke.py` against the live stack; re-open ADR-030 before any decision to open the product to customers (its two carried exceptions are unchanged) |
| **Licensing** | **VERIFIED as correctly blocked** | `commercial_gate: NOT_REVIEWED`; `release_gate.py --delivery commercial` refuses; CI asserts the refusal (not re-run this session, but the assertion is a repository-level guarantee independent of session state) | high for commercialisation | a legal review, not an engineering task |
| **UX completion** | **NOT VERIFIED this session (UI_VISUAL / UI_JOURNEY)** | `11-appearance.spec.ts` (UI_STRUCTURAL) is included in whatever the E2E row above records. **No screenshot was captured or read this session, and no journey was walked in the running product.** Per the new three-way split (`docs/ai-sdlc/EVIDENCE_MODEL.md`, `.claude/skills/ui-review/SKILL.md`), UI_STRUCTURAL evidence is not a substitute for UI_VISUAL or UI_JOURNEY evidence, and this document does not claim either | medium | run `/ui-review` before any UI-affecting change is called Done |

---

## Product journeys

The first baseline listed every journey as "COMPLETE" on the strength of
coverage existing in the test suites. That conflated "a test exists for this"
with "this passed today." Corrected:

| Journey | State | What actually supports this claim today |
|---|---|---|
| Sign in, forced password change | **NOT VERIFIED this session** | `02-auth.spec.ts` exists; not run standalone this session — folded into the E2E row above |
| Build a graph, run a draft | **PARTIALLY VERIFIED** | `test_new_workflow_seed.py` is in the 264 backend tests that passed; the browser-driven version (`03-editor.spec.ts`) is in the E2E row |
| Publish → activate → rollback stay distinct | **VERIFIED at the code level, this session** | new: `scripts/guardrails.py`'s structural check, proven to catch both directions of coupling by injection. The end-to-end browser journey (`04-lifecycle.spec.ts`) is in the E2E row |
| Multi-tenant isolation | **VERIFIED at the code level** | `test_tenant_isolation.py` (AST walk over every service module) is in the 264 passing backend tests. The two-real-tenant browser proof (`07-tenancy.spec.ts`) is in the E2E row |
| Secret never echoed | **VERIFIED at the unit level, this session; NOT VERIFIED end-to-end today** | `test_payload_integrity.py`'s existing suite plus this session's new retry-forwarding test are in the 264 passing tests. `scripts/smoke.py`'s live assertion of the same property was not re-run this session |
| Idempotency and rate limits at 2 replicas | **NOT VERIFIED this session** | `08-idempotency-limits.spec.ts` exists; folded into the E2E row |
| All of the above, in the browser, today | **See the E2E row above** | this is the only row that can turn "coverage exists" into "passed today" for a full journey |

---

## Proof of freshness — demonstrated live this session

Every claim below has its exact commands and output in this session's
transcript, not merely asserted here.

**1. Fingerprint determinism and sensitivity.**
```
$ python scripts/repo_fingerprint.py        # run twice, clean tree
<identical hash both times>
$ echo "" >> README.md && python scripts/repo_fingerprint.py
<different hash>
$ git checkout -- README.md && python scripts/repo_fingerprint.py
<original hash, restored exactly>
```

**2. Evidence goes stale the instant the tree changes, and un-stales on
revert.**
```
$ python scripts/verify.py targeted guardrails   # records evidence at fp=X
$ python scripts/evidence.py check --kind verification --area guardrails
CURRENT  verification/guardrails: PASS (fingerprint X)
$ echo "" >> README.md
$ python scripts/evidence.py check --kind verification --area guardrails
STALE  verification/guardrails: recorded for X, current is Y   (exit 1)
$ git checkout -- README.md
$ python scripts/evidence.py check --kind verification --area guardrails
CURRENT  ...   (exit 0)
```

**3. Reviewer verdicts go stale the same way.**
```
$ python scripts/record_review.py --reviewer architecture-reviewer \
    --status FINDINGS --blocker 0 --important 2 --minor 1 --summary "..."
$ python scripts/evidence.py check --kind review --area architecture-reviewer
CURRENT ...
$ echo "" >> README.md
$ python scripts/evidence.py check --kind review --area architecture-reviewer
STALE ...   (exit 1)
```
(This record is itself now stale in `evidence.py status` above, from the
documentation edits made after it — which is the mechanism working as
intended, not a defect in this document.)

**4. The completion gate blocks a detected completion claim on missing
evidence, and allows it once evidence is current.**
```
$ echo '{"transcript_path":".../t1.jsonl"}' | python scripts/completion_gate.py
# t1.jsonl's assistant text: "Implementation complete. Everything is passing."
{"decision": "block", "reason": "... Missing:\n  - verification/quick ...\n  - verification/engine ...\n  - verification/guardrails ..."}

$ python scripts/verify.py quick && python scripts/verify.py targeted guardrails
$ echo '{"transcript_path":".../t1.jsonl"}' | python scripts/completion_gate.py
{}   # allowed
```
Also demonstrated: an honest `"STATUS: NOT DONE. Docker unavailable..."`
message is let through without blocking; `stop_hook_active: true` always
allows (loop safety); a message with no completion-claim phrasing (ordinary
mid-task text) is never blocked.

**5. The preflight write-gate blocks product-code edits with no declared
scope, and unblocks on either declaration.**
```
$ echo '{"tool_name":"Edit","tool_input":{"file_path":".../backend/app/services/workflows.py",...}}' \
    | python scripts/claude_guard.py
{"...": "ask", "...reason": "... is product code, and no change is declared..."}

$ echo '{"reason":"...", "declared_at":"..."}' > .claude/light-change.json
$ echo '{"tool_name":"Edit", ...}' | python scripts/claude_guard.py
{}   # allowed
```
Also demonstrated: the light-path file cap (5 files) escalates back to
"ask, run /preflight" once exceeded; a real `.claude/active-change` pointing
at a `docs/changes/<slug>/plan.md` also satisfies the gate; test files are
exempt (writing a regression test is how a bugfix starts); `.claude/`,
`docs/`, and top-level docs are never gated.

**6. New guardrails catch the exact violation they name, by injection.**
```
$ echo "// new Workflow({ id: 'test' });" >> workflow-engine/src/logger.ts
$ python scripts/guardrails.py
[ FAIL ] one compiler: only compiler.ts constructs an n8n Workflow instance
           workflow-engine/src/logger.ts:56: ...
$ git checkout -- workflow-engine/src/logger.ts   # reverted
```
Same pattern proven for both directions of the Publish/Activate check
(`publish()` assigning `workflow.status`; `activate()` constructing a
`WorkflowVersion`) — both injected, both caught, both reverted.

**7. New regression tests catch the exact defect they are named for, by
reverting the fix.**
```
$ sed -i 's/_payload_for_engine(original)/_sanitize_payload(original.start_payload)/' \
    backend/app/services/executions.py
$ pytest tests/test_payload_integrity.py::TestRetryForwardsTheSealedPayloadNotThePreview
FAILED ... assert {'password': '********'} == {'password': 'hunter2'}
$ git checkout -- backend/app/services/executions.py   # reverted
```
Same pattern proven for the `engine_binding` leak test, via an injected
`include_binding=True` on the non-admin `get_node` route.

---

## Previously "documented-only" invariants — three closed, one narrowed

From the first baseline's list of four:

| Invariant | Then | Now |
|---|---|---|
| Masked payload becoming execution input | documented only | **VERIFIED mechanically**: `TestRetryForwardsTheSealedPayloadNotThePreview` in `backend/tests/test_payload_integrity.py`, proven to catch the regression by reverting the fix |
| A second product-graph → n8n translation site | documented only | **VERIFIED mechanically**: `scripts/guardrails.py`'s `there_is_exactly_one_compiler`, proven by injection |
| Publish/Activate coupling | documented only | **VERIFIED mechanically**: `scripts/guardrails.py`'s `publish_never_activates_and_activate_never_publishes`, proven by injection in both directions |
| `engine_binding` leaking into non-admin responses | documented only | **VERIFIED mechanically**: `backend/tests/test_node_catalog_projection.py`, both the direct projection test and an AST-based check over the router, proven by injection |

All four were closed with real behavioural or structural checks rather than
naive text greps — see each mechanism's own docstring for why the chosen
check is the specific, narrow thing that actually matters (e.g. "constructing
a `Workflow` instance", not "importing `n8n-workflow`", which most of the
engine legitimately does).

## Remaining documented-only invariants

None from the original four. New ones surfaced by this session's own work,
listed rather than hidden:

- **The completion gate's transcript heuristic** is phrase-based, not
  semantic. Wording it does not recognise (see `completion_gate.py`'s
  `COMPLETION_PATTERNS`) will not be blocked — `CLAUDE.md`'s
  no-self-certification principle and the evidence system itself remain the
  primary mechanism; this hook is a backstop, documented as such in its own
  module docstring.
- **The light-path file cap** (5 files) is a proxy for "how big has this
  gotten", not a semantic judgement of complexity — a determined agent could
  touch 5 *very* consequential lines and stay under it. It is a tripwire, not
  a substitute for judgement about what warrants `/preflight`.

## Remaining blockers

1. **E2E did not pass today.** It ran, and failed at the sign-in step because
   the long-lived dev stack's admin credential no longer matches what the
   suite tries. This blocks *this document* from claiming any browser-level
   journey evidence, but is not evidence of a product regression — the 134
   tests that never ran are NOT VERIFIED, not FAIL. Re-run against a stack
   with known credentials (freshest: `docker compose down -v && docker compose
   up -d --build --wait`, which is also what item 4 below asks for anyway).
2. `scripts/smoke.py` has not been re-run this session; its live
   secret-never-echoed assertion is NOT VERIFIED today even though its unit-
   level counterpart is.
3. No UI_VISUAL or UI_JOURNEY evidence exists this session for any screen —
   `/ui-review` was not run. Any UI-affecting change from this point should
   not be called Done without it.
4. A genuinely disposable-environment certification (`docker compose down -v`
   → fresh install → smoke → e2e, the original bootstrap's §15) was **not**
   attempted this session, to avoid mutating a stack that had been running
   16+ hours and might carry state relied on elsewhere. That caution turned
   out to have a cost — item 1 above is the direct consequence of the stack's
   accumulated state. The disposable run is now the clearer next step, not
   merely a nice-to-have: it would have produced real E2E evidence instead of
   an environment-state failure.
