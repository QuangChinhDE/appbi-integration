# Runbooks

Five incidents worth rehearsing (SRS 56), then one section per alert in
`deploy/alerts.yaml`. Each one starts with how to tell it apart from the
incident it is most often confused with, because that is where these go wrong:
the first action taken during an outage is usually the one chosen from the
wrong runbook.

Every rule in `deploy/alerts.yaml` names a section here, and
`backend/tests/test_alert_rules.py` fails if one of them does not exist -- an
alert that fires at 3am pointing at a section nobody wrote is an alert that
gets acknowledged and forgotten.

Commands assume the compose stack. Substitute your own orchestration.

---

## 1. The execution service is unavailable

**Symptom.** A warning banner across the app. Publishing and running fail with
`ENGINE_UNAVAILABLE`. Everything else works.

**Not this runbook if** the API itself is failing — check `/healthz` first. An
engine outage leaves the product fully readable by design; if lists are also
failing, it is the API or the database.

```bash
curl -s localhost:8000/readyz?deep=1 | jq .checks
docker compose ps engine
docker compose logs --tail=100 engine
```

**Diagnose in this order.**

1. Is the process up? `docker compose ps engine`.
2. Is it *ready*? A `DEGRADED` health means it started but a node failed to
   load — the message names which. That is a deployment fault, usually a
   partial `npm ci`.
3. Is the token right? A 401 from the adapter means `ENGINE_INTERNAL_TOKEN`
   differs between the API and the engine. Both read it from the same `.env`;
   a mismatch means one of them was restarted with a stale environment.

**Act.**

- Restart: `docker compose restart engine`.
- Queued executions stay `QUEUED` and dispatch when it returns — nothing is
  lost, and no operator action is needed for them.
- Runs that were in flight when it died become `ENGINE_INTERRUPTED` within
  `EXECUTION_STALE_AFTER_SECONDS` (default 120s). They are not retried
  automatically: retrying a workflow that may have already written to an
  external system is a decision, not a default.
- If it will be down for a while, deactivate the noisiest scheduled workflows
  rather than letting them accumulate interrupted runs:
  `POST /api/v1/workflows/{id}/deactivate`.

**Do not** `docker compose down -v`. The volume is Postgres, which holds every
workflow in the product.

---

## 2. Many executions are stuck

**Symptom.** `running_now` climbs on the overview and does not fall. Queue wait
p95 on `/monitoring` is rising.

**Tell the two cases apart first.**

```bash
# Are they queued (dispatch is the bottleneck) or running (the engine is)?
docker compose exec postgres psql -U appbi -d appbi_workflow -c \
  "SELECT status, count(*) FROM executions
   WHERE status NOT IN ('SUCCEEDED','FAILED','CANCELLED','TIMED_OUT',
                        'FAILED_TO_START','ENGINE_INTERRUPTED')
   GROUP BY status;"
```

- Mostly `QUEUED` → the worker is not dispatching. Check it is running and look
  at its log; a crash loop shows up here as a queue that only grows.
- Mostly `RUNNING` → the engine is saturated or the workflows are genuinely
  slow. `ENGINE_MAX_CONCURRENT` (default 20) is the ceiling; past that the
  engine answers `ENGINE_UNAVAILABLE` and the worker leaves them queued, which
  is the intended back-pressure.

**Then find the common cause.** Almost always one external endpoint:

```bash
docker compose exec postgres psql -U appbi -d appbi_workflow -c \
  "SELECT failed_node_name, error_code, count(*) FROM executions
   WHERE queued_at > now() - interval '1 hour'
   GROUP BY 1,2 ORDER BY 3 DESC LIMIT 10;"
```

**Act.**

- Cancel individual runs from the UI, or in bulk through the API. Cancel is
  idempotent.
- If one workflow is the cause, deactivate it. That stops new runs without
  touching its history.
- **Do not mass-retry before the root cause is known.** A hundred retries
  against a rate-limited API extends the outage instead of ending it.

---

## 3. A node upgrade regression

**Symptom.** After an engine deploy, workflows that worked now fail — often with
`NODE_CONFIGURATION_INVALID` on one node type.

**Confirm it is the upgrade.**

```bash
python scripts/certify.py            # do the pins, the catalogue and the tree agree?
cd workflow-engine && npm test       # do the golden workflows still pass?
```

`/settings/engine` shows the same comparison in the UI, including drift between
what the catalogue offers and what the runtime can compile.

**Act.**

1. **Roll back first.** Redeploy the previous engine image, or
   `git checkout <previous> -- compatibility.yaml workflow-engine/package-lock.json`
   and `npm ci`. The pin is the rollback.
2. Confirm with the contract suite before declaring it fixed.
3. Only then investigate. Reproduce as a golden test — a regression without a
   test comes back.
4. If one node is affected and a rollback is not possible, disable it:
   `POST /api/v1/admin/nodes/{node_key}/status {"status": "DISABLED"}`. Existing
   workflows keep their configuration; new runs are refused with a clear code
   rather than failing mid-flight.
5. Tell the affected workspaces which workflows are involved — the failing-node
   query in runbook 2 answers that.

**Never** change a node's `engine_type_version` to fix a live incident. That
changes what every existing workflow compiles to; it is an upgrade, and it goes
through SRS 31.3.

---

## 4. A credential is compromised

**Act in this order.** Rotation first — everything else can wait.

1. **Rotate at the provider.** Revoke the leaked value where it was issued.
   Nothing done in this product limits what an already-leaked token can do.
2. **Replace it here.** Update the credential (`PATCH /api/v1/credentials/{id}`
   or the UI). The new value takes effect on the next run; nothing caches it —
   secrets are resolved per execution and never persisted engine-side.
3. **Find what used it.** `GET /api/v1/credentials/{id}` returns `used_by`,
   including which workflows are actively running it.
4. **Decide about the runs in between.** Execution previews are redacted, so a
   token is not sitting in the execution history — but the *responses* the
   credential fetched may be sensitive. To remove them:

   ```sql
   DELETE FROM execution_node_results
   WHERE execution_id IN (SELECT id FROM executions WHERE workflow_id = '<id>');
   ```

   Execution summaries survive, so the audit trail stays intact.
5. **Read the audit log.** `/audit` filtered to `CREDENTIAL` shows every create,
   update and rotation with an actor and an IP.

**Never** put the leaked value in the incident ticket. The audit log does not
contain it, and the ticket should not be the only place that does.

---

## 5. Webhook abuse

**Symptom.** A spike in webhook executions, or a burst of
`WEBHOOK_AUTH_FAILED` in the API log.

```bash
docker compose logs api | grep -c webhook.rejected
```

**Act, cheapest first.**

1. **Rotate the signing secret**:
   `POST /api/v1/workflows/{id}/trigger/rotate-secret`. It is returned once.
   Every unsigned or wrongly-signed caller stops immediately — including the
   legitimate one, so have its owner ready to take the new value.
2. **Deactivate the trigger** if rotation is not enough:
   `POST /api/v1/workflows/{id}/deactivate`. The URL stops accepting anything
   while the workflow and its history stay intact. Deleting the workflow would
   release the path; deactivating does not.
3. **Turn authentication on** if the trigger was configured as `NONE`. Edit the
   Webhook Trigger node, set `auth_mode` to `HEADER_SIGNATURE`, publish and
   activate.
4. **Rate limiting** is per API instance (`WEBHOOK_RATE_LIMIT_PER_MINUTE`,
   default 120/min). With N replicas the effective limit is N times that — a
   deliberate V1 simplification, so for a serious flood the limit belongs at the
   ingress, not here.

**Note what is already true without any action:** the body is capped before it
is parsed, the content type is checked, signatures carry a five-minute replay
window, and an unknown key and a disabled trigger answer identically so the
endpoint cannot be used to enumerate workflows.

---

# Alert responses

One per rule in `deploy/alerts.yaml`. Shorter than the incident runbooks above
on purpose: an alert response should fit on a phone screen.

## API unavailable

**Fires:** `AppbiApiDown` — no replica answered a scrape for two minutes.

**Blast radius:** total. Nobody can sign in, open a workflow, or deliver a
webhook. Runs already in flight in the engine continue and are reconciled when
the API returns.

```bash
docker compose ps api
docker compose logs api --tail 100
```

Look for, in this order:

1. **`Refusing to start with an unsafe configuration`** — the deployment was
   restarted with a changed environment and `readiness.enforce_at_startup`
   rejected it. The log lists every problem. This is the most common cause
   after a deploy, and `python scripts/doctor.py --env-file .env.production`
   reproduces it without restarting anything.
2. **`_FILE is set to ... but it cannot be read`** — a mounted secret is
   missing. The process refuses to fall back rather than run with a secret
   nobody chose.
3. **database connection errors** — check the managed instance and the network
   policy, not the application. `python scripts/schema_drift.py` answers
   "can I even reach it" as a side effect.

**Do not** roll back before reading the log. A configuration refusal rolls back
to the same refusal, and the two minutes spent are the fastest way to know.

## Worker stopped

**Fires:** `AppbiWorkerStopped` (probe older than five minutes) or
`AppbiWorkerProbeMissing` (no probe ever).

**Blast radius:** invisible from the outside and total for automation. The API
is healthy, the interface works, workflows can be edited and published — and
nothing runs. Every execution stays `QUEUED`, and every schedule silently does
not fire.

This is the failure that most needs an alert, because no user-facing symptom
appears until somebody notices their workflow did not run.

```bash
docker compose ps worker
docker compose logs worker --tail 100
# Is it the process, or is it stuck?
docker compose exec worker pgrep -af 'app.worker'
```

The worker writes `worker.housekeeping_error` on a caught failure and keeps
looping; a *silent* worker with a live process is stuck on something that does
not raise — almost always a database statement waiting on a lock.

```sql
SELECT pid, state, wait_event_type, wait_event, left(query, 120)
FROM pg_stat_activity WHERE state <> 'idle' ORDER BY query_start;
```

Restarting the worker is safe: dispatch is idempotent on the execution id, and
the reconciler picks up whatever was in flight.

## Queue not moving

**Fires:** `AppbiQueueNotMoving` (oldest queued run over five minutes) or
`AppbiQueueSlow` (over one minute, sustained).

**First distinguish two very different causes** — this is the section most
often entered from the wrong runbook:

```bash
curl -s localhost:8010/metrics | grep -E 'queue_lag|engine_healthy'
```

* **`appbi_engine_healthy 0`** — this is an engine outage. Go to *The execution
  service is unavailable*.
* **engine healthy, lag high** — either the worker is not dispatching (go to
  *Worker stopped*), or the queue is held behind a concurrency ceiling.

For the ceiling case, the per-workflow limit is 1 by design: a long-running run
blocks its own workflow, which is intended. The workspace ceiling is the one
worth checking:

```sql
SELECT w.slug, count(*) AS active
FROM executions e JOIN workspaces w ON w.id = e.workspace_id
WHERE e.status IN ('QUEUED','DISPATCHING','RUNNING') GROUP BY w.slug
ORDER BY active DESC;
```

A single tenant at its ceiling with a long-running workflow is not an incident.
Raise the ceiling deliberately if it should be higher:

```bash
python -m app.provision quota <workspace-id> --max-concurrent 25
```

## Schedules late

**Fires:** `AppbiSchedulesOverdue` — enabled schedules more than five minutes
past their next run time.

The product also raises its own in-app alert for this (SRS 19.1). If the
external alert fires and the in-app one did not, the *alerting* is what is
broken, and that points at the worker.

```sql
SELECT w.name, t.next_run_at, t.overlap_policy
FROM trigger_bindings t JOIN workflows w ON w.id = t.workflow_id
WHERE t.enabled AND t.trigger_type = 'SCHEDULE'
  AND t.next_run_at < now() - interval '5 minutes'
ORDER BY t.next_run_at;
```

A schedule whose previous run is still going and whose policy is
`SKIP_IF_RUNNING` is *correct* behaviour reported honestly — the product prefers
saying it is late to firing quietly and pretending otherwise. Check whether the
overdue set is the same workflows each time (a too-frequent schedule) or
everything (the worker).

## Engine interrupted runs

**Fires:** `AppbiExecutionsInterrupted` — the reconciler gave up on runs in the
last half hour.

An interrupted run is neither a success nor a failure, so it does not show in a
success-rate graph. Nonzero means the engine is losing in-flight work.

```bash
kubectl get pods -l app.kubernetes.io/name=engine
kubectl describe pod <engine-pod> | grep -A5 'Last State'
```

`OOMKilled` is the usual answer. The engine's memory limit equals its request
so it is Guaranteed, which means an OOM is genuinely too little memory rather
than a noisy neighbour: raise the limit, or lower `ENGINE_MAX_CONCURRENT`.

Also check whether a node drain is in progress — the PDB allows one engine pod
out at a time, and the runs on that pod are legitimately interrupted. The
product reports them, which is the designed behaviour (ADR-010), and they can
be retried from the executions page.

## Widespread failures

**Fires:** `AppbiFailureRateHigh` — over half of all runs failing, with enough
volume to be meaningful.

Individual workflow failures belong to the tenant and are deliberately not
alerted on. Over half of *everything* failing is a deployment problem.

```sql
SELECT error_code, count(*) FROM executions
WHERE queued_at > now() - interval '1 hour' AND status IN
  ('FAILED','TIMED_OUT','FAILED_TO_START')
GROUP BY error_code ORDER BY 2 DESC;
```

The code tells you which system:

| Dominant code | Where to look |
|---|---|
| `NODE_AUTHENTICATION_FAILED` | a shared credential expired or was rotated upstream |
| `EGRESS_BLOCKED` | `EGRESS_ALLOWED_HOSTS` changed, or a tenant's API moved |
| `ENGINE_UNAVAILABLE` / `FAILED_TO_START` | the engine — go to *The execution service is unavailable* |
| `NODE_TIMEOUT` | the tenant's upstream, or a network path out of the cluster |

## Mixed versions

**Fires:** `AppbiMixedBuildVersions` — more than one product version reporting
for fifteen minutes.

Two possibilities, and the second is much worse:

1. **a stuck rolling update.** `kubectl rollout status deploy/appbi-workflow-api`
   says so. Usually an image that cannot be pulled or a pod failing its
   readiness probe.
2. **two deployments sharing one database.** A staging stack pointed at
   production by mistake. Check `appbi_workflow_build_info` labels for an
   `environment` that should not be there — and treat it as an incident: the
   other deployment's worker is dispatching this deployment's executions to
   its own engine.

The second case is what produced the one smoke-test failure during this
product's development: two workers on one database, each reconciling the
other's runs as `ENGINE_INTERRUPTED`.

## Wrong environment

**Fires:** `AppbiRunningInDevelopmentMode` — a deployment reporting
`environment != production`.

None of the checks in `app/core/readiness.py` are enforced outside production
mode. A deployment in this state may be running with the JWT secret published
in this repository, an http webhook base, and `ALLOW_DERIVED_ENCRYPTION_KEY`
true.

**Treat it as a credential exposure**, not a configuration slip:

1. `python scripts/doctor.py --env-file <the deployment's env>` — what exactly
   is wrong.
2. If `JWT_SECRET` was a development value, every session token ever issued by
   this deployment is forgeable. Rotate it; that signs everybody out, which is
   the intended effect.
3. If `SECRET_ENCRYPTION_KEY` was derived from a passphrase, re-key with
   `app.core.secrets.rewrap_all` and rotate every stored credential upstream.

---

## Backup and restore

The product database is the only thing that matters. The engine holds nothing
durable, and can be rebuilt from its image.

```bash
# Backup
docker compose exec -T postgres pg_dump -U appbi -Fc appbi_workflow > backup.dump

# Restore into an empty database
docker compose exec -T postgres pg_restore -U appbi -d appbi_workflow --clean backup.dump
```

**`SECRET_ENCRYPTION_KEY` is not in the dump.** A restore without the key that
was in use gives you every workflow and no working credential. Back it up
wherever your other key material lives, and rotate it with
`app.core.secrets.rewrap_all`, which rewraps data keys without decrypting a
single credential.
