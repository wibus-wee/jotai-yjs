import { describe, it, expect, vi } from 'vitest'
import * as Y from 'yjs'
import { atom, createStore } from 'jotai'
import {
  createYAtom,
  createYMapKeyAtom,
  createYArrayIndexAtom,
  createYTextAtom,
  createYPathAtom,
} from '../src'

describe('yJotai adapters', () => {
  it('Map key atom updates only when the key changes', () => {
    const doc = new Y.Doc()
    const map = doc.getMap<number>('m')
    const aAtom = createYMapKeyAtom<number, number>(map, 'a', {
      decode: (v) => (typeof v === 'number' ? v : 0),
    })

    const store = createStore()
    const seen: number[] = []

    // Mount subscription and track changes
    const unsubscribe = store.sub(aAtom, () => {
      seen.push(store.get(aAtom))
    })
    // Push initial snapshot manually for assertion clarity
    seen.push(store.get(aAtom))
    expect(seen.at(-1)).toBe(0)

    // Unrelated key should not trigger update (eventFilter blocks)
    map.set('b', 2)
    expect(seen.length).toBe(1)

    // Target key change should propagate
    map.set('a', 5)
    expect(store.get(aAtom)).toBe(5)
    expect(seen.at(-1)).toBe(5)
    expect(seen.length).toBe(2)

    // Setting same value should be suppressed by equals
    map.set('a', 5)
    expect(seen.length).toBe(2)

    unsubscribe()
  })

  it('Array index atom reacts to index shifts and value changes', () => {
    const doc = new Y.Doc()
    const arr = doc.getArray<number>('a')
    arr.insert(0, [1, 2, 3])

    const idx = 1
    const aAtom = createYArrayIndexAtom<number, number>(arr, idx, {
      decode: (v) => (typeof v === 'number' ? v : -1),
    })

    const store = createStore()
    const seen: number[] = []

    const unsubscribe = store.sub(aAtom, () => {
      seen.push(store.get(aAtom))
    })
    // Push initial snapshot manually for assertion clarity
    seen.push(store.get(aAtom))
    expect(seen.at(-1)).toBe(2)

    // Insert before index -> shifts, should update to previous value at index-1 (1)
    arr.insert(0, [99]) // [99,1,2,3]
    expect(store.get(aAtom)).toBe(1)
    expect(seen.at(-1)).toBe(1)

    // Change after index -> should not affect the value at index 1
    const lastIndex = arr.length - 1
    arr.delete(lastIndex, 1)
    arr.insert(lastIndex, [42])
    expect(store.get(aAtom)).toBe(1)
    // equals guard avoids pushing new value when unchanged
    expect(seen.at(-1)).toBe(1)

    // Insert right after index -> should not affect the value at index 1
    arr.insert(idx + 1, [777])
    expect(store.get(aAtom)).toBe(1)

    // Replace same value at same index: should be suppressed by equals
    arr.delete(idx, 1)
    arr.insert(idx, [1])
    const before = seen.length
    // Force microtask boundary (not required but clarifies intent)
    expect(store.get(aAtom)).toBe(1)
    expect(seen.length).toBe(before) // no new push

    unsubscribe()
  })

  it('Text atom reads/writes string content', () => {
    const doc = new Y.Doc()
    const text = doc.getText('t')
    text.insert(0, 'hi')
    const tAtom = createYTextAtom(text)

    const store = createStore()
    const seen: string[] = []

    const unsubscribe = store.sub(tAtom, () => {
      seen.push(store.get(tAtom))
    })
    // Push initial snapshot manually
    seen.push(store.get(tAtom))
    expect(seen.at(-1)).toBe('hi')

    // Write via atom
    store.set(tAtom, 'hello')
    expect(text.toString()).toBe('hello')
    expect(store.get(tAtom)).toBe('hello')
    expect(seen.at(-1)).toBe('hello')

    // Writing same value should not push
    const before = seen.length
    store.set(tAtom, 'hello')
    expect(seen.length).toBe(before)

    unsubscribe()
  })

  

  it('yAtom source can resubscribe on instance change', () => {
    const doc1 = new Y.Doc()
    const doc2 = new Y.Doc()
    const map1 = doc1.getMap<number>('m')
    const map2 = doc2.getMap<number>('m')
    map1.set('a', 1)
    map2.set('a', 100)

    const sourceAtom = atom<Y.Map<number>>(map1)
    const aAtom = createYAtom({
      yAtom: sourceAtom,
      read: (m) => (typeof m.get('a') === 'number' ? (m.get('a') as number) : 0),
      write: (m, next) => m.set('a', next),
      eventFilter: (evt) => (evt.keysChanged ? evt.keysChanged.has('a') : true),
      resubscribeOnSourceChange: true,
    })

    const store = createStore()
    const seen: number[] = []
    const unsubscribe = store.sub(aAtom, () => {
      seen.push(store.get(aAtom))
    })

    // initial from map1
    expect(store.get(aAtom)).toBe(1)

    // switch source to map2 -> immediate sync
    store.set(sourceAtom, map2)
    expect(store.get(aAtom)).toBe(100)

    // events from old source should not affect
    map1.set('a', 2)
    expect(store.get(aAtom)).toBe(100)

    // events from new source should reflect
    map2.set('a', 101)
    expect(store.get(aAtom)).toBe(101)
    expect(seen.at(-1)).toBe(101)

    unsubscribe()
  })

  it('Path atom default writer handles Map semantics', () => {
    const doc = new Y.Doc()
    const root = doc.getMap<unknown>('root')
    const store = createStore()
    const pathAtom = createYPathAtom(root, ['foo'])

    // Initial write creates the key
    store.set(pathAtom, 42)
    expect(root.get('foo')).toBe(42)

    // Writing same value should be a no-op
    store.set(pathAtom, 42)
    expect(root.get('foo')).toBe(42)

    // undefined triggers deletion
    store.set(pathAtom, undefined)
    expect(root.has('foo')).toBe(false)
  })

  it('Path atom default writer handles Array semantics', () => {
    const doc = new Y.Doc()
    const arr = doc.getArray<string>('arr')
    arr.insert(0, ['a', 'b'])
    const store = createStore()
    const pathAtom = createYPathAtom<string | undefined>(arr, [1])

    expect(store.get(pathAtom)).toBe('b')

    store.set(pathAtom, 'c')
    expect(arr.toArray()[1]).toBe('c')

    // No-op when value unchanged
    store.set(pathAtom, 'c')
    expect(arr.toArray()[1]).toBe('c')

    // undefined removes the slot
    store.set(pathAtom, undefined)
    expect(arr.length).toBe(1)

    // Writing again appends at the desired index
    store.set(pathAtom, 'z')
    expect(arr.toArray()[1]).toBe('z')
  })

  it('Path atom default writer skips when parent cannot be resolved', () => {
    const doc = new Y.Doc()
    const root = doc.getMap<unknown>('root')
    const store = createStore()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const pathAtom = createYPathAtom<number>(root, ['missing', 'value'])

    expect(() => store.set(pathAtom, 1)).not.toThrow()
    expect(root.has('missing')).toBe(false)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('does not resubscribe when resubscribeOnSourceChange=false (default)', () => {
    const doc1 = new Y.Doc()
    const doc2 = new Y.Doc()
    const map1 = doc1.getMap<number>('m')
    const map2 = doc2.getMap<number>('m')
    map1.set('a', 1)
    map2.set('a', 100)

    const sourceAtom = atom<Y.Map<number>>(map1)
    const aAtom = createYAtom({
      yAtom: sourceAtom,
      read: (m) => (typeof m.get('a') === 'number' ? (m.get('a') as number) : 0),
      write: (m, next) => m.set('a', next),
      eventFilter: (evt) => (evt.keysChanged ? evt.keysChanged.has('a') : true),
      // default is no-resubscribe
    })

    const store = createStore()
    const seen: number[] = []
    const unsub = store.sub(aAtom, () => {
      seen.push(store.get(aAtom))
    })

    // initial from map1
    expect(store.get(aAtom)).toBe(1)

    // switch source to map2 -> should NOT resubscribe or switch snapshot
    store.set(sourceAtom, map2)
    expect(store.get(aAtom)).toBe(1)

    // updates on old source should still drive snapshot
    map1.set('a', 2)
    expect(store.get(aAtom)).toBe(2)

    // updates on new source should NOT affect
    map2.set('a', 101)
    expect(store.get(aAtom)).toBe(2)

    // default path doesn't resubscribe; writer semantics are out of scope here
    
    unsub()
  })

  it('coalesces updates inside a single transact to one notification', () => {
    const doc = new Y.Doc()
    const map = doc.getMap<number>('m')
    const aAtom = createYAtom({
      y: map,
      read: (m) => ({ a: m.get('a') ?? 0, b: m.get('b') ?? 0 }),
      deep: false,
      eventFilter: () => true,
    })

    const store = createStore()
    const seen: Array<{ a: number; b: number }> = []
    const unsub = store.sub(aAtom, () => {
      seen.push(store.get(aAtom))
    })

    // initial push
    seen.push(store.get(aAtom))
    expect(seen.at(-1)).toEqual({ a: 0, b: 0 })

    doc.transact(() => {
      map.set('a', 1)
      map.set('a', 2)
      map.set('b', 3)
    })

    // only one notification, latest values
    expect(store.get(aAtom)).toEqual({ a: 2, b: 3 })
    expect(seen.at(-1)).toEqual({ a: 2, b: 3 })
    expect(seen.length).toBe(2)
    unsub()
  })

  it('deep observation updates on nested change and ignores eventFilter', () => {
    const doc = new Y.Doc()
    const root = doc.getMap<any>('root')
    const nested = new Y.Map<any>()
    root.set('nested', nested)

    const filter = vi.fn(() => false) // should not be called in deep mode
    const aAtom = createYAtom({
      y: root,
      read: (m) => (m.get('nested') as Y.Map<any>)?.get('x') ?? 0,
      deep: true,
      eventFilter: filter,
    })

    const store = createStore()
    const unsub = store.sub(aAtom, () => {})

    expect(store.get(aAtom)).toBe(0)
    nested.set('x', 42)
    expect(store.get(aAtom)).toBe(42)
    expect(filter).not.toHaveBeenCalled()

    unsub()
  })

  it('non-deep respects eventFilter and blocks unrelated changes', () => {
    const doc = new Y.Doc()
    const map = doc.getMap<any>('m')
    const filter = vi.fn((evt: any) => (evt.keysChanged ? evt.keysChanged.has('a') : true))
    const aAtom = createYAtom({
      y: map as Y.Map<any>,
      read: (m) => (m.get('a') ?? 0) as number,
      eventFilter: filter,
    })

    const store = createStore()
    const unsub = store.sub(aAtom, () => {})
    expect(store.get(aAtom)).toBe(0)

    map.set('b', 1)
    expect(store.get(aAtom)).toBe(0)
    expect(filter).toHaveBeenCalled()

    map.set('a', 2)
    expect(store.get(aAtom)).toBe(2)
    unsub()
  })

  it('array path: out-of-range writes clamp to tail; undefined deletes', () => {
    const doc = new Y.Doc()
    const arr = doc.getArray<string>('arr')
    arr.insert(0, ['a', 'b'])
    const store = createStore()
    const aAtom = createYPathAtom<string | undefined>(arr, [5])

    // writing beyond length appends
    store.set(aAtom, 'z')
    expect(arr.toArray()).toEqual(['a', 'b', 'z'])

    // deletion at existing index
    const idxAtom = createYPathAtom<string | undefined>(arr, [1])
    store.set(idxAtom, undefined)
    expect(arr.toArray()).toEqual(['a', 'z'])
  })

  it('custom equals suppresses object identity changes with same content', () => {
    const doc = new Y.Doc()
    const map = doc.getMap<any>('m')
    const aAtom = createYMapKeyAtom<any, { x: number } | undefined>(map, 'obj', {
      decode: (v) => (v as { x: number } | undefined),
      encode: (v) => v as any,
      equals: (a, b) => (a?.x ?? -1) === (b?.x ?? -1),
    })

    const store = createStore()
    const seen: Array<{ x: number } | undefined> = []
    const unsub = store.sub(aAtom, () => {
      seen.push(store.get(aAtom))
    })

    seen.push(store.get(aAtom))
    expect(seen.at(-1)).toBeUndefined()

    map.set('obj', { x: 1 })
    expect(store.get(aAtom)).toEqual({ x: 1 })
    const before = seen.length
    map.set('obj', { x: 1 })
    expect(seen.length).toBe(before) // equals suppresses

    map.set('obj', { x: 2 })
    expect(store.get(aAtom)).toEqual({ x: 2 })
    expect(seen.at(-1)).toEqual({ x: 2 })

    unsub()
  })

  it('writer supports functional updates', () => {
    const doc = new Y.Doc()
    const text = doc.getText('t')
    text.insert(0, 'hi')
    const tAtom = createYTextAtom(text)
    const store = createStore()

    expect(store.get(tAtom)).toBe('hi')
    store.set(tAtom, (prev) => prev + ' there')
    expect(text.toString()).toBe('hi there')
    expect(store.get(tAtom)).toBe('hi there')
  })

  it('stops notifying after unsubscribe', () => {
    const doc = new Y.Doc()
    const map = doc.getMap<number>('m')
    const aAtom = createYMapKeyAtom<number, number>(map, 'a', {
      decode: (v) => (typeof v === 'number' ? v : 0),
    })
    const store = createStore()
    const seen: number[] = []
    const unsub = store.sub(aAtom, () => {
      seen.push(store.get(aAtom))
    })
    seen.push(store.get(aAtom))
    expect(seen.at(-1)).toBe(0)
    unsub()
    map.set('a', 5)
    expect(seen.at(-1)).toBe(0)
  })

  it('path mixed Map→Array→Map and undefined deletes', () => {
    const doc = new Y.Doc()
    const root = doc.getMap<any>('root')
    const arr = new Y.Array<any>()
    const item0 = new Y.Map<any>()
    const meta = new Y.Map<any>()
    item0.set('meta', meta)
    arr.insert(0, [item0])
    root.set('threads', arr)

    const store = createStore()
    const pAtom = createYPathAtom<string | undefined>(root, ['threads', 0, 'meta', 'flag'])

    expect(store.get(pAtom)).toBeUndefined()
    store.set(pAtom, 'on')
    expect((root.get('threads') as Y.Array<any>).get(0).get('meta').get('flag')).toBe('on')

    // undefined deletes
    store.set(pAtom, undefined)
    expect((root.get('threads') as Y.Array<any>).get(0).get('meta').has('flag')).toBe(false)
  })

  it('Text updates from Y side flow through', () => {
    const doc = new Y.Doc()
    const text = doc.getText('t')
    text.insert(0, 'x')
    const tAtom = createYTextAtom(text)
    const store = createStore()
    const seen: string[] = []
    const unsub = store.sub(tAtom, () => {
      seen.push(store.get(tAtom))
    })
    seen.push(store.get(tAtom))
    expect(seen.at(-1)).toBe('x')
    text.insert(1, 'y')
    expect(store.get(tAtom)).toBe('xy')
    expect(seen.at(-1)).toBe('xy')
    unsub()
  })
})
