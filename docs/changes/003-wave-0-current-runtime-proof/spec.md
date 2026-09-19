# Spec — Wave 0: Current Runtime Proof

Scope is the stability matrix
(`docs/changes/002-capability-audit/WORKFLOW_STABILITY_MATRIX.md`) at
fingerprint `1bdb2584ecc2`: 73 numbered rows, 21 OK / 11 PART / 41 GAP.

## 0A — HTTP status and expression semantics

### 0A.1 HTTP (matrix §4)

Every row of §4. For each, the assertion is the **whole chain**, not a terminal
status:

```
engine outcome -> product error code -> remediation.action -> what the UI renders
```

| Case | Required product behaviour |
|---|---|
| 200 JSON | SUCCEEDED, items parsed |
| 200 text/plain | SUCCEEDED, one item, body as string — **not** a parse error |
| 200 invalid JSON | A classified error, not an engine exception |
| 204 no content | SUCCEEDED, one empty item |
| 400 | Classified as configuration, not auth |
| 401 | `NODE_AUTHENTICATION_FAILED` + `UPDATE_CREDENTIAL` remediation |
| 403 | Authentication family, remediation distinct from 401 |
| 404 | Configuration, not auth |
| 409 | Classified, not a generic 5xx shape |
| 429 | `NODE_RATE_LIMITED` |
| 500 | Upstream failure, distinct from a configuration error |
| timeout | `NODE_TIMEOUT` |
| DNS failure | Classified, names the host |
| connection refused | Classified |
| redirect followed | Succeeds within `max_redirects` |
| **redirect to a private address** | **Refused.** Security-relevant: the egress guard blocks a direct private address; a public URL that 302s to `169.254.169.254` is the real SSRF shape |
| response over the size ceiling | Refused, classified |
| continue-on-error | Workflow proceeds past the failed node |
| credential revoked between publish and run | Classified error, not a crash |

A case that produces the right *status* with the wrong *code*, or the right
code with a remediation that resolves nowhere, is a **FAIL**.

### 0A.2 Expressions (matrix §2)

| Case | Required behaviour |
|---|---|
| Runtime evaluation failure (`.toUpperCase()` on a number) | `EXPRESSION_EVALUATION_FAILED` |
| Reference a node on a skipped branch | Classified, actionable — not a crash |
| Reference a nonexistent node | Caught at **validation**, before publish |
| `null` present in a referenced field | Distinct from a missing path |
| Nested value `$json.a.b[0].c` | Resolves |
| Mixed types across items | Deterministic, documented |
| **2.8 — Fixed value containing expression syntax** | See below |

### 0A.3 Row 2.8 — the silent-expression decision

**Behaviour to implement**, decided in the stability matrix ("Row 2.8 in full"):

1. `services/graph.py` raises a **`WARNING`** issue when a Fixed (non-`=`)
   string config value contains `{{ … }}`, naming node and field. The rule
   lives in the domain, so the API and the worker honour it, not only the
   editor.
2. The editor renders an inline hint beside the Fixed/Expression toggle
   offering the switch.
3. **Publish is not blocked.** `{{ }}` inside a literal is legitimate for a
   templated body posted to a service that interpolates it downstream.
4. The mode is **not** auto-switched — that silently rewrites a URL on a guess.

**Acceptance:** a Fixed value containing expression syntax must not reach a
SUCCEEDED run without the user having been told.

## 0B — Composition, current nodes only

Pairs, all buildable on the nine certified nodes:

`http_request -> edit_fields` · `http_request -> if` · `if -> merge` ·
`switch -> merge` · `filter -> edit_fields` · **filter to zero results** ·
`multi-item -> branch -> merge` · `continue-on-error -> downstream`

**Every assertion names the item count at every node**, via
`node_results[].output_preview`. A final-output assertion alone is not
acceptable evidence: a branch that silently drops or duplicates items produces
a plausible final result.

## 0C — Reference workflows through the UI

W01–W06 and W08a from `REFERENCE_WORKFLOWS.md`, each asserting: per-step item
count, actual field content, branch taken, execution state, error state where
applicable, retry behaviour, and history/preview.

**Seeding a graph through the API is not acceptance evidence for 0C.** Every
existing browser spec seeds through the API, which is exactly why nobody had
looked at the graph the product creates for you, and five real defects lived
there (001's defect inventory). Where a workflow cannot yet be built through
the UI, that is a **finding**, not a reason to seed it.

## 0D — Engine loss

Against the real deployed images, not a mocked adapter.

| Scenario | Required |
|---|---|
| Engine down **before** Run | Dispatch fails cleanly; `ENGINE_UNAVAILABLE`; the product stays readable and says runs are paused |
| Engine **killed mid-run** | The execution does not remain `RUNNING`; the reconciler moves it to `ENGINE_INTERRUPTED`; the UI explains it |
| Engine **restarted** | The interrupted run does not silently resume or duplicate; a **new** run succeeds |

This verifies ADR-010's reconciler, which has never been exercised against a
real kill.

## Defect handling

Every defect follows the same path, in order:

```
reproduce -> regression test (watched failing) -> root cause -> fix
         -> targeted verify -> re-run the actual scenario
```

A fix from code inspection alone, or a regression test written after the fix
and never seen red, does not count (`.claude/rules/testing.md`).

## Non-goals

No new node. No engine version change. No credential types. No performance
work. No weakening of any existing assertion to obtain a pass — if a matrix row
turns out to be a wrong expectation, the correction is argued here in spec,
then applied.
