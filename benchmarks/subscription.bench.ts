import { bench, describe } from 'vitest'
import * as Y from 'yjs'
import { createStore } from 'jotai'
import { createYMapKeyAtom, createYArrayIndexAtom } from '../src'

describe('Subscription performance', () => {
  bench('mount Map atom', () => {
    const doc = new Y.Doc()
    const map = doc.getMap<number>('m')
    const atom = createYMapKeyAtom(map, 'key')
    const store = createStore()

    const unsub = store.sub(atom, () => {})
    unsub()
  })

  bench('mount Array atom', () => {
    const doc = new Y.Doc()
    const arr = doc.getArray<number>('a')
    arr.insert(0, [1, 2, 3])
    const atom = createYArrayIndexAtom(arr, 1)
    const store = createStore()

    const unsub = store.sub(atom, () => {})
    unsub()
  })

  bench('10 concurrent atoms on same Y.Map', () => {
    const doc = new Y.Doc()
    const map = doc.getMap<number>('m')
    const store = createStore()

    const atoms = Array.from({ length: 10 }, (_, i) =>
      createYMapKeyAtom(map, `key${i}`)
    )

    const unsubs = atoms.map((atom) => store.sub(atom, () => {}))

    unsubs.forEach((u) => u())
  })

  bench('100 concurrent atoms on same Y.Map', () => {
    const doc = new Y.Doc()
    const map = doc.getMap<number>('m')
    const store = createStore()

    const atoms = Array.from({ length: 100 }, (_, i) =>
      createYMapKeyAtom(map, `key${i}`)
    )

    const unsubs = atoms.map((atom) => store.sub(atom, () => {}))

    map.set('key50', 999)

    unsubs.forEach((u) => u())
  })

  bench('single update with 10 subscribers', () => {
    const doc = new Y.Doc()
    const map = doc.getMap<number>('m')
    const atom = createYMapKeyAtom(map, 'key')
    const store = createStore()

    const unsubs = Array.from({ length: 10 }, () =>
      store.sub(atom, () => {})
    )

    map.set('key', 999)

    unsubs.forEach((u) => u())
  })

  bench('rapid mount/unmount cycles', () => {
    const doc = new Y.Doc()
    const map = doc.getMap<number>('m')
    const atom = createYMapKeyAtom(map, 'key')
    const store = createStore()

    for (let i = 0; i < 10; i++) {
      const unsub = store.sub(atom, () => {})
      unsub()
    }
  })

  bench('update with no subscribers', () => {
    const doc = new Y.Doc()
    const map = doc.getMap<number>('m')

    map.set('key', 999)
  })

  bench('update with 1 subscriber', () => {
    const doc = new Y.Doc()
    const map = doc.getMap<number>('m')
    const atom = createYMapKeyAtom(map, 'key')
    const store = createStore()

    const unsub = store.sub(atom, () => {})

    map.set('key', 999)

    unsub()
  })
})
