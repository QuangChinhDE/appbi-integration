# workflow-engine/

This is the only place in the repository allowed to import n8n. Read
[.claude/rules/workflow-engine.md](../.claude/rules/workflow-engine.md) before
changing code here.

@../.claude/rules/workflow-engine.md

The runtime is pinned at n8n 1.14.1. Install with `npm ci`, never
`npm install`. Changing a version is its own change artefact, never a side
effect (ADR-013).

Adding a node? `/engine-node`. It is a certification exercise, not an import.

Verify: `python scripts/verify.py targeted engine`
