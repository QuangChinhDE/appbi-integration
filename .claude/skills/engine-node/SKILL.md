---
name: engine-node
description: Certify a new node for the workflow catalogue — the full set of pieces required before a node may become user-visible and executable (registry entry, config schema, compiler mapper, allowlist with pinned versions, credentials, golden contract test, frontend form, both locales, certify.py). Use whenever asked to add, enable, or expose a node, an integration, or an n8n node type.
---

# Certifying a node

**`n8n-nodes-base` ships 294 node directories and every one of them is already
in the image. Nine are certified.** A node being importable is not permission
to run it.

Adding a node is a certification exercise with nine artefacts. A node that has
eight of them is not a node that mostly works — it is a node that fails
somewhere a user will find and you will not. The failure modes are specific:
without a compiler mapping it validates and will not run; without a golden test
nothing notices when an upgrade changes its semantics; without both locales it
renders an English string inside a Vietnamese screen; without an allowlist entry
it is refused at runtime after the UI has offered it.

Do this under a change artefact (`docs/changes/<NNN>-node-<name>/`). It is
substantial work by definition.

## Before starting: is it certifiable at all?

- **Code node, community nodes, arbitrary package execution are disabled**
  (ADR-014, guardrail 13). Not a gap to fill.
- Does it need wait/resume or long-lived execution? Out of scope for V1
  (guardrail 14) until a persistence design exists.
- Check [docs/node-catalog-backlog.md](../../../docs/node-catalog-backlog.md) —
  it lists what to certify next in tiers by what each costs, and may already
  have decided this one's tier and its known problems.
- Which version does the **pinned 1.14.1 tree actually ship**? Not what
  upstream docs say for a later line. The existing pins were verified against
  the installed packages, and that is why they read `set@3.2` not `3.3` and
  `if@1` not `2`. Check `workflow-engine/node_modules/n8n-nodes-base/dist/nodes/`.

## The nine pieces

Do them in this order; each depends on the previous.

### 1. Product node definition — `backend/app/resources/node_registry.json`

A product node key (`snake_case`, e.g. `http_request`) with its display name,
category, ports and `engine_binding`. The key is the product's; the binding is
backend-only and **must never appear in a non-admin response** (guardrail 9).
The user never sees `n8n-nodes-base.httpRequest`.

### 2. `config_schema`

The form the frontend renders — *not* an n8n node description. Fields, types,
required, defaults, options.

Defaults are a trap here: the registry's defaults were once rendered by the form
but never written to the config, so validation reported fields as unfilled on a
panel visibly showing them set. Make sure a default reaches the stored config.

### 3. Compiler mapper — `workflow-engine/src/compiler/node-mappers.ts`

A `Mapper` translating product config → n8n node parameters, registered in
`MAPPERS` under the product key. This is the only translation layer; do not add
a second one anywhere.

Mind the semantics the compiler pins deliberately (ADR-023): execution order and
condition types are fixed on purpose, not left to upstream defaults.

### 4. Allowlist entry — `workflow-engine/src/nodes/registry-loader.ts`

An `ALLOWLIST` entry with a `load()` that `require`s the individual compiled
node file — never the directory loader — and `certifiedVersions` naming the
exact versions. The allowlist is enforced here **and** in the product,
deliberately; both stay.

### 5. Pinned version — `compatibility.yaml`

A `certified_nodes` entry: `product_schema_version`, `engine_type`,
`engine_type_version`, `certification`. It must agree with the allowlist and the
registry. `node-lock.json` is regenerated, not hand-edited.

### 6. Credentials, if it authenticates

Product-owned credential metadata and a credential type in the registry. The
engine receives credentials resolved **at execution time**; validation receives
`{credential_id, credential_type, data: {}}` — descriptors, not values
(ADR-016). Read [.claude/rules/security.md](../../rules/security.md) before
touching this.

### 7. Golden contract test — `workflow-engine/tests/contract/`

A golden workflow exercising the node against the **real pinned runtime**. No
mocks.

- Assert on the **normalized product result**, never on `IRun`.
- Assert **per-node** results, not just that the run succeeded.
- Cover the node's branching and data semantics if it has any: which ports it
  offers, how items propagate, what happens with zero items. Filter's second
  returned array of discarded items must not be read by the preview (ADR-026);
  Switch's fallback compiles to a catch-all rule because v2 has no extra output.
- If it makes HTTP requests, it goes through the egress guard — assert that a
  private address is refused.

### 8. Frontend form

The panel renders from `config_schema`, so usually there is nothing bespoke to
write — but **look at it** (`/ui-review`). Check the empty state, a validation
error naming the right field, and that defaults show as set and validate as set.

### 9. Both locales — `frontend/src/lib/i18n.ts`

Every user-visible string. The policy for which English words stay English is at
the top of that file — read it. A node shipped with English-only strings is a
node that reads as untranslated inside a Vietnamese product.

## Then

```bash
python scripts/certify.py            # refreshes node-lock.json
python scripts/certify.py --check    # the gate: non-zero on drift
python scripts/verify.py targeted engine
python scripts/verify.py full
```

`certify.py` is what catches five of the nine pieces disagreeing: every registry
node must have a binding naming a version the installed runtime ships, the
compatibility matrix must agree with the registry, the installed package set
must match the pins, and nothing may name a node the compiler cannot map.

Add an E2E journey if the node introduces a user-visible flow — build it on the
canvas, run it, read the output off the node card.

## Never

- enable the directory loader, or widen the allowlist to a family;
- add a registry entry without a compiler mapping — it validates and cannot run;
- pin `latest`, a caret range, or a version the installed tree does not ship;
- **change the n8n version to get a node.** That is an engine migration with a
  compatibility analysis, golden-test regression and its own change artefact
  (ADR-013) — and a hook will refuse the edit;
- let a node become executable because `n8n-nodes-base` exports it.

## Definition of Done for a node

All nine pieces present; `certify.py --check` green; the golden test asserts
per-node results against the real runtime; the panel has been looked at; both
locales complete; `verify.py full` reported truthfully. Anything short of that
is an uncertified node, whatever the UI shows.
