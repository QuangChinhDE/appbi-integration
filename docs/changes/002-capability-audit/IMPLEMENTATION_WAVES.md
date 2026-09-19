# Implementation waves

Order, estimate and risk for closing the capability and stability gaps.
All waves assume the engine stays at **1.14.1**
(`ENGINE_VERSION_RECOMMENDATION.md`).

**Estimates are ranges in working days**, and they are estimates — the only
figure grounded in measurement is Wave 1's, because the nine existing nodes
were certified through the same eight-step process. Treat everything else as
planning input, not commitment.

---

## The ordering principle

Two orderings were possible, and the obvious one is wrong.

The obvious one: certify nodes first (visible progress, a bigger picture in the
node picker), then test. That reproduces exactly the failure you described —
a bigger catalogue whose combinations nobody has run.

The one below: **build the test layer that can catch composition defects
before there are combinations to catch.** Wave 0 also settles the question of
whether the *current* nine-node product is stable, which is unanswered today
and cheap to answer. If Tier-1 reference workflows fail, that is a finding
about the product we have shipped, and it should not be discovered underneath
seven new nodes.

---

## Wave 0 — Prove the product we already have

**Nothing new is certified. This is the wave that tests your hypothesis.**

**Approved, and scoped as below.** The goal is one sentence: *prove or break the
current nine-node product.*

| Item | Detail |
|---|---|
| Build | The composition test layer (§5 of the stability matrix has no home today) and the reference-workflow harness that drives the **UI**, not the API |
| Write | Reference workflows **W01–W06 and W08a** — all buildable on the 9 certified nodes |
| Close | HTTP semantics, expressions, current-node composition and basic engine loss — enumerated below |
| Estimate | **11–17 days** (raised from 8–13 by the expanded scope) |

### Wave 0.1 — HTTP semantics

Every case in §4 of the stability matrix: 200 JSON, 200 text/plain, 204,
invalid JSON body, 400, 401, 403, 404, 409, 429, 500, timeout, DNS failure,
connection refused, redirect, **redirect to a private address**, large
response, continue-on-error, credential revoked mid-flight.

**Each asserts the whole chain, not a terminal status:**

```
engine outcome -> product error code -> remediation -> what the UI shows
```

A case that ends FAILED with the wrong code, or the right code with a
remediation pointing nowhere, is a defect — not a pass. This is the block where
the product currently ships ten error-code labels and ten remediations that
nothing proves the engine ever emits.

### Wave 0.2 — Expressions

At minimum: runtime evaluation failure (valid syntax, bad operation), a
reference to a **skipped branch**, a reference to a **nonexistent node**, a
`null` value present in a referenced field, a nested value (`$json.a.b[0].c`),
and mixed types.

Plus **row 2.8, the silent-expression case**, which is a product decision
before it is a test. Writing `http://host/item/={{ $json.id }}` (the `=`
mid-string rather than leading) sent the braces to the server as literal text
and returned **200 / SUCCEEDED with wrong data**. The frontend infers
Fixed-vs-Expression from `value.startsWith('=')`, so a Fixed value carrying
`{{ }}` is indistinguishable from an intentional literal.

The chosen behaviour (reasoning in the stability matrix, "Row 2.8 in full") is
a **graph-validation `WARNING`** in `services/graph.py` — where the rules live,
so the API and worker honour it too — plus an inline hint beside the
Fixed/Expression toggle. Publish is *not* blocked: `{{ }}` in a literal is
legitimate for a templated body.

**Acceptance for this row:** a Fixed value containing expression syntax must
not reach a SUCCEEDED run without the user having been told.

### Wave 0.3 — Composition, current nodes only

Risk-based, asserting **item count at every step** rather than final output:
HTTP -> Edit Fields; HTTP -> IF; IF -> Merge; Switch -> Merge; Filter -> Edit
Fields; **Filter to zero results**; multi-item -> branch -> merge;
continue-on-error -> downstream.

### Wave 0.4 — Basic engine loss (pulled forward from Wave 4)

Not the full chaos wave, but the architecture already *claims* the reconciler
handles engine loss (ADR-010), and that claim has never been exercised. Three
scenarios: **engine down before Run**, **engine killed mid-run**, **engine
restart**.

Expected in each: the execution does not stick in `RUNNING`; the state
transitions correctly; the product stays readable; the UI says plainly that the
engine is unavailable or the run was interrupted; and after recovery a new run
succeeds. This verifies existing architecture and depends on no new node.

**Why first.** The frontend already ships labels and remediations for
`NODE_AUTHENTICATION_FAILED`, `NODE_RATE_LIMITED` and eight other codes, and
nothing asserts the engine ever emits them. That is the largest single block of
untested-but-user-visible behaviour in the product, and it needs no new node.

**Risk: medium-high, and the risk is discovery.** The likely outcome is that
Wave 0 *finds defects* — a status that maps to the wrong code, a remediation
that points nowhere, an empty stream reported as a failure. That is the point,
but it means Wave 0 can overrun in a way later waves cannot. Budget for a fix
tail, and do not schedule Wave 1 to start on Wave 0's last day.

**Exit — the ten deliverables:**

1. W01–W06 and W08a run for real **through the UI**.
2. HTTP status / error matrix, actual results.
3. Expression matrix, actual results.
4. Current-node composition matrix, actual results.
5. Basic engine-loss test results.
6. A bug inventory of everything Wave 0 found.
7. **PASS / FAIL / NOT RUN per row, no inference.** A row that could not run is
   NOT RUN, never a pass.
8. The current repository fingerprint the evidence was recorded against.
9. A revised Minimum Practical Node Catalog based on what actually happened.
10. A re-estimate of Waves 1–4.

**No new node is certified in Wave 0.** The objective is not functionality.

---

## Wave 1 — Transform and flow control (3 nodes)

| Item | Detail |
|---|---|
| Certify | `item_lists` (as **one** product node with an operation field) and `date_time`. **`split_in_batches` has been removed from this wave** |
| Write | **W07, W08b, W09, W10** + the composition pairs 5.3–5.8, 5.11, 5.12 |
| Estimate | **7–11 days** (reduced — the riskiest node left the wave) |

**Why these two together.** They are the pack with no new credential type, so
the wave is pure node work and does not wait on the credential framework.
`item_lists` alone is needed by four of the fifteen reference workflows.

**`split_in_batches` moved to Wave 3b** on the spike's evidence
(`SPIKE_FANOUT_FINDINGS.md`): basic fan-out does not need it, so it is the
highest-risk node in the catalogue attached to the lowest necessity. Only W12
requires it.

**Risks.**

- `item_lists` has six operations behind one schema — six mappers and six
  golden tests, not one. The estimate reflects that; a naive reading of "two
  nodes" does not.
- **Low** risk on `date_time` beyond timezone arithmetic, which the backend
  already tests for schedules.
- Overall this is now the **lowest-risk** build wave, which is a direct result
  of having spiked before planning.

**Exit:** W07, W08b, W09, W10 green through the UI.

---

## Wave 2 — Credential-type framework

**Not node work, and the wave most likely to be skipped and then regretted.**

| Item | Detail |
|---|---|
| Build | Product credential types beyond today's four HTTP-flavoured shapes: `POSTGRES` (host/port/db/user/password/**ssl**) and `SMTP` |
| Each needs | A product schema, the encrypted store, the *describe-do-not-disclose* validation path (ADR-016), a health check, and both locales |
| Write | Nothing user-facing — the wave's evidence is security review plus the existing redaction contract tests extended to the new shapes |
| Estimate | **6–10 days** |

**Why separate.** Discovering this mid-batch is the standard way an
integration wave doubles. Doing it once, deliberately, in front of a security
reviewer, is cheaper than twice under pressure.

**Risk: medium, and it is security risk rather than schedule risk.** These are
the first credential shapes that are not a header or a token, and §2.7 of the
stability matrix (an expression in a credential-bearing field) is unclosed.
This wave **must** go through the security reviewer, not only the QA reviewer.

---

## Wave 3 — Integration (2–3 nodes)

| Item | Detail |
|---|---|
| Certify | `postgres`, `email_send`, `xml` (`xml` needs no credential and rides along cheaply) |
| Decide first | **Which of `slack` / `google_sheets` the pilot customer actually wants** — the matrix deliberately does not guess |
| Write | **W11, W13, W14** + composition pairs 5.13–5.19 |
| Estimate | **10–14 days**, plus 4–6 if a SaaS node is added |
| Blocked on | Wave 2 |

**Risks.**

- **`email_send` carries a product decision, not just a certification**: what
  does retrying a failed execution do when step 3 already sent the email?
  `Idempotency-Key` protects the execution, not a third-party effect. **Answer
  this before certifying, not during.** W14 exists to hold the answer.
- `postgres` is the first node that writes to a customer system. An upsert
  that duplicates on the second run is the failure mode, and W13 asserts
  against it.
- **Medium** risk overall; the credential work is already out of the way.

---

## Wave 3b — `split_in_batches`, on its own

| Item | Detail |
|---|---|
| Certify | `split_in_batches` |
| Write | **W12** + composition pairs 5.1, 5.2 |
| Estimate | **3–5 days** |

**Why it is alone, and why it is this late.** The spike proved basic fan-out
does not need it, so its remaining justification is batching under a rate limit
and controlled loops — valuable, not foundational. Meanwhile it is the only
node in the catalogue whose semantics can break the compiler's pinned execution
order (ADR-023), and a loop that runs twice produces plausible output rather
than an obvious failure.

Isolating it means a problem here is diagnosed against a stable catalogue
instead of being tangled with two other new nodes. **Risk: high per day, but
few days, and nothing downstream is blocked on it.**

## Wave 4 — Chaos, concurrency and scale

| Item | Detail |
|---|---|
| Close | §6.2–6.6 (engine and worker chaos), §6.13–6.17 (concurrency), §7.2–7.7 (scale budgets) |
| Write | **W15** — held to this wave because it needs a long-running fan-out *and* a killed engine. (W08a's basic engine-loss case is already pulled forward into Wave 0.4) |
| Estimate | **8–12 days** |

**Why last among the build waves.** It needs the full catalogue to be
meaningful, and it needs infrastructure the other waves do not: killing a
container mid-run, driving two browser clients at once, generating 1000-item
fixtures.

**Risks.**

- **§6.16 — publish while a run is executing — is the one that could surface an
  architectural defect** rather than a test gap. Guardrail 17/18 says the
  running execution binds the old version; nothing proves it under concurrency.
  If that turns out to be wrong it is a BLOCKER and not a small fix.
- §6.2 is ADR-010's reason for existing and has never been exercised against a
  real kill. A reconciler that has never reconciled is a hypothesis.
- **High variance.** This wave is the most likely to find something that
  changes the plan.

---

## Wave 5 — Decisions deferred on purpose

Not scheduled. Listed so they are visibly deferred rather than forgotten.

| Item | Why it is not in waves 0–4 |
|---|---|
| `wait` node | Needs the **durable resume** decision first. `execution_stale_after_seconds: 120` means a correct long wait is currently reconciled to `ENGINE_INTERRUPTED`. Certify with a hard cap below the threshold, or design durability — do not certify it open-ended |
| Microsoft Excel / Teams | Genuinely blocked on OAuth2 refresh. Only worth it for a Microsoft-shop pilot customer |
| MySQL, GitHub, GitLab | Available and cheap, but no identified pilot need. Add opportunistically inside another wave |
| Node i18n | `node_registry.json` is Vietnamese-only, so an English-locale user already sees Vietnamese node names. Seven new nodes make an **existing** gap worse; they do not create it. Fix it as one piece, once |
| Engine migration | See `ENGINE_VERSION_RECOMMENDATION.md`, with the named triggers for revisiting |

---

## Totals and what they mean

| Wave | Days | Status | Dominant risk |
|---|---|---|---|
| 0 — prove what we have | 11–17 | **Approved** | Discovery: it will find defects |
| 1 — transform (`item_lists`, `date_time`) | 7–11 | Estimate only | Six operations behind one schema |
| 2 — credential types | 6–10 | Estimate only | Security, not schedule |
| 3 — integration | 10–14 (+4–6) | Estimate only | A product decision on retry side effects |
| 3b — `split_in_batches` | 3–5 | Estimate only | Loop semantics vs the compiler (ADR-023) |
| 4 — chaos / scale | 8–12 | Estimate only | May surface an architectural defect |
| **Indicative total** | **45–69 days** | | |

## These are not a delivery commitment

**Only Wave 0 is approved, and only Wave 0's estimate is being offered as
plannable.** Waves 1–4 are planning input. The agreed sequence is:

```
Wave 0  ->  defect inventory  ->  fix the current runtime
        ->  actual effort measured  ->  re-estimate Waves 1-4
        ->  then commit the capability roadmap
```

Wave 0 *is* the discovery wave, so its output is expected to move the other
numbers — possibly a long way. Two illustrations of how volatile they are:

- A single spike this week moved `split_in_batches` out of the first batch and
  took **3–4 days** off Wave 1 while adding a wave. That was one assumption,
  checked in an afternoon.
- If Wave 0 finds that HTTP statuses map to the wrong product error codes, the
  fix is in the error normalizer and the adapter — shared machinery every later
  wave depends on. That would raise Wave 0 and *lower* the rest.

The honest summary of the total is therefore: **roughly two to three months of
focused work for one engineer, with a confidence interval that Wave 0 exists to
narrow.** Re-estimating is a deliverable of Wave 0, not a renegotiation.
