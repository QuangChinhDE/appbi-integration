# Acceptance — <change name>

> User-observable scenarios, walked in the running product. Written **before**
> implementation — written afterwards, they come out shaped like the code you
> happened to write.
>
> Each must be checkable by someone who did not build the feature. Use concrete
> values: "the list shows 3 workflows, newest first", not "then it works".

## Scenario 1 — <name>

**Given** …
**When** …
**Then** …

## Scenario 2 — <name>

**Given** …
**When** …
**Then** …

## Failure scenarios

> At least one. What the user sees, and that they can get out of it.

**Given** … **When** … **Then** the screen says … and offers …

## Permission scenarios

> A role that may, and a role that may not — including that the API refuses
> independently of what the UI showed.

---

## The journey

> For workflow and integration work, walk the stages that genuinely apply and
> delete the rest. Tick each only when you have actually done it in the product.
>
> - [ ] create
> - [ ] configure
> - [ ] validate
> - [ ] save the draft, and prove nothing published changed
> - [ ] run the draft
> - [ ] inspect the data that came back — did expressions resolve against it?
> - [ ] publish
> - [ ] activate
> - [ ] trigger a real execution
> - [ ] inspect execution history
> - [ ] diagnose a failure from the error screen
> - [ ] roll back, and prove history did not change

## UI states checked

> If any UI changed: each state you looked at, at which viewport, with the
> screenshot. `/ui-review`. A rendering component is not a finished feature, and
> a passing component test is not a UI review.
>
> | State | Viewport | Screenshot | OK? |
> |---|---|---|---|
