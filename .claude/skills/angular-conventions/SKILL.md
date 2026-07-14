---
name: angular-conventions
description: This repo's Angular 22 idiom — standalone components, signals-only state, inject() DI, file/class naming without suffixes, signal-store shape, lazy routes, where specs go. Read before creating or editing any file under web/src/app/.
---

# Angular conventions for this repo

Verified against source 2026-07-07. If code and this file disagree, trust the
code and update this file.

Training-data Angular (NgModules, `.component.ts` suffixes, constructor DI,
`@HostListener`, `.subscribe()`) is **wrong here**. Match the patterns below.

## Naming and layout

- Feature = one folder `web/src/app/features/{name}/` with `{name}.ts`,
  `{name}.html`, `{name}.scss`. **No `.component` suffix anywhere** — file
  `review.ts`, class `Review`, selector `app-review`, `templateUrl:
  './review.html'`, `styleUrl` (singular).
- Routes are lazy `loadComponent` entries in `app/app.routes.ts`; add new
  pages there the same way.
- Shared logic lives in `core/` (services, stores, pure modules); shared UI in
  `shared/` (e.g. `shared/heatmap/`). Features import from `core/`, never from
  each other.

## Components

Follow `features/review/review.ts`:

- Standalone (the default — never add `standalone:` or an NgModule);
  dependencies go in the decorator's `imports: [...]`.
- DI: `private readonly store = inject(CollectionStore);` — fields, never
  constructor parameters.
- All mutable state is `signal()`; derived state is `computed()`. No plain
  mutable class fields for anything the template reads.
- Route params: `toSignal(this.route.paramMap.pipe(map(...)), { initialValue:
  null })`. That `map` is roughly the only RxJS in a component.
- Async work: `async` methods + `lastValueFrom(this.api...)`. There are zero
  `.subscribe()` calls in the app — keep it that way.
- Global keyboard handling via the decorator:
  `host: { '(document:keydown)': 'onKey($event)' }` — not `@HostListener`.

## Stores and services

Follow `core/collection.store.ts` (`CollectionStore`):

- `@Injectable({ providedIn: 'root' })`, no provider registration elsewhere.
- Public `readonly` signals for raw state; `computed()` (often building a
  `Map`) for derived views; mutations go through methods that `.set`/`.update`
  the signals. HTTP only via `ApiService`.

## Pure logic first

Anything algorithmic (limits, search, stats, scheduling, templating) is a
plain exported function in `core/*.ts` — no Angular imports — with a colocated
`*.spec.ts` that imports `{ describe, expect, it } from 'vitest'` and runs
without TestBed or a browser (e.g. `core/daily-limits.ts` +
`daily-limits.spec.ts`). Put logic there and keep components thin wiring.

## Contracts to respect

- `web/src/app/core/models/` mirrors `server/src/models/index.ts` — change
  both or neither.
- Anything touching cards, scheduling, or the study queue: read the
  [[scheduling-domain]] skill first (due overloading, day numbers, dual
  SM-2/FSRS state).
- Where and how to test: see the [[testing-playbook]] skill.

## Lessons (auto-appended)

Dated entries promoted from feature STATE.md Pitfalls by the critic's drift
audit. Append-only; humans prune. If a lesson contradicts the body above,
trust the code, then fix both.

_None yet._
