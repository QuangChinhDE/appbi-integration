# Security rules

Scope: credentials, auth, the webhook gateway, engine ingress, HTTP egress, the
secret store, and anything tenancy-sensitive — `backend/app/core/{secrets,
security,redaction,rate_limit,permissions,payload_vault}.py`,
`backend/app/services/credentials.py`, the `/hooks` gateway,
`workflow-engine/src/{credentials,runtime}/`.

A change in these areas needs security review before Done (see
[REVIEW.md](../../REVIEW.md)), and editing them triggers a hook that says so.

## Secrets

- **Plaintext never leaves through a product-facing response.** Ever. What goes
  out is `{configured, masked_hint}`. A contract test asserts no credential
  value appears in any engine result; a smoke check proves a created credential
  is never echoed.
- Secrets resolve **only** when execution needs them, and only inside the
  engine's credential provider.
- A redacted value is a **view, never the data** (ADR-027). A masked payload
  must never become execution input, never be stored as execution truth, and
  never be what a retry re-runs. This is the single most attractive mistake in
  this codebase, because the masked object is right there and looks usable.
- The validation path is the exception that proves the rule: it carries
  `{credential_id, credential_type, data: {}}` — descriptors, not values. Do
  not "fix" it by dropping the list (ADR-016).
- Envelope encryption with a KEK. A backup manifest records a **fingerprint** of
  the key, never the key, and a restore refuses on mismatch rather than
  succeeding with unreadable ciphertext.
- Secrets may arrive as files (`*_FILE=/run/secrets/...`). A named file that
  cannot be read is a **blocking error**, never a fallback: a deployment running
  with a secret nobody chose is worse than one that does not start.

## Logs and payloads

- Redaction happens twice — engine side and product side — so neither is the
  single point of failure. Removing either half as "duplicate" is a defect.
- Anything a user can read is sanitized: no secret, no raw upstream body, no
  stack trace. Keep enough internally to diagnose — `X-Trace-Id` is on every
  response, and every error screen can copy execution id, version, node name
  and trace id in one click (SRS 76).
- Metrics labels carry **no** workspace or workflow names: names are user data
  and an unbounded label set is how a metrics backend falls over.

## The webhook gateway

The public endpoint is the product's (ADR-005), and a URL is not a credential.

- HMAC over `timestamp.body`. Unsigned is refused.
- **Constant-time comparison** for every signature and token. Never `==`.
- Replay protection via the timestamp window. A stale timestamp is refused.
- An unknown key and a disabled trigger answer **identically**, so the endpoint
  cannot enumerate workflows.
- Request size limits, and a rate limit counted in Postgres atomically — an
  in-process counter multiplies by the replica count (ADR-020).
- A retried delivery produces one execution, by database constraint (ADR-019).

## Engine ingress

Internal only, shared token, no published port. Not a convention — enforced by
the absence of a port mapping in compose, no Ingress path in the Kubernetes
overlay, and a NetworkPolicy accepting only `api` and `worker`. Each is
asserted by a test. Do not publish it "temporarily" to debug.

## HTTP egress

Node execution goes through the egress guard: private-network and SSRF refusal,
redirect handling, size and timeout ceilings, host allowlist in production
(`EGRESS_ALLOW_PRIVATE_NETWORKS=false`, `EGRESS_ALLOWED_HOSTS`). Never bypass it
for a node that wants a local address; that is the vulnerability, not the
obstacle.

## Tenancy

`workspace_id` on every tenant query — see [backend.md](backend.md). A suspended
workspace refuses every request including its owner's.

**Two exceptions are carried deliberately** and are documented in ADR-030: no
row-level security, standing on a composite foreign key plus twelve asserted
mutating cross-tenant routes; and the second gap recorded there. They are scoped
to one organisation, internal use, and **neither survives opening the product to
customers**. Do not treat them as precedent for a third exception, and do not
quietly rely on them.

## Licensing is a security-adjacent release gate

`licensing.commercial_gate` in `compatibility.yaml` reads `NOT_REVIEWED`.
n8n's Sustainable Use Licence covers one organisation's own use and does not
cover selling or hosting this for customers (ADR-015). `release_gate.py`
refuses a commercial delivery while the review is open — that refusal is the
gate's only purpose. Do not weaken it, do not default `--delivery` to
`internal`, and do not assume the dependency is cleared for SaaS or OEM.

`ee_source_loaded_by_runtime` and `ee_feature_enabled` must stay false for
**every** delivery, internal included.

## Verifying

Security-relevant changes: `python scripts/verify.py targeted backend` plus
`targeted engine`, and the tenancy and idempotency browser specs
(`e2e/tests/07-tenancy.spec.ts`, `08-idempotency-limits.spec.ts`) — the only
place a missing tenant filter is observable, because every service test builds
its fixtures in one workspace.
