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

| Item | Detail |
|---|---|
| Build | The composition test layer (§5 of the stability matrix has no home today) and the reference-workflow harness that drives the **UI**, not the API |
| Write | Reference workflows **W01–W06** — all buildable on the 9 certified nodes |
| Close | Stability rows **§4.2–4.11, 4.15–4.17, 4.19** (HTTP status semantics) and **§2.3–2.5** (expression failures) |
| Estimate | **8–13 days** |

**Why first.** The frontend already ships labels and remediations for
`NODE_AUTHENTICATION_FAILED`, `NODE_RATE_LIMITED` and eight other codes, and
nothing asserts the engine ever emits them. That is the largest single block of
untested-but-user-visible behaviour in the product, and it needs no new node.

**Risk: medium-high, and the risk is discovery.** The likely outcome is that
Wave 0 *finds defects* — a status that maps to the wrong code, a remediation
that points nowhere, an empty stream reported as a failure. That is the point,
but it means Wave 0 can overrun in a way later waves cannot. Budget for a fix
tail, and do not schedule Wave 1 to start on Wave 0's last day.

**Exit:** W01–W06 green through the UI, and every HTTP status in §4 asserted
to a specific product error code.

---

## Wave 1 — Transform and flow control (3 nodes)

| Item | Detail |
|---|---|
| Certify | `item_lists` (as **one** product node with an operation field), `date_time`, `split_in_batches` |
| Write | **W07, W09, W10, W12** + the composition pairs 5.1–5.8, 5.11, 5.12 |
| Estimate | **10–15 days** |

**Why these three together.** They are the pack with no new credential type, so
the wave is pure node work — it does not wait on the credential framework. And
`item_lists` alone unblocks five of the fifteen reference workflows.

**Risks.**

- **`split_in_batches` is the genuinely hard one.** It loops by feeding items
  back into the graph and therefore depends on the compiler's pinned execution
  order (ADR-023). A loop that runs twice instead of once produces plausible
  output, which is why W08/W12 assert per-iteration item counts rather than a
  final result. If this node misbehaves it is a compiler investigation, not a
  mapper fix. **Certify it last in the wave, and treat a 3–5 day overrun here
  as expected rather than as a slip.**
- `item_lists` has six operations behind one schema — six mappers and six
  golden tests, not one. The estimate reflects that; a naive reading of "three
  nodes" does not.
- **Low** risk on `date_time` beyond timezone arithmetic, which the backend
  already tests for schedules.

**Exit:** the four workflows green, loop termination asserted.

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

## Wave 4 — Chaos, concurrency and scale

| Item | Detail |
|---|---|
| Close | §6.2–6.6 (engine and worker chaos), §6.13–6.17 (concurrency), §7.2–7.7 (scale budgets) |
| Write | **W08, W15** — held to this wave because both need the loop *and* a killed engine |
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

| Wave | Days | Dominant risk |
|---|---|---|
| 0 — prove what we have | 8–13 | Discovery: it will find defects |
| 1 — transform / flow | 10–15 | `split_in_batches` and the compiler |
| 2 — credential types | 6–10 | Security, not schedule |
| 3 — integration | 10–14 (+4–6) | A product decision on retry side effects |
| 4 — chaos / scale | 8–12 | May surface an architectural defect |
| **Total** | **42–64 days** | |

That is roughly **two to three months of focused work** for one engineer to
move from "9 nodes, single-node tests" to "16 nodes, fifteen reference
workflows, chaos and concurrency asserted".

**The number to argue with is not the total — it is Wave 0.** If Wave 0 comes
back clean, the current product is more stable than this audit assumes and the
later waves get cheaper. If it comes back with defects, we have learned that
before building on top, which is the entire reason it is first.
