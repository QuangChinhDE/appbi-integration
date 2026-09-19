# Review — <change name>

> Filled in during review, not after. This is the record of what was checked and
> what was decided — including what was not fixed.

## Reviewers run

> | Reviewer | Run? | Findings |
> |---|---|---|
> | product-reviewer | | |
> | architecture-reviewer | | |
> | qa-reviewer | | |
> | ui-reviewer | | |
> | security review | | |
>
> Mark anything genuinely inapplicable **N/A with a reason**. "Not applicable"
> and "nobody looked" must not produce the same table.

## Dimensions

> The eleven in REVIEW.md — which applied, and the result.
>
> | # | Dimension | Result | Note |
> |---|---|---|---|

## Findings

> Every finding, most severe first, each with its resolution. Do not delete a
> finding once fixed; the record is the point.
>
> ### [BLOCKER] …
> - **Where:**
> - **Violates:**
> - **Why it matters:**
> - **Resolution:** fixed in … / **still open**
>
> ### [IMPORTANT] …
> - **Resolution:** fixed / **deferred**
> - If deferred: the reason, **who carries it**, and what a user experiences
>   until it is fixed. An IMPORTANT finding with no owner is not deferred — it
>   is dropped.
>
> Findings may not be silently downgraded. If you think a severity is wrong, say
> so explicitly and leave the finding visible.

## Residual risks

> What is knowingly imperfect, and what stands in for it. **Any test removed or
> disabled goes here**, prominently, with what now covers the behaviour.

## Verification

> The verbatim output of the final run. Every stage as **PASS / FAIL / NOT RUN**
> — never describe a command that did not execute as passing.
>
> ```
> $ python scripts/verify.py full
> …
> ```

## Done?

> - [ ] no BLOCKER open
> - [ ] every IMPORTANT fixed, or documented with an owner
> - [ ] the acceptance journey was walked in the running product
> - [ ] UI looked at, if UI changed
> - [ ] docs / ADR updated, if a decision was made
> - [ ] verification reported truthfully, SKIPs included
>
> **Status:** Done / not Done — and if not, what remains.
