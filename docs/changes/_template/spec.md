# Spec — <change name>

> **Observable behaviour only** — what a user or an API client can see. No
> implementation detail unless the architecture forces it (say which ADR, if
> so). This is the document review judges the diff against.

## Primary flow

> Numbered. What the user does, what the system does, what they then see.
>
> 1. …

## Alternate flows

> The paths that are not the happy one and are still correct: the object
> already exists, the list is empty, the user is resuming, an optional field is
> blank, the same action arrives twice.

## Failure behaviour

> For each way this can fail: what the user sees, which error code, and what
> `remediation.action` offers. An error with no route forward is not specified
> yet.
>
> | Failure | Code | What the user sees | Remediation |
> |---|---|---|---|

## Permissions

> Which roles may do this, and what a role that may not sees — hidden,
> disabled-with-a-reason, or refused. The backend is the authority; the UI is an
> affordance. Say what the API does independently of what the UI showed.

## Data behaviour

> What is written, read and derived. What is the system of record. What is
> tenant-scoped (everything touching tenant data is). What is retained, and for
> how long.

## Lifecycle effects

> Does this touch draft, publish, activate, version immutability or execution
> binding? Be explicit: Publish and Activate are separate operations, a
> published version never changes, and a run names the exact version it ran.

## UI states

> Every one that applies, and what each says. A flow specifying only success is
> not finished.
>
> | State | What is on the screen |
> |---|---|
> | initial | |
> | loading | |
> | empty | |
> | populated | |
> | long content | |
> | validation error | |
> | API failure | |
> | permission denied | |
> | disabled | |
> | engine unavailable | |

## API implications

> New or changed routes, request and response shapes, status codes, error
> codes. No n8n type or node-type string may appear in a product-facing
> contract (guardrails 2, 9).

## Compatibility

> Does this break an existing client, a stored graph, a published version or a
> saved trigger? What happens to data that already exists?

## Non-functional constraints

> Latency, concurrency, limits, idempotency, what must survive a restart, and
> what must still hold at two replicas.
