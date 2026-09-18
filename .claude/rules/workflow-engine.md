# Workflow-engine rules

Scope: `workflow-engine/`. Node 22 / TypeScript. An internal HTTP service with
no public route, no scheduler, no webhook server, no editor and no database.

This is the **only** place in the repository allowed to import n8n. That
privilege is the entire reason this service exists as a separate process, and
everything below follows from it.

## What this service owns, and what it must never own

Owns: compiling a product graph to an n8n `Workflow`, bootstrapping
`WorkflowExecute`, normalising `IRun` into a product DTO, the node allowlist,
the egress policy, redaction on the way out.

Must never own — these are product concerns and taking one is a BLOCKER:
scheduling, the public webhook endpoint, credential storage, execution history,
workflow identity or versions, tenancy, an editor, a metadata database.

## The compiler is the only translation layer

`src/compiler/` turns the product graph into n8n's model. One place, on purpose.
A mapping that grows a second home means the two disagree, and the disagreement
surfaces as a workflow that validates and then runs differently.

- The compiler pins n8n's execution order and its condition types deliberately
  (ADR-023). Do not "simplify" to upstream defaults.
- A node outside the allowlist cannot compile. That check exists here *and* in
  the product, and both are load-bearing — do not remove one because the other
  covers it.

## Only certified nodes run

`n8n-nodes-base` ships 294 node directories and they are all in the image. Nine
are certified. An export being available is not permission to run it: a node
becomes executable only with a registry entry, a `config_schema`, a compiler
mapper, an allowlist entry with pinned versions, a golden test asserting
per-node results, and both locales. Use `/engine-node`.

Code node, community nodes and arbitrary package execution are **disabled**
(ADR-014). Do not enable them.

## The contract with the product

- Answers are normalized product DTOs (`src/contracts/engine-dto.ts`). Never
  return `IRun` or an n8n shape across the boundary.
- The status vocabulary is a contract. Adding or renaming a status is a change
  to the product's error and history rendering, not a local edit.
- Errors go through `src/runtime/error-normalizer.ts`. No n8n error class, no
  uncontrolled internals, no secret values in a message.
- Redaction happens here **and** product-side, so neither is the single point
  of failure. Do not remove this half as a duplicate.
- Validation carries credential **descriptors** — `{credential_id,
  credential_type, data: {}}` — and strips values again on that route. Do not
  drop the credential list: the compiler cannot resolve a reference it was
  never sent, and that made every authenticating workflow impossible to publish
  three separate times (ADR-016). *Enforced:* `scripts/guardrails.py`.
- HTTP execution goes through the egress guard: SSRF and private-network
  refusal, redirect handling, size and timeout ceilings. Do not bypass it for a
  node that "needs" a local address.

## Versions are frozen

`n8n-workflow`, `n8n-core` and `n8n-nodes-base` at **1.14.1**, exactly, and
`typedi` alongside. The line is chosen, not inherited — later lines pull the n8n
application's own service container into a process that only wants
`WorkflowExecute` (ADR-013).

- Install with `npm ci`, **never** `npm install`. The lockfile is the pin.
- Vulnerabilities in the pinned tree are fixed by `overrides`, not by moving the
  line (ADR-024).
- No dependency or version change without its own change artefact, a
  compatibility analysis and a green contract suite. A version bump as a side
  effect of feature work is refused by a hook and by `certify.py --check`.
- Deep-import rather than pull in an `.ee` module. `binary-data.ts` explains
  why; `tests/contract/no-enterprise-source.test.ts` proves it at runtime by
  asserting nothing matching `.ee.` reached `require.cache`.

## Execution semantics need contract tests

`tests/contract/` runs the **real pinned runtime**. No engine mocks — a mock
proves the mock works.

- Assert on the **normalized product result**, never on `IRun`. Snapshotting
  upstream's shape fails on changes that do not affect the product and passes
  on ones that do.
- The fifteen golden workflows (SRS 43.4) are what an n8n upgrade has to keep
  green. Changing an expected value there is changing what the product does —
  justify it or fix the code.
- A node's preview shows the ports it has, not the arrays it returns. Filter
  returns a second array of discarded items which the preview must not read
  (ADR-026).

## Verifying

```bash
python scripts/verify.py targeted engine
```

Or in `workflow-engine/`: `npm run typecheck`, `npm test`, `npm run build`,
then `python scripts/certify.py --check` from the root.
