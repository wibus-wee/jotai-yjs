# y-jotai (Jotai + Yjs)

Thin, typed bridge between Yjs types and Jotai atoms.

> [!WARNING]
> This is an early release. The API and behavior may change in future versions. This library is small and opinionated; please read the Semantics before adopting.

## Highlights

- Semantics first: reads are pure projections; writes are explicit.
- `undefined` is ignored by default (no implicit delete); delete explicitly or provide a custom writer.
- All writes run in Y transactions and can carry an origin for observability.
- Accepts both a concrete `y` instance or a `yAtom` source atom.
- Supports nullable sources: `y`/`yAtom` can be `null` (no subscription; read still runs; writes no-op with dev warning until ready).
- Event-driven updates from Yjs; writes rely on Y events to refresh the snapshot (no manual state sets).
- Narrow subscriptions by default; opt-in deep observation when you need it.
- SSR/hydration-friendly: first frame matches the current Y state.

## Installation

Want to see our vibe coding demo? [Try it now](/demo)

```bash
npm install y-jotai jotai yjs
```

## Quick Start

```ts
import * as Y from 'yjs'
import { Provider, useAtom } from 'jotai'
import { createYAtom } from 'y-jotai'

const doc = new Y.Doc()
const map = doc.getMap<string>('root')

// Treat the whole Y.Map as a single Jotai atom.
const snapshotAtom = createYAtom({
  y: map,
  read: (m) => m.toJSON() as Record<string, string>,
})

function Example() {
  const [snapshot, setSnapshot] = useAtom(snapshotAtom)
  const onRename = () => setSnapshot((prev) => ({ ...prev, title: 'Hello peers' }))
  return (
    <>
      <pre>{JSON.stringify(snapshot, null, 2)}</pre>
      <button onClick={onRename}>Rename</button>
    </>
  )
}

export const App = () => (
  <Provider>
    <Example />
  </Provider>
)
```

## Using a yAtom Source (atomFamily-friendly)

> [!WARNING]
> Prior to using this pattern, ensure you understand the semantics of `resubscribeOnSourceChange` and that your state management design is sound.

When your Y instance itself comes from a Jotai atom (e.g., `atomFamily(id)` returning a `Y.Map`), pass it via `yAtom`.

```ts
import { atomFamily } from 'jotai/utils'

// Each document exposes its own root map via an atom.
const rootMapFamily = atomFamily((id: string) => atom(docFor(id).getMap('root')))

export const titleAtomFamily = atomFamily((id: string) =>
  createYAtom({
    yAtom: rootMapFamily(id),
    read: (m) => m.get('title') ?? '',
    write: (m, next) => m.set('title', next),
    eventFilter: (evt) => (evt.keysChanged ? evt.keysChanged.has('title') : true),
    // Optional: switch subscriptions when the source instance changes.
    // resubscribeOnSourceChange: true,
  })
)
```

By default, subscriptions are pinned to the initial instance (`resubscribeOnSourceChange: false`). Set it to `true` to automatically unsubscribe from the old Y instance and subscribe to the new one, with an immediate snapshot sync.

Notes
- Writes follow the active Y instance:
  - `resubscribeOnSourceChange: false` (default): reads/writes stay pinned to the initial instance from first mount.
  - `resubscribeOnSourceChange: true`: reads/writes move with the latest `yAtom` value.
- Updates always flow via Y events; no manual state set after writes.
- SSR/hydration: derived state ensures the first frame matches the current Y snapshot.
## Nullable source (writing when the root isn't ready)

In real apps the Y root is often `null` initially and later swapped for a real Y type when ready. `createYAtom` and `createYMapEntryAtom` now accept `y`/`yAtom` being `null`:

- `read` will receive `null` and can return a placeholder (e.g. `null` or a default object).
- When the source is `null` the atom does not subscribe to Y events.
- Writes are no-ops while the source is `null`; a dev warning is emitted to avoid writing to an uninitialized document.
- When the source changes from `null` to a real instance, the atom subscribes and syncs the snapshot according to `resubscribeOnSourceChange`:
  - Default `false`: the first non-null instance is pinned; later `yAtom` changes do not switch the active source.
  - `true`: each source change causes an unsubscribe/subscribe and an immediate fallback to `read(y)`.

Example: root not ready → ready flow

```ts
const rootRefAtom = atom<Y.Map<unknown> | null>(null)

// Nullable map source
const cellMapRefAtom = atom((get) => {
  const root = get(rootRefAtom)
  return root ? (root.get('cells') as Y.Map<unknown>) : null
})

// Entry atom also accepts a mapAtom that may be null
const cellEntryFamily = atomFamily((id: string) =>
  createYMapEntryAtom<Y.Map<any>>(cellMapRefAtom, id, {
    deleteOnNull: true,
    resubscribeOnSourceChange: true,
  })
)

// On read, read receives null → produce a placeholder
const cellTitleFamily = atomFamily((id: string) =>
  createYAtom({
    yAtom: cellEntryFamily(id),
    read: (cell) => (cell ? (cell.get('title') as string | null) : null),
    write: (cell, next) => cell.set('title', next),
    resubscribeOnSourceChange: true,
  })
)
```

## Behavior & Semantics

- Event-driven updates: writes rely on Y events to update the cached snapshot (no direct state set after write).
- Equality suppression: `equals` prevents redundant updates; defaults to deep equality.
- Deep vs shallow observation:
  - `deep: true` uses `observeDeep` and ignores `eventFilter`.
  - `deep: false` (default) uses narrow observation; you can provide `eventFilter` to filter events precisely.
- Nullable sources: 当 `y`/`yAtom` 为 `null` 时不订阅，`read` 仍会执行；写入会被忽略并在 dev 环境告警；出现真实实例后按 `resubscribeOnSourceChange` 语义运行（默认 pinned）。
Nullable sources: when `y`/`yAtom` is `null`, the atom does not subscribe to Y events but `read` still runs; writes are no‑ops (with a dev warning). When a real instance becomes available, the atom follows the `resubscribeOnSourceChange` semantics (pinned/false by default).
- Transactions coalesce: multiple Y operations inside a single `doc.transact(...)` result in at most one update.
- Writer supports functional updates: `set(atom, prev => next)` is supported; the write executes inside a transaction via `withTransact`.
- Transactions carry origins: writes from `createYAtom` and `createYPathAtom` are tagged with default origins (`[y-jotai] atom-write` / `[y-jotai] path-write`); you can override this via `transactionOrigin` for easier debugging.
- Unmount cleanup: subscriptions are removed on unmount; no callbacks after unsubscribe.

## Patterns

- Start coarse and refine: begin with a single `createYAtom` per document; split into smaller atoms only when profiling indicates a need.
- Opt for factories when focusing:
  - `createYMapKeyAtom(map, key)` for single key
  - `createYMapEntryAtom(map, key, { deleteOnNull })` for Y type reference stored at a key (narrow to replacements); set `deleteOnNull: true` to delete key when writing `null`
  - `createYMapFieldsAtom(map, ['title', 'status'], { deleteOnUndefined })` for partial projections of a Map; only writes changed fields; set `deleteOnUndefined: true` to delete keys when writing `undefined`
  - `createYArrayIndexAtom(array, index)` for single item
  - `createYTextAtom(text)` for text content

  > [!IMPORTANT]
  > deleteOnNull and deleteOnUndefined are mutually exclusive. Enable only the option that matches the sentinel value you want to treat as a deletion marker (`null` vs `undefined`) to avoid conflicting behaviors.
- Arbitrary paths: `createYPathAtom(root, ['a', 0, 'b'])` traverses Map/Array mixes.
  - Default writer semantics:
    - Map: `undefined` is ignored; use a custom writer or dedicated delete atom when you need to remove keys.
    - Array: index is clamped to [0, length]; `undefined` is ignored; use a custom writer or dedicated delete atom when you need to remove slots.

## Notes on resubscribeOnSourceChange

- Default is `false` (stable/pinned):
  - Subscriptions stay on the initial instance even if `yAtom` later changes.
  - Reads/writes both hit the initial instance (avoids ghost writes to a different doc).
  - Use when you want stability and the source is expected to remain the same.
- `true` (follow source):
  - On `yAtom` change, unsubscribe old, subscribe new, and sync immediately.
  - Reads/writes both target the latest `yAtom` instance (safe for doc swap flows).
  - Use when you intentionally swap documents/roots and want updates to follow.

## Advanced Usage

### Lifecycle: init vs sync

Internally the subscription has two actions to keep state predictable:

- `init` (on mount)
  - If `resubscribeOnSourceChange` is `false`, capture the initial `y` and keep using it even if `yAtom` later returns a new instance.
  - If the source is dynamic (`yAtom`), seed the first snapshot so the initial read is consistent before any Y events fire.
- `sync` (on Y events)
  - Refresh the cached snapshot using `read(y)`; suppressed by `equals` to avoid redundant updates.

Timeline when `resubscribeOnSourceChange: true` and `yAtom` changes:

- The effect unsubscribes from the old `y` and subscribes to the new one.
- Reads immediately reflect the new `y` via a direct `read(y)` fallback (bypassing the previous cached snapshot).
- The next Y event (or batch inside a transaction) runs `sync` and caches the fresh snapshot.

This design ensures predictable SSR/first frame and safe transitions when swapping documents or roots at runtime.

Resubscribe is enabled and `yAtom` swaps from old to new. Reads fall back to `read(y)` immediately; cache updates on the next Y event.

```
Component      Store           subscriptionAtom        Y(old)           Y(new)
   |            |                    |                   |                |
   | read       |                    |                   |                |
   |----------->|                    |                   |                |
   |            | init               |                   |                |
   |            |------------------->|                   |                |
   |            |                    | subscribe         |                |
   |            |                    |------------------>| observe        |
   |            |                    | seed snapshot     |                |
   |            |<-------------------|                   |                |
   | snapshot   |                    |                   |                |
   |            |                    |                   |                |
-- swap doc: yAtom -> Y(new) -----------------------------------------------
   |            | rerun effect        |                   |                |
   |            |                     | unsubscribe       |                |
   |            |                     |------------------>| unobserve      |
   |            |                     | subscribe                          |
   |            |                     |----------------------------------->| observe
   | read       |                     |                                     |
   |----------->|                     |                                     |
   |            | lastY != activeY    |                                     |
   |            | return read(Ynew)   |                                     |
   |<-----------|                     |                                     |
   |            |                     | <event> sync                        |
   |            |                     |<------------------------------------|
   |            |                     | snapshot <- read(Ynew)              |
   |            |<--------------------|                                     |
```

### Example: swapping documents safely

```ts
const currentDocAtom = atom<Y.Doc>(() => new Y.Doc())
const rootMapAtom = atom((get) => get(currentDocAtom).getMap('root'))

export const titleAtom = createYAtom({
  yAtom: rootMapAtom,
  read: (m) => m.get('title') ?? '',
  write: (m, next) => m.set('title', next),
  eventFilter: (evt) => (evt.keysChanged ? evt.keysChanged.has('title') : true),
  resubscribeOnSourceChange: true,
})

// Later, swap the document
set(currentDocAtom, new Y.Doc())
// Reads from titleAtom immediately use the new map's value; the cache updates on the next Y event.
```

## Recipes

These snippets are minimal, copy-pastable starting points for common cases.

### Map key atom (typed, with decode/encode)

```ts
import * as Y from 'yjs'
import { createYMapKeyAtom } from 'y-jotai'

const doc = new Y.Doc()
const settings = doc.getMap<unknown>('settings')

// Treat missing as false, and coerce non-boolean inputs.
export const darkModeAtom = createYMapKeyAtom<unknown, boolean>(settings, 'darkMode', {
  decode: (v) => Boolean(v ?? false),
  encode: (v) => Boolean(v),
})
```

### Map entry atom (Y types stored inside a Map)

```ts
import * as Y from 'yjs'
import { createYMapEntryAtom } from 'y-jotai'

const doc = new Y.Doc()
const blocks = doc.getMap<Y.Map<any> | null>('blocks')

// Subscribe to a nested Y.Map by key; updates when the reference is replaced.
// With deleteOnNull: true, writing null removes the key entirely (no tombstone).
export const blockMapAtom = createYMapEntryAtom<Y.Map<any>>(blocks, 'activeBlock', {
  deleteOnNull: true, // writing null will delete the key instead of storing null
})
```

### Map fields atom (partial projection of a Map)

```ts
import * as Y from 'yjs'
import { createYMapFieldsAtom } from 'y-jotai'

const doc = new Y.Doc()
const metadata = doc.getMap<string | number>('metadata')

type Meta = { title?: string; count?: number }

// Keys infer from the const tuple; only writes fields that actually changed.
// With deleteOnUndefined: true, writing undefined removes that key.
export const metaFieldsAtom = createYMapFieldsAtom<Meta>(
  metadata,
  ['title', 'count'] as const,
  {
    includeUndefined: true,   // include missing fields as undefined in read
    deleteOnUndefined: true,  // writing undefined deletes the key
  }
)

// Only 'title' will be written to CRDT (count unchanged, no redundant ops)
// set(metaFieldsAtom, prev => ({ ...prev, title: 'New Title' }))

// Delete 'title' key from the map
// set(metaFieldsAtom, prev => ({ ...prev, title: undefined }))
```

### Array index atom (replace item in place)

```ts
import * as Y from 'yjs'
import { createYArrayIndexAtom } from 'y-jotai'

type Todo = { id: string; title: string; done: boolean }

const doc = new Y.Doc()
const todos = doc.getArray<Todo>('todos')

export const firstTodoAtom = createYArrayIndexAtom<Todo, Todo | undefined>(todos, 0)
// set(firstTodoAtom, (t) => t ? { ...t, done: true } : t)
```

### Text atom (diff-based writer)

```ts
import * as Y from 'yjs'
import { createYTextAtom } from 'y-jotai'

const doc = new Y.Doc()
const ytext = doc.getText('content')

export const textAtom = createYTextAtom(ytext)
// set(textAtom, (s) => s + "!")
```

### Path atom (Map/Array traversal with default writer)

```ts
import * as Y from 'yjs'
import { createYPathAtom } from 'y-jotai'

const doc = new Y.Doc()
const root = doc.getMap('root')

// Access root.profile.friends[0].name
export const firstFriendNameAtom = createYPathAtom<string | undefined>(root, [
  'profile', 'friends', 0, 'name',
])

// Default writer ignores undefined; to delete a key,
// provide a custom writer or a dedicated delete atom.
```

## Non-goals / Safety

- No automatic diff/patch for arbitrary objects (beyond the built-in text diff); bring your own if needed.
- No implicit deletes: default writers ignore `undefined`; delete explicitly or supply a custom writer.
- Yjs values should be JSON-like/serializable; avoid storing non-serializable data if you need portability or persistence.

### From coarse to fine (eventFilter for precision)

```ts
import * as Y from 'yjs'
import { createYAtom } from 'y-jotai'

const doc = new Y.Doc()
const map = doc.getMap<any>('root')

// Start coarse: one atom for the whole map
export const snapshotAtom = createYAtom({
  y: map,
  read: (m) => m.toJSON() as Record<string, unknown>,
})

// Later, split out a focused title atom with a precise eventFilter
export const titleAtom = createYAtom({
  y: map,
  read: (m) => (m.get('title') as string | undefined) ?? '',
  write: (m, next) => m.set('title', next),
  eventFilter: (evt) => (evt.keysChanged ? evt.keysChanged.has('title') : true),
})
```

## Why another bridge?

- You keep the Jotai mental model while syncing collaborative state through Yjs.
- Flexible granularity: from whole-doc snapshots to focused keys/indices.
- No extra state fan-out: Y events are the single source of truth.

## FAQ

- Do I need fine-grained atoms? Not necessarily. Start with a single atom per document and refine when needed.
- Can I mix with local Jotai atoms? Yes. They share the same store and compose naturally.
- How about Valtio? Choose the state library you prefer. This package focuses on Jotai idioms and narrow subscriptions.

## License

MIT © Wibus
