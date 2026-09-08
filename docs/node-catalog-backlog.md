# Node catalog backlog

**Certified so far: 9.** `filter` was added on 2026-09-08 — the first from this
backlog, and the one that surfaced ADR-026.

The product certifies nine steps. `n8n-nodes-base@1.14.1` ships **294** node
directories, already on disk and already in the image — the catalog is small
because certification is deliberate, not because the runtime is missing
anything. This is the list of what to certify next and what each one costs.

## What certifying one node actually involves

Adding a node is not an import. `registry-loader.ts` is a closed allowlist and
that is load-bearing: it is the second of the two places an uncertified node is
refused, and it is why 16 of the 18 packages `npm audit` flags are never loaded
into the process (ADR-024). Every entry therefore needs all of:

| Piece | Where | Why it cannot be skipped |
|---|---|---|
| Registry entry | `backend/app/resources/node_registry.json` | `node_key`, category, icon, `security_profile`, `engine_binding` with a **pinned** `engine_type_version` |
| `config_schema` | same entry | The product's own form fields. This is the real work: n8n's parameter set is not a UI |
| Mapper | `workflow-engine/src/compiler/node-mappers.ts` | Product config → n8n parameters. Typed condition buckets and operator names are not one-to-one — see ADR-023 |
| Allowlist entry | `workflow-engine/src/nodes/registry-loader.ts` | With the certified version numbers, not "whatever is newest" |
| Golden test | `workflow-engine/tests/contract/golden-workflows.test.ts` | Asserting **per-node** results, not just the workflow's output. Both defects in ADR-023 were invisible to output-only assertions |
| Certify gate | `node-lock.json` via `scripts/certify.py` | Fails the build when the runtime and the catalog disagree |
| Compatibility entry | `compatibility.yaml` under `certified_nodes` | `certify.py` refuses a node the catalogue has and the contract does not |
| Run-panel check | by hand, once | Run it and compare the panel's item count with what the next step received. See ADR-026: `Filter` returns two output arrays and declares one, and the preview reported the dropped items as output |

Node names, descriptions and field labels come from
`node_registry.json`, not from the i18n catalogue — so they are Vietnamese
only, and an English-locale user sees Vietnamese node names. That is a real gap
and a separate piece of work; it is not part of adding a node.

Credentialled nodes add one more: a credential type in the product's own
encrypted store, plus the `describe, do not disclose` rule on the validation
path (ADR-016).

## Ordering principle

By what an internal workspace automates today, not by what looks impressive in
a catalog. A node nobody uses still costs a mapper, a schema, a test and a
place in the compatibility contract forever.

Two questions decide the tier:

1. **Does it need a credential?** A credentialled node is roughly twice the
   work of one that does not, and it puts a new secret shape into the store.
2. **Does it have side effects outside the product?** Sending mail or writing
   to a sheet is not undoable, so it needs the egress guard, and it needs
   somebody to have thought about what a re-run does. See the note on
   idempotency below.

## Tier 1 — no credential, no external side effects

Cheapest possible additions: a schema, a mapper, a test. Nothing new in the
secret store, nothing irreversible.

| Node | n8n type | Buys |
|---|---|---|
| Wait | `n8n-nodes-base.wait` | Pause between steps. Needs a decision first: a wait that outlives the engine process does not survive it, because execution state is in memory (see `engine-deployment.yaml`) |
| Date & Time | `n8n-nodes-base.dateTime` | Formatting and arithmetic that people currently do with expressions |
| Item Lists | `n8n-nodes-base.itemLists` | Split, aggregate, sort, limit, deduplicate — the operations most often missing from a real flow |
| ~~Filter~~ | `n8n-nodes-base.filter@1` | **Done.** Drop items without branching, instead of an IF with one empty branch |
| Rename Keys | `n8n-nodes-base.renameKeys` | Partly covered by Edit Fields; worth it only if the field mapping proves painful |
| XML / HTML | `n8n-nodes-base.xml`, `.html` | Parsing responses that are not JSON, which HTTP Request currently cannot use |
| Crypto | `n8n-nodes-base.crypto` | Hashing and HMAC. Check the `security_profile` carefully — this is the closest a non-Code node gets to computation |

## Tier 2 — credentialled, read-mostly

Each needs a credential type in the product store and a health check that
describes without disclosing (ADR-016).

| Node | n8n type | Credential | Note |
|---|---|---|---|
| Postgres | `n8n-nodes-base.postgres` | DB connection | The most likely internal need. `mysql2`'s critical advisory is a reminder that a DB driver is a large surface — check what `pg` pulls in before certifying |
| Google Sheets | `n8n-nodes-base.googleSheets` | OAuth2 / service account | OAuth2 refresh is real work; a service account is much cheaper and usually enough internally |
| Slack | `n8n-nodes-base.slack` | Bot token | Reading channels and posting. Posting is a side effect — see below |
| Microsoft Excel / Teams | `n8n-nodes-base.microsoftExcel`, `.microsoftTeams` | OAuth2 | Only if the organisation is on Microsoft rather than Google. Do not certify both |
| GitHub / GitLab | `n8n-nodes-base.github`, `.gitlab` | PAT | Issues and pipelines. Narrow but cheap once the PAT credential shape exists |

## Tier 3 — irreversible side effects

These need a product answer before they need code.

| Node | n8n type | The question to answer first |
|---|---|---|
| Send Email (SMTP) | `n8n-nodes-base.emailSend` | What does re-running a failed execution do? A retry that re-sends is a product decision, not an engine one |
| Slack / Teams post | as above | Same question. `Idempotency-Key` protects the *execution*, not a step's third-party effect |
| Google Drive, S3 | `.googleDrive`, `.awsS3` | Binary data. V1 does not support it (ADR-012), and the binary-data service is registered in `default` mode on purpose |

## Blocked, and staying blocked

* **Code** (`n8n-nodes-base.code`) and **Execute Command**
  (`.executeCommand`) — ADR-014. Arbitrary code in a shared multi-workspace
  runtime is the whole tenant-isolation story undone. The `n8n-nodes-base`
  advisory *"Execute Command Node Allows Authenticated Users to Run Arbitrary
  Commands"* covers every published version and is unreachable here **only**
  because the allowlist is closed.
* **Community nodes** — ADR-014. Nothing outside the pinned tree.
* Anything reached through an `.ee.` file — ADR-015.

## Where these live on disk

Vendor nodes are nested, which matters because the allowlist deep-requires the
compiled file by path:

```
n8n-nodes-base/dist/nodes/Wait/Wait.node.js              # top level
n8n-nodes-base/dist/nodes/Google/Sheet/GoogleSheets.node.js
n8n-nodes-base/dist/nodes/Microsoft/Excel/...
n8n-nodes-base/dist/nodes/Aws/S3/...
```

Check the path before writing the allowlist entry. `certify.py` will catch a
wrong one, but it will report it as "the runtime does not certify this node",
which sounds like a version problem rather than a typo.

## Before starting a tier

1. Ask which of these the workspace actually automates by hand today. The list
   above is what is *available*, which is not the same question.
2. Certify in batches of three to five. Each batch is one `certify.py` run, one
   `node-lock.json` diff, and one review.
3. Add the golden test with the node, not after it. A node whose mapper is
   wrong in a way only per-node assertions catch will otherwise ship green.
