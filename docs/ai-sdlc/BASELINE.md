# Baseline audit

**Date:** 2026-09-18 · **Commit:** `10a59c5` · **Branch:** `master` ·
**Product version:** 1.0.0 (`v1.0.0-rc1`) · **Engine:** n8n 1.14.1

Established while bootstrapping the AI-native SDLC harness. Every row cites
evidence from a command actually run on this machine, or says **NOT RUN**.

Environment: Docker 27.4.0 with the container stack up (api ×3, worker,
engine, postgres, frontend), kubectl v1.30.5, Python 3.12, Node 22.

---

## Summary

This repository is in **unusually good health**. It is not a prototype with a
test suite bolted on: 362 automated tests across four suites plus 118 browser
scenarios, 31 ADRs recording what was rejected, architectural rules enforced by
CI greps and AST walks rather than convention, and artefact tests that check the
deployment rather than only the code.

What it did **not** have, before this bootstrap, was a development harness: no
`CLAUDE.md`, no `.claude/`, no scoped rules, no reviewers, no change-artefact
discipline, no single verification entry point, and no Definition of Done. The
engineering was strong and entirely undocumented as a *process*.

Three real defects were found and fixed while bootstrapping (§ Harness defects).
All three were in the SDLC wiring, none in the product.

---

## Area matrix

| Area | State | Evidence | Risk | Required action |
|---|---|---|---|---|
| **Development harness** | **WAS FAIL → now PASS** | No `CLAUDE.md`, no `.claude/` existed. Now: constitution, 6 scoped rule files, 5 skills, 4 reviewers, DoD, templates, `verify.py`, `guardrails.py`, a `PreToolUse` guard proven to fire | — | none; keep it current as the code moves |
| **Backend** | **PASS** | `260 passed in 2.45s`; `ruff` clean (after fixing 2 errors); migration round-trip, `alembic check` and `schema_drift.py` all PASS against the live database | low | none |
| **Frontend** | **PASS** | typecheck, lint, 34 component tests, `next build` — all PASS | low | none |
| **Engine** | **PASS** | typecheck, build, **68 contract tests against the real pinned runtime**, `certify.py --check` PASS. Live `/readyz` reports `n8n-core@1.14.1` — the pin is real at runtime, not only in a manifest | low | none |
| **Node contracts** | **PASS** | 9 of 294 available nodes certified, each with registry entry, schema, compiler mapper, pinned allowlist entry, golden test and both locales. `certify.py` cross-checks registry ↔ compatibility ↔ installed tree ↔ compiler | low | new nodes via `/engine-node` only |
| **E2E** | **NOT RUN** (this session) | 118 scenarios across 12 specs exist and are wired into CI. Not executed here: the suite runs serially against the images and would mutate the running dev stack | **medium — unverified today** | run `verify.py full` on a disposable stack before the next release |
| **CI** | **WAS FAIL → now PASS** | Two real defects, both fixed (§ below). 7 jobs; YAML parses; guardrails consolidated to one runnable script | low | confirm the first `master` push actually triggers |
| **Deployment** | **PASS** | manifest/alert/production-doctor tests PASS; unedited production template correctly **refused**; `docker compose config` and `kubectl kustomize` PASS. Live `docker compose ps`: engine exposes `8099/tcp` with **no host mapping** — guardrail 15 confirmed in the running deployment | low | none |
| **Security** | **PASS, with two carried exceptions** | Secrets never echoed (contract + smoke); redaction in both layers; HMAC + replay + constant-time on `/hooks`; egress guard; tenant isolation by AST walk and 12 asserted cross-tenant routes. **ADR-030 carries two exceptions for the internal pilot: no row-level security, and the second gap recorded there** | **medium** | neither exception survives opening to customers; re-open ADR-030 before that decision |
| **Licensing** | **BLOCKED, correctly** | `commercial_gate: NOT_REVIEWED`; `release_gate.py --delivery commercial` refuses, and CI asserts the refusal | **high for commercialisation** | a legal review is a prerequisite for any non-internal delivery. Not an engineering task |
| **UX completion** | **PASS, with a caveat** | Appearance asserted at 3 viewports with 12 pixel baselines and measured invariants (overflow, 12px floor after transforms, canvas share). 9 UX defects previously found by *looking* and fixed | low | the screenshots still have to be looked at; assertions cannot see "no focal point" |

---

## Product journeys

| Journey | State | Evidence |
|---|---|---|
| Sign in, forced password change | COMPLETE | `02-auth.spec.ts`, smoke, clean-install |
| Build a graph on the canvas | COMPLETE | `03-editor.spec.ts` (14), `test_new_workflow_seed.py` |
| Run a draft, read real output | COMPLETE | smoke (39 checks); expressions asserted to resolve against real data |
| Publish → activate → rollback | COMPLETE | `04-lifecycle.spec.ts`; smoke proves v1 unchanged after a draft edit |
| Trigger a real execution (webhook, schedule) | COMPLETE | `06-triggers-ops.spec.ts`, `demo_webhook.py` incl. unsigned and replay refusals |
| Execution history and failure diagnosis | COMPLETE | `06-triggers-ops.spec.ts`; a deliberately-failing seeded workflow exists so the error screen is exercised |
| Credentials, secret never echoed | COMPLETE | `05-credentials-rbac.spec.ts`, smoke |
| Multi-tenant isolation | COMPLETE | `07-tenancy.spec.ts` (17), incl. `X-Workspace-Id` spoofing |
| Idempotency and rate limits at 2 replicas | COMPLETE | `08-idempotency-limits.spec.ts` (8) |
| Members, invite, role change, revoke | COMPLETE | `10-members.spec.ts` (9) |
| Operations: doctor, drift, backup, restore | COMPLETE | `09-operations.spec.ts` (11) |
| Clean install from an empty volume | COMPLETE | `clean-install.spec.ts`, CI job |
| **All of the above, verified today** | **NOT TESTED** | the browser suite did not run in this session |

Every journey has coverage that exists and is wired into CI. What this session
can attest to is that the code, the contracts and the deployment artefacts pass;
it cannot attest that the browser suite is green *today*, because it was not run.

---

## Harness defects found and fixed

All three were in the SDLC wiring. None was a product defect.

### 1. CI gated a branch that does not exist — **the repository was ungated**

`ci.yml` had `push: branches: [main]`. The default branch, locally and on the
remote, is `master`. **No push to the default branch has ever triggered CI.**
Pull requests still ran, so the repository looked green while its most important
trigger was dead — precisely the defect that hides behind a badge.

Fixed: the trigger names `master`. Guarded: `guardrails.py` now compares the
push trigger against `.git/HEAD`, so this cannot silently recur.

### 2. The `.ee` guardrail failed on the comment documenting it

CI's ADR-015 step grepped for the text `.ee.` anywhere in `backend`, `frontend`
and `workflow-engine/src`. It matched `binary-data.ts:23` — a comment explaining
why that file deep-imports `BinaryData.service` instead of the package root,
and naming the contract test that enforces it. Reproduced exactly:

```
$ grep -rIln --include='*.ts' --include='*.py' -E "\.ee\." backend frontend workflow-engine/src
workflow-engine/src/runtime/binary-data.ts
```

**The `guardrails` job failed on every pull request.** The comment documenting
the rule broke the check enforcing it — and the repository's own stated
principle is that a check failing on prose gets switched off within a week.

Fixed: the check matches module specifiers (`import`/`require`/`from` paths
ending in `.ee`), not arbitrary text. The runtime guarantee was never affected —
`no-enterprise-source.test.ts` runs a real execution and asserts nothing
matching `.ee.` reaches `require.cache`.

### 3. `ruff` failed on `master`

Two unused imports (`pathlib` in `test_production_doctor.py:336`, `argparse` in
`test_release_gate.py:168`). The backend job's Lint step would have failed. Both
were genuinely unused locals; removing them touched no assertion.

Together, defects 1–3 mean **CI was failing or not running on the default
branch**. The product was healthy; the thing that was supposed to prove it was
not.

---

## Also changed, and why

The `guardrails` CI job was seven inline shell greps, runnable only by pushing.
They are now one script, `scripts/guardrails.py`, called by both CI and
`verify.py` — one definition of the rules, runnable locally and on Windows, and
it prints the offending file and line. It gained two checks the greps did not
have: the frontend carries no engine address (guardrail 1), and CI's push
trigger names the default branch.

---

## Known product-level gaps

Not defects found here — positions the repository takes deliberately, recorded
so they are not mistaken for oversights.

| Gap | Where recorded | Status |
|---|---|---|
| No row-level security; tenant scoping by query + AST walk + composite FK | ADR-030 | deliberate, internal pilot only |
| The second security exception carried into the pilot | ADR-030 | deliberate, internal pilot only |
| `commercial_gate: NOT_REVIEWED` — SUL covers internal delivery only | ADR-015 | blocks commercial release, correctly |
| 285 of 294 nodes uncertified | `docs/node-catalog-backlog.md` | deliberate; tiered backlog exists |
| Code node, community nodes, arbitrary execution disabled | ADR-014 | deliberate |
| Wait/resume and long-lived execution out of scope | guardrail 14 | deliberate |
| SheetJS resolves off-registry (1 of 896 lockfile entries) | `mirror_bundle.py` | needs explicit internal-registry publication |

## Invariants standing on documentation alone

From [ARCHITECTURE_INVARIANTS.md](ARCHITECTURE_INVARIANTS.md) — the thin places,
and the best candidates for the next guard:

- a redacted value becoming execution input (ADR-027) — nothing prevents it;
- a second product-graph → n8n translation site appearing outside the compiler;
- Publish and Activate becoming coupled;
- an `engine_binding` leaking into a non-admin response (guardrail 9).

---

## Verification run for this baseline

| Command | Result |
|---|---|
| `verify.py quick` | **PASS** — 9/9 stages, 53s |
| `verify.py targeted backend` (with `DATABASE_URL`) | **PASS** — 6/6 incl. migration round-trip, `alembic check`, no drift |
| `verify.py targeted frontend` | **PASS** — 5/5 incl. `next build` |
| `verify.py targeted engine` | **PASS** — 5/5 incl. 68 contract tests, `certify.py --check` |
| `verify.py targeted deployment` | **PASS** — 5/5 incl. the refused production template, kustomize render |
| `verify.py targeted backend` (no `DATABASE_URL`) | **exit 2, SKIP reported** — confirms an incomplete run is not called green |
| `guardrails.py` | **PASS** — 8 checks, warns that `commercial_gate` is `NOT_REVIEWED` |
| `verify.py full` | **NOT RUN** — would execute the 118-scenario browser suite against the running dev stack and mutate its data |
| `scripts/smoke.py` | **NOT RUN** — same reason |

**The browser suite and the smoke suite were not run in this session.** They are
the two that catch defects existing only in the deployed shape, so this baseline
is evidence about the sources, the contracts and the deployment artefacts — not
about today's running deployment.
