# Plan — Wave 0: Current Runtime Proof

## Affected layers

| Layer | Touched | What |
|---|---|---|
| **frontend** | Yes | Inline expression-mode hint (0A.3). Possible fixes to error/remediation rendering if 0A finds them. UI-driven reference workflows are tests, not product code |
| **API** (`app/api/v1`) | Possible | Only if 0A shows an error envelope is malformed at the edge. No new endpoint |
| **domain / service** | **Yes** | `services/graph.py` — the 2.8 validation WARNING. Possibly `services/executions.py` if a status maps wrongly |
| **DB / migrations** | **No** | No schema change. If one turns out to be needed, it is a finding and re-scoped |
| **worker** | Possible | 0D may expose reconciler defects (ADR-010) |
| **engine** | **Yes** | `src/runtime/error-normalizer.ts` and the HTTP path are where 0A's failures will land |
| **security** | **Yes** | §4.16 redirect-to-private-address is an SSRF case; §2.7 expression in a credential-bearing field |
| **monitoring** | No | |
| **audit** | No | |
| **tests** | **Yes — the bulk of the work.** | New engine contract tests, a new composition suite, new browser specs, engine-loss scenarios |

## Invariants in play (SRS §2.1)

| # | Invariant | Why it is in play |
|---|---|---|
| **1, 15** | Frontend calls `/api/v1` and `/hooks` only | New browser specs must not reach the engine |
| **2, 10** | Only `workflow-engine/` imports n8n | New contract tests live in the engine; composition tests must assert the **product DTO**, never `IRun` |
| **7, ADR-027** | Secrets never come back out | 0A tests a revoked credential and a credential-bearing expression. No test may print a secret |
| **9, 17, 18** | Publish ≠ Activate; versions immutable; a run binds its exact version | 0C publishes and runs. Retry must re-run the **frozen** input |
| **19** | Every tenant-scoped query names `workspace_id` | New fixtures must not bypass it |
| **ADR-010** | Engine loss must not leave runs `RUNNING` | 0D's entire purpose |
| **ADR-023** | The compiler pins execution order and condition types | 0B's item-count assertions depend on it; a failure here is a compiler investigation |
| **ADR-026** | Retry re-executes the frozen input, never a preview | 0C's retry assertion |

**Documented-only invariants in play:** ADR-010's reconciliation guarantee has
no mechanical enforcement — 0D is the first thing that will actually check it.
Nothing catches a violation there today, which is the point.

## Risk: **HIGH**

Not for diff size. The change touches execution semantics, the error
normalizer, the reconciler, and an SSRF case, and the fixes it produces will
land in shared machinery every later wave depends on. Per `/preflight`, a small
diff at HIGH risk still gets full verification and review.

## Sequence

Strictly ordered; each checkpoint's defects are fixed before the next begins,
because later checkpoints build on the machinery earlier ones repair.

### 0A (largest)
1. Build the HTTP status fixture harness (a test endpoint that can produce
   every status, body shape and failure mode in §4).
2. Assert the full chain per case. Record PASS/FAIL per row.
3. Expression cases, including 2.8.
4. Implement 2.8: `graph.py` WARNING + editor hint + tests.
5. Fix every defect found, each with its regression test watched failing first.
6. `verify.py targeted engine`, `targeted backend`, `targeted frontend`.

### 0B
7. New composition suite asserting per-node item counts.
8. Fix, verify.

### 0C
9. Browser specs for W01–W06 + W08a, **built through the UI**.
10. `/ui-review` on the screens they traverse.
11. Fix, verify, re-walk.

### 0D
12. Engine-loss scenarios against the real images (`./run.ps1`).
13. Fix reconciler defects, verify, re-run.

### Exit
14. Refresh the stability matrix with actual results, counted with the recorded
    commands — **not estimated**.
15. Defect inventory.
16. Revised Minimum Practical Node Catalog.
17. Re-estimate Waves 1–4 from measured effort.
18. `architecture-reviewer`, `qa-reviewer`, `ui-reviewer` against the final
    diff; `verify.py full`; record the final fingerprint.

## How this could go wrong

- **Scope creep into fixing everything found.** A defect outside Wave 0's four
  checkpoints gets inventoried, not fixed, unless it blocks a checkpoint.
- **Assertion drift.** If a matrix row is a wrong expectation, the correction
  is argued in `spec.md` first. Changing an expected value to whatever the code
  produces is prohibited (`.claude/rules/testing.md`).
- **0C seeded through the API** because UI building is slow. That would repeat
  001's exact failure and void 0C's evidence.
- **Claiming 0D from logs.** The engine must actually be stopped and killed.
- **Reporting a total without counting it.** Three invented numbers came out of
  002. Every total in the exit report carries the command that produced it.
