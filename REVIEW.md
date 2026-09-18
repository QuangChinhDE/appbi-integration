# Review policy

What must be reviewed before a change is Done, by whom, and what a finding
obliges.

Review is not "does it compile" and it is not "does it look reasonable to the
person who wrote it". A reviewer holds the diff against the **intent, the spec,
the plan, the acceptance criteria and the repository's rules**, and actively
looks for reasons the change is incomplete or wrong.

## Fresh perspective is the point

For substantial work, run the reviewer agents in
[.claude/agents/](.claude/agents/) rather than re-reading your own work. Asking
the context that just wrote the code whether the code looks correct is not
review — it shares every assumption that produced the defect.

Reviewers are read-only by default. They report findings; they do not rewrite
the implementation. That separation keeps the finding legible, and stops a
reviewer from quietly fixing a symptom and reporting a pass.

## The eleven dimensions

Every change is reviewed against the dimensions that apply. Mark the rest
**N/A with a reason** — "not applicable" and "nobody looked" must not produce
the same checklist.

| # | Dimension | Question | Owner |
|---|---|---|---|
| 1 | Product correctness | can a user do the thing, end to end? | `product-reviewer` |
| 2 | Spec compliance | does the diff do what `spec.md` promised, and does it match `plan.md`? | `product-reviewer` |
| 3 | Architecture | guardrails, boundaries, adapter, lifecycle, one compiler | `architecture-reviewer` |
| 4 | Data integrity | immutable versions, frozen execution artefacts, migrations, no drift | `architecture-reviewer` |
| 5 | Tenancy | every tenant query names `workspace_id`; platform reach is distinct | `architecture-reviewer` |
| 6 | Security | secrets, redaction, webhook auth, egress, constant-time comparison, licence gates | security review — [rules/security.md](.claude/rules/security.md) |
| 7 | Failure handling | edge cases, races, duplicates, partial failure, recovery | `qa-reviewer` |
| 8 | Frontend completeness | every state, responsive, design system, **looked at** | `ui-reviewer` |
| 9 | Runtime semantics | contract tests against the real pinned runtime; normalized DTOs | `architecture-reviewer` |
| 10 | Regression risk | other callers of what changed; is there a test that would have failed? | `qa-reviewer` |
| 11 | Operations | metrics, alerts pointing at runbook sections that exist, audit entries | `architecture-reviewer` |

### Which are mandatory for what

| The change touches | Mandatory |
|---|---|
| any substantial feature | 1, 2, 3, 7, 10 |
| `backend/app/services/`, `models/`, `api/` | + 4, 5 |
| `backend/migrations/` | + 4, and the migration verification |
| `workflow-engine/` | + 9 |
| credentials, auth, `/hooks`, egress, secrets, tenancy | + 6 |
| `frontend/` | + 8, and `/ui-review` |
| a new node | 1–3, 6, 9, 10, and all nine certification pieces |
| dependency, pin, lockfile, `compatibility.yaml` | 3, 9, 6, and an approved engine-migration artefact |
| `deploy/`, `.github/workflows/`, `docker-compose.yml` | 3, 11 |
| removing or disabling a test | 10, and a written justification in `review.md` |

## Findings

Three severities. Every finding carries: the file and location, the requirement
or invariant violated, why it matters concretely, and a concrete remediation.

**BLOCKER** — the change is not ready. Non-negotiable.
A guardrail or ADR violated; the intended journey does not work; a cross-tenant
leak; a secret exposed; data loss; a stuck state with no exit; an unexplained
engine version or lockfile movement; a guard weakened or removed; a node
executable without its nine pieces.

**IMPORTANT** — must be **either fixed, or explicitly documented** in the change
artefact's `review.md` with:
- the reason it is being deferred — a real one, not "out of scope";
- who carries it;
- what a user experiences until it is fixed.

An IMPORTANT finding with no owner is not deferred. It is dropped.

**MINOR** — fix it or note it. Avoid style nitpicks unless they affect
maintainability or consistency with an established convention.

## The rule that this document exists for

> **A change is not ready while any relevant BLOCKER is open.**
>
> Findings may not be silently downgraded. If you believe a BLOCKER is
> mis-severity, say so explicitly, say why, and leave the finding visible.
> Re-labelling a finding so a checklist closes is a worse outcome than shipping
> the defect knowingly, because it destroys the record.

An agent that re-reads its own diff, decides the findings were overstated, and
reports "implementation complete" has done the one thing this harness was built
to prevent.

## Recording it

All findings, resolutions and residual risks go in
`docs/changes/<change>/review.md`, along with the verbatim output of the final
`python scripts/verify.py full` — including every stage that was **NOT RUN**.

A review with no findings is a legitimate result. Say what you checked, so the
next reader can tell it from a review that did not happen.

## Turning corrections into durable checks

When the same mistake happens twice, documentation has already failed. Escalate
it to something mechanical — a rule, a regression test, a guard, or an eval
case. See [docs/ai-sdlc/DEVELOPMENT_WORKFLOW.md](docs/ai-sdlc/DEVELOPMENT_WORKFLOW.md#when-a-correction-recurs).
