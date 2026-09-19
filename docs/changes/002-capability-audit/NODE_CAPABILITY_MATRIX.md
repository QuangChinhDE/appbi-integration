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

**Of the integration pack, OAuth2 blocks only Microsoft** *at the runtime
layer*. Everything else has a first-class non-OAuth2 credential path that n8n
supports natively.

**That is a statement about the runtime, not about onboarding.** Section C
tracks `Runtime auth path` and `Customer credential UX` as separate columns,
because a service-account JSON is technically sufficient and still puts a
five-step GCP setup in front of a non-technical customer. Do not read this
correction as "the integration pack is ready". The
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
| Loop over items in batches | `splitInBatches@3` | "call API B once per row, 50 at a time, without tripping rate limits" | ~~P0~~ **P2** — see the spike note | **None** | none | **M** |
| Wait / delay | `wait@1` | "pause 30s between pages"; "resume tomorrow" | **P1 (short) / P3 (long)** | **None** | **Yes — durability.** `features.wait_resume: false`; execution state is in memory, and `execution_stale_after_seconds: 120` means the reconciler marks anything quiet for 2 minutes `ENGINE_INTERRUPTED` | **L** |
| Branch / merge (already have) | `if`, `switch`, `filter`, `merge` | — | — | **Certified** | — | — |

**`splitInBatches` — demoted from P0 by measurement.** This node was listed P0
on the assumption that App-to-App fan-out requires it. **That assumption was
wrong**, and a spike against the real runtime settled it
(`SPIKE_FANOUT_FINDINGS.md`, `tests/contract/fan-out.test.ts`, 5/5 pass):

- a JSON array response already becomes one item per element;
- a downstream HTTP node already runs **once per item**, correctly paired;
- 100 items produce 100 distinct requests with **no batching node at all**.

So the defining "call API B once per row of API A" pattern needs neither this
node nor `splitOut`. What `splitInBatches` is actually for is narrower —
staying under a rate limit, a controlled loop where each iteration depends on
the last, pacing a large fan-out — all real, none required to build a working
integration.

It also carries the highest certification risk in the catalogue: it loops by
feeding items back into the graph, so it depends on the compiler's pinned
execution order (ADR-023), and it needs a golden test asserting *loop
termination and per-iteration item counts* rather than a final result — a loop
that runs twice produces plausible output. **High risk, low necessity: it
should not be in the first batch.**

**`wait` note.** A wait longer than `execution_stale_after_seconds` is not just
unsupported, it is actively wrong today: the run would be reconciled to
`ENGINE_INTERRUPTED` while waiting correctly. Two honest options — certify with
a hard cap below the stale threshold and say so in the UI, or design durable
resume first. **Do not certify it open-ended.**

### C. Integration

**Technically supported is not product-ready.** A non-OAuth2 path means the
*runtime* can authenticate; it says nothing about whether a customer can get
themselves connected. These two are tracked separately, because conflating them
is how "Google Sheets works" becomes a support ticket:

| Node | Runtime auth path | Customer credential UX | Onboarding verdict |
|---|---|---|---|
| **Postgres** | `postgres` — host/port/db/user/password/ssl | The customer's DBA already has these. Normal for an internal tool | **Ready** |
| **MySQL** | `mySql` | same | **Ready** |
| **Email Send** | `smtp` — host/port/user/password | An IT-provided SMTP account. Familiar | **Ready** |
| **Slack** | `slackApi` bot token | Create a Slack app, add scopes, install to workspace, copy the bot token. Several screens of Slack admin, but it is a documented path an ops person can follow | **Acceptable with a guide** |
| **GitHub / GitLab** | `githubApi` / `gitlabApi` PAT | Generate a PAT with scopes. Routine for a developer audience | **Acceptable** |
| **Google Sheets** | `googleApi` service account | **Create a GCP project, enable the Sheets API, create a service account, download a JSON key, then share the target sheet with the service account's email.** Technically usable, materially different from "Connect Google account" | **NOT onboarding-ready** |
| **Microsoft Excel / Teams** | `microsoftExcel/TeamsOAuth2Api` only | n/a — blocked at the runtime layer | **Blocked** |

The Google Sheets row is the one that matters and you named it exactly. The
service account clears the *technical* block and leaves a five-step manual
provisioning flow, including the non-obvious final step — sharing the sheet
with a machine email address — which is where a non-technical customer stops
and files a ticket. **Do not call Sheets an integration win because the runtime
supports it.** Two honest options: ship it with a written onboarding guide and
set the expectation that it is an admin-assisted setup, or treat proper OAuth2
as the real requirement for this connector and schedule it as such.

This is also a reason to prefer **Slack** over **Sheets** for the one
discretionary slot in the minimum catalogue, unless the pilot customer
specifically asks for Sheets — the runtime effort is the same and the
onboarding cost is not.

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
| 1 | `item_lists` | `itemLists@3` | Six operations in one certification. Needed by **5 of 15** reference workflows (W07, W08, W09, W10, W15) |
| 2 | `date_time` | `dateTime@2` | Every scheduled/reporting flow formats or compares a date |
| 3 | `postgres` | `postgres@2.3` | The most likely internal system of record |
| 4 | `email_send` | `emailSend@2.1` | The cheapest "tell a human" that needs no SaaS account |
| 5 | `xml` | `xml@1` | Without it, any non-JSON partner API is unreachable |
| 6 | `slack` **or** `google_sheets` | `slack@2.1` / `googleSheets@4.1` | **Pick one by asking the pilot customer.** Both are "M"; certifying both doubles credential surface for one capability class |
| 7 | `split_in_batches` | `splitInBatches@3` | **Demoted to last.** Rate limiting and controlled loops only — basic fan-out does not need it (spike). Highest certification risk in the set |

**Correction to an earlier figure.** This table previously said `item_lists`
"unblocks 11 of 15 reference workflows". **That number was unfounded** — the
reference-workflow coverage table counts **5** (W07, W08, W09, W10, W15), and
there is no defensible indirect reading that reaches 11. It is corrected rather
than re-derived, because a priority ordering built on an invented metric is
worse than one built on a small honest one. Five of fifteen, from one
certification carrying six operations, is still the best ratio in the
catalogue — the argument survives the correction, which is the only reason the
recommendation does not change.

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
