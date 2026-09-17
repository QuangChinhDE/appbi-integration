# AppBI Workflow Automation Platform

Workflow automation with an AppBI-style product frontend and **n8n as an
embedded execution engine** — not as the application behind a reskin.

The product owns the workflow, its versions, its triggers, its credentials and
its execution history. n8n contributes exactly one thing: the semantics of
running a graph (item propagation, branching, merging, expressions, node
behaviour). Everything a user sees, and everything the database stores, is the
product's own.

Built to the specification in
[`BA_SRS_AppBI_Workflow_Automation_n8n_Core.md`](BA_SRS_AppBI_Workflow_Automation_n8n_Core.md);
the decisions are recorded in [`docs/adr/index.md`](docs/adr/index.md).

> **Delivery scope: internal.** n8n is under the Sustainable Use License, which
> covers one organisation's own use and does not cover selling or hosting this
> for customers. See [Licensing](#licensing) before treating it as a product to
> ship. Current state: `v1.0.0-rc1`, a release candidate for an internal pilot.

---

## What runs where

```
browser
   │  only ever /api/v1 and /hooks  (guardrail 1)
   ▼
frontend  ── Next.js 15, the AppBI design system
   │
   ▼
api  ─────── FastAPI. Auth, RBAC, tenancy, workflow/version/draft, triggers,
   │         credentials, execution records, audit, the normalized error envelope
   ├── postgres      the system of record. No n8n metadata database exists.
   ├── secret store  envelope-encrypted credentials
   │
   ▼   WorkflowEngineAdapter — the only thing that knows an engine exists
worker ───── dispatch, schedule tick, reconciliation, retention
   │
   ▼   internal HTTP, shared token, no published port
engine ───── Node/TypeScript. The only place that imports n8n.
             compiler (product graph → n8n Workflow) · allowlisted nodes ·
             WorkflowExecute · IRun → product DTO
```

The engine has no public route, no scheduler, no webhook server, no editor and
no database. Those are all product concerns, and the compose file enforces the
first one by simply not publishing its port.

### The pinned runtime

`n8n-workflow`, `n8n-core` and `n8n-nodes-base` at **1.14.1**, exactly.

Deliberately not the newest line. Measured against the published dependency
manifests, `n8n-core@1.14.1` needs `typedi` and `n8n-workflow`; `1.60` adds
`@langchain/core`; `1.122` and `2.x` add `@n8n/backend-common`, `@n8n/config`,
`@n8n/di`, `@n8n/decorators`, `@sentry/*` and `@aws-sdk/client-s3` — the
application's own service container, in a process that only wants
`WorkflowExecute`. See [ADR-013](docs/adr/index.md#adr-013--n8n-pin-and-upgrade-policy-the-114-line).

The pin lives in [`compatibility.yaml`](compatibility.yaml) and
[`node-lock.json`](node-lock.json), and `python scripts/certify.py --check`
fails the build when the installed tree, the catalogue and the pins stop
agreeing.

---

## Getting it running

Needs Docker, Python 3.12 and Node 22.

```powershell
.\run.ps1 setup      # venv, npm installs, database, migrations, seed data
.\run.ps1 up         # engine + api + worker + frontend
.\run.ps1 smoke      # end-to-end walk through the product API
```

```bash
./run.sh setup
./run.sh up
./run.sh smoke
```

Then open <http://localhost:3000>. `setup` prints the bootstrap account's
password once; that account can sign in and change its password, and nothing
else, until it has.

If port 8000 or 3000 is taken:

```powershell
.\run.ps1 up -ApiPort 8001 -FrontendPort 3100
```

```bash
API_PORT=8001 FRONTEND_PORT=3100 ./run.sh up
```

### Or in containers

```bash
cp .env.example .env     # then fill in SECRET_ENCRYPTION_KEY and JWT_SECRET
docker compose up -d --build --wait
docker compose logs migrate | tail -20     # the admin's one-time password
```

That is the whole install. A `migrate` service runs before the API and does the
five steps in the one order that works — schema, migration, drift check,
catalogue, first admin — and stops the deployment if any of them fails rather
than leaving a half-built one running. The generated admin password is printed
once, in its log, and must be changed on first sign-in.

`API_HOST_PORT`, `FRONTEND_HOST_PORT` and `POSTGRES_HOST_PORT` move the
published ports when those are taken — but change `DATABASE_URL` alongside the
last one, or every local tool loses the database.

`IMAGE_TAG` selects which build the stack runs, so two checkouts on one host do
not share an image. Note that `docker-compose.yml` fixes the project name, so
`docker compose up` from a second checkout controls the *same* stack unless you
pass `-p`.

`docker compose ps` should show `engine` with a container port and **no host
mapping**. That is guardrail 15 enforced by the compose file rather than by a
convention.

`docker compose` is the shape of a real deployment; `run.ps1` / `run.sh` is for
development, where the API and the engine restart far faster outside a
container.

### Something to look at

An empty deployment is correct and tells you nothing. To fill one:

```bash
python scripts/demo_seed.py --base http://127.0.0.1:8010
```

Seven workflows covering the certified nodes, run where they can be run, so
every screen has real execution data behind it — including one workflow that
fails on purpose, because the error screen is part of the product and an
untested error screen is a promise nobody has kept.

The HTTP steps call real public APIs. That matters: a green node means a
request genuinely left the machine, which is the one thing a mocked test can
never tell you.

It refuses to seed on top of itself. Seed a second tenant with `--tenant-name`,
or start clean with `docker compose down -v`.

The webhook demo is separate because its point is the signature:

```bash
python scripts/demo_webhook.py --url <the URL the seed printed> --secret <...>
python scripts/demo_webhook.py --url <...> --unsigned   # watch it refused
python scripts/demo_webhook.py --url <...> --replay     # a stale timestamp
```

A webhook that anybody who has seen the URL can fire is not authenticated, so
the gateway requires an HMAC over `timestamp.body` and refuses anything else.
`--unsigned` and `--replay` show the two refusals; an unknown key and a
disabled trigger answer identically, so the endpoint cannot be used to
enumerate workflows.

---

## Repository layout

| Path | What it is |
|---|---|
| `frontend/` | Next.js app. Design tokens, primitives and shell inherited from AppBI Pipeline. |
| `backend/app/api/` | HTTP surface: `/api/v1/**` plus the public `/hooks/{key}` gateway. |
| `backend/app/services/` | The domain. `graph.py` is pure and has no database or engine in it. |
| `backend/app/engine/` | `WorkflowEngineAdapter` and the n8n service adapter. The boundary. |
| `backend/app/models/` | Product schema. Three tables for "a workflow": identity, draft, versions. |
| `backend/migrations/` | Alembic. Applies, rolls back and re-applies in CI. |
| `workflow-engine/src/compiler/` | Product graph → n8n `Workflow`. The only translation layer. |
| `workflow-engine/src/nodes/` | The allowlist, and the product's own start node. |
| `workflow-engine/src/runtime/` | `WorkflowExecute` bootstrap, error normalizer, redaction, egress guard. |
| `workflow-engine/tests/contract/` | Golden workflows against the real runtime. |
| `docs/adr/index.md` | Twenty-two decisions, each with what was rejected and why. |
| `e2e/tests/` | Playwright. The same journeys through a browser, against the images. |
| `deploy/kustomize/` | Kubernetes. The base is not applyable on its own, on purpose. |
| `deploy/production.yaml.example` | Single-host production: no database container, no published API port. |
| `deploy/alerts.yaml` | Prometheus rules. Each one names a runbook section that exists. |
| `scripts/smoke.py` | UAT-001 … UAT-019 walked through the product API. |
| `scripts/doctor.py` | Refuses a configuration that is not safe to deploy. |
| `scripts/install.py` | Migrate and bootstrap, in the one order that works. |
| `scripts/backup.py` | Dump with a manifest, and prove it restores. |
| `scripts/restore.py` | Restore into a named database, deliberately awkwardly. |
| `scripts/schema_drift.py` | Does the live schema match the models. |
| `scripts/release_gate.py` | Whether this commit may be released, and the artefact saying so. |
| `scripts/demo_seed.py` | Fills a fresh deployment with something to look at, and to try. |
| `scripts/demo_webhook.py` | Calls a webhook the way a real sender must, signature and all. |
| `scripts/certify.py` | The compatibility gate. |
| `scripts/mirror_bundle.py` | Bundles the packages an internal registry must hold, hash-checked. |

---

## The certified nodes

`n8n-nodes-base` ships 294 node directories, all of them already in the image.
Nine are certified, because certification is a decision and not an import:
each one needs a registry entry, a `config_schema`, a compiler mapper, an
allowlist entry with pinned versions, a golden test asserting per-node results,
and both locales. [`docs/node-catalog-backlog.md`](docs/node-catalog-backlog.md)
lists what to certify next, in tiers by what each costs.


| Product node | Compiles to | Notes |
|---|---|---|
| Manual Trigger | `appbi.start@1` | The product decides when a run starts. |
| Webhook Trigger | `appbi.start@1` | The public endpoint is the product's (ADR-005). |
| Schedule Trigger | `appbi.start@1` | The product's scheduler fires it (ADR-004). |
| HTTP Request | `n8n-nodes-base.httpRequest@4.1` | Behind an egress policy. |
| Edit Fields | `n8n-nodes-base.set@3.2` | |
| IF | `n8n-nodes-base.if@1` | True/false ports. |
| Filter | `n8n-nodes-base.filter@1` | One port: matching items go on, the rest stop. The node returns a second array of what it dropped, which the preview must not read — ADR-026. |
| Switch | `n8n-nodes-base.switch@2` | The fallback branch compiles to a catch-all rule — v2 has no extra output. |
| Merge | `n8n-nodes-base.merge@2.1` | Two named input ports. |

A user never sees the right-hand column. `engine_binding` is served only to a
platform admin, from the admin endpoints (guardrail 9).

Adding a node is a certification exercise, not an import: a registry entry, a
compiler mapping, a golden test, and `certify.py` agreeing.

---

## Testing

```powershell
.\run.ps1 test      # all three suites
.\run.ps1 smoke     # end-to-end against a running stack
.\run.ps1 e2e       # Playwright: the same journeys through a browser
```

**Engine contract suite** — 56 tests against the real pinned runtime, no engine
mocks. The fifteen golden workflows from SRS 43.4, the internal HTTP contract,
and the SSRF policy. These are what an n8n upgrade has to keep green.

Assertions are on the *normalized product result*, never on `IRun`: snapshotting
upstream's shape would fail on changes that do not affect the product and pass
on ones that do.

**Backend unit tests** — 225 tests over graph validation, schedule arithmetic
(including timezone correctness), redaction, the RBAC matrix, the error UX
matrix, the wire form of an engine request, the production configuration gate,
the release gate, the rendered Kubernetes manifests, the alert rules, and a
static check that every tenant query names its tenant. No database: none of
those need one, which is why they run in three seconds.

Four of those groups check *artefacts* rather than code, which is unusual and
deliberate. `test_deployment_manifests.py` renders the production overlay and
asserts that no Ingress path reaches the engine, that every image is pinned and
that a release suffix has not renamed the Services out from under the ConfigMap
that addresses them — the last of which caught a manifest that would have come
up healthy and been unable to dispatch a single run. `test_alert_rules.py`
checks each alert expression's metric names against the exporter, because a
rule naming a metric nobody publishes never fires and silence looks exactly
like health. `test_tenant_isolation.py` walks the AST of every service module
and requires a `workspace_id` filter on any query touching tenant data, with an
allow-list where crossing the boundary is the point.

**Frontend component tests** — 32 tests over the parts that carry a decision
rather than markup: which ports a node offers given its rules, whether publish
is allowed, where a remediation sends the user, that every status renders a word
and not only a colour, and that the data picker hands back a usable expression
path. Two of them found real accessibility defects before the code was right —
a label with no associated control, and an expander sharing its accessible name
with the button beside it.

**Smoke test** — signs in, builds a five-node graph, runs the draft, checks that
expressions resolved against real data, publishes v1, edits the draft, proves v1
did not change, publishes v2, activates, rolls back, retries, creates a
credential and checks the secret is never echoed. Thirty-nine checks, and they
pass against both the development processes and the container stack.

**Browser suite** — 109 Playwright tests driving the real interface against the
container stack, run one at a time because the per-workflow concurrency ceiling
is one. They cover the shell and every module page, first-run behaviour in a
workspace provisioned for the purpose, sign-in and the forced password change,
building a graph on the canvas, running a draft and reading the engine's actual
output off the node cards, publish/activate/rollback, the draft conflict,
credentials, role gating, the webhook and schedule trigger panels, execution
history, workspace settings and the audit log.

Then the things that are properties of a *deployment* rather than of a
function, and cannot be tested by calling something once:

| Spec | What it establishes |
|---|---|
| `07-tenancy` | A platform admin provisions two tenants; A then fails to read or write B's workflow, credential, execution or audit trail — by id, and with an `X-Workspace-Id` header naming B. Also that a tenant owner cannot provision a tenant, and that a suspended workspace refuses its own owner. |
| `08-idempotency-limits` | Ten concurrent `Run` requests with one `Idempotency-Key` produce one execution, and a retried webhook delivery produces one. Then the API is scaled to two replicas and the per-minute limit is still the configured number rather than twice it. |
| `09-operations` | The doctor refuses the shipped template, the development configuration, and each individual mistake; drift is detected when a column is added by hand; a backup is taken, verified, restored into a new database, and the restored copy is checked for a signed-in account, its workspace, and credentials that are still ciphertext. |
| `10-members` | The invite journey through the settings screen, a role change taking effect on the invited account's *next* request with no re-login, a revoked membership taking effect immediately, and the last owner being undemotable. |
| `clean-install` | `docker compose down -v` then `up --wait`: the migration runs, the schema is at head with no drift, the bootstrapped admin is made to change its password, the API smoke suite passes, and a second `up` changes nothing. Opt-in, because it deletes the data volume. |

This suite is the only one that runs the *images* rather than the sources, and
that is where it earns its keep. It found six defects that every other suite was
structurally unable to see:

| Found | Why nothing else could see it |
|---|---|
| `output: 'standalone'` bakes `rewrites()` at build time, so the container frontend proxied to `127.0.0.1:8000` and could not reach the API at all | Only exists in the built image — the dev server reads the same config at runtime and works. |
| An unparseable error body reached the login form as a raw `SyntaxError` | Needs a response that is not JSON, which the API never sends and no unit test simulated. |
| A validation dry run sent no credentials, so **no workflow that authenticated to anything could ever be published** — the same well-meant "no secrets on validate" decision, made independently in three layers | The product, the adapter and the engine each looked correct in isolation. Only an end-to-end publish showed the result. |
| The mobile config sheet is a portal, so `xl:hidden` styled an empty wrapper and left a modal over the canvas at every width | A component test renders the portal without a viewport; a browser has one. |
| `invalidateQueries` matched nothing, because `qk.credentials(ws)` appended `undefined` and so was not a prefix of the active key — a created credential never appeared in the list | The mutation succeeded and the API was right; only the cache was wrong. |
| The conflict banner's Reload handed back the cached draft, because `fetchQuery` honours `staleTime` — the banner cleared and nothing changed | Requires two writers and a real fifteen-second cache. |

Two frontend component tests had already found real accessibility defects the
same way, and the browser suite found the class behind them: labels tied to
their controls by hand, which several screens had simply not done. That is now
structural — `Field` generates the id and wires both sides.

A second round of hardening for multi-tenant operation found five more, and the
pattern held: each one was invisible to every test that did not run the whole
deployment.

| Found | Why nothing else could see it |
|---|---|
| `derive_health` looked up a credential by id alone, so a workflow in workspace A naming B's credential got back B's row — and **B's credential name in A's health message** | Not a permission bug and not a route bug, so the RBAC and API tests passed. Every service test builds its fixtures in one workspace, so a missing tenant filter is unobservable. |
| A platform admin with a membership row lost their platform-wide reach, so they could provision a tenant and then not open it. `reachable()` was an either/or, and `bootstrap` gives the first admin a membership — so the branch never applied to the one account that needed it | Requires two workspaces and an account that belongs to one of them. |
| Idempotency was a read-then-write, so two clicks of `Run` arriving together both read nothing and both inserted | A sequential pair is answered by the service's own lookup and never reaches the race. |
| The webhook rate limit was an in-process counter, so the effective limit was the configured number times the replica count — and changed whenever somebody scaled the deployment | Single-replica tests pass against an implementation that is wrong in production. |
| `api`, `worker` and `migrate` each had their own `build:` block over one Dockerfile, so compose produced three separately-tagged images and `docker compose build api` left the migration running the previous build | Only shows when a change to shared code has to reach all three. |

Two more were caught by the manifest tests before they ever ran: a Kustomize
`nameSuffix` that renamed the Services while the ConfigMap addressing them kept
the old name, and a migration Job that would have been Burstable for memory.

### Looking at it, which is a different question

`e2e/ux-walkthrough.mjs` is not a test. It provisions a tenant, signs in as its
owner and does what a new customer would do on their first afternoon, taking a
screenshot at every step:

```bash
cd e2e && node ux-walkthrough.mjs --headed --out ./ux-screenshots
```

Assertions answer "does it work". Only looking answers "is it pleasant", and
the two have different answers. The first walkthrough found five things that
108 passing tests did not, all in the first two minutes of using the product,
and all with the same cause: **every test seeds its graph through the API, so
none of them had ever looked at the one the product creates for you.**

| Found | What the user saw |
|---|---|
| `empty_graph` hardcoded the manual trigger's name | A webhook workflow whose first step was called "Khi bấm Run" — "When you press Run" |
| The registry's defaults were rendered by the form but never written to the config | Validation reporting `HTTP method` and `Xác thực` as unfilled, on a panel showing them set to POST and HMAC. Two errors on a workflow three seconds old, for fields visibly filled in |
| The trigger binding stayed MANUAL until the first edit | The header badge read "Thủ công" on a webhook workflow, and **the webhook URL was not on the screen at all** — an empty box where the one thing a webhook is for should be |
| `fitView` had no zoom ceiling | A one-node workflow — which every workflow is for its first thirty seconds — scaled that node to fill the canvas |
| The run panel opened on Output regardless of outcome | A failed step answered "what went wrong?" with an empty Output tab and "Không có". The error was one unmarked tab away |

A second pass, at the three viewports below, found four more — and the same
cause each time: **the suite ran at one width and only kept a screenshot when
something failed.**

| Found | What the user saw |
|---|---|
| `text-tiny` was 10px, with negative tracking, at 123 call sites | Every badge, every table's second line, every node subtitle. The interface read as faint rather than calm |
| Three hardcoded `text-[10px]` classes | Sidebar group headings and the palette's categories, invisible to a change of the type scale because an arbitrary value is not a token |
| The editor toolbar did not wrap | At 390px the actions overflowed the window and **Run** was cut down the middle by the right edge |
| `TriggerFacts` drew its container before checking it had content | An empty bordered rectangle under "Advanced" on every manual trigger, which reads as a field that failed to load |

### Appearance, asserted

`e2e/tests/11-appearance.spec.ts` runs at **1440×900**, **1280×800** and
**390×844**. Two kinds of check, because they catch different things.

**Measured invariants:**

- no horizontal document overflow, and the failure names the widest offending
  element — "something is 40px too wide" is not actionable;
- no text *rendering* below **12px**. Multiplied by the cumulative scale of
  every transformed ancestor, because `getComputedStyle().fontSize` is the CSS
  value and a 12px label inside a canvas fitted at 0.75 reaches the eye at 9px.
  The first version of this check read the CSS and passed;
- the primary action inside the viewport;
- **how much of the editor is canvas rather than panel** — at 1280 that is
  ≥900px with nothing selected and ≥600px while configuring a step. "More than
  200px" passed while the canvas was 435px, which proved nothing.

The canvas viewport is excluded from the font floor, and that is a decision
rather than an exemption: it is a zoomable surface, and the guarantee there is
that the product never *auto-zooms* below a stated floor — 1 on a phone, 0.5 on
a desktop — which the same spec asserts directly.

**Pixel baselines** for the overview, the editor with a six-step graph and a
step open, and executions that succeeded and failed — twelve images across the
three viewports, plus three of sign-in. Timestamps, durations, ids and hashes
are marked `data-volatile` and masked, so a baseline does not fail on the day
"2 days ago" becomes "3 days ago". `--update-snapshots` accepts a deliberate
change; look at the diff before you do.

This catches 10px text, a clipped button and a canvas squeezed by its panels.
It cannot tell you a page has no focal point — the defects above were all found
by looking, and the screenshots still have to be looked at.

Plus a smaller one: a workflow that has never been published showed an amber
"unpublished changes" warning, which is true and reads as though something is
broken.

All five are fixed, and `backend/tests/test_new_workflow_seed.py` plus a
webhook journey in `03-editor.spec.ts` now cover the seeded graph specifically
— the gap that let them through.

---

## The rules this codebase keeps

Each of these is a decision that would be expensive to reverse, so each is
enforced by something other than good intentions:

| Rule | Enforced by |
|---|---|
| The FE never calls the engine | The engine has no published port; the frontend proxies only `/api/v1` and `/hooks`. |
| Only the engine imports n8n | A CI grep over imports and declared dependencies. |
| No engine identity in the product schema | A CI grep over the migrations. |
| A node outside the allowlist cannot run | Checked in the product *and* again in the compiler. |
| A published version never changes | Nothing in the codebase updates a `workflow_versions` row. |
| A run names the exact artefact it ran | The graph is frozen onto the execution row at creation. |
| Secrets never come back out | Responses carry `{configured, masked_hint}`; a contract test asserts no credential value appears in any engine result. |
| A validation dry run carries no secret, but still resolves | The adapter sends `{credential_id, credential_type, data: {}}`; the engine strips values again on that route; a unit test and a contract test pin both halves. |
| A label is associated with its control | `Field` generates the id and `Label` and the inputs read it from context, so no call site can forget. |
| Every tenant query names its tenant | An AST walk over every service module, with an allow-list that requires a written reason. |
| One `Idempotency-Key` means one run | A partial unique index on `(workspace_id, workflow_id, idempotency_key)`; the loser of the race is answered with the winner's row. |
| A rate limit means the same number on every replica | Counted in Postgres with one atomic statement; a two-replica browser test proves it. |
| The engine is unreachable from outside | No published port in compose, no Ingress path in Kubernetes, and a NetworkPolicy that accepts only `api` and `worker`. Each asserted by a test. |
| A release can say what it was built from | `scripts/release_gate.py` refuses an uncommitted tree, a missing test report, and a suite that reported zero passes. |
| Every alert points at a runbook that exists | The rule file's `runbook:` anchors are checked against `docs/runbooks/README.md`. |
| Payloads are redacted before storage | Twice — engine side and product side — so neither is the single point of failure. |
| The version pin cannot drift | `certify.py --check` compares the pins against the installed tree and the loaded runtime. |
| The licence review is visible | `compatibility.yaml` carries `commercial_gate`; CI prints it and warns while it is not `APPROVED`. |

---

## Operating it

- `/healthz` — liveness.
- `/readyz` — readiness for a load balancer. **Does not** fail when the engine
  is down: the product is designed to stay readable without it, and taking every
  API instance out of rotation would turn a degraded product into an outage.
- `/readyz?deep=1` — also requires the engine. This is the one a deploy gate
  should watch.
- `/metrics` — Prometheus format. No workspace or workflow names in labels: an
  unbounded label set is how a metrics backend falls over, and names are user
  data. Beyond the inventory counters it exports the four numbers an alert can
  fire on — queue lag at the *head* of the queue, overdue schedules,
  interrupted runs, and the age of the engine's last probe. The last of those
  is the only signal that reveals a stopped worker: the API stays perfectly
  healthy while nothing runs.

Every response carries `X-Trace-Id`, and every error screen can copy the
execution id, version, node name and trace id in one click (SRS 76).

Runbooks for the five incidents worth rehearsing — engine unavailable, stuck
executions, a node upgrade regression, a compromised credential, webhook abuse —
are in [`docs/runbooks/`](docs/runbooks/), followed by one section per alert in
[`deploy/alerts.yaml`](deploy/alerts.yaml). Every rule names a section, and a
test fails if the section does not exist: an alert that fires at 3am pointing
at documentation nobody wrote is an alert that gets acknowledged and forgotten.

### Onboarding a customer

```powershell
.\run.ps1 provision -- create --name "Acme Corp" --owner ops@acme.com --max-concurrent 20
.\run.ps1 provision -- list
.\run.ps1 provision -- quota <workspace-id> --max-concurrent 50
.\run.ps1 provision -- status <workspace-id> --status SUSPENDED
```

Or `POST /api/v1/platform/workspaces`, which is the same service. One call
creates the workspace, its first owner, its concurrency quota and its engine
binding, and records `workspace.provisioned` in the audit log of the workspace
it just created — so a customer's own trail starts with who created it.

The owner's password is generated, returned exactly once, and must be changed
on first sign-in. What is handed over is a one-time secret, not a credential.

Creating a tenant needs the platform-admin flag on the account, not a workspace
role: a customer's Owner is the top of *their* hierarchy and has no business
creating another tenant. A suspended workspace refuses every request including
its owner's, which makes it usable for a billing hold without deleting
anything.

### Deploying

```powershell
.\run.ps1 doctor .env.production   # refuse a configuration that is not safe
.\run.ps1 drift                    # does the live schema match the models
python scripts/install.py --env-file .env.production
```

Secrets may be delivered as files -- `DATABASE_URL_FILE=/run/secrets/database_url`
and friends -- which is how Docker secrets and Kubernetes projected volumes
hand one over, and better than an environment variable that `docker inspect`
and `/proc/<pid>/environ` show to anybody who can read them.
`deploy/production.yaml.example` configures the whole deployment that way, and
the doctor, the installer and the application all resolve it identically. A
named file that cannot be read is a blocking error rather than a fallback: a
deployment running with a secret nobody chose is worse than one that does not
start.

`install.py` is the order that works, and the reason it is a script rather than
three lines in this file: wait for the database, `alembic upgrade head`,
`alembic check`, then seed. It is idempotent, so it runs on every deploy rather
than being a thing somebody remembers to do on the first one. The compose
stack's `migrate` service and the Kubernetes migration Job both run this same
script, from the same image.

The doctor refuses a placeholder secret, a value published in this repository,
an `http://` webhook base, a database inside the compose file, a `DATABASE_URL`
with no TLS (or with `sslmode`, which asyncpg silently ignores), an unpinned
image tag, and a release with nobody named on call. Each of those is a failure
somebody has shipped.

For Kubernetes, [`deploy/kustomize/`](deploy/kustomize/). The base is
deliberately not applyable on its own — it carries no image tags, no hostname
and no secrets — so there is no way to deploy "the defaults" and find out later
that the defaults were a placeholder.

### Backups

```powershell
.\run.ps1 backup                              # dump + manifest
python scripts/backup.py --verify backups/appbi-...dump
python scripts/restore.py --dump ... --into appbi_recovered
```

The manifest beside each dump records the schema revision, the product version,
row counts and a **fingerprint** of the encryption key — not the key. A restore
compares that fingerprint and refuses rather than succeeding with every
credential as unreadable ciphertext, which is the failure that otherwise
surfaces when the first scheduled workflow fails at 3am.

`--verify` restores into a scratch database and compares against the manifest.
An unverified backup is a belief.

### Releasing

```bash
python scripts/release_gate.py --version 1.2.0 \
  --env-file .env.production --evidence ci-evidence.json
```

Writes `release/appbi-workflow-<version>.json` and exits non-zero unless every
gate passes: which commit, which images, which suites ran and with what result,
the production configuration, the schema, the licence position, and somebody
named on call. A missing report is a failure rather than an unknown — "we did
not record whether the tests passed" and "the tests did not pass" have to be
treated the same way, or the recording stops happening.

Two of those gates are worth understanding:

- **schema** wants `--drift-report`, the JSON `schema_drift.py --json` writes
  after migrating a real database. "There is one migration head" is a claim; a
  migration that applies and leaves the schema disagreeing with the models
  passes a head check and then fails at runtime for whichever tenant touches
  the affected column first. A report produced against a different head is
  refused, because a stale CI artefact says nothing about this release.
- **legal** blocks. `--delivery` defaults to `commercial`, which requires
  `licensing.commercial_gate: APPROVED` in `compatibility.yaml`. Today it reads
  `NOT_REVIEWED`, so the gate refuses — correctly. The delivery this product is
  built for is `--delivery internal`: one organisation, many workspaces, which
  is inside n8n's Sustainable Use grant. The artefact records which was
  claimed. The gate used to record the licence state and pass either way, which
  made it impossible to stop a commercial release: the only thing a licence
  gate is for.

  It also refuses if `ee_source_loaded_by_runtime` or `ee_feature_enabled` is
  anything but false. Enterprise-licensed n8n source needs an n8n Enterprise
  Licence for *any* delivery, internal included, so that one is not a function
  of `--delivery`.

### Supply chain

The pinned n8n packages and anything the lockfile resolves off-registry are the
two things an npm proxy will not produce on demand:

```bash
python scripts/mirror_bundle.py --out dist/mirror     # fetch + hash-check
python scripts/mirror_bundle.py --verify dist/mirror  # re-check, no network
```

Of 896 lockfile entries, exactly one resolves outside `registry.npmjs.org` —
SheetJS from `cdn.sheetjs.com`, pulled in transitively by `n8n-nodes-base`. A
proxy pointed at the public registry does not mirror it, so it has to be
published into the internal registry explicitly. The script writes a manifest
saying which packages and why; publishing is left to whoever holds the
registry's credentials.

It does not commit anything into Git. `node_modules` stays out, and so does
unpacked n8n source — partly because it is 335 MB, and partly because
`n8n-core` ships three Enterprise-licensed files that would come with it.

---

## What V1 deliberately does not do

Each of these is a decision with a reopening condition, not an oversight:

- **Code node and community nodes** — blocked. Reopens with a sandbox, resource
  limits, filesystem and network policy, a dependency allowlist and an abuse
  review (ADR-014).
- **Wait / resume and human approval** — out of scope. An in-flight run is bound
  to one engine process; long-lived resume needs its own persistence design
  (ADR-010).
- **Sub-workflows** — out of scope. Needs parent/child execution records,
  cross-workflow cycle detection and a permission model.
- **Binary-heavy payloads** — HTTP Request is capped at a configurable response
  size, JSON and text only (ADR-012).
- **`Respond to Webhook`** — the gateway answers `202 Accepted`. A synchronous
  response from inside a running workflow needs a separate design (ADR-005).
- **OAuth2 credentials** — the credential type registry has the slot; the
  refresh flow is V1.1.

---

## Licensing

n8n is distributed under the **Sustainable Use License**, which grants use and
modification "only for your own internal business purposes or for
non-commercial or personal use", and distribution only free of charge for
non-commercial purposes. Source files marked `.ee.` are excluded from that
grant entirely and need an n8n Enterprise Licence.

**The delivery this product is built for is internal**: one organisation, many
workspaces. Selling the service, hosting it for external customers, OEM
embedding and redistribution are not covered, and
`licensing.commercial_gate` in [`compatibility.yaml`](compatibility.yaml) reads
`NOT_REVIEWED` until a legal review says otherwise.
`scripts/release_gate.py` refuses `--delivery commercial` on that basis and
passes `--delivery internal`; the release artefact records which was claimed
(**LIC-N8N-001**, SRS 33, [ADR-015](docs/adr/index.md)).

On the `.ee.` files, three claims that can each be checked rather than one that
cannot:

| | |
|---|---|
| `ee_source_present_in_dependency` | **true** — three files ship inside `n8n-core`; not ours to change |
| `ee_source_loaded_by_runtime` | **false** — `workflow-engine/tests/contract/no-enterprise-source.test.ts` |
| `ee_feature_enabled` | **false** — no S3 binary mode, no EE feature flag |

The middle one was `false` and quietly wrong before it was measured:
`n8n-core`'s entry point statically re-exports the Enterprise ObjectStore, so
importing anything from the package root loaded it. The engine deep-imports
past the entry point, and a test asserts the module cache stays clean after a
real run.

The architecture is not, and must not be presented as, a way around those
terms.
