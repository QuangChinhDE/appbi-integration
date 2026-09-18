# e2e/

Playwright, driving the real interface against the **container images** — the
only suite that can catch a defect existing solely in the deployed shape of the
product. Read [.claude/rules/testing.md](../.claude/rules/testing.md).

@../.claude/rules/testing.md

Runs one test at a time on purpose: the per-workflow concurrency ceiling is one.
Do not parallelise it.

Seed a journey the way a **user** would, not through the API. Every spec seeding
its graph through the API is why nobody had looked at the graph the product
creates for you, and five real defects lived there.

Verify: `python scripts/verify.py targeted e2e` (needs Docker and the stack up)
