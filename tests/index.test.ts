import { describe, it, expect, vi } from 'vitest'
import * as Y from 'yjs'
import { createStore } from 'jotai'
import {
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

  it('Path atom default writer handles Map semantics', () => {
    const doc = new Y.Doc()
    const root = doc.getMap<unknown>('root')
    const store = createStore()
    const atom = createYPathAtom(root, ['foo'])

    // Initial write creates the key
    store.set(atom, 42)
    expect(root.get('foo')).toBe(42)

    // Writing same value should be a no-op
    store.set(atom, 42)
    expect(root.get('foo')).toBe(42)

    // undefined triggers deletion
    store.set(atom, undefined)
    expect(root.has('foo')).toBe(false)
  })

  it('Path atom default writer handles Array semantics', () => {
    const doc = new Y.Doc()
    const arr = doc.getArray<string>('arr')
    arr.insert(0, ['a', 'b'])
    const store = createStore()
    const atom = createYPathAtom<string | undefined>(arr, [1])

    expect(store.get(atom)).toBe('b')

    store.set(atom, 'c')
    expect(arr.toArray()[1]).toBe('c')

    // No-op when value unchanged
    store.set(atom, 'c')
    expect(arr.toArray()[1]).toBe('c')

    // undefined removes the slot
    store.set(atom, undefined)
    expect(arr.length).toBe(1)

    // Writing again appends at the desired index
    store.set(atom, 'z')
    expect(arr.toArray()[1]).toBe('z')
  })

  it('Path atom default writer skips when parent cannot be resolved', () => {
    const doc = new Y.Doc()
    const root = doc.getMap<unknown>('root')
    const store = createStore()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const atom = createYPathAtom<number>(root, ['missing', 'value'])

    expect(() => store.set(atom, 1)).not.toThrow()
    expect(root.has('missing')).toBe(false)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
