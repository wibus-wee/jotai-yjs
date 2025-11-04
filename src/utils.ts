import { isEqual } from 'es-toolkit';

/**
 * Performs a shallow equality check between two values.
 * For primitives, uses Object.is. For objects, compares own enumerable properties.
 */
export function shallowEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;

  if (
    typeof a !== 'object' ||
    a === null ||
    typeof b !== 'object' ||
    b === null
  ) {
    return false;
  }

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);

  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    const aRecord = a as Record<string, unknown>;
    const bRecord = b as Record<string, unknown>;

    if (
      !Object.prototype.hasOwnProperty.call(b, key) ||
      !Object.is(aRecord[key], bRecord[key])
    ) {
      return false;
    }
  }

  return true;
}

/**
 * Performs a deep equality check between two values.
 * Recursively compares nested objects and arrays.
 * 
 * It's a reexport of 'isEqual' from 'es-toolkit'.
 */
export const deepEquals = isEqual;