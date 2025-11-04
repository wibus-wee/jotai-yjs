import { bench, describe } from 'vitest'
import * as Y from 'yjs'
import { createStore } from 'jotai'
import { createYTextAtom } from '../src'

describe('Text atom write performance', () => {
  bench('small change (10 chars in 1KB text)', () => {
    const doc = new Y.Doc()
    const text = doc.getText('t')
    text.insert(0, 'a'.repeat(1000))

    const atom = createYTextAtom(text)
    const store = createStore()

    store.set(atom, 'a'.repeat(500) + 'MODIFIED!!' + 'a'.repeat(490))
  })

  bench('medium change (100 chars in 10KB text)', () => {
    const doc = new Y.Doc()
    const text = doc.getText('t')
    text.insert(0, 'a'.repeat(10000))

    const atom = createYTextAtom(text)
    const store = createStore()

    store.set(
      atom,
      'a'.repeat(5000) + 'M'.repeat(100) + 'a'.repeat(4900)
    )
  })

  bench('large text (100KB)', () => {
    const doc = new Y.Doc()
    const text = doc.getText('t')
    text.insert(0, 'a'.repeat(100000))

    const atom = createYTextAtom(text)
    const store = createStore()

    store.set(
      atom,
      'a'.repeat(50000) + 'MODIFIED' + 'a'.repeat(50000 - 8)
    )
  })

  bench('append only', () => {
    const doc = new Y.Doc()
    const text = doc.getText('t')
    text.insert(0, 'Hello')

    const atom = createYTextAtom(text)
    const store = createStore()

    store.set(atom, 'Hello World')
  })

  bench('prepend only', () => {
    const doc = new Y.Doc()
    const text = doc.getText('t')
    text.insert(0, 'World')

    const atom = createYTextAtom(text)
    const store = createStore()

    store.set(atom, 'Hello World')
  })

  bench('delete only', () => {
    const doc = new Y.Doc()
    const text = doc.getText('t')
    text.insert(0, 'Hello World')

    const atom = createYTextAtom(text)
    const store = createStore()

    store.set(atom, 'Hello')
  })

  bench('replace middle', () => {
    const doc = new Y.Doc()
    const text = doc.getText('t')
    text.insert(0, 'The quick brown fox jumps')

    const atom = createYTextAtom(text)
    const store = createStore()

    store.set(atom, 'The slow brown fox jumps')
  })
})
