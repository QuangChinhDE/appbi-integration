# Acceptance — Wave 0: Current Runtime Proof

The journey to walk before this change is Done. It is deliberately a
**customer's** journey, not a test runner's: the question Wave 0 answers is
whether the nine-node product is trustworthy in a real person's hands.

## The journey

Walked in a browser, against the **deployed images**, as a user who has just
been given an account.

1. **Sign in** and land on an empty workspace. The empty state says what to do
   next and does not instruct an action the role cannot perform.
2. **Build W01 through the UI** — manual trigger, HTTP GET a JSON list, Edit
   Fields normalising three keys. No API seeding. Every step is reachable from
   the canvas the product creates for you.
3. **Run it.** The run appears in history bound to the version that executed.
   Each node's preview shows the items it actually produced, and the item count
   at each step is what it should be.
4. **Break it deliberately** — point the HTTP node at an endpoint returning
   401. The run fails with `NODE_AUTHENTICATION_FAILED`, the error screen names
   the failing node, and the primary CTA is the credential remediation. It is
   reachable in one click and lands somewhere that helps.
5. **Fix the credential and retry.** The retry re-runs the frozen input, and
   the run succeeds.
6. **Add a branch** — IF on a field, two branches, a Merge. Publish. Confirm
   Publish did **not** activate anything.
7. **Feed it an empty result.** The run ends SUCCEEDED with zero items and
   reads as "nothing to do today", not as a failure.
8. **Make the 2.8 mistake on purpose** — type `{{ $json.id }}` into a URL while
   the field is in Fixed mode. The product tells you, before the run produces
   confidently wrong data.
9. **Stop the engine** and press Run. The product stays readable and says runs
   are paused.
10. **Kill the engine mid-run.** Within the reconciliation window the execution
    stops being `RUNNING`, becomes `ENGINE_INTERRUPTED`, and the UI explains it
    rather than spinning.
11. **Restart the engine.** A new run succeeds. The interrupted run did not
    silently resume or duplicate.

## Done criteria

A criterion is met only with current, fingerprint-matched evidence.

| # | Criterion |
|---|---|
| 1 | Every §4 HTTP row has an asserted product error code **and** remediation. No row is NOT RUN without a stated reason |
| 2 | Every §2 expression row asserted, including 2.8 |
| 3 | Row 2.8 implemented: a Fixed value with expression syntax cannot reach a SUCCEEDED run silently |
| 4 | Composition suite exists and asserts **item count at every node** |
| 5 | W01–W06 and W08a run through the UI. None seeded via the API as acceptance evidence |
| 6 | All three engine-loss scenarios executed against real containers, with the reconciler observed |
| 7 | Every defect found: reproduced, regression test watched failing, root cause named, fixed, re-run |
| 8 | Stability matrix refreshed with actual results, **counted with the recorded commands** |
| 9 | Defect inventory complete |
| 10 | Revised node catalogue and re-estimated Waves 1–4 |
| 11 | `verify.py full` — every stage PASS or an explicitly reported NOT RUN |
| 12 | architecture-reviewer, qa-reviewer, ui-reviewer run **against the final diff**, no BLOCKER open |
| 13 | Final fingerprint recorded |
| 14 | **No new node certified** — `node-lock.json` and `compatibility.yaml` unchanged |

## What would make this a failed Wave 0

- Reporting "no defects found" without having driven the deployed product.
- 0C evidence produced by API seeding.
- 0D claimed from configuration review rather than a stopped container.
- A green matrix produced by softening a row instead of fixing the product.
- Any total reported without the command that counted it.

## Verification commands

```bash
python scripts/verify.py targeted engine
python scripts/verify.py targeted backend
python scripts/verify.py targeted frontend
python scripts/verify.py targeted e2e
python scripts/verify.py full
python scripts/evidence.py status
```
