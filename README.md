# y-jotai (Jotai + Yjs)

Thin, typed bridge between Yjs types and Jotai atoms.

> [!WARNING]
> This is an early release. The API and behavior may change in future versions. *This library has a high usage cost; you may need to read the source code to understand the design details.*

## Highlights

- Accepts both a concrete `y` instance or a `yAtom` source atom.
- Event-driven updates from Yjs; no duplicate sets after writes.
- Narrow subscriptions by default; opt-in deep observation when you need it.
- SSR/hydration-friendly: first frame matches the current Y state.

## Installation

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
- Writes always target the current `get(yAtom)` instance; updates still flow via Y events.
- SSR/hydration: derived state ensures the first frame matches the current Y snapshot.

## Behavior & Semantics

- Event-driven updates: we never set state after a write; Yjs events drive updates.
- Equality suppression: `equals` prevents redundant updates; defaults to deep equality.
- Deep vs shallow observation:
  - `deep: true` uses `observeDeep` and ignores `eventFilter`.
  - `deep: false` (default) uses narrow observation; you can provide `eventFilter` to filter events precisely.
- Transactions coalesce: multiple Y operations inside a single `doc.transact(...)` result in at most one update.
- Writer supports functional updates: `set(atom, prev => next)` is supported; the write executes inside a transaction via `withTransact`.
- Unmount cleanup: subscriptions are removed on unmount; no callbacks after unsubscribe.

## Patterns

- Start coarse and refine: begin with a single `createYAtom` per document; split into smaller atoms only when profiling indicates a need.
- Opt for factories when focusing:
  - `createYMapKeyAtom(map, key)` for single key
  - `createYArrayIndexAtom(array, index)` for single item
  - `createYTextAtom(text)` for text content
- Arbitrary paths: `createYPathAtom(root, ['a', 0, 'b'])` traverses Map/Array mixes.
  - Default writer semantics:
    - Map: `undefined` deletes the key.
    - Array: index is clamped to [0, length]; `undefined` deletes the slot if it exists, otherwise no-op.

## Notes on resubscribeOnSourceChange

- Default is `false`: the subscription is pinned to the initial instance; updates keep flowing from the old source even if `yAtom` changes.
- When `true`: on `yAtom` changes, we unsubscribe from the old instance and subscribe to the new one, and sync the latest snapshot immediately.
- Writes always target the current `get(yAtom)` instance, regardless of the resubscribe option.

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

// Delete the key by writing undefined
// set(firstFriendNameAtom, undefined)
```

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
