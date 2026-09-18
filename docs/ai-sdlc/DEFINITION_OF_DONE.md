# Definition of Done

Done is a claim about evidence, not about effort. Code being written and
compiling is the beginning of the checklist, not the end of it.

Every item is **Yes**, **No**, or **N/A with a reason**. The third is
legitimate and common — but "not applicable" and "nobody checked" must never
produce the same mark. If you cannot say which one an item is, it is No.

---

## 1. The change is specified

| | Item |
|---|---|
| ☐ | For substantial work, `intent.md`, `spec.md`, `plan.md` and `acceptance.md` exist under `docs/changes/<change>/` |
| ☐ | The implementation matches `plan.md`, or every deviation is written into `plan.md` with its reason |
| ☐ | Nothing outside the declared scope was built; nothing inside it was quietly dropped |

Small obvious fixes may skip the artefacts — but not the verification below.
"Small" describes the diff, never the amount of checking.

## 2. It is verified

| | Item |
|---|---|
| ☐ | `ruff check app tests` and every typecheck pass |
| ☐ | The unit and integration suites for every area the diff touches pass |
| ☐ | `python scripts/guardrails.py` passes |
| ☐ | `python scripts/verify.py full` has been run, and its result is recorded **verbatim** in `review.md` |
| ☐ | Every stage reported **PASS / FAIL / NOT RUN** — no stage that did not execute is described as passing |
| ☐ | `python scripts/evidence.py status` shows the relevant records **CURRENT**, i.e. matching `scripts/repo_fingerprint.py`'s value right now, not from an earlier point in the session |

A `full` run that skipped stages is not a green repository. Say which stages
did not run and why. **A verification run recorded before the last edit is not
evidence about the diff being delivered** — re-run it. This is not a manual
discipline to remember: `scripts/completion_gate.py` checks it before allowing
a completion claim through, and will name exactly what is stale.

## 3. Engine behaviour changed?

| | Item |
|---|---|
| ☐ | The contract suite passes against the **real pinned runtime** — no engine mocks |
| ☐ | Assertions are on the normalized product DTO, never on `IRun` |
| ☐ | `python scripts/certify.py --check` passes |
| ☐ | A new node has **all nine** certification pieces (`/engine-node`) |
| ☐ | No n8n version, lockfile, `compatibility.yaml` or `node-lock.json` moved — or, if it did, it is an approved engine migration with its own change artefact and a compatibility analysis (ADR-013) |

## 4. The schema changed?

| | Item |
|---|---|
| ☐ | The migration applies, `downgrade base`, and re-applies |
| ☐ | `alembic check` is clean |
| ☐ | `python scripts/schema_drift.py` was run against a real migrated database — one head is a claim, the drift report is the evidence |
| ☐ | No engine identifier reached the schema (guardrail 5) |
| ☐ | No applied migration was edited in place |

## 5. Security and tenancy

| | Item |
|---|---|
| ☐ | Security implications reviewed (REVIEW.md dimension 6) — mandatory for credentials, auth, webhooks, egress, secrets, tenancy |
| ☐ | Every new or changed tenant-scoped query names `workspace_id`; any allow-list addition carries a written reason |
| ☐ | No plaintext secret can leave through a product-facing response |
| ☐ | No masked or redacted value can become execution input |
| ☐ | Redaction remains in **both** layers; no security check, rate limit or egress guard was removed |
| ☐ | No commercial-release or licence gate was weakened |

## 6. UI changed?

Three separate kinds of evidence, none a substitute for another (see
`.claude/skills/ui-review/SKILL.md`):

| | Item | Evidence kind |
|---|---|---|
| ☐ | Typecheck, component tests, build, `11-appearance.spec.ts` pass | UI_STRUCTURAL |
| ☐ | Screenshots actually captured, at 1440×900, 1280×800 and 390×844 | UI_VISUAL |
| ☐ | Screenshots actually opened and read; findings recorded; re-inspected after fixes | UI_VISUAL |
| ☐ | The real deployed flow walked as a user would, not asserted through the API | UI_JOURNEY |
| ☐ | Every state reviewed: initial, loading, empty, populated, long content, validation error, API failure, permission denied, disabled, engine unavailable | UI_VISUAL |
| ☐ | Errors are actionable — `remediation.action` reaches somewhere useful | UI_VISUAL / UI_JOURNEY |
| ☐ | Design-system primitives and tokens used; nothing renders below 12px after ancestor transforms | UI_STRUCTURAL |
| ☐ | Every user-visible string is in `i18n.ts`, in both locales | UI_STRUCTURAL |

**A green UI_STRUCTURAL row is not "UI verified."** Component tests passing
and a build succeeding prove the code compiles and the measured invariants
hold; they say nothing about whether a human looked at the result or whether
the flow makes sense. Do not report "UI complete" — or let
`review/ui-reviewer` evidence be treated as current — unless UI_VISUAL and (for
a flow, not a copy tweak) UI_JOURNEY evidence exist too. If the application
could not be run, that is `--status PARTIAL` from the `ui-reviewer` agent and
**NOT DONE for the UI dimension**, not a pass by default.

A component that renders is not a finished feature.

## 7. Tests

| | Item |
|---|---|
| ☐ | Changed behaviour has a changed or added test |
| ☐ | A fixed bug has a regression test, and it was **watched failing** before the fix |
| ☐ | The test lives where the defect is actually observable |
| ☐ | **No test was deleted, skipped or weakened to obtain a pass.** If one was legitimately removed, `review.md` names the spec change that made it obsolete |

## 8. Reviewed

| | Item |
|---|---|
| ☐ | The reviewers mandatory for this kind of change have run (REVIEW.md), each ending in `scripts/record_review.py` |
| ☐ | Every recorded review's fingerprint matches the current one — a review stamped for an earlier diff is stale, even if the finding it raised was fixed |
| ☐ | If a fix was made in response to a finding, the relevant reviewer ran **again** on the result (REVIEW.md's review-fix-review loop) |
| ☐ | Review was done with fresh perspective, not by re-reading your own reasoning |
| ☐ | **No BLOCKER is open** |
| ☐ | Every IMPORTANT finding is fixed, or documented with a reason **and an owner** |
| ☐ | No finding was downgraded to close the checklist |

## 9. Operations and documentation

| | Item |
|---|---|
| ☐ | New metric, alert or runbook section added if the change creates a failure mode somebody must respond to; every alert names a runbook section that exists |
| ☐ | Auditable actions write an audit entry |
| ☐ | An architectural decision is recorded as an ADR, including what was rejected |
| ☐ | README / rules / templates updated if the change alters how the repository is worked in |

---

## Reporting

The report is part of the deliverable. State:

1. what was built, and whether it matches the plan;
2. the verification result, per stage, as PASS / FAIL / **NOT RUN**;
3. every open finding, with severity;
4. what is deferred, why, and who carries it;
5. whether it is Done.

If it is not Done, say so and say what remains. A truthful "not Done, the
browser suite did not run because Docker is unavailable" is worth more than a
confident "implementation complete" — the second is the failure this whole
harness exists to make harder.
