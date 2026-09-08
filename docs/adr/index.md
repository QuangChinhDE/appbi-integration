# Architecture Decision Records

The fifteen records SRS section 49 requires, plus six written afterwards:
two the browser suite turned up, and four from hardening the product for
multi-tenant operation. Each one is short on purpose: the reasoning that
matters is the part a future change has to argue against.

Status of all records: **Accepted** for V1 unless noted.

---

## ADR-001 — n8n-core as an internal runtime, not the n8n application

**Context.** n8n ships an execution engine we want and an application we do
not: its own editor, users, projects, credential database, webhook server,
scheduler, execution persistence and queue mode.

**Decision.** The product embeds `n8n-workflow` + `n8n-core` + allowlisted
`n8n-nodes-base` node classes inside one internal service (`workflow-engine/`).
No n8n CLI, no n8n server, no n8n database, no editor.

**Consequences.** `WorkflowExecute` is not a public embedding API, so the engine
service is an anti-corruption layer with a contract suite
(`workflow-engine/tests/contract`) as its only guarantee. Upgrades are a change
to `compatibility.yaml` plus a green suite.

**Rejected.** Running n8n behind our own frontend. It makes n8n's object model,
URLs and RBAC the product's, and every upgrade a product migration.

---

## ADR-002 — The product owns Workflow and WorkflowVersion

**Decision.** Product PostgreSQL is the system of record for workflow identity,
draft graph, immutable published versions, trigger bindings, credential
references and execution history. There is no `n8n_workflow_id` column anywhere
in the product schema.

**Consequences.** The engine can be wiped and rebuilt without data loss. An
execution record names an exact `workflow_version_id` or `draft_revision`, so
history stays truthful after the draft moves on.

---

## ADR-003 — A separate Node/TypeScript engine service

**Decision.** The product API stays Python/FastAPI, matching AppBI Pipeline.
The n8n runtime lives in a Node service reached over an internal HTTP contract
via `WorkflowEngineAdapter`.

**Consequences.** Two languages, one boundary. The alternative — running JS
inside Python — buys nothing and makes the n8n dependency inseparable from the
product process.

---

## ADR-004 — The product owns the scheduler

**Decision.** `trigger_bindings.next_run_at` plus the product worker's schedule
tick. n8n's own scheduler is disabled and never registered.

**Why.** A schedule has to fire an *exact published version*, respect an overlap
policy, be attributable in the audit log, and keep working while the engine is
down. n8n's scheduler owns none of those concerns.

---

## ADR-005 — The product owns the webhook gateway

**Decision.** Public ingress is `ANY /hooks/{public_key}`, served by the product
API. The engine has no public route and no internet ingress.

**Consequences.** Auth mode, rate limit, body cap, replay policy and version
resolution are product code, tested by product tests. `Respond to Webhook`
(a synchronous response from inside a running workflow) is therefore out of
scope until a separate design exists — V1 answers `202 Accepted`.

---

## ADR-006 — The product owns credentials

**Decision.** Credentials are product rows plus envelope-encrypted secrets in
the product secret store. The engine receives a *resolved* credential payload
for the duration of one execution and stores nothing.

**Consequences.** `ICredentialsHelper` in the engine is implemented against the
execution request, not against a database. No n8n credential table exists.

---

## ADR-007 — A product Node Registry with certification

**Decision.** The FE only ever sees product `node_key`s and normalized config
schemas. `engine_binding` (`n8n-nodes-base.httpRequest`, `typeVersion`) is
backend-only and appears in admin endpoints alone.

**Consequences.** Adding a node is a certification exercise, not an import. The
compiler rejects any `node_key` outside the registry — the allowlist is enforced
twice, in the product and again in the engine.

---

## ADR-008 — n8n expression syntax is the product DSL

**Decision.** `{{ $json.x }}` and `{{ $node["Name"].json.y }}` are a
product-supported surface, evaluated by the pinned n8n expression runtime.

**Consequences.** A deliberate, documented exception to "no engine shape in the
product contract". Writing our own expression language would be months of work
to end up worse. A future engine swap must supply a compatible DSL or a
migration; expression compatibility is part of the upgrade gate (SRS 70).

---

## ADR-009 — Mutable draft, immutable published versions

**Decision.** One mutable draft per workflow guarded by an optimistic
`revision`; publishing freezes an immutable `workflow_versions` row; activation
points a trigger binding at one exact version.

**Consequences.** Editing an active workflow is safe by construction. Rollback
is "activate version N-1", not "republish a copy".

---

## ADR-010 — Execution persistence and engine-crash semantics

**Decision.** The product writes every execution row. The engine holds only
in-flight state. A run whose engine process disappears is reconciled to
`ENGINE_INTERRUPTED` by the worker, never left `RUNNING` forever.

**Consequences.** No Wait/resume in V1 — an active execution may be bound to one
engine process. Long-running resume needs its own persistence design.

---

## ADR-011 — Queue technology and the threshold to change it

**Decision.** V1 dispatch is a durable table in the product database
(`executions` rows in `QUEUED`) polled by the worker with `FOR UPDATE SKIP
LOCKED`.

**Threshold for a broker.** Any of: sustained throughput above 20
executions/minute, more than two engine workers, or a p95 dispatch lag above
10s. At that point the same `WorkflowEngineAdapter` sits behind a real queue and
no domain code changes.

---

## ADR-012 — Binary data boundary

**Decision.** V1 does not support binary-heavy nodes. HTTP Request is capped at
a configurable response size, and JSON/text bodies only. n8n's binary
abstractions never reach the product contract.

---

## ADR-013 — n8n pin and upgrade policy: the 1.14 line

**Context.** Embedding difficulty is not monotonic with version. Measured
against the published dependency manifests: `n8n-core@1.14.1` needs `typedi` and
`n8n-workflow`; `1.60` adds `@langchain/core`; `1.122` and `2.x` add
`@n8n/backend-common`, `@n8n/config`, `@n8n/di`, `@n8n/decorators`, `@sentry/*`
and `@aws-sdk/client-s3` — the application's own service container, in a process
that only wants `WorkflowExecute`.

**Decision.** Pin the `1.14.1` package set exactly (`n8n-workflow`, `n8n-core`,
`n8n-nodes-base`). Upgrade only through the flow in SRS 31.3, and only when
something we need is on the other side of it.

**Consequences.** We do not get node versions released after that line — which is
the point: the V1 node set is eight nodes, all certified against this pin. A node
`typeVersion` is never bumped merely because upstream published a new one.

**Security note.** The pinned line carries older transitive dependencies. The
engine service therefore runs with no inbound public route and an egress policy
in front of HTTP Request (SRS 32.2). The SBOM step in CI is what keeps this
honest.

---

## ADR-014 — Code node and community nodes are blocked

**Decision.** `BLOCKED` in the registry, and rejected by the compiler even if a
graph names them. No `npm install` from the UI, ever.

**Reopening condition.** A sandbox with CPU/memory limits, filesystem and network
policy, a dependency allowlist and an abuse review. Not before.

---

## ADR-015 — Licensing, and the delivery scope this product is built for

**Context.** n8n ships under the Sustainable Use License, which grants use and
modification "only for your own internal business purposes or for
non-commercial or personal use", and distribution only free of charge for
non-commercial purposes. Source files marked `.ee.` are excluded from that
grant entirely and require an n8n Enterprise License.

**Decision — scope.** The delivery this product is built for is **internal**:
one organisation, many workspaces. That is inside the Sustainable Use grant.
Selling the service, hosting it for external customers, OEM/embedding and
redistribution are not, and `licensing.commercial_gate` in
`compatibility.yaml` stays `NOT_REVIEWED` until a legal review says otherwise.
`release_gate.py` fails `--delivery commercial` on that basis and passes
`--delivery internal`; the artefact records which was claimed.

**Decision — Enterprise source.** The original wording here was *"No `.ee`
source is used or copied"*, and it was wrong in a way nothing could catch. The
three `.ee.` files in `n8n-core` (the S3 ObjectStore) arrive inside the
package, so "not copied" was never in our gift; and `dist/index.js`
*statically* re-exports the ObjectStore, so `import { WorkflowExecute } from
'n8n-core'` loaded Enterprise-licensed code into every engine process. Reading
the code argued otherwise — the ObjectStore is referenced inside
`BinaryData.service.init` behind `if (availableModes.includes('s3'))`, and the
engine passes `['default']` — but that guard runs after the entry point has
already loaded the module.

So the claim is replaced by three that can each be checked:

* `ee_source_present_in_dependency: true` — it ships that way; not ours to change.
* `ee_source_loaded_by_runtime: false` — the engine deep-imports
  `n8n-core/dist/BinaryData/BinaryData.service` and
  `n8n-core/dist/WorkflowExecute`, past the entry point.
* `ee_feature_enabled: false` — no s3 binary mode, no EE feature flag.

**Consequences.** `tests/contract/no-enterprise-source.test.ts` boots the
runtime, executes a real workflow through the HTTP node — the path that reaches
`BinaryDataService` — and asserts nothing matching `.ee.` or `/.ee/` is in the
module cache. It fails if either deep import is reverted, which is how it was
verified. Not a grep over our own imports: the defect was in a transitive
static require, where a grep sees nothing.

The architecture is not a licensing workaround and must not be presented as
one. If the scope ever changes to selling or hosting for customers, the gate is
the thing that must move first, not the code.

---

## ADR-016 — Credentials on the validation path: describe, do not disclose

**Context.** Publishing runs a compile dry-run in the engine. Three layers of
the system -- the product service, the engine adapter and the engine's own
`/internal/validate` route -- each independently decided that a dry run should
receive no credentials, and each implemented that by sending an empty list.

The result was that the compiler could not resolve any credential reference, so
it reported `CREDENTIAL_REQUIRED` and **no workflow that authenticated to
anything could ever be published**. Every layer looked correct on its own; only
an end-to-end publish showed the outcome.

**Decision.** The validation path sends the credential's *identity and type*
with an empty payload: `{credential_id, credential_type, data: {}}`.

The compiler needs exactly two things from a credential at compile time -- that
the reference resolves, and that its type maps to an authentication the pinned
tree supports (which is a real publish-time finding worth reporting). Neither
needs the secret. Nothing is executed, so there is nothing for a value to be
used by.

**Where it is enforced.** In the adapter, so the product cannot send a value on
this path by accident; and again in the engine's validate route, which strips
values from whatever it is handed -- so a dry run cannot leak a secret even if a
future caller sends one. A backend unit test pins the wire form, an engine
contract test pins both the resolving case and the still-reported unresolvable
case, and a CI grep fails if either half is "simplified" back into the bug.

**Rejected.** A `mode: 'validate'` flag telling the compiler to treat any
unresolved credential as satisfied. It would have hidden the genuine finding
(a reference to a credential that really is gone) along with the false one.

---

## ADR-017 — The browser suite runs the images, not the sources

**Context.** The unit, contract and component suites all pass against source.
Three defects in this product existed only in the deployed shape of it: Next's
`output: 'standalone'` serialises `rewrites()` destinations at build time, so
the container frontend could not reach the API at all; a modal rendered through
a portal escaped the `xl:hidden` wrapper meant to confine it to small screens;
and a query key that appended `undefined` was not a prefix of the key it was
meant to invalidate.

None of those is reachable by a test that imports a module.

**Decision.** `e2e/` drives the real interface with Playwright against the
container stack, and CI runs it as its own job with `docker compose up --build`.
It targets the *frontend's* port and reaches the API only the way a person does.

**Consequences.** It is the slowest suite (about three minutes) and it runs
single-worker, because the per-workflow concurrency ceiling is one and parallel
workers would fight over the same workspace. That cost is accepted: it is the
only suite that can fail for a deployment reason.

**Convention.** Tests assert on what the interface *means*, not on how it looks
-- `data-run-status` on a node card rather than a Tailwind class -- and they
address their own rows by name rather than taking the first one, so a previous
failed run cannot make the next one lie.

---

## ADR-018 — Tenant isolation is checked structurally, not remembered

**Context.** A `workspace_id` column makes isolation *possible*, not automatic.
The leak that prompted this was `derive_health` looking up a credential by id
alone: a graph is JSONB, so it can name any UUID -- the reference is not a
foreign key -- and a workflow in workspace A naming B's credential got back B's
row, and B's credential *name* in A's health message.

Nothing caught it. It is not a permission bug, so the RBAC tests passed; not a
route bug, so the API tests passed; and every service test builds its fixtures
in one workspace, which makes a missing filter unobservable.

**Decision.** Three layers, because one is not enough:

1. **The filter is a parameter, not a memory.** Helpers that read tenant data
   take `workspace_id` explicitly even when a `workflow_id` already implies
   one. The filter is then visible in the query rather than depending on every
   caller being careful.
2. **A static check.** `backend/tests/test_tenant_isolation.py` walks the AST
   of every service module and fails on a query touching a tenant-scoped table
   without a tenant constraint. Crossing the boundary is allowed and listed --
   the allow-list requires a written reason, and a separate test fails if an
   entry names code that no longer exists.
3. **A hostile browser test.** `e2e/tests/07-tenancy.spec.ts` provisions two
   tenants and asks A for B's rows *by id*, with and without an
   `X-Workspace-Id` header naming B. It does not check that B's rows are absent
   from a list; every product with a `workspace_id` column passes that version.

**Consequences.** Adding a cross-tenant query is now a deliberate act with a
paper trail. The static check is deliberately crude -- it reads statement text
for a marker -- because a subtle checker that understood the ORM would agree
with the ORM's bugs.

---

## ADR-019 — Idempotency is a database constraint, not a lookup

**Context.** `executions.create` checked for an existing run with the same
`Idempotency-Key` before inserting. That answers the common case -- a retry
arriving after the first request committed -- and does nothing about the
interesting one: two clicks of `Run`, or two webhook deliveries, arriving in the
same instant. Both read nothing; both insert.

**Decision.** A partial unique index on
`(workspace_id, workflow_id, idempotency_key)`, and the service catches the
violation and returns the winner's row. The insert runs in a savepoint, because
a failed `INSERT` aborts its transaction and without one the session could not
be used to read the row that caused the failure.

Partial because the key is null for most runs: a plain unique constraint would
permit exactly one keyless execution per workflow, since Postgres treats nulls
as distinct only outside a `NULLS NOT DISTINCT` declaration. There is a test
for that specific mistake.

**Rejected.** An advisory lock around the read-then-write. It would work, and it
would put the correctness of the product's most-clicked button in code that has
to be got right at every call site rather than in a constraint the database
enforces regardless.

**Consequences.** The loser of a race is answered, not errored: `202` with the
winner's execution id, which is what "idempotent" means to a caller. The log
records `execution.idempotent_replay` so the race is observable rather than
merely handled.

---

## ADR-020 — The rate limit counts in Postgres

**Context.** The webhook limiter was an in-process sliding window. With N API
replicas the effective limit was N times the configured number -- and N changes
whenever somebody scales the deployment, which is the worst property a security
control can have. A single-replica test passes against it.

**Decision.** One row per fixed window in `rate_limit_buckets`, incremented by a
single `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`, which is atomic without
a transaction of its own. A *fixed* window rather than sliding: a sliding window
needs the timestamp of every hit, a fixed one needs one row, and its failure
mode -- up to twice the rate across a boundary -- is bounded and understood.
Correct across replicas beats precise on one.

Postgres rather than Redis because the deployment already requires Postgres and
ADR-011 defers a second datastore until there is a measured reason. Redis would
be faster per call and no more correct.

**Consequences.** One round trip per limited request. The limiter fails *open*
on a database error and says so in the log: every request it guards needs the
same database one step later, so a limiter that turns a database blip into a
second outage is worse than one that stops counting for a moment. The worker
prunes stale buckets on its housekeeping tick.

`e2e/tests/08-idempotency-limits.spec.ts` scales the API to two replicas and
asserts the limit is still the configured number. That needs
`deploy/compose.scale.yaml`, which drops the API's published host port -- a
fixed published port cannot be replicated.

---

## ADR-021 — Deployment artefacts are tested like code

**Context.** Manifests, alert rules and configuration templates are usually
reviewed by eye and discovered to be wrong during an incident. Three of this
product's defects lived in exactly that space, and two more were caught while
the manifests were being written:

* a Kustomize `nameSuffix` renamed the Services while the ConfigMap addressing
  them kept the old name. The deployment would have come up healthy and been
  unable to dispatch a single run;
* the migration Job was Burstable for memory, so an OOM under node pressure
  could leave a schema half-migrated.

**Decision.** Every deployment artefact has a test:

| Artefact | Test | What it would otherwise cost |
|---|---|---|
| `deploy/kustomize/` | renders the overlay and asserts no Ingress path reaches the engine, every image is pinned to one release, every container has requests and limits with memory Guaranteed, there is a default-deny NetworkPolicy, and service names still match the ConfigMap | a healthy-looking deployment that cannot run anything |
| `deploy/alerts.yaml` | every metric name in every expression exists in the exporter, and every rule names a runbook section that exists | silence that looks like health |
| `.env.production.example` | the unedited template is refused, and each individual mistake is refused | a template people ship unedited |
| `scripts/release_gate.py` | a missing report is a failure and a zero-pass suite did not run | a release that claims tests it never ran |

**Consequences.** `kubectl` and `pyyaml` become test dependencies; the manifest
tests skip when `kubectl` is absent so a laptop without it can still run the
suite, and CI has it. The alert-rule test also checks the *other* direction --
an exported metric no rule reads -- because a metric that costs a query on
every scrape and that nothing watches is either dashboard-only by design or an
oversight, and the difference should be written down.

---

## ADR-022 — Tenant provisioning is an API and a CLI over one service

**Context.** `app.bootstrap` creates one workspace so a fresh deployment has
somewhere for its platform admin to land. Onboarding a customer is a different
operation, and anything that worked only because "the default workspace"
existed would be a single-tenant assumption wearing a multi-tenant schema.

**Decision.** One service, `services/provisioning.py`, reached two ways:

* `POST /api/v1/platform/workspaces` for a control panel or a signup flow;
* `python -m app.provision create ...` for a shell.

Both create the workspace, its first owner, its concurrency quota and its
engine binding in one transaction, and record `workspace.provisioned` in the
audit log of the workspace they just created -- so a customer's own trail
starts with who created it.

The CLI exists because onboarding must not require the API to be up, reachable
or holding a session. It acts as a *named* platform admin (`--as`), and refuses
rather than inventing a system identity: an audit row whose actor is "the CLI"
answers nothing when somebody asks who created a tenant.

Authority is the platform-admin flag, checked in the service rather than
through the role matrix. Creating a tenant is not an action *within* a tenant,
so no workspace role can express it -- not even Owner, which is the top of the
customer's own hierarchy.

**A bug this surfaced.** `access.reachable` gave a platform admin every active
workspace *or* their memberships, not both. `bootstrap` gives the first admin
an Owner membership, so the platform branch never applied to the one account
that needed it: they could provision a tenant and then not open it. It is now
additive, with their own memberships first so they land where they belong.

**Consequences.** A suspended workspace refuses every request including its
owner's, which makes it usable for a billing hold without deleting anything.
Engine instances are addressed by name, which is now unique -- `--engine
eu-west-1` has to mean one cluster.



---

## ADR-023 — The compiler pins n8n's execution order, and its condition types

**Context.** Two defects that no suite had caught, both found by running a
seeded demo and reading `execution_node_results` rather than the canvas.

The first: `IF` into two branches into `Merge` executed *both* branches. The
untaken one ran, `Merge` emitted an item assembled from an empty input, and the
run finished green with the wrong answer. This is the most ordinary shape in
the product, and the canvas showed nothing wrong -- every node was a green
tick, which is exactly what it should look like when the engine is lying.

The cause is a default. `WorkflowExecute` consults a multi-input node's
`requiredInputs` only when the workflow's `settings.executionOrder` is `'v1'`;
otherwise it waits for *every* input, and to get them it runs the branch the
condition rejected. `Merge` declares `requiredInputs: 1`. The compiler
constructed `new Workflow({...})` without settings, so it got the legacy
ordering, and the legacy ordering makes branching meaningless.

The second: a condition on a boolean field never matched. The compiler routes
each operator to one of n8n's typed condition buckets -- `string`, `number`,
`boolean` -- and `equals` was hardcoded to `string`. A step comparing
`{{ $json.rush }}` to `true` compared the boolean `true` against the string
`"true"`, which is false forever. The step was configured correctly, the canvas
rendered it correctly, and it silently always took the false branch.

**Decision.** `executionOrder: 'v1'` is set explicitly by the compiler, with a
comment saying what breaks without it, and the equality operators pick their
bucket from the field's declared `value_type` instead of assuming text.

Explicitly rather than by relying on n8n's own default for new workflows: the
default is a property of the version in the pin, and ADR-013 exists because
this product does not want its behaviour to move when the pin does.

**Consequences.** A skipped branch is now recorded as `SKIPPED` and drawn
dimmed, so the run view shows the decision the workflow actually made. Golden
workflow tests cover both directions of an `IF`/`Merge`, both directions of a
boolean condition, and a numeric comparison either side of its threshold --
directions matter here, because a bug that runs everything passes any test that
only asserts the branch it expected did run.

**What this says about the test strategy.** Both bugs were invisible to
assertions on final output and on node status. They were visible immediately in
per-node results. Tests over golden workflows now assert what each node did,
not only what the workflow returned.


---

## ADR-024 — Vulnerabilities in the pinned runtime are fixed by override, not by upgrade

**Context.** `npm audit --omit=dev` on the engine reported 35 advisories: 1
critical, 15 high, 19 moderate. Almost all arrive through `n8n-nodes-base`,
which declares SDKs for several hundred integrations the product does not
certify. "Upgrade n8n" is the obvious answer and it is the wrong one; "ignore
the audit" is the other obvious answer and it is also wrong.

**What was measured.** Reachability first, because the tree is not the runtime.
A test boots the engine, executes a real HTTP workflow, and reads the module
cache. 16 of 18 audited packages are never loaded -- including `mysql2`, which
carried the only critical. The node loader is a hardcoded allowlist of six
classes and does not use n8n's `DirectoryLoader`, so this is a property of the
design rather than of one code path: the advisory *"Execute Command Node Allows
Authenticated Users to Run Arbitrary Commands"*, which covers every version of
`n8n-nodes-base`, describes a node that cannot be instantiated.

Two are reachable: `axios` and `@n8n/client-oauth2`, both through
`NodeExecuteFunctions`, which every HTTP step goes through. Three more --
`express`, `path-to-regexp`, `body-parser` -- are reachable through the
engine's own HTTP server rather than through n8n.

Then upgrade paths, as spikes in throwaway trees rather than in the project:

| target | tests | audit total | axios |
|---|---|---|---|
| `1.14.1` (the pin) | 61 pass | 31 | high, reachable |
| `n8n-core@1.40.0` | 61 pass | **38** (4 critical) | still high |
| `core@1.122.46` + `nodes-base@1.121.50` | **4 of 5 files fail** | **69** (7 critical) | clear |
| `1.14.1` + `overrides.axios: 1.18.0` | 61 pass | **29** | **clear** |

Newer is not safer. 1.40.0 costs the pin and buys nothing: its axios is 1.6.7,
inside the advisory's `1.0.0 - 1.17.0`. The 1.12x line does clear axios and
mysql2, and brings 1065 packages instead of 618, 69 advisories, and an
`n8n-workflow` ESM entry point whose internal imports do not resolve
(`dist/esm/logger-proxy`) -- a build problem, not a flake.

**Decision.** Keep the pin. Fix the *reachable* advisories with npm
`overrides`, and treat the unreachable ones as what they are.

`workflow-engine/package.json` overrides:

* `axios: 1.18.0` -- `n8n-core@1.14.1` declares `^0.21.1`, so this is a major
  jump inside a pinned dependency, taken deliberately. It clears both reachable
  n8n advisories.
* `qs: 6.16.0` -- `express` and `body-parser` declare `~6.15.1`, so this is
  outside their stated range. It clears the query-parsing advisories that the
  engine's own server is exposed to.

Both are constraint violations by construction: an override is the tool for
saying "the maintainer's range is wrong for us". Neither is safe because npm
allowed it -- each is safe because the 61 golden workflow tests and the browser
suite pass with it, against the built image.

`express` itself went `4.21.2 -> 4.22.2`, which is an ordinary upgrade of a
direct dependency and needs no override.

**The risk this accepts.** axios 0.21 to 1.18 changes API that
`NodeExecuteFunctions` uses. The golden tests cover real HTTP calls, redirects
and error normalisation, and the browser suite runs workflows through the built
image -- but they do not cover every axios path n8n can take (proxies, some
binary and multipart shapes, less common auth injections). If a request shape
breaks, it breaks in the HTTP node, which is the most-used node in the product.
That is the trade against a reachable high-severity advisory in the same code
path, and it is recorded here so the next person can revisit it rather than
rediscover it.

**Rejected.** A VEX entry for axios. VEX is for stating that vulnerable code is
not reachable, and axios demonstrably is -- writing one would have been a
measurement saying the opposite of the measurement above. VEX remains right for
the 16 packages that never load, where the allowlist is the justification.

**Consequences.** `npm audit` is still not clean and will not be: 29
advisories remain, essentially all of them in SDKs for uncertified nodes.
Silence would have to come from a pruned `n8n-nodes-base`, which means
repacking somebody else's package. The number is not the goal; which
advisories are reachable is, and that question now has a test rather than an
opinion.


---

## ADR-025 — The interface is checked by measurement, not only by assertion

**Context.** 109 browser tests passed at one viewport, 1600x1000, keeping a
screenshot only when a test failed. Compatible with all of that:

* the entire metadata layer of the product set at **10px** with -0.015em
  tracking -- `text-tiny`, 123 call sites, every badge, every table's second
  line, every node subtitle -- plus three hardcoded `text-[10px]` classes that
  bypassed the scale entirely;
* the editor's toolbar overflowing a 390px viewport, with **Run** -- the button
  that screen exists for -- sliced in half by the window edge;
* an empty bordered rectangle in the inspector for every manual trigger,
  because the trigger panel drew its container before checking whether it had
  anything to put in it;
* the overview opening with six equal-weight tiles, four of them usually zero,
  above three cards that rendered whether or not they had rows -- so one failed
  run sat in the same visual register as five zeroes and a box saying
  "nothing is running".

None of these is a behaviour a test would naturally assert. All of them are
obvious in a screenshot.

**Decision.** Two additions, and they are not the same thing.

*Measured invariants*, in `e2e/tests/11-appearance.spec.ts`, at 1440x900,
1280x800 and 390x844:

* no horizontal document overflow -- and the failure names the widest
  offending element, because "something is 40px too wide" is not actionable;
* no rendered text below **12px**, checked on elements that have their own text
  and a non-zero box, so an inherited size on an empty wrapper is not reported;
* the primary action inside the viewport, and the canvas at least 200px in
  both directions.

*Pixel baselines* for exactly one screen: sign-in, the only page in the product
with no server data on it. A snapshot of a page showing relative timestamps and
run counts fails on a Tuesday for reasons nobody wants to debug. Pictures where
the page is static, measurement everywhere else.

**What the measurement found immediately.** Three `text-[10px]` classes that
the type-scale change could not reach, because an arbitrary Tailwind value is
invisible to a token. That is the argument for measuring the rendered result
rather than reviewing the source: the scale was correct and the page was not.

**The type scale.** Ten steps became eight, with a floor of 12px. `micro` had
zero call sites -- a step nobody chose, which is how a scale grows -- and
`label` was a second name for 12px, so both are gone and `tiny` is now the
floor. Negative tracking is kept only on h1/h2/h3, where the type is 20px and
up and tightening is what stops a heading looking gappy.

**The editor.** A canvas with two dialogs over it became three columns:
palette rail, canvas, inspector. Both side panels collapse, both remember their
width, and the dialogs survive only below `xl`, where a third column does not
fit. The palette is addressed in tests by `data-palette` rather than by role or
position -- it has moved once and should survive moving again. Changing it
broke nine tests, none of them about the palette's shape, which is what a
fixture that knew only about the dialog was always going to cost.

**Consequences.** The three viewports are asserted on every run, so a layout
that only works at 1600px now fails rather than passes quietly. `React Flow`'s
attribution link is styled up to 12px rather than removed: deleting it to
satisfy a font-size rule would answer a legibility question with a licensing
one.

What this does **not** cover: whether the result is any good. A measured floor
catches 10px text and cannot tell you the page has no focal point. The
screenshots still have to be looked at, and the four defects at the top of this
entry were all found by looking.


---

## ADR-026 — A node's output preview shows the ports it has, not the arrays it returns

**Context.** Certifying `Filter` -- the ninth node, and the first whose n8n
implementation returns more output arrays than it declares outputs.

`Filter` declares `outputs: ['main']` and its `execute` ends
`return [returnDataTrue, returnDataFalse]`. The second array holds the items it
*dropped*; nothing is ever connected to it, and `WorkflowExecute` discards it.

The engine's normalizer did not. `itemsOf` flattened every branch in
`task.data.main`, so a filter that passed two of four items reported four, and
listed the two discarded rows in the run panel as though they had gone on.
Downstream received two; the panel said four. The workflow was correct and the
screen was lying.

**Why the tests did not see it.** The golden tests for `IF` and `Switch` assert
per-node *status* -- which branch ran, which was skipped -- and that was enough,
because those nodes leave the untaken branch empty and flattening an empty
array changes nothing. `Filter` is the first node where a branch is both
non-empty and not connected. The defect was two years old and had never had a
node that could expose it.

**Decision.** The compiler publishes `outputPortsByName`, taken from the
product registry's `capability.output_ports`, and the normalizer reads only
that many branches. The product's own catalogue is the authority on how many
outputs a step has -- not the implementation's return value, which is n8n's
private business.

Unbounded when the count is unknown, which is the previous behaviour: showing
too much is a smaller fault than silently hiding a branch the product does know
about.

**Consequences.** `item_count` and the JSON preview now match what the next
step receives, which is what a person reading the panel assumes they mean.
`branch_metadata` is untouched and still records every branch, including ones
with no port -- it is diagnostic data, and the canvas uses it to grey out a
branch that did not fire.

The general shape of this is worth keeping in mind for every node added from
here: **an n8n node's runtime behaviour is not fully described by its
declaration**, and the only way to find the gap is to run one and compare what
the panel says with what the next step got. The certification checklist in
`docs/node-catalog-backlog.md` now says so.


---

## ADR-027 — A redacted value is a view, never the data

**Context.** `executions.start_payload` held one value used for two purposes,
and the value it held was the redacted one. `_sanitize_payload` masked anything
key-like, capped arrays at fifty items and strings at 4096 characters — correct
for a column every execution screen reads, and catastrophic for the column the
worker hands to the engine.

A webhook body arriving with a token and sixty line items was *executed* as
`{"password": "********"}` with fifty items. The run succeeded, against input
the caller never sent. A retry re-ran the mangled version, because retry copied
the same column. Nothing anywhere reported it: the numbers were plausible and
the workflow was green.

**Decision.** Two values, two jobs, two columns.

* `start_payload` — the redacted preview. What the API returns and every screen
  shows. Unchanged behaviour.
* `start_payload_sealed` — the caller's payload, Fernet-encrypted with the same
  key that protects credentials, read only when the worker dispatches a run and
  when a retry re-sends one.

Encrypted rather than plain, because the redaction was not paranoia: a run
payload is the likeliest place in the product for a live token to arrive, and
this row is read widely. Removing the masking without sealing the real value
would have traded a correctness bug for a disclosure one.

Rows written before the column existed get NULL. They cannot be recovered — the
original was never stored — so the dispatcher falls back to the preview and logs
`execution.payload_fell_back_to_preview`, because a run quietly receiving less
than it should is the defect this exists to end.

**Consequences.** `test_payload_integrity.py` is written from the four shapes
that lose information passing through `redact` — a sensitive key, an array over
the cap, a string over the cap, and nesting past the depth limit — and asserts
*both* halves for each: intact for the engine, redacted for the screen. Fixing
one direction by breaking the other is the obvious wrong turn, and one
assertion each way is what stops it.

Verified against the running stack as well as in unit tests: a workflow whose
step copies `$json` reported `password: hunter2`, sixty items and a
5000-character string, while the stored preview held `********`, fifty items
and 4108 characters.

**The general rule.** Redaction is a property of a *rendering*. The moment a
redacted value is stored in the field the system reads back, it has stopped
being a view and become the data. Anywhere else this pattern appears — logs
that feed a replay, an audit row used to reconstruct state — the same split
applies.

---

## ADR-028 — Quotas need a lock, and liveness needs its own writer

**Context.** Two defects with the same shape: a guarantee that could not be
made by the code that claimed to make it.

**The quota.** `_check_concurrency` counted active runs; the insert happened
several lines later. Two requests arriving together both counted `ceiling - 1`
and both inserted, so a workspace capped at 10 could reach 12. Same-key bursts
were already safe — the partial unique index settles those (ADR-019) — and
*different* keys were only ever fired sequentially by the suite, so nothing
exercised the window. Measured: a burst of 12 against a ceiling of 3 admitted
4.

**The liveness signal.** `AppbiWorkerStopped` alerted on
`engine_instances.last_probe_at` going stale. The worker writes that field once
a minute — and so does the API's engine-status endpoint, which every open
browser tab polls. So the field stayed fresh while the worker was dead, and the
one alert that would have revealed a stopped worker could not fire as long as
somebody had the product open. Measured: worker down 88 seconds, one page load,
probe age 0.1s.

**Decisions.**

`pg_advisory_xact_lock` around the count-then-insert, scoped to the workspace.
Not `SELECT ... FOR UPDATE`: there is no row to lock. What is being protected is
the *absence* of rows, which is what a predicate lock is for and what row
locking cannot express. Transaction-scoped, so it is released however the
transaction ends. Per workspace, so tenants never wait on each other.

`last_worker_beat_at`, written by `app.worker` and by nothing else, exposed as
`appbi_worker_beat_age_seconds`, and the alert reads that.

**The rule worth keeping.** A liveness signal must be written by the thing whose
liveness it reports. Sharing a freshness field between the subject and an
observer makes the observer's health indistinguishable from the subject's.

**Consequences.** The quota test now fires 12 concurrent requests with 12
distinct keys and asserts the exact ceiling. It was verified by removing the
lock and watching it fail with "accepted 4 with a ceiling of 3" — a test that
has never been seen to fail is a test nobody has checked.

`test_deployment_manifests.py` asserts the alert reads the heartbeat and not the
probe, and that *something* may scrape `/metrics`: the NetworkPolicy admitted
only the frontend, so every alert rule in `deploy/alerts.yaml` evaluated on no
data. A monitoring rule that cannot be scraped is worse than no rule, because
its silence reads as health.

---

## ADR-029 — Tenant membership is a schema constraint where the pair can disagree

**Context.** Every tenant-scoped query carries `workspace_id`, and
`test_tenant_isolation.py` walks the AST to prove it. That guard has a shape of
hole: it inspects `select()`, so a `get`, an `update`, a `delete` or anything
reaching for raw SQL is outside it — and a future writer only has to forget
once.

**Decision.** Close it at the schema level for the rows that carry *both* a
tenant column and a parent, because those are the only ones whose two answers
can disagree. `executions` has `workspace_id` and `workflow_id`, and nothing
stopped them naming different tenants: a bug anywhere in the write path could
file tenant A's run against tenant B's workflow, and every later read — being
correctly filtered by `workspace_id` — would then hide the row from the tenant
it actually belonged to.

`fk_executions_workflow_same_workspace` references
`workflows(workspace_id, id)`. The pair is now unrepresentable; verified by
attempting the insert directly in `psql` and being refused.

`execution_node_results` needs nothing: it has no `workspace_id` of its own and
inherits its tenant entirely through `execution_id`.

**Rejected, for now.** Row-level security on all nineteen tables. It needs every
connection to carry the tenant (`SET LOCAL app.workspace_id`) — including the
worker's, the reconciler's and the migration runner's, none of which have a
request context — and a policy that silently matches nothing turns a leak into
an outage. Half-done RLS is worse than none. It stays open, and this ADR is
where the reason lives.

**Consequences.** `07-tenancy.spec.ts` now drives twelve *mutating* routes as
the wrong tenant — delete, deactivate, publish, rotate-secret, run, duplicate,
draft read and write, cancel, retry, node list and node input — and asserts 404
for each, then checks the owning tenant still has its data. 404 rather than 403
throughout: telling A that B's id exists is already a leak.


---

## ADR-030 — Two security exceptions carried into the internal pilot

**Context.** `v1.0.0-rc1` ships for an internal pilot with two known gaps. They
are written down here rather than left in a review thread, because an exception
nobody owns is not an exception, it is a thing that was forgotten.

Both are scoped to **one organisation, internal use**. Neither survives a
decision to open the product to customers or to independent organisations: that
decision re-opens this ADR before it re-opens anything else.

### Exception 1 — no row-level security

**What is missing.** None of the nineteen tables has RLS. Tenant scoping is
enforced by every query carrying `workspace_id`, checked structurally by
`test_tenant_isolation.py`, which walks the AST looking at `select()` calls.

**What stands in for it.**

* A composite foreign key, `fk_executions_workflow_same_workspace`, so an
  execution filed against another tenant's workflow cannot be written at all
  (ADR-029). Verified by attempting the insert in `psql` and being refused.
* Twelve *mutating* cross-tenant routes in `07-tenancy.spec.ts` — delete,
  deactivate, publish, rotate-secret, run, duplicate, draft read and write,
  cancel, retry, node list, node input — each asserted to answer 404, with the
  owning tenant's data confirmed intact afterwards.
* `X-Workspace-Id` spoofing and malformed values, refused rather than honoured.

**Why it is not simply done.** RLS needs every connection to carry the tenant
(`SET LOCAL app.workspace_id`), including the worker's, the reconciler's and
the migration runner's — none of which have a request context. A policy that
silently matches nothing turns a leak into an outage, and half-applied RLS is
worse than none, because it reads as protection.

**Residual risk.** A future writer adding a `get`, an `update`, a `delete` or
raw SQL without the tenant filter, on a table the composite key does not cover.
The AST scan will not see it.

* **Owner:** backend lead.
* **Review by:** the first of — 2026-12-01, or the decision to admit a second
  organisation, or the first tenant-scoped table added without a composite key.
* **Exit:** RLS on `workflows`, `executions`, `credentials`, `audit_events` at
  minimum, with the session variable set in one place in the session factory.

### Exception 2 — 29 dependency advisories in the pinned runtime

**What is missing.** `npm audit --omit=dev` reports 29 findings: 1 critical, 11
high, 17 moderate. The pin at n8n 1.14.1 (ADR-013) is deliberate and moving it
does not help — measured in ADR-024, where 1.40.0 scored *worse* (38 findings)
and the 1.12x line broke the build outright.

**What stands in for it.**

* `release/vex-*.cdx.json`, generated by `scripts/sbom.py` from a
  **measurement**, not a list: `tests/contract/reachability.test.ts` boots the
  runtime, builds the HTTP app, executes a real workflow and reads
  `require.cache`. 27 of the 39 audited packages are never loaded, because the
  engine's node allowlist is hardcoded and never calls n8n's `DirectoryLoader`.
* The one critical, `mysql2`, is among them: the MySQL node is not certified
  and cannot be instantiated.
* The two reachable advisories with fixes — `axios` and `qs` — are overridden
  to patched versions inside the pinned tree (ADR-024).
* One finding remains `affected`: `file-type`'s ASF parser, reachable but not
  fed caller-controlled input, because V1 has no binary data path (ADR-012).

**Residual risk.** The VEX is only as good as the measurement, and the
measurement covers the paths the tests exercise. A node certified later can
make a package reachable that this document currently clears — which is why
`docs/node-catalog-backlog.md` lists re-running the reachability test as part
of certifying one.

* **Owner:** platform lead.
* **Review by:** the first of — 2026-12-01, the next n8n pin change, or any
  node certification that adds a credentialled or binary-capable step.
* **Exit:** a pruned `n8n-nodes-base` carrying only certified nodes, which
  removes the packages rather than explaining them.

**Consequences.** `release_gate.py --delivery internal` passes with these in
place; `--delivery commercial` still refuses, and these exceptions are part of
why. Neither may be cited as precedent for the other: they have different
owners and different exits.
