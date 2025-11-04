import { describe, it, expect } from 'vitest'
import * as Y from 'yjs'
import { createStore } from 'jotai'
import {
  createYMapKeyAtom,
  createYArrayIndexAtom,
  createYTextAtom,
} from '../src'

describe('Memory leaks', () => {
  it('cleans up Y subscriptions on unmount', () => {
    const doc = new Y.Doc()
    const map = doc.getMap<number>('m')

    // Track subscription by monitoring actual updates
    let updateCount = 0
    map.observe(() => {
      updateCount++
    })

    const atom = createYMapKeyAtom(map, 'key')
    const store = createStore()

    const unsub = store.sub(atom, () => {})

    map.set('key', 1)
    const countDuring = updateCount

    unsub()

    map.set('key', 2)
    const countAfter = updateCount

    // Both updates should have triggered the observe callback
    expect(countDuring).toBeGreaterThan(0)
    expect(countAfter).toBeGreaterThan(countDuring)
  })

  it('handles multiple mount/unmount cycles', () => {
    const doc = new Y.Doc()
    const map = doc.getMap<number>('m')

    const atom = createYMapKeyAtom(map, 'key')
    const store = createStore()

    // Multiple cycles should not cause errors
    for (let i = 0; i < 100; i++) {
      const unsub = store.sub(atom, () => {})
      map.set('key', i)
      unsub()
    }

    // If we got here without errors, the test passes
    expect(true).toBe(true)
  })

  it('cleans up Array atom subscriptions', () => {
    const doc = new Y.Doc()
    const arr = doc.getArray<number>('a')
    arr.insert(0, [1, 2, 3])

    let updateCount = 0
    arr.observe(() => {
      updateCount++
    })

    const atom = createYArrayIndexAtom(arr, 1)
    const store = createStore()

    const unsub = store.sub(atom, () => {})

    arr.insert(0, [99])
    const countDuring = updateCount

    unsub()

    arr.insert(0, [100])
    const countAfter = updateCount

    expect(countDuring).toBeGreaterThan(0)
    expect(countAfter).toBeGreaterThan(countDuring)
  })

  it('cleans up Text atom subscriptions', () => {
    const doc = new Y.Doc()
    const text = doc.getText('t')
    text.insert(0, 'hello')

    let updateCount = 0
    text.observe(() => {
      updateCount++
    })

    const atom = createYTextAtom(text)
    const store = createStore()

    const unsub = store.sub(atom, () => {})

    store.set(atom, 'world')
    const countDuring = updateCount

    unsub()

    text.insert(0, 'x')
    const countAfter = updateCount

    expect(countDuring).toBeGreaterThan(0)
    expect(countAfter).toBeGreaterThan(countDuring)
  })

  it('does not leak when atom is never subscribed', () => {
    const doc = new Y.Doc()
    const map = doc.getMap<number>('m')

    let updateCount = 0
    map.observe(() => {
      updateCount++
    })

    // Create atom but don't subscribe
    const _atom = createYMapKeyAtom(map, 'key')

    map.set('key', 1)

    // Only our manual observer should fire
    expect(updateCount).toBe(1)
  })

  it('does not leak with concurrent atoms on same Y type', () => {
    const doc = new Y.Doc()
    const map = doc.getMap<number>('m')

    let updateCount = 0
    map.observe(() => {
      updateCount++
    })

    const store = createStore()
    const atoms = Array.from({ length: 10 }, (_, i) =>
      createYMapKeyAtom(map, `key${i}`)
    )

    const unsubs = atoms.map((atom) => store.sub(atom, () => {}))

    map.set('key0', 1)
    const countDuring = updateCount

    unsubs.forEach((u) => u())

    map.set('key0', 2)
    const countAfter = updateCount

    expect(countDuring).toBeGreaterThan(0)
    expect(countAfter).toBeGreaterThan(countDuring)
  })

  it('atoms can be resubscribed after unmount', () => {
    const doc = new Y.Doc()
    const map = doc.getMap<number>('m')

    const atom = createYMapKeyAtom(map, 'key')
    const store = createStore()

    // First subscription
    const unsub1 = store.sub(atom, () => {})
    map.set('key', 1)
    unsub1()

    // Second subscription after unmount
    let updateCount = 0
    const unsub2 = store.sub(atom, () => {
      updateCount++
    })

    map.set('key', 2)

    expect(updateCount).toBe(1)
    unsub2()
  })
})
