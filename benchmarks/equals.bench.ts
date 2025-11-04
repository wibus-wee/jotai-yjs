import { bench, describe } from 'vitest'
import { shallowEqual, deepEquals } from '../src'

describe('Equals performance', () => {
  const obj10 = Object.fromEntries(
    Array.from({ length: 10 }, (_, i) => [`key${i}`, i])
  )
  const obj10Clone = { ...obj10 }

  const obj100 = Object.fromEntries(
    Array.from({ length: 100 }, (_, i) => [`key${i}`, i])
  )
  const obj100Clone = { ...obj100 }

  const obj1000 = Object.fromEntries(
    Array.from({ length: 1000 }, (_, i) => [`key${i}`, i])
  )
  const obj1000Clone = { ...obj1000 }

  describe('shallowEqual', () => {
    bench('primitives - equal', () => {
      shallowEqual(42, 42)
    })

    bench('primitives - not equal', () => {
      shallowEqual(42, 43)
    })

    bench('10 keys - equal', () => {
      shallowEqual(obj10, obj10Clone)
    })

    bench('100 keys - equal', () => {
      shallowEqual(obj100, obj100Clone)
    })

    bench('1000 keys - equal', () => {
      shallowEqual(obj1000, obj1000Clone)
    })

    bench('arrays - equal', () => {
      shallowEqual([1, 2, 3], [1, 2, 3])
    })

    bench('arrays - not equal', () => {
      shallowEqual([1, 2, 3], [1, 2, 4])
    })
  })

  describe('deepEquals', () => {
    bench('primitives - equal', () => {
      deepEquals(42, 42)
    })

    bench('10 keys - equal', () => {
      deepEquals(obj10, obj10Clone)
    })

    bench('100 keys - equal', () => {
      deepEquals(obj100, obj100Clone)
    })

    bench('1000 keys - equal', () => {
      deepEquals(obj1000, obj1000Clone)
    })

    bench('nested objects - equal', () => {
      deepEquals(
        { a: { b: { c: 1 } } },
        { a: { b: { c: 1 } } }
      )
    })

    bench('nested objects - not equal', () => {
      deepEquals(
        { a: { b: { c: 1 } } },
        { a: { b: { c: 2 } } }
      )
    })
  })

  describe('Comparison: shallow vs deep', () => {
    bench('shallow: 100 keys', () => {
      shallowEqual(obj100, obj100Clone)
    })

    bench('deep: 100 keys', () => {
      deepEquals(obj100, obj100Clone)
    })
  })
})
