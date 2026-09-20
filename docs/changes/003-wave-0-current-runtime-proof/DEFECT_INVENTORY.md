# Wave 0 — defect inventory

Every entry was reproduced against the real pinned runtime before it was
written down. Each fixed entry has a regression test that was **watched
failing** first.

Status: `FIXED` · `CONFIRMED — not fixed` (real, deliberately not fixed in 0A,
with the reason) · `OBSERVATION` (recorded, needs 0C to judge).

---

## 0A — HTTP and expression semantics

### D-W0-01 · FIXED · An unreadable response body said only "a step failed"

**Severity: high.** Three of the most ordinary HTTP outcomes in existence.

Reproduced: a 200 with an **empty body** and `content-type: application/json`,
a **204** that still declares JSON, and a **truncated** body all reached the
runtime's single `Invalid JSON in response body` and fell through the
normalizer to `NODE_EXECUTION_FAILED` — *"Một bước trong workflow đã thất bại."*
Unactionable, and untrue: the service answered.

**Root cause.** One missing branch in `error-normalizer.ts`. The node's
`response_format` defaults to AUTO, so the runtime parses anything announcing
itself as JSON.

**Fix.** Classify as `NODE_CONFIGURATION_INVALID` / CONFIGURATION with a message
naming the way out (set Response format to Text). Remediation `EDIT_NODE`
already resolves to the editor, so the chain completes.

**Rejected:** n8n's `neverError` flag, which suppresses the parse throw *and*
erroring on 4xx/5xx — it would have silently undone the authentication and
rate-limit classification this same checkpoint asserts.

*Tests:* `contract/http-semantics.test.ts`, the `unparseable` table.

### D-W0-02 · FIXED · A node that failed under continue-on-error reported SUCCEEDED

**Severity: high.** The run was indistinguishable from one where nothing went
wrong.

Reproduced: a 500 behind `continue_on_error: true` produced
`node_results[Call].status = SUCCEEDED` with one item. The user is never told
the call did not work.

**Root cause.** With `continueOnFail` n8n does not set `task.error`; it writes
the error into the node's **output items** and records the task as a success.
`nodeStatus()` only looked at `task.error`.

**Fix.** `normalize.ts` detects the swallowed error and reports the node
`FAILED` while deliberately **not** failing the run — that is what
continue-on-error was asked for, and the existing golden still passes.

### D-W0-03 · FIXED · The swallowed error was a raw AxiosError, including response headers

**Severity: high — guardrail 10, and a header-leak risk.**

Same reproduction as D-W0-02. The stored item preview — what a user reads —
contained `"name":"AxiosError"`, `"isAxiosError":true`, `"code":"ERR_BAD_RESPONSE"`
and the upstream's **response headers**. An n8n shape crossing the product
boundary, carrying whatever the upstream chose to send back.

**Fix.** Same root cause as D-W0-02, so the same place: the item is kept
(downstream is entitled to branch on a failed row) and its `error` is replaced
with `{code, category, message}`.

*Test asserts a `set-cookie` value does not survive into the preview.*

### D-W0-04 · CONFIRMED — not fixed · `max_response_bytes` is enforced nowhere

**Severity: medium-high.** Unbounded response body in a process that runs other
tenants' workflows, reachable by any workflow pointing at a URL somebody else
controls.

Reproduced: 8 MB body returned whole against a 1 MB policy. `max_response_bytes`
is declared in `engine-dto.ts` and read by nothing in `src/`.

**Why not fixed, and what was tried** — recorded so the next attempt does not
repeat it:

- `axios.defaults.maxContentLength` does not work. `proxyRequestToAxios` sets an
  explicit `maxContentLength: Infinity` on every request.
- A **request interceptor** does apply (n8n calls the default axios instance),
  and it makes the case **hang instead of failing**: axios destroys the response
  stream and n8n's `binaryToBuffer` then awaits an `end` that never arrives. A
  hang is worse than an unenforced cap, so it was reverted.

Enforcing this needs byte counting at the socket or agent level — a design task,
not a smallest-coherent-fix.

**This is worse than an unused contract field.** `.env` sets
`EGRESS_MAX_RESPONSE_BYTES=8388608`, and `docker-compose.yml` passes an egress
policy to the engine on both the api and worker paths. So the deployment
**configures a response ceiling that silently does nothing** — an operator
reading the configuration would reasonably believe the control exists. Raise
the severity accordingly: a limit that is present, documented and inert is a
worse state than one that was never offered.

*Test present and `it.skip`ped with this reason.*

### D-W0-05 · CONFIRMED — not fixed · A runtime expression failure silently yields null

**Severity: high. The most serious finding in 0A.**

Reproduced: `{{ $json.count.toUpperCase() }}` against `count: 7` — valid syntax,
wrong assumption about the data. Result: `result: null`, node **SUCCEEDED**, run
**SUCCEEDED**, and `node_results[].error` empty. Nothing anywhere records that
an evaluation failed.

A workflow writing that field into Postgres or posting it to an API writes a
null and reports success. Same silent-wrong-data class as D-W0-08, and worse:
there is no typo to spot.

**Why not fixed.** The information is gone by the time the product sees the
result — nothing downstream can distinguish "genuinely null" from "evaluating
it threw". A fix belongs where the expression is resolved and is a decision
about what the product promises.

*The assertable part is tested:* the value must not be the text `"null"` or
`"undefined"`. The full assertion is present and skipped with this reason.

### D-W0-06 · FIXED · An expression naming a missing node was "a step failed"

Reproduced: `{{ $('Ghost').item.json.x }}` → `NODE_EXECUTION_FAILED` / NODE.
The runtime reports `"Ghost" node doesn't exist` as a `NodeOperationError`,
which carries neither the word "expression" nor an Expression class name, so it
missed the normalizer's expression branch.

**Fix.** `EXPRESSION_INVALID` / EXPRESSION — the fix is in the field.

### D-W0-07 · FIXED · Reading from a branch that did not run was "a step failed"

Reproduced: an IF's rejected branch referenced by the other branch →
`no data, execute "Yes" node first` → `NODE_EXECUTION_FAILED` / NODE.

**Fix.** `EXPRESSION_EVALUATION_FAILED` / EXPRESSION — deliberately *not* the
same code as D-W0-06. The expression is correct and the data is absent, so the
user should look at the run, not rewrite the field. That is the distinction the
product's two expression codes already exist to draw.

### D-W0-08 · FIXED · A fixed value containing `{{ }}` was sent out as text (row 2.8)

**Severity: high.** Found by the Wave 0 fan-out spike, which made this exact
mistake and got a green run out of it.

Reproduced: `http://host/item/={{ $json.id }}` — the `=` must lead the *whole*
field, so this is a literal. The braces were URL-encoded into the request; the
run returned **200 / SUCCEEDED** with semantically wrong data.

**Fix**, as specified before implementation:
- `services/graph.py` raises `EXPRESSION_NOT_ENABLED` as a **WARNING**, where
  the rules live, so the API and worker honour it — not only the editor;
- the editor offers a one-click switch beside the field;
- **publish is not blocked**: `{{ }}` in a literal is legitimate for a templated
  body a downstream service interpolates;
- the mode is **not** auto-switched — that guesses, and the guess rewrites a URL.

### D-W0-09 · FIXED · Seven remediations led nowhere, including two of the three commonest failures

**Severity: high**, and it is the defect 0A was designed to find: the product
ships a code, a label and a remediation, and the last link was missing.

Audited the whole chain against `ERROR_UX_MATRIX`. Seven of twenty-three codes
carried an action `resolveRemediation` returned `null` for, so the error card
rendered a message and **no way forward**:

| Code | Action |
|---|---|
| `NODE_TIMEOUT` | `RETRY_OR_CHECK_ENDPOINT` |
| `NODE_NETWORK_UNREACHABLE` | `CHECK_ENDPOINT` |
| `EXPRESSION_INVALID` | `OPEN_FIELD` |
| `NODE_UNSUPPORTED` | `REPLACE_NODE` |
| `WEBHOOK_AUTH_FAILED` | `CHECK_WEBHOOK_SECRET` |
| `NODE_RATE_LIMITED`, `ENGINE_UNAVAILABLE` | `RETRY_LATER` |
| `ENGINE_INCOMPATIBLE` | `CONTACT_ADMIN` |

The first five have an obvious destination — the editor, where the URL or the
field is — and now go there. `RETRY_LATER` and `CONTACT_ADMIN` genuinely have
none: waiting and asking a person are not places to navigate to. That was
already the documented intent; the defect was that five others were sharing
their fate silently.

*Regression test walks the backend's matrix and was watched failing on exactly
these five before the fix.*

---

## 0B — composition of the current nine nodes

**Zero defects. Eight pairs, every one correct on the first run.**

That is a real result and worth stating plainly rather than burying: the nine
certified nodes compose correctly at the engine level. `contract/composition.test.ts`
asserts the item count at **every node** in each graph, not the final output,
because a branch that drops or duplicates a row produces a plausible final
result either way.

| Pair | Asserted |
|---|---|
| `http -> edit_fields` | 5 in, 5 out, every item modified |
| `http -> if` | 5 split 3/2, and the specific ids on each side |
| `if -> merge` | 3 + 2 back to 5 — not 10, not 3 |
| `switch -> merge` | three named branches plus fallback, counted separately |
| `filter -> edit_fields` | 6 in, 3 kept; the discarded array never reaches downstream (ADR-026) |
| **filter to zero** | SUCCEEDED, no error code, and the downstream node invents no item |
| `continue-on-error -> downstream` | run succeeds, failed row carried in the product's vocabulary |
| multi-item through branch and back | 20 in, 10/10, 20 out, **every id exactly once** |

Two caveats, so this is not read as more than it is. It is an **engine-level**
result: whether the UI displays these counts correctly is 0C's question, and
the run panel is where a wrong count would actually be seen. And three of the
eight only pass because of fixes made in 0A — the `continue-on-error` pair
asserts D-W0-03's normalized error shape.

One thing this checkpoint did *not* find, which is worth noting because it was
the likeliest place for it: no ADR-023 execution-order surprise. The diamond and
merge shapes behave as the compiler's pinned order says they should.

---

## 0C — the reference workflows, through the UI

Nine assertions, built the way a user builds them — **nothing seeded through
the API**. Eight passed once my own test mistakes were corrected. One found a
defect that 0A could not have found, because 0A never looked at a screen.

### D-W0-10 · FIXED · The run panel could act on one error code out of twenty-three

**Severity: high**, and strictly worse than D-W0-09 — that one was a gap in the
lookup table, this is the caller ignoring the table entirely.

Found by *looking at the screenshot*, not by an assertion. A 401 showed a
proper primary button (*Cập nhật thông tin xác thực*). An unreachable host
showed the same card with an excellent message — it names the host — and **no
button at all**, only "technical details" and "copy support info".

**Root cause.** `ExecutionDataPanel.tsx` hardcoded one case:

```ts
nodeResult.error.code === 'NODE_AUTHENTICATION_FAILED' ? 'UPDATE_CREDENTIAL' : undefined
```

It had to, because the stored node error carries `code`, `category`, `message`
and `technical_message` and **no remediation** — so the frontend had nothing to
read and re-derived the one case somebody needed. `ERROR_UX_MATRIX` knew the
answer for all twenty-three codes and it never reached a failed run, which is
where a user actually meets most of them.

**Fix, in the layer that owns the rule.** `remediation_for(code)` in
`core/errors.py`, applied to the stored error in `detail_view`. The frontend
now reads `error.remediation.action`. Recomputing the mapping in the frontend
was rejected: `.claude/rules/frontend.md` is explicit that a rule recomputed
there gives two answers that diverge.

**Evidence.** The e2e assertion was watched failing against the pre-fix images,
then passing after a rebuild, and the screen was looked at both times: *Kiểm
tra endpoint* now appears where there was nothing.

### What the screens actually showed

Captured and read, not merely asserted:

- **A failed run opens on the error tab** with a sentence, not an identifier —
  the run panel opening on an empty Output with the error one tab away was a
  001 defect and it has stayed fixed.
- **Per-node item counts are visible** in two places, on the canvas card
  (`1 item`, `0 item`) and in the run panel's step list, with durations.
- **The 2.8 warning appears in three places at once** — an amber banner, an
  inline hint under the field offering the switch, and a badge on the node card
  — and Run stays enabled, which is what the spec asked for.
- **An invalid step is refused clearly.** An Edit Fields node with no fields
  declared blocks the run and says so in the banner, on the card and under the
  field. My first W01 attempt failed on this and the product was right.

---

## 0D — engine loss, against real containers

Three scenarios, run by stopping and killing the engine container for real, and
waiting the **configured** 120-second reconciliation window rather than a
shortened one. This is the first time ADR-010's reconciler has ever been
exercised; `.claude/rules/architecture.md` lists that guarantee as having no
mechanical enforcement.

**What already worked**, and is worth saying plainly because it is the harder
half:

- the engine **killed mid-run** (`docker kill`, no graceful shutdown) leaves a
  run at `ENGINE_INTERRUPTED`, not stuck, with a usable summary — *"Engine
  không xác nhận lần chạy này trong thời gian cho phép."*;
- the product **stays readable** with no engine at all;
- after the engine returns, a **new run succeeds**.

### D-W0-11 · FIXED · With the engine stopped, a run never became terminal

**Severity: high. This is the case ADR-010 exists to prevent.**

Reproduced: engine stopped, run dispatched, and **200 seconds later against a
120-second window the execution was still active** with `ENGINE_UNAVAILABLE`.

**Root cause.** `dispatch()` sets `last_seen_at = utcnow()` before every
attempt, and the `EngineUnavailableError` path requeues. Each retry therefore
refreshed the reconciler's staleness reference, `utcnow() - reference` never
grew past one poll interval, and `_interrupt_if_stale` could never fire — so
its own `not execution.engine_ref -> FAILED_TO_START` branch, written for
exactly this case, was **dead code** for this path.

The run oscillated QUEUED ↔ DISPATCHING indefinitely. Both are ACTIVE statuses
and **neither is RUNNING**, which is why a "not RUNNING" check sails past it —
including the first version of this harness.

**Fix.** The dispatch-failure path gives up once the wait exceeds the same
configured window, using the existing terminal state
(`FAILED_TO_START` / `ENGINE_UNAVAILABLE`). Brief outages still requeue, so an
engine restart does not fail everything in flight.

**Rejected: adding `QUEUED` to `active_executions`.** It looks like the more
general fix and it is the more dangerous one — the reconciler would then fail
**legitimately queued work during a backlog**, because from the outside a
queued run older than the window is indistinguishable from a stranded one. At
the dispatch site we already know *why* the run is queued.

### Three harness defects, all mine

Recorded because they are the reason the first two 0D runs were worthless, and
because they are the same shape as the product defects this wave keeps finding:
an assertion loose enough to pass on the wrong thing.

1. **A wrong endpoint reported a pass.** The harness posted to
   `/workflows/{id}/run`, which does not exist, and its condition was "any
   4xx" — so `RESOURCE_NOT_FOUND` counted as *the engine being down was handled
   correctly*. The check now rejects 404 explicitly.
2. **An active status counted as terminal.** "Not RUNNING and not QUEUED" let
   `DISPATCHING` through. It now asserts against the product's own
   `TERMINAL_EXECUTION_STATUSES`. **This correction is what exposed D-W0-11** —
   with the loose assertion, 0D reported 9/9 and a real ADR-010 violation went
   unseen.
3. **A 404 counted as engine health being reported.** Same shape again, on a
   path that does not exist. It now calls `/api/v1/engine/status` and asserts
   the engine is actually reported as unhealthy.

---

## Observations, not defects

**O-1 · A revoked credential is refused before dispatch, which is better than
0A's spec expected.** The spec predicted a FAILED execution carrying a
credential code. The runtime fails to *compile*, so no execution record is
created for a run that could never have worked, and the diagnostic names the
node and the field (`CREDENTIAL_REQUIRED`, `node_id`, `field`). The product
surface is a 422 `WORKFLOW_INVALID` whose remediation is `SHOW_INVALID_NODES`.
**The spec was corrected, not the behaviour.**

**O-2 · 200 with an empty body is an error rather than an empty item.** After
D-W0-01 it is at least actionable, but arguably an empty body on a 200 should
produce one empty item, as a bare 204 already does. Changing it means setting
the response format explicitly in the compiler, which changes behaviour for
every existing workflow — out of 0A's remit, worth a decision later.

---

## Counts

Reproduce with:

```bash
grep -c '^### D-W0-' docs/changes/003-wave-0-current-runtime-proof/DEFECT_INVENTORY.md
grep -c 'FIXED ·' docs/changes/003-wave-0-current-runtime-proof/DEFECT_INVENTORY.md
```

| | |
|---|---|
| Defects found, 0A | **9** |
| Defects found, 0B | **0** |
| Defects found, 0C | **1** |
| Defects found, 0D | **1** |
| **Total** | **11** |
| Fixed | **9** |
| Harness defects found and fixed (mine, not the product's) | 3 |
| Confirmed, not fixed (reason recorded, test present and skipped) | **2** |
| Observations | 2 |
| Spec expectations corrected | 1 |
