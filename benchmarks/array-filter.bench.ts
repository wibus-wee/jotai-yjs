import { bench, describe } from 'vitest'
import * as Y from 'yjs'
import { createStore } from 'jotai'
import { createYArrayIndexAtom } from '../src'

describe('Array eventFilter performance', () => {
  bench('insert before monitored index (should trigger)', () => {
    const doc = new Y.Doc()
    const arr = doc.getArray<number>('a')
    arr.insert(0, Array.from({ length: 100 }, (_, i) => i))

    const atom = createYArrayIndexAtom(arr, 50)
    const store = createStore()
    store.sub(atom, () => {})

    arr.insert(0, [999])
  })

  bench('insert after monitored index (should not trigger)', () => {
    const doc = new Y.Doc()
    const arr = doc.getArray<number>('a')
    arr.insert(0, Array.from({ length: 100 }, (_, i) => i))

    const atom = createYArrayIndexAtom(arr, 50)
    const store = createStore()
    store.sub(atom, () => {})

    arr.insert(99, [999])
  })

  bench('delete before index', () => {
    const doc = new Y.Doc()
    const arr = doc.getArray<number>('a')
    arr.insert(0, Array.from({ length: 100 }, (_, i) => i))

    const atom = createYArrayIndexAtom(arr, 50)
    const store = createStore()
    store.sub(atom, () => {})

    arr.delete(0, 1)
  })

  bench('delete after index', () => {
    const doc = new Y.Doc()
    const arr = doc.getArray<number>('a')
    arr.insert(0, Array.from({ length: 100 }, (_, i) => i))

    const atom = createYArrayIndexAtom(arr, 50)
    const store = createStore()
    store.sub(atom, () => {})

    arr.delete(99, 1)
  })

  bench('update at exact index', () => {
    const doc = new Y.Doc()
    const arr = doc.getArray<number>('a')
    arr.insert(0, Array.from({ length: 100 }, (_, i) => i))

    const atom = createYArrayIndexAtom(arr, 50)
    const store = createStore()
    store.sub(atom, () => {})

    arr.delete(50, 1)
    arr.insert(50, [999])
  })

  bench('large array - insert at start', () => {
    const doc = new Y.Doc()
    const arr = doc.getArray<number>('a')
    arr.insert(0, Array.from({ length: 10000 }, (_, i) => i))

    const atom = createYArrayIndexAtom(arr, 5000)
    const store = createStore()
    store.sub(atom, () => {})

    arr.insert(0, [999])
  })

  bench('multiple atoms on same array', () => {
    const doc = new Y.Doc()
    const arr = doc.getArray<number>('a')
    arr.insert(0, Array.from({ length: 100 }, (_, i) => i))

    const atoms = Array.from({ length: 10 }, (_, i) =>
      createYArrayIndexAtom(arr, i * 10)
    )

    const store = createStore()
    atoms.forEach((atom) => store.sub(atom, () => {}))

    arr.insert(50, [999])
  })
})
