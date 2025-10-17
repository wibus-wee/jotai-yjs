# y-jotai (Jotai + Yjs)

Thin, typed bridge between Yjs types and Jotai atoms.

> In *an experimental stage*. Using abstractions adds mental overhead for developers.

## Installation

```bash
npm install y-jotai jotai yjs
```

## Design goals

- Minimal abstraction: only subscribe, snapshot(read), and write via native Yjs ops.
- Narrow subscriptions by default (type.observe). Opt-in deep observation if needed.
- No double updates: do not set after write; rely on Y events to propagate.
- Type-safe with minimal unknown usage (decode/encode provide typed boundaries when needed).

## Why would I use this?

- **Single mental model:** keep using Jotai atoms in React while syncing data through Yjs.
- **Opt-in granularity:** map one atom to an entire `Y.Map`, or drill down to keys/indices only when perf requires it.
- **Zero extra state:** writes go through native Yjs operations and are broadcast to every peer; no manual fan-out.

If you already have app state in Jotai and only occasionally need real-time collaboration, this package lets you bridge the gap without learning a whole new state system.

## Quick start

```ts
import * as Y from 'yjs'
import { Provider, useAtom } from 'jotai'
import { createYAtom, withTransact } from 'y-jotai'

const doc = new Y.Doc()
const map = doc.getMap<string>('root')

// Treat the whole Y.Map as a single Jotai atom.
const snapshotAtom = createYAtom({
  y: map,
  read: (m) => m.toJSON() as Record<string, string>,
})

// Regular Jotai usage inside your React components.
function Example() {
  const [snapshot, setSnapshot] = useAtom(snapshotAtom)
  const onRename = () =>
    setSnapshot((prev) => ({ ...prev, title: 'Hello, peers!' }))

  return (
    <div>
      <pre>{JSON.stringify(snapshot, null, 2)}</pre>
      <button onClick={onRename}>Rename</button>
    </div>
  )
}

export const App = () => (
  <Provider>
    <Example />
  </Provider>
)
```

> The only requirement is to mount a single `Jotai` `<Provider>` that owns the atoms. You can reuse the same pre-existing store you use for local state.

## Usage patterns

### 1. Large snapshot atoms

You do **not** need to split your document if you do not care about fine-grained rerenders. Just supply `read`/`write` and, when you want *any* nested change to trigger an update, set `deep: true`.

```ts
const docAtom = createYAtom({
  y: doc.getMap('content'),
  read: (map) => map.toJSON(),
  deep: true,
})
```

This mirrors the common `y.observeDeep` pattern while staying inside the Jotai ecosystem.

### 2. Focused atoms when you need them

When a component only cares about a single key or array index and you want to avoid wide rerenders, switch to the specialised factories:

```ts
const titleAtom = createYMapKeyAtom(doc.getMap('content'), 'title')
const todoAtom = createYArrayIndexAtom(doc.getArray<Todo>('todos'), 0, {
  decode: (item) => item ?? { text: '', done: false },
})
const textAtom = createYTextAtom(doc.getText('body'))
```

These helpers automatically guard against redundant updates (`equals`), decode/encode values, and filter events so only relevant components rerender.

### 3. Arbitrary deep paths

If the structure is dynamic, `createYPathAtom` lets you traverse any mix of `Y.Map`/`Y.Array` segments:

```ts
const commentAtom = createYPathAtom<Comment>(
  doc.getMap('root'),
  ['threads', 0, 'comments', 4],
  {
    read: (node) => (node as Y.Map<Comment>).toJSON(),
    write: (parent, last, next) => {
      if (parent instanceof Y.Array && typeof last === 'number') {
        parent.delete(last, 1)
        parent.insert(last, [next])
      }
    },
  }
)
```

By default it enables deep observation because the path may span multiple nested Y types.

### 4. Reduce manual wiring

You only need to handcraft atoms for structures that truly benefit from them. Typical shortcuts:

- **Start coarse:** keep a single `createYAtom` per document (as shown in the quick start). Break it down only if profiling shows expensive rerenders.
- **Generate on demand:** wrap a helper once and reuse it everywhere.

```ts
const useYMapKeyAtom = (map: Y.Map<any>, key: string) =>
  useMemo(() => createYMapKeyAtom(map, key), [map, key])
```

For larger teams you can memoise via `atomFamily` so callers only specify the path:

```ts
import { atomFamily } from 'jotai/utils'

const mapKeyFamily = atomFamily((key: string) =>
  createYMapKeyAtom(doc.getMap('content'), key)
)

// Later in components
const [title, setTitle] = useAtom(mapKeyFamily('title'))
```

- **Slice a big atom:** pair a document-wide atom with utilities like [`jotai-optics`](https://github.com/jotaijs/jotai/tree/main/examples/with-optics) or `selectAtom` from `jotai/utils` to derive smaller atoms without redefining them.

These approaches keep adoption friction low while preserving a path to fine-grained atoms if you need them later.

## Writing back to Yjs

- `createYAtom` automatically wraps your `write` callback with [`withTransact`](src/index.ts) so operations happen inside a Yjs transaction when the document supports it.
- You can pass functional updates (`set(atom, prev => next)`) and they behave just like regular Jotai atoms. Use `equals` to prevent unnecessary writes if you store complex structures.
- Writes **must** use the native Yjs APIs (`map.set`, `array.insert`, `text.insert`, …). Do not mutate the snapshotted value—it is detached from the actual Yjs type.

## Sharing the Y.Doc

This package does not create or sync the document. Bring your own provider (WebRTC, WebSocket, y-websocket, Hocuspocus, Liveblocks bridge, etc.). Every peer that shares the same `Y.Doc` instance can mount the same atoms and they will stay in sync via Yjs updates.

## FAQ

- **Is fine-grained decomposition required?** No. Start with a single atom per logical document and only split when profiling shows unnecessary rerenders.
- **How does this compare to `valtio-yjs`?** Choose whichever state library you already use. Jotai favors explicit atoms, Valtio favors mutable proxies. Both ultimately forward updates to Yjs.
- **Can I mix this with local Jotai atoms?** Yes. They live in the same store, so components can read collaborative state and local UI state without extra wiring.

## Author

y-jotai © Wibus, Released under MIT. Created on Oct 17, 2025

> [Personal Website](http://wibus.ren/) · [Blog](https://blog.wibus.ren/) · GitHub [@wibus-wee](https://github.com/wibus-wee/) · Telegram [@wibus✪](https://t.me/wibus_wee)
