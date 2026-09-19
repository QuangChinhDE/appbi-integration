# Node capability matrix

An audit, not a plan to add nodes. The question is **which real workflows a
customer cannot build today**, and what each missing capability actually costs.

Every "available in 1.14.1" claim below was checked by loading the node from
the installed tree and reading its own description — version list and declared
credentials — not from upstream documentation for a later line. Commands are in
"How this was verified" at the end.

**Runtime audited:** `n8n-nodes-base@1.14.1`, 294 node directories on disk.
**Certified today:** 9.

---

## The headline correction: OAuth2 blocks less than assumed

`compatibility.yaml:94` has `OAUTH2: { certification: BLOCKED }`, and the
reasonable inference is that the SaaS integrations are therefore unusable. That
is **not what the runtime says**. Reading the latest version of each node:

| Node | Credentials it accepts (latest version in 1.14.1) | Needs OAuth2? |
|---|---|---|
| Postgres v2.3 | `postgres` | **No** |
| MySQL v2.2 | `mySql` | **No** |
| Email Send v2.1 | `smtp` | **No** |
| Slack v2.1 | `slackApi` (bot token) **or** `slackOAuth2Api` | **No** — bot token |
| Google Sheets v4.1 | `googleApi` (service account) **or** `googleSheetsOAuth2Api` | **No** — service account |
| GitHub v1 | `githubApi` (PAT) **or** `githubOAuth2Api` | **No** — PAT |
| GitLab v1 | `gitlabApi` (PAT) **or** `gitlabOAuth2Api` | **No** — PAT |
| Microsoft Excel v2 | `microsoftExcelOAuth2Api` only | **Yes — blocked** |
| Microsoft Teams v1.1 | `microsoftTeamsOAuth2Api` only | **Yes — blocked** |

**Of the integration pack, OAuth2 blocks only Microsoft.** Everything else has
a first-class non-OAuth2 credential path that n8n supports natively. The
backlog already said this about Sheets ("a service account is much cheaper and
usually enough internally"); what is new here is that it generalises.

What that costs instead is **new credential types in the product store**. Today
the store has four shapes, all HTTP-flavoured: `HTTP_BASIC`, `BEARER`,
`HEADER_API_KEY`, `QUERY_API_KEY`. A Postgres connection, an SMTP server and a
Google service-account JSON are none of those. So the integration pack's real
prerequisite is **credential-type work, not OAuth2 work** — and that is a
smaller, better-understood piece.

---

## The second correction: the Transform pack is one node

The requested Core Data/Transform capabilities — split items, aggregate, sort,
limit, deduplicate — do **not** need five nodes on this line. In 1.14.1 they are
all operations of `ItemLists@3`:

```
operation -> concatenateItems, limit, removeDuplicates, sort, splitOutItems, summarize
```

The split into separate `Aggregate` / `Sort` / `Limit` / `Remove Duplicates` /
`Split Out` / `Summarize` nodes happened **after** this line, which is why the
attached screenshot (a newer n8n) shows them separately. Mapping by capability
rather than by node name, as you asked: **one certification buys six
operations.** That makes it the single highest-value item in this matrix.

The corollary matters for the version decision: if we later migrate, these six
operations become six nodes and the product's own `node_key`s would have to
change or fan out. Certifying `item_lists` as **one product node with an
operation field** keeps the product key stable across that migration — the
mapper absorbs the change. Certifying six product keys now would not.

---

## The matrix

`Priority` is by how many of the 15 reference workflows
(`REFERENCE_WORKFLOWS.md`) are blocked without it. `Effort` counts the eight
certification pieces from `docs/node-catalog-backlog.md`; **S** = schema +
mapper + golden test, **M** = adds a new credential type or non-trivial
operation surface, **L** = adds durable state or a product decision first.

### A. Core data / transform

| Capability | Node (1.14.1) | User case | Priority | Current support | Blocker | Effort |
|---|---|---|---|---|---|---|
| Split / aggregate / sort / limit / dedupe / summarize | `itemLists@3` | "one API returns a list, I need one item per row, deduped and sorted" | **P0** | **None** — must be faked with expressions | none | **M** (six operations, one schema) |
| Date formatting and arithmetic | `dateTime@2` | "stamp today", "was this in the last 7 days", timezone conversion | **P0** | Expressions only, error-prone | none | **S** |
| Parse non-JSON responses | `xml@1`, `html@1` | SOAP/RSS partner feeds; scraping an HTML table | **P1** | **None** — HTTP Request cannot use a non-JSON body | none | **S** each |
| Rename / reshape keys | `renameKeys@1` | mapping a partner's field names onto ours | **P2** | Mostly covered by `edit_fields` | none | **S** |
| Hash / HMAC | `crypto@1` | signing an outbound partner request | **P2** | **None** | review `security_profile` — closest a non-Code node gets to computation | **S** |
| Explicit no-op / stop | `noOp@1`, `stopAndError@1` | readable branches; deliberate failure | **P3** | **None** | none | **S** each |

### B. Flow control

| Capability | Node (1.14.1) | User case | Priority | Current support | Blocker | Effort |
|---|---|---|---|---|---|---|
| Loop over items in batches | `splitInBatches@3` | "call API B once per row, 50 at a time, without tripping rate limits" | **P0** | **None** | none *(but see the note below)* | **M** |
| Wait / delay | `wait@1` | "pause 30s between pages"; "resume tomorrow" | **P1 (short) / P3 (long)** | **None** | **Yes — durability.** `features.wait_resume: false`; execution state is in memory, and `execution_stale_after_seconds: 120` means the reconciler marks anything quiet for 2 minutes `ENGINE_INTERRUPTED` | **L** |
| Branch / merge (already have) | `if`, `switch`, `filter`, `merge` | — | — | **Certified** | — | — |

**`splitInBatches` note.** It loops by feeding items back into the graph, so it
depends on the compiler's pinned execution order (ADR-023). It needs a golden
test asserting *loop termination and per-iteration item counts*, not just a
final result — a loop that runs twice instead of once produces plausible output.
This is the one Tier-1-looking node with a real engine-semantics risk.

**`wait` note.** A wait longer than `execution_stale_after_seconds` is not just
unsupported, it is actively wrong today: the run would be reconciled to
`ENGINE_INTERRUPTED` while waiting correctly. Two honest options — certify with
a hard cap below the stale threshold and say so in the UI, or design durable
resume first. **Do not certify it open-ended.**

### C. Integration

| Capability | Node (1.14.1) | User case | Priority | Current support | Blocker | Effort |
|---|---|---|---|---|---|---|
| Read/write Postgres | `postgres@2.3` | the most likely internal need: read a table, upsert results | **P0** | **None** | new credential type (host/port/db/user/password/**ssl**) | **M** |
| Send email | `emailSend@2.1` | notify a human when a run finds something | **P1** | **None** | new `smtp` credential type; **re-run semantics** (Tier 3 — a retry re-sends) | **M** |
| Post to Slack | `slack@2.1` | same, in chat | **P1** | **None** | new bot-token credential type; same re-run question | **M** |
| Google Sheets | `googleSheets@4.1` | "append a row per result" — very common for non-technical users | **P1** | **None** | **service-account** credential type (JSON key). Avoids OAuth2 | **M** |
| MySQL | `mySql@2.2` | only if a customer is on MySQL | **P3** | **None** | new credential type; `mysql2` advisory — check before certifying | **M** |
| GitHub / GitLab | `github@1`, `gitlab@1` | issues, pipelines | **P3** | **None** | PAT credential type | **M** |
| Microsoft Excel / Teams | `microsoftExcel@2`, `microsoftTeams@1.1` | Microsoft-shop customers | **P2 if such a customer exists, else P4** | **None** | **OAuth2 refresh flow — genuinely blocked** | **L** |

### D. Staying blocked (unchanged, and correctly so)

`code`, `executeCommand` (ADR-014 — the `n8n-nodes-base` arbitrary-command
advisory is unreachable *only* because the allowlist is closed), community
nodes, anything behind an `.ee.` path (ADR-015), binary data / Drive / S3
(ADR-012, `features.binary_data: false`).

---

## Minimum Practical Node Catalog

Chosen against the 15 reference workflows, not against node count. **9
certified today + 7 new = 16.**

| # | Product node | n8n binding | Why it is in the minimum |
|---|---|---|---|
| 1 | `item_lists` | `itemLists@3` | Six operations. Unblocks 11 of 15 reference workflows |
| 2 | `date_time` | `dateTime@2` | Every scheduled/reporting flow formats or compares a date |
| 3 | `split_in_batches` | `splitInBatches@3` | The "call B for each row of A" shape — the defining App-to-App pattern |
| 4 | `postgres` | `postgres@2.3` | The most likely internal system of record |
| 5 | `email_send` | `emailSend@2.1` | The cheapest "tell a human" that needs no SaaS account |
| 6 | `xml` | `xml@1` | Without it, any non-JSON partner API is unreachable |
| 7 | `slack` **or** `google_sheets` | `slack@2.1` / `googleSheets@4.1` | **Pick one by asking the pilot customer.** Both are "M"; certifying both doubles credential surface for one capability class |

**Deliberately excluded from the minimum:** `wait` (needs the durability
decision), Microsoft (needs OAuth2), MySQL/GitHub/GitLab (no identified pilot
need), `crypto`/`renameKeys`/`noOp`/`stopAndError` (cheap, but no reference
workflow requires them — add opportunistically inside another batch).

**This list is a hypothesis until the pilot customer confirms it.** The backlog
already says the right thing: *"Ask which of these the workspace actually
automates by hand today. The list above is what is available, which is not the
same question."* Item 7 in particular should not be guessed.

---

## What this costs beyond the nodes

Three pieces of work that are **not** node certification and would otherwise be
discovered mid-batch:

1. **Credential-type framework extension.** Four new shapes (`POSTGRES`,
   `SMTP`, `SLACK_BOT`, `GOOGLE_SERVICE_ACCOUNT`) versus today's four
   HTTP-flavoured ones. Each needs a product schema, the encrypted store, the
   `describe, do not disclose` validation path (ADR-016), and a health check.
   **Do this once, before the integration batch** — not per node.
2. **Node i18n.** `node_registry.json` holds names and descriptions in
   Vietnamese only, so an English-locale user already sees Vietnamese node
   names. The backlog flags it. Adding 7 nodes makes an existing gap ~78%
   worse; it does not create it.
3. **Re-run semantics for side-effecting nodes.** "What does retrying a failed
   execution do when step 3 already sent the email?" is a product decision,
   and `Idempotency-Key` protects the execution, not a third-party effect.
   Needed before `email_send` or `slack`, not before `postgres` reads.

---

## How this was verified

```bash
# 294 directories, and which of the relevant ones exist
ls workflow-engine/node_modules/n8n-nodes-base/dist/nodes | wc -l

# Per-node: version list and the credentials the LATEST version declares.
# Versioned nodes declare credentials per version, so the base description
# reports "none" and reading it would have been wrong.
node -e "const m=require('n8n-nodes-base/dist/nodes/Postgres/Postgres.node.js');
         const n=new m.Postgres();
         const top=Math.max(...Object.keys(n.nodeVersions).map(Number));
         console.log(top, n.nodeVersions[top].description.credentials);"

# ItemLists operations on this line
node -e "const m=require('n8n-nodes-base/dist/nodes/ItemLists/ItemLists.node.js');
         const n=new m.ItemLists();
         const v=n.nodeVersions[3].description.properties.find(p=>p.name==='operation');
         console.log(v.options.map(o=>o.value).join(', '));"
```

Product-side facts: `compatibility.yaml:85-105` (credential types, features),
`backend/app/resources/node_registry.json` (`credential_types`),
`backend/app/core/config.py:114` (`execution_stale_after_seconds`).
