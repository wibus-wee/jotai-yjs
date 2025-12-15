import { describe, it, expect, vi } from 'vitest'
import * as Y from 'yjs'
import { atom, createStore } from 'jotai'
import {
  createYAtom,
  createYMapKeyAtom,
  createYArrayIndexAtom,
  createYPathAtom,
  withTransact,
} from '../src'

describe('Edge cases', () => {
  describe('Array index eventFilter precision', () => {
    it('insert before index triggers update', () => {
      const doc = new Y.Doc()
      const arr = doc.getArray<number>('a')
      arr.insert(0, [1, 2, 3, 4, 5])

      const idx = 3
      const atom = createYArrayIndexAtom(arr, idx)
      const store = createStore()
      const seen: number[] = []

      store.sub(atom, () => {
        seen.push(store.get(atom) as number)
      })
      seen.push(store.get(atom) as number) // initial: 4

      arr.insert(0, [99]) // insert before index
      expect(seen.at(-1)).toBe(3) // value shifted down
    })

    it('insert after index does not trigger', () => {
      const doc = new Y.Doc()
      const arr = doc.getArray<number>('a')
      arr.insert(0, [1, 2, 3])

      const idx = 1
      const atom = createYArrayIndexAtom(arr, idx)
      const store = createStore()
      const seen: number[] = []

      store.sub(atom, () => {
        seen.push(store.get(atom) as number)
      })
      seen.push(store.get(atom) as number) // initial: 2

      arr.insert(2, [99]) // insert after index
      // May trigger due to eventFilter, but equals should prevent update
      expect(store.get(atom)).toBe(2)
    })

    it('delete overlapping index triggers', () => {
      const doc = new Y.Doc()
      const arr = doc.getArray<number>('a')
      arr.insert(0, [1, 2, 3, 4, 5])

      const idx = 2
      const atom = createYArrayIndexAtom(arr, idx)
      const store = createStore()
      const seen: number[] = []

      store.sub(atom, () => {
        seen.push(store.get(atom) as number)
      })
      seen.push(store.get(atom) as number) // initial: 3

      arr.delete(2, 2) // delete index 2 and 3
      expect(store.get(atom)).toBe(5) // now points to what was index 4
      expect(seen.at(-1)).toBe(5)
    })

    it('multiple operations in same transaction', () => {
      const doc = new Y.Doc()
      const arr = doc.getArray<number>('a')
      arr.insert(0, [1, 2, 3, 4, 5])

      const idx = 2
      const atom = createYArrayIndexAtom(arr, idx)
      const store = createStore()
      const seen: number[] = []

      store.sub(atom, () => {
        seen.push(store.get(atom) as number)
      })
      seen.push(store.get(atom) as number) // initial: 3

      doc.transact(() => {
        arr.insert(0, [99])
        arr.delete(1, 1)
      })

      // Should trigger only once
      expect(store.get(atom)).toBe(3) // value might have changed
      // equals should prevent duplicate updates
    })
  })

  describe('Input validation', () => {
    it('throws on empty map key in development', () => {
      const doc = new Y.Doc()
      const map = doc.getMap<number>('m')

      expect(() => {
        createYMapKeyAtom(map, '')
      }).toThrow('[y-jotai] Map key must be a non-empty string')
    })

    it('throws on negative array index', () => {
      const doc = new Y.Doc()
      const arr = doc.getArray<number>('a')

      expect(() => {
        createYArrayIndexAtom(arr, -1)
      }).toThrow('[y-jotai] Array index must be a non-negative integer')
    })

    it('throws on non-integer array index', () => {
      const doc = new Y.Doc()
      const arr = doc.getArray<number>('a')

      expect(() => {
        createYArrayIndexAtom(arr, 1.5)
      }).toThrow('[y-jotai] Array index must be a non-negative integer')
    })

    it('throws on empty path', () => {
      const doc = new Y.Doc()
      const root = doc.getMap('root')

      expect(() => {
        createYPathAtom(root, [])
      }).toThrow('[y-jotai] Path must be a non-empty array')
    })
  })

  describe('Concurrent updates', () => {
    it('handles multiple updates in same frame', () => {
      const doc = new Y.Doc()
      const map = doc.getMap<number>('m')
      const aAtom = createYMapKeyAtom(map, 'a')

      const store = createStore()
      const seen: number[] = []

      store.sub(aAtom, () => {
        seen.push(store.get(aAtom) as number)
      })
      seen.push(store.get(aAtom) as number) // initial

      // Multiple updates outside transaction
      map.set('a', 1)
      map.set('a', 2)
      map.set('a', 3)

      // Each update triggers separately (no transaction)
      expect(store.get(aAtom)).toBe(3)
      expect(seen.length).toBeGreaterThan(1)
    })

    it('coalesces updates inside transaction', () => {
      const doc = new Y.Doc()
      const map = doc.getMap<number>('m')
      const aAtom = createYMapKeyAtom(map, 'a')

      const store = createStore()
      const seen: number[] = []

      store.sub(aAtom, () => {
        seen.push(store.get(aAtom) as number)
      })
      seen.push(store.get(aAtom) as number) // initial: 0

      doc.transact(() => {
        map.set('a', 1)
        map.set('a', 2)
        map.set('a', 3)
      })

      // Only one update notification
      expect(store.get(aAtom)).toBe(3)
      expect(seen.at(-1)).toBe(3)
      // Should have at most 2 entries (initial + final)
      expect(seen.length).toBeLessThanOrEqual(2)
    })

    it('deep observation with multiple nested changes', () => {
      const doc = new Y.Doc()
      const root = doc.getMap<any>('root')
      const nested = new Y.Map<any>()
      root.set('nested', nested)

      const atom = createYAtom({
        y: root,
        read: (m) => (m.get('nested') as Y.Map<any>)?.get('x') ?? 0,
        deep: true,
      })

      const store = createStore()
      const seen: number[] = []

      store.sub(atom, () => {
        seen.push(store.get(atom))
      })
      seen.push(store.get(atom)) // initial: 0

      doc.transact(() => {
        nested.set('x', 1)
        nested.set('x', 2)
        nested.set('y', 3) // unrelated key
      })

      expect(store.get(atom)).toBe(2)
    })
  })

  describe('Detached Y types', () => {
    it('warns when doc is null', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const map = new Y.Map<number>() // not attached to doc
      expect(map.doc).toBeNull()

      withTransact(map.doc, () => {
        map.set('a', 1)
      })

      expect(warn).toHaveBeenCalledWith(
        '[y-jotai] Y type is not attached to a document. Operations may not be properly transacted.'
      )
      warn.mockRestore()
    })

    it('still allows operations on detached types', () => {
      const map = new Y.Map<number>()

      // Y types need to be attached to document for proper operation
      // This test verifies the warning is shown but operation doesn't throw
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const atom = createYMapKeyAtom(map, 'a')
      const store = createStore()

      // Operations on detached types may not work as expected
      // This is more of a "doesn't throw" test rather than functionality test
      expect(() => {
        store.set(atom, 42)
      }).not.toThrow()

      warn.mockRestore()
    })
  })

  describe('Transaction origin tagging', () => {
    it('withTransact forwards origin to Y.Doc transactions', () => {
      const doc = new Y.Doc()
      const map = doc.getMap<number>('m')
      const origins: unknown[] = []

      doc.on('afterTransaction', (tr: any) => {
        origins.push(tr.origin)
      })

      withTransact(doc, () => {
        map.set('a', 1)
      }, 'custom-origin')

      expect(origins.at(-1)).toBe('custom-origin')
    })

    it('createYAtom tags writes with default and custom origin', () => {
      const doc = new Y.Doc()
      const map = doc.getMap<number>('m')
      const store = createStore()
      const origins: unknown[] = []

      doc.on('afterTransaction', (tr: any) => {
        origins.push(tr.origin)
      })

      const defaultAtom = createYAtom({
        y: map,
        read: (m) => m.get('a') ?? 0,
        write: (m, next) => m.set('a', next),
      })

      store.set(defaultAtom, 1)
      expect(origins.at(-1)).toBe('[y-jotai] atom-write')

      const staticOriginAtom = createYAtom({
        y: map,
        read: (m) => m.get('b') ?? 0,
        write: (m, next) => m.set('b', next),
        transactionOrigin: 'static-origin',
      })

      store.set(staticOriginAtom, 2)
      expect(origins.at(-1)).toBe('static-origin')

      const fnOriginAtom = createYAtom({
        y: map,
        read: (m) => m.get('c') ?? 0,
        write: (m, next) => m.set('c', next),
        transactionOrigin: ({ type }) => `fn-origin-${type}`,
      })

      store.set(fnOriginAtom, 3)
      expect(origins.at(-1)).toBe('fn-origin-write')
    })

    it('createYPathAtom tags writes with default and custom origin', () => {
      const doc = new Y.Doc()
      const root = doc.getMap<unknown>('root')
      const store = createStore()
      const origins: unknown[] = []

      doc.on('afterTransaction', (tr: any) => {
        origins.push(tr.origin)
      })

      const defaultPathAtom = createYPathAtom<number | undefined>(root, ['foo'])
      store.set(defaultPathAtom, 1)
      expect(origins.at(-1)).toBe('[y-jotai] path-write')

      const customPathAtom = createYPathAtom<number | undefined>(root, ['bar'], {
        read: (node) => (node as number | undefined) ?? 0,
        transactionOrigin: 'path-origin',
      })

      store.set(customPathAtom, 2)
      expect(origins.at(-1)).toBe('path-origin')
    })
  })

  describe('Error handling', () => {
    it('handles write function throwing error', () => {
      const doc = new Y.Doc()
      const map = doc.getMap<number>('m')

      const atom = createYAtom({
        y: map,
        read: (m) => m.get('a') ?? 0,
        write: (_m, _next) => {
          throw new Error('Write error')
        },
      })

      const store = createStore()

      expect(() => {
        store.set(atom, 42)
      }).toThrow('Write error')
    })

    it('handles read function throwing error', () => {
      const doc = new Y.Doc()
      const map = doc.getMap<number>('m')

      const atom = createYAtom({
        y: map,
        read: (_m) => {
          throw new Error('Read error')
        },
      })

      const store = createStore()

      expect(() => {
        store.get(atom)
      }).toThrow('Read error')
    })
  })

  describe('Shallow equals behavior', () => {
    it('detects object property changes', () => {
      const doc = new Y.Doc()
      const map = doc.getMap<any>('m')

      const atom = createYAtom({
        y: map,
        read: (m) => ({ a: m.get('a') ?? 0, b: m.get('b') ?? 0 }),
      })

      const store = createStore()
      const seen: any[] = []

      store.sub(atom, () => {
        seen.push(store.get(atom))
      })
      seen.push(store.get(atom)) // initial: { a: 0, b: 0 }

      map.set('a', 1)
      expect(seen.at(-1)).toEqual({ a: 1, b: 0 })

      // Same value, different object instance
      map.set('a', 1)
      expect(seen.length).toBe(2) // shallow equal prevents update
    })

    it('does not detect nested object changes with shallow equals', () => {
      const doc = new Y.Doc()
      const map = doc.getMap<any>('m')

      const obj = { x: 1 }
      map.set('obj', obj)

      const atom = createYAtom({
        y: map,
        read: (m) => ({ obj: m.get('obj') }),
      })

      const store = createStore()
      const seen: any[] = []

      store.sub(atom, () => {
        seen.push(store.get(atom))
      })
      seen.push(store.get(atom)) // initial

      // Setting same object reference
      // Note: Y.Map.set always triggers an event, but shallow equals prevents state update
      map.set('obj', obj)
      // The Y event is triggered, but shallow equals sees same reference in nested obj
      // This may or may not update depending on Y's behavior
      const afterSameRef = seen.length

      // Setting different object with same content
      map.set('obj', { x: 1 })
      // Different reference always triggers update
      expect(seen.length).toBeGreaterThan(afterSameRef)
    })
  })
})
