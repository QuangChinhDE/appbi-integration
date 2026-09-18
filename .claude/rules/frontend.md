# Frontend rules

Scope: `frontend/`. Next.js 15 (App Router), React 18, TanStack Query v5,
Tailwind, `@xyflow/react` for the canvas. Design tokens, primitives and shell
inherited from AppBI Pipeline.

## The boundary

- Call **`/api/v1/**` and `/hooks` only.** The engine has no address here and
  must never acquire one — no `ENGINE_BASE_URL`, no `:8099`, no `/internal/v1`.
  *Enforced:* `scripts/guardrails.py`.
- Do not invent API fields. If a screen needs data the API does not return,
  that is an API change with a spec — not an optimistic property access that
  renders `undefined`.
- Business logic stays in the backend. Recomputing a rule here gives two
  answers that will diverge; read the server's.

## Permissions are an affordance, not authorization

`use-permissions.ts` decides what to *show*. It decides nothing about what is
*allowed* — the backend does. Hiding a button is a courtesy; the endpoint must
refuse regardless. Never gate a destructive action on the UI alone, and never
render an action the user cannot perform without saying why.

## Use what exists

- Primitives: `components/ui/` — `Button`, `Input`, `Badge`, `Modal`, `Tabs`,
  `Menu`, `Disclosure`, `Feedback`. Use them. A one-off `<div>` styled to look
  like a button is a defect, not a shortcut.
- Type scale and spacing come from tokens. **Never** an arbitrary value like
  `text-[10px]` — it is invisible to a change of the scale, which is how three
  hardcoded sizes survived a type-scale fix. Nothing renders below **12px**;
  `11-appearance.spec.ts` measures it, multiplied by ancestor transforms.
- Labels: use `Field`, which generates the id and wires `Label` and the input
  through context. Do not hand-associate — several screens forgot, and two
  component tests found it as an accessibility defect before the code was right.

## Data fetching

- Keys come from `lib/queryKeys.ts`. Read the comment at the top before adding
  one. A filtered list must drop the filter segment when there is no filter, so
  `qk.credentials(ws)` is a real **prefix** of the filtered key — otherwise
  `invalidateQueries` matches nothing and a created row never appears.
- Every key is workspace-scoped, so a workspace switch evicts a whole tenant's
  cache. A key without `ws` is a data-leak-shaped bug.
- `fetchQuery` honours `staleTime`. A "Reload" that hands back the cached value
  is a button that does nothing — the conflict banner shipped that way once.

## i18n

Every user-visible string lives in `lib/i18n.ts`. No literal in a component.
The policy for which English words stay English is documented at the top of that
file — read it rather than guessing; roles, statuses and sentences are
Vietnamese. Backend errors are translated **by stable code**, falling back to
the server's message so a new code degrades to a readable sentence.

## States — every one of them, every time

A feature is not done when the happy path renders. Each user-facing flow
accounts for:

| State | The test |
|---|---|
| initial | before anything is requested |
| loading | a skeleton or spinner, not a layout jump |
| empty | says what to do next, not just "no data" |
| populated | including long content that must not overflow |
| validation error | on the field, naming what to fix |
| API failure | the envelope's `remediation.action` as the primary CTA |
| permission denied | why, not a blank screen |
| disabled | visibly disabled, and the reason reachable |
| engine unavailable | the product stays readable; say runs are paused |

Errors must be actionable. A failed step must answer "what went wrong?" on the
tab that opens — the run panel once opened on an empty Output with the error one
unmarked tab away.

## Responsive

Checked at **1440×900**, **1280×800** and **390×844**. No horizontal document
overflow; the primary action inside the viewport at every width. The mobile
config sheet is a **portal** — `xl:hidden` on the wrapper styles nothing and
leaves a modal over the canvas at every width. Check the rendered node, not the
JSX.

## UI is not done until it has been looked at

A passing component test means the component renders. It says nothing about
whether the screen is usable. Run `/ui-review` before claiming a UI change is
complete — the walkthrough found five real defects that 108 passing tests could
not see, all in the first two minutes of use, because every test seeded its
graph through the API and none had looked at the one the product creates for you.

## Verifying

```bash
python scripts/verify.py targeted frontend
```

Or in `frontend/`: `npm run typecheck`, `npm run lint`, `npm test`,
`npm run build`. Run the build — `output: 'standalone'` bakes config at build
time, and a defect that exists only in the built image is invisible to the dev
server.
