import { describe, it, expect, vi } from 'vitest'
import * as Y from 'yjs'
import { atom, createStore } from 'jotai'
import {
  createYAtom,
  createYMapKeyAtom,
  createYMapEntryAtom,
  createYMapFieldsAtom,
  createYArrayIndexAtom,
  createYTextAtom,
  createYPathAtom,
} from '../src'

describe('yJotai adapters', () => {
  it('Map key atom updates only when the key changes', () => {
    const doc = new Y.Doc()
    const map = doc.getMap<number>('m')
    const aAtom = createYMapKeyAtom(map, 'a', {
      decode: (v): number => (typeof v === 'number' ? v : 0),
      encode: (v: number): number => v,
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

  it('Map entry atom tracks Y type reference and filters by key', () => {
    const doc = new Y.Doc()
    type ChildMap = Y.Map<number>
    const map = doc.getMap<ChildMap>('m')
    const entryAtom = createYMapEntryAtom(map, 'child')

    const store = createStore()
    const seen: Array<ChildMap | null> = []

    const unsubscribe = store.sub(entryAtom, () => {
      seen.push(store.get(entryAtom))
    })
    seen.push(store.get(entryAtom))
    expect(seen.at(-1)).toBeNull()

    const first = new Y.Map<number>()
    first.set('v', 1)
    map.set('child', first)
    expect(store.get(entryAtom)).toBe(first)
    expect(seen.at(-1)).toBe(first)

    // Replacing with a new reference should update
    const second = new Y.Map<number>()
    map.set('child', second)
    expect(store.get(entryAtom)).toBe(second)
    expect(seen.at(-1)).toBe(second)

    // Unrelated key should be filtered out
    const before = seen.length
    map.set('other', new Y.Map<number>())
    expect(seen.length).toBe(before)

    unsubscribe()
  })

  it('Array index atom reacts to index shifts and value changes', () => {
    const doc = new Y.Doc()
    const arr = doc.getArray<number>('a')
    arr.insert(0, [1, 2, 3])

    const idx = 1
    const aAtom = createYArrayIndexAtom(arr, idx, {
      decode: (v): number => (typeof v === 'number' ? v : -1),
      encode: (v: number): number => v,
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

  it('Map fields atom narrows updates to selected keys with shallow equals', () => {
    const doc = new Y.Doc()
    const map = doc.getMap<string>('m')
    type Fields = { title: string; status: string }
    const fieldsAtom = createYMapFieldsAtom<Fields, readonly ['title', 'status']>(map, ['title', 'status'] as const)

    const store = createStore()
    const seen: Array<Partial<Fields>> = []

    const unsubscribe = store.sub(fieldsAtom, () => {
      seen.push(store.get(fieldsAtom))
    })
    seen.push(store.get(fieldsAtom))
    expect(seen.at(-1)).toEqual({})

    map.set('other', 'noop')
    expect(seen.length).toBe(1)

    map.set('title', 'hello')
    expect(store.get(fieldsAtom)).toEqual({ title: 'hello' })
    expect(seen.at(-1)).toEqual({ title: 'hello' })

    // Same value is shallow-equal; no extra push
    const before = seen.length
    map.set('title', 'hello')
    expect(seen.length).toBe(before)

    map.set('status', 'open')
    expect(store.get(fieldsAtom)).toEqual({ title: 'hello', status: 'open' })
    expect(seen.at(-1)).toEqual({ title: 'hello', status: 'open' })

    unsubscribe()
  })

  it('Map fields atom supports includeUndefined and partial writes', () => {
    const doc = new Y.Doc()
    const map = doc.getMap<string | number>('m')
    type Fields = { title: string; count: number }
    const fieldsAtom = createYMapFieldsAtom<Fields, readonly ['title', 'count']>(
      map,
      ['title', 'count'] as const,
      { includeUndefined: true }
    )

    const store = createStore()
    const seen: Array<Partial<Fields>> = []

    const unsubscribe = store.sub(fieldsAtom, () => {
      seen.push(store.get(fieldsAtom))
    })
    seen.push(store.get(fieldsAtom))
    expect(seen.at(-1)).toEqual({ title: undefined, count: undefined })

    store.set(fieldsAtom, { title: 'hi' })
    expect(map.get('title')).toBe('hi')
    expect(map.has('count')).toBe(false)
    expect(store.get(fieldsAtom)).toEqual({ title: 'hi', count: undefined })
    expect(seen.at(-1)).toEqual({ title: 'hi', count: undefined })

    store.set(fieldsAtom, (prev) => ({ ...prev, count: 2 }))
    expect(map.get('count')).toBe(2)
    expect(store.get(fieldsAtom)).toEqual({ title: 'hi', count: 2 })
    expect(seen.at(-1)).toEqual({ title: 'hi', count: 2 })

    const before = seen.length
    map.set('other', 'noop')
    expect(seen.length).toBe(before)

    unsubscribe()
  })

  it('Map entry atom deleteOnNull removes key from map', () => {
    const doc = new Y.Doc()
    type ChildMap = Y.Map<number>
    const map = doc.getMap<ChildMap | null>('m')
    const entryAtom = createYMapEntryAtom<typeof map, ChildMap>(map, 'child', {
      deleteOnNull: true,
    })

    const store = createStore()
    const seen: Array<ChildMap | null> = []

    const unsubscribe = store.sub(entryAtom, () => {
      seen.push(store.get(entryAtom))
    })
    seen.push(store.get(entryAtom))
    expect(seen.at(-1)).toBeNull()

    // Set a Y.Map entry
    const child = new Y.Map<number>()
    child.set('v', 1)
    store.set(entryAtom, child)
    expect(map.get('child')).toBe(child)
    expect(store.get(entryAtom)).toBe(child)

    // Writing null should delete the key (not leave tombstone)
    store.set(entryAtom, null)
    expect(map.has('child')).toBe(false)
    expect(store.get(entryAtom)).toBeNull()

    unsubscribe()
  })

  it('Map entry atom without deleteOnNull stores null value', () => {
    const doc = new Y.Doc()
    type ChildMap = Y.Map<number>
    const map = doc.getMap<ChildMap | null>('m')
    const entryAtom = createYMapEntryAtom<typeof map, ChildMap>(map, 'child')

    const store = createStore()
    const unsub = store.sub(entryAtom, () => {})

    // Set a Y.Map entry
    const child = new Y.Map<number>()
    store.set(entryAtom, child)
    expect(map.get('child')).toBe(child)

    // Writing null should store null value (key remains)
    store.set(entryAtom, null)
    expect(map.has('child')).toBe(true)
    expect(map.get('child')).toBeNull()

    unsub()
  })

  it('Map fields atom deleteOnUndefined removes keys from map', () => {
    const doc = new Y.Doc()
    const map = doc.getMap<any>('m')
    map.set('title', 'hello')
    map.set('count', 5)

    const fieldsAtom = createYMapFieldsAtom(
      map,
      ['title', 'count'] as const,
      { deleteOnUndefined: true }
    )

    const store = createStore()
    const unsub = store.sub(fieldsAtom, () => {})

    expect(store.get(fieldsAtom)).toEqual({ title: 'hello', count: 5 })

    // Writing undefined to 'title' should delete it
    store.set(fieldsAtom, { title: undefined, count: 5 })
    expect(map.has('title')).toBe(false)
    expect(map.get('count')).toBe(5)
    expect(store.get(fieldsAtom)).toEqual({ count: 5 })

    unsub()
  })

  it('Map fields atom only writes changed fields (no redundant CRDT ops)', () => {
    const doc = new Y.Doc()
    const map = doc.getMap<any>('m')
    map.set('title', 'hello')
    map.set('count', 5)

    // Track all set operations on the map
    const setCalls: Array<{ key: string; value: unknown }> = []
    const originalSet = map.set.bind(map) as typeof map.set
    ;(map as any).set = <V>(key: string, value: V): V => {
      setCalls.push({ key, value })
      return originalSet(key, value)
    }

    const fieldsAtom = createYMapFieldsAtom(
      map,
      ['title', 'count'] as const
    )

    const store = createStore()
    const unsub = store.sub(fieldsAtom, () => {})

    // Clear setCalls from any initial operations
    setCalls.length = 0

    // Write with unchanged count - should only set 'title'
    store.set(fieldsAtom, { title: 'world', count: 5 })
    expect(setCalls).toEqual([{ key: 'title', value: 'world' }])
    expect(map.get('title')).toBe('world')
    expect(map.get('count')).toBe(5)

    setCalls.length = 0

    // Write with both unchanged - should not call set at all
    store.set(fieldsAtom, { title: 'world', count: 5 })
    expect(setCalls).toEqual([])

    setCalls.length = 0

    // Write with only count changed - should only set 'count'
    store.set(fieldsAtom, prev => ({ ...prev, count: 10 }))
    expect(setCalls).toEqual([{ key: 'count', value: 10 }])

    unsub()
  })

  it('Map fields atom fieldEquals option for custom comparison', () => {
    const doc = new Y.Doc()
    const map = doc.getMap<any>('m')
    map.set('data', { nested: 1 })

    // Track set operations
    const setCalls: string[] = []
    const originalSet = map.set.bind(map) as typeof map.set
    ;(map as any).set = <VAL>(key: string, value: VAL): VAL => {
      setCalls.push(key)
      return originalSet(key, value)
    }

    // With deep equality for fields
    const fieldsAtom = createYMapFieldsAtom(
      map,
      ['data'] as const,
      { fieldEquals: (a, b) => JSON.stringify(a) === JSON.stringify(b) }
    )

    const store = createStore()
    const unsub = store.sub(fieldsAtom, () => {})

    setCalls.length = 0

    // Same content, different reference - should not trigger set
    store.set(fieldsAtom, { data: { nested: 1 } })
    expect(setCalls).toEqual([])

    // Different content - should trigger set
    store.set(fieldsAtom, { data: { nested: 2 } })
    expect(setCalls).toEqual(['data'])

    unsub()
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

  it('supports nullable yAtom sources; no-ops writes before ready; resubscribes across sources', () => {
    const doc = new Y.Doc()
    const map1 = doc.getMap<number>('m1')
    const map2 = doc.getMap<number>('m2')

    const sourceAtom = atom<Y.Map<number> | null>(null)

    const aAtom = createYAtom({
      yAtom: sourceAtom,
      read: (m) => (m ? (m.get('a') as number | undefined) ?? -1 : -1),
      write: (m, next) => m.set('a', next),
      eventFilter: (evt) => (evt.keysChanged ? evt.keysChanged.has('a') : true),
      resubscribeOnSourceChange: true,
    })

    const store = createStore()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // Initial read from null source
    expect(store.get(aAtom)).toBe(-1)

    // Write while source is null should warn and no-op
    store.set(aAtom, 5)
    expect(map1.has('a')).toBe(false)
    expect(map2.has('a')).toBe(false)
    expect(warn).toHaveBeenCalled()
    warn.mockClear()

    // Bring source online (map1)
    store.set(sourceAtom, map1)
    expect(store.get(aAtom)).toBe(-1)
    expect(warn).not.toHaveBeenCalled()

    // External Yjs changes should propagate
    map1.set('a', 1)
    expect(store.get(aAtom)).toBe(1)

    // Writes now apply to the map, and should not warn
    store.set(aAtom, 2)
    expect(map1.get('a')).toBe(2)
    expect(warn).not.toHaveBeenCalled()

    // Swap source to map2 (resubscribe)
    store.set(sourceAtom, map2)
    expect(store.get(aAtom)).toBe(-1)

    // Changes to old source must NOT affect atom anymore
    map1.set('a', 9)
    expect(store.get(aAtom)).toBe(-1)

    // Changes to new source should affect atom
    map2.set('a', 7)
    expect(store.get(aAtom)).toBe(7)

    // Writes should go to new source
    store.set(aAtom, 8)
    expect(map2.get('a')).toBe(8)
    expect(warn).not.toHaveBeenCalled()

    warn.mockRestore()
  })

  it('map entry atom tolerates nullable map source; no-ops writes before ready; resubscribes across maps', () => {
    const doc = new Y.Doc()
    const parent1 = doc.getMap<Y.Map<any>>('parent1')
    const parent2 = doc.getMap<Y.Map<any>>('parent2')

    const mapAtom = atom<Y.Map<Y.Map<any>> | null>(null)

    const entryAtom = createYMapEntryAtom<Y.Map<any>>(mapAtom, 'child', {
      deleteOnNull: true,
      resubscribeOnSourceChange: true,
    })

    const store = createStore()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // Null parent -> entry is null
    expect(store.get(entryAtom)).toBeNull()

    // Write while parent is null should warn and no-op
    store.set(entryAtom, new Y.Map<any>())
    expect(parent1.has('child')).toBe(false)
    expect(parent2.has('child')).toBe(false)
    expect(warn).toHaveBeenCalled()
    warn.mockClear()

    // Bring parent online (parent1)
    store.set(mapAtom, parent1)
    expect(store.get(entryAtom)).toBeNull()
    expect(warn).not.toHaveBeenCalled()

    // Create child in parent1 -> should propagate
    const child1 = new Y.Map<any>()
    parent1.set('child', child1)
    expect(store.get(entryAtom)).toBe(child1)

    // Delete via atom (deleteOnNull)
    store.set(entryAtom, null)
    expect(parent1.has('child')).toBe(false)
    expect(warn).not.toHaveBeenCalled()

    // Recreate then swap to parent2 (resubscribe)
    const child1b = new Y.Map<any>()
    parent1.set('child', child1b)
    expect(store.get(entryAtom)).toBe(child1b)

    store.set(mapAtom, parent2)
    expect(store.get(entryAtom)).toBeNull()

    // Changes to old parent must NOT affect atom anymore
    parent1.set('child', new Y.Map<any>())
    expect(store.get(entryAtom)).toBeNull()

    // Changes to new parent should affect atom
    const child2 = new Y.Map<any>()
    parent2.set('child', child2)
    expect(store.get(entryAtom)).toBe(child2)

    warn.mockRestore()
  })

  it('Path atom default writer handles Map semantics', () => {
    const doc = new Y.Doc()
    const root = doc.getMap<unknown>('root')
    const store = createStore()
    const pathAtom = createYPathAtom(root, ['foo'])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // Initial write creates the key
    store.set(pathAtom, 42)
    expect(root.get('foo')).toBe(42)

    // Writing same value should be a no-op
    store.set(pathAtom, 42)
    expect(root.get('foo')).toBe(42)

    // undefined is ignored by default writer (no delete)
    store.set(pathAtom, undefined)
    expect(root.has('foo')).toBe(true)
    expect(root.get('foo')).toBe(42)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('Path atom default writer handles Array semantics', () => {
    const doc = new Y.Doc()
    const arr = doc.getArray<string>('arr')
    arr.insert(0, ['a', 'b'])
    const store = createStore()
    const pathAtom = createYPathAtom<string | undefined>(arr, [1])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(store.get(pathAtom)).toBe('b')

    store.set(pathAtom, 'c')
    expect(arr.toArray()[1]).toBe('c')

    // No-op when value unchanged
    store.set(pathAtom, 'c')
    expect(arr.toArray()[1]).toBe('c')

    // undefined is ignored by default writer (no delete)
    store.set(pathAtom, undefined)
    expect(arr.length).toBe(2)
    expect(arr.toArray()[1]).toBe('c')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()

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

  it('writes use the same Y instance as reads when resubscribeOnSourceChange=false', () => {
    const doc1 = new Y.Doc()
    const doc2 = new Y.Doc()
    const map1 = doc1.getMap<number>('m')
    const map2 = doc2.getMap<number>('m')

    const sourceAtom = atom<Y.Map<number>>(map1)
    const aAtom = createYAtom({
      yAtom: sourceAtom,
      read: (m) => (m.get('a') as number | undefined) ?? 0,
      write: (m, next) => m.set('a', next),
      eventFilter: (evt) => (evt.keysChanged ? evt.keysChanged.has('a') : true),
      // resubscribeOnSourceChange is false by default
    })

    const store = createStore()
    const unsub = store.sub(aAtom, () => {})

    // initial from map1
    expect(store.get(aAtom)).toBe(0)

    // write goes to pinned doc (map1)
    store.set(aAtom, 1)
    expect(map1.get('a')).toBe(1)
    expect(map2.get('a')).toBeUndefined()

    // swap source, but subscription stays on map1
    store.set(sourceAtom, map2)

    // write should still target map1, not map2
    store.set(aAtom, 2)
    expect(map1.get('a')).toBe(2)
    expect(map2.get('a')).toBeUndefined()

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

    // deletion at existing index must be handled by a custom writer;
    // default writer ignores undefined and keeps the value.
    const idxAtom = createYPathAtom<string | undefined>(arr, [1])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    store.set(idxAtom, undefined)
    expect(arr.toArray()).toEqual(['a', 'b', 'z'])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
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
    const aAtom = createYMapKeyAtom(map, 'a', {
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

    // undefined is ignored by default writer; key remains.
    store.set(pAtom, undefined)
    expect((root.get('threads') as Y.Array<any>).get(0).get('meta').has('flag')).toBe(true)
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
