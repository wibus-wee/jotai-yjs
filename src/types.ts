import * as Y from 'yjs'

/** Base type alias for any Y.js abstract type */
export type YType = Y.AbstractType<any>

/** Extract value type from Y.Map<T> */
export type YMapValue<T> = T extends Y.Map<infer V> ? V : never

/** Extract item type from Y.Array<T> */
export type YArrayItem<T> = T extends Y.Array<infer V> ? V : never

/** Constraint for Y types that can be stored in maps/arrays */
export type YStorableType = Y.Map<any> | Y.Array<any> | Y.Text | Y.XmlElement | Y.XmlFragment
