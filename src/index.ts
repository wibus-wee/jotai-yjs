import { atom, type Atom, type WritableAtom } from 'jotai'
import * as Y from 'yjs'
import diff from 'fast-diff'
import { shallowEqual, deepEquals } from './utils'

/** Equality function used to suppress redundant updates. */
type Equals<T> = (a: T, b: T) => boolean;
const defaultEquals = <T>(a: T, b: T): boolean => shallowEqual(a, b);
const UNSET: unique symbol = Symbol('jotai-yjs/UNSET');
const ATOM_WRITE_ORIGIN: unique symbol = Symbol('jotai-yjs/atom-write');
const PATH_WRITE_ORIGIN: unique symbol = Symbol('jotai-yjs/path-write');

type YArrayDelta<T> = Array<
  { retain: number } | { insert: T[] } | { delete: number }
>;

type YEventOf<T extends Y.AbstractType<any>> = 
  T extends Y.Map<infer V> ? Y.YMapEvent<V> :
  T extends Y.Array<infer V> ? Y.YArrayEvent<V> :
  T extends Y.Text ? Y.YTextEvent :
  Y.YEvent<T>;

type SubscribeEvent<T extends Y.AbstractType<any>> =
  | YEventOf<T>
  | Y.YEvent<any>[];

/** Internal util: subscribe to a Y type with optional deep observation. */
function subscribeY<T extends Y.AbstractType<any>>(
  y: T,
  onChange: (evt: SubscribeEvent<T>, tr: Y.Transaction) => void,
  options?: { deep?: boolean }
): () => void {
  if (options?.deep) {
    const handler = (evts: Y.YEvent<any>[], tr: Y.Transaction) =>
      onChange(evts, tr);
    y.observeDeep(handler);
    return () => y.unobserveDeep(handler);
  }
  const handler = (evt: YEventOf<T>, tr: Y.Transaction) => onChange(evt, tr);
  y.observe(handler);
  return () => y.unobserve(handler);
}

/** Run a function inside a Y.Doc transaction when available. */
export function withTransact(
  doc: Y.Doc | null,
  fn: () => void,
  origin?: unknown
): void {
  if (!doc) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[y-jotai] Y type is not attached to a document. Operations may not be properly transacted.');
    }
    fn();
    return;
  }
  doc.transact(fn, origin);
}

export interface CreateYAtomSharedOptions<YType extends Y.AbstractType<any>, T> {
  /** Read function to project the Y value into a typed snapshot T. */
  read: (y: YType) => T;
  /**
   * Optional write function that applies the next T to the underlying Y type
   * using native Yjs operations. It will be invoked inside a transaction if
   * the Y type is attached to a Y.Doc.
   */
  write?: (y: YType, next: T) => void;
  /** Optional equality to suppress redundant sets. Default: deep equality. */
  equals?: Equals<T>;
  /**
   * Observe deep changes under this Y type. Default: false (narrower, faster).
   * Use only when read() depends on nested children that won't emit direct events.
   */
  deep?: boolean;
  /**
   * Optional filter to ignore unrelated Y events before calling read().
   * This helps narrow updates further (e.g., only when a Map key changes).
   */
  eventFilter?: (evt: YEventOf<YType>) => boolean;
  /**
   * When using `yAtom` as the source, optionally resubscribe to a new instance
   * when the source atom value changes. If enabled, the previous subscription
   * is cleaned up and a new one is installed, and a fresh snapshot is emitted.
   */
  resubscribeOnSourceChange?: boolean;
  /**
   * Optional transaction origin passed to Y.Doc.transact for writes.
   * Can be a static value or a function to derive origin per write.
   */
  transactionOrigin?: unknown | ((params: { y: YType; type: 'write' }) => unknown);
}

export type CreateYAtomOptions<YType extends Y.AbstractType<any>, T> =
  | ({ y: YType; yAtom?: never } & CreateYAtomSharedOptions<YType, T>)
  | ({ yAtom: Atom<YType>; y?: never } & CreateYAtomSharedOptions<YType, T>);

/**
 * Create a typed Jotai atom bound to a specific Y type.
 * - Subscribes on mount; unsubscribes on unmount.
 * - Suppresses updates via equals.
 * - Writes are wrapped in `withTransact` and rely on Y events to propagate.
 */
export function createYAtom<YType extends Y.AbstractType<any>, T>(
  opts: CreateYAtomOptions<YType, T>
): WritableAtom<T, [T | ((prev: T) => T)], void> {
  const {
    read,
    write,
    equals = defaultEquals,
    deep,
    eventFilter,
    resubscribeOnSourceChange,
    transactionOrigin,
  } = opts;
  const hasYAtom = 'yAtom' in opts && opts.yAtom !== undefined;

  // Normalize source: always use an Atom<YType> as the source of truth.
  const ySourceAtom: Atom<YType> = hasYAtom
    ? opts.yAtom
    : atom(opts.y);

  // Snapshot cache controlled by Y event subscription and equals.
  const snapAtom = atom<T | typeof UNSET>(UNSET);
  // Tracks the Y instance used to compute the current snapshot. This lets us
  // detect when the source Y changes (especially when resubscribing) and avoid
  // returning a stale snapshot.
  const lastYAtom = atom<YType | null>(null);

  // Derived state for consumers: SSR/first frame returns read(get(ySourceAtom)).
  // Public-facing read atom. It prefers the cached snapshot when available,
  // but falls back to a direct read for SSR/first render. When the Y source
  // instance changes (with resubscribe enabled), a fresh read is returned
  // immediately until the subscription updates the snapshot.
  const stateAtom = atom<T>((get) => {
    const y = get(ySourceAtom);
    const s = get(snapAtom);
    if (resubscribeOnSourceChange) {
      const lastY = get(lastYAtom);
      if (lastY !== y) return read(y);
    }
    if (s !== UNSET) return s as T;
    return read(y);
  });

  // Subscription manager: installs Y observers and syncs snapshot when events
  // fire. Uses AbortSignal to cleanup and re-run when ySourceAtom changes.
  // Two internal actions are used:
  // - 'init': run on mount to optionally fix the initial Y reference and seed
  //           the first snapshot when using a dynamic yAtom source.
  // - 'sync': run whenever Y emits an event to refresh the cached snapshot.
  type SubAction = { type: 'sync' } | { type: 'init' };

  // For disabling resubscribe, capture the initial Y per-store and reuse it.
  const yRefAtom = atom<YType | null>(null);
  
  // Helper that returns the currently active Y instance based on the
  // resubscribe strategy.
  const getActiveY = (get: <V>(a: Atom<V>) => V): YType =>
    resubscribeOnSourceChange
      ? get(ySourceAtom)
      : (get(yRefAtom) ?? get(ySourceAtom));

  // Effect atom that owns the Y subscription and performs snapshot updates.
  const subscriptionAtom = atom<null, [SubAction?], void>(
    (get, { signal, setSelf }) => {
      // Determine which Y to subscribe to for this mount cycle.
      const y = getActiveY(get);

      const unsubscribe = subscribeY(
        y,
        (evt, _tr) => {
          if (!Array.isArray(evt) && eventFilter && !eventFilter(evt)) return;
          setSelf({ type: 'sync' });
        },
        { deep }
      );

      const cleanup = () => {
        try {
          unsubscribe();
        } catch (err) {
          if (process.env.NODE_ENV !== 'production') {
            console.error('[y-jotai] Error during unsubscribe:', err);
          }
        }
      };

      signal.addEventListener('abort', cleanup);
      return null;
    },
    (get, set, action) => {
      // 'sync' is the default action when events arrive or when setSelf() is
      // called without an explicit action (Jotai’s convention).
      if (!action || action.type === 'sync') {
        const y = getActiveY(get);
        const next = read(y);
        const prev = get(snapAtom);
        if (prev === UNSET || !equals(prev as T, next)) {
          set(snapAtom, next);
        }
        // Always stamp lastY to reflect the active source we read from.
        set(lastYAtom, y);
        return;
      }

      // 'init' runs once on mount. When resubscribe is disabled, we capture
      // the first Y instance and reuse it for the lifetime of the store. When
      // the source is an atom (hasYAtom), we also seed the initial snapshot so
      // the first read is consistent before any events fire.
      if (action.type === 'init') {
        if (!resubscribeOnSourceChange) {
          set(yRefAtom, get(ySourceAtom));
        }
        if (hasYAtom) {
          const y = getActiveY(get);
          const next = read(y);
          const prev = get(snapAtom);
          if (prev === UNSET || !equals(prev as T, next)) set(snapAtom, next);
          set(lastYAtom, y);
        }
      }
    }
  );

  // Public atom: read state, ensure subAtom is mounted; writes transact against current Y.
  const out = atom<T, [T | ((prev: T) => T)], void>(
    (get) => {
      // Ensure the subscription is mounted and kept in sync.
      get(subscriptionAtom);
      return get(stateAtom);
    },
    (get, _set, update) => {
      if (!write) return;
      const y = getActiveY(get);
      const current = read(y);
      const next =
        typeof update === 'function'
          ? (update as (p: T) => T)(current)
          : update;
      if (equals(current, next)) return;
      const origin =
        typeof transactionOrigin === 'function'
          ? transactionOrigin({ y, type: 'write' })
          : transactionOrigin ?? ATOM_WRITE_ORIGIN;
      withTransact(y.doc, () => write(y, next), origin);
    }
  );

  // Initialize per-store refs and populate first snapshot on mount.
  subscriptionAtom.onMount = (set) => set({ type: 'init' });

  return out;
}

// ------------------------ Specialised factories ------------------------

/**
 * Y.Map key atom: subscribes only when `key` is changed. Use decode/encode for type safety.
 */
export function createYMapKeyAtom<
  TValue,
  TSnapshot extends TValue | undefined = TValue | undefined
>(
  map: Y.Map<TValue>,
  key: string,
  opts?: {
    decode?: (v: TValue | undefined) => TSnapshot;
    encode?: (v: TSnapshot) => TValue;
    equals?: Equals<TSnapshot>;
  }
): WritableAtom<
  TSnapshot,
  [TSnapshot | ((prev: TSnapshot) => TSnapshot)],
  void
> {
  if (process.env.NODE_ENV !== 'production') {
    if (typeof key !== 'string' || key === '') {
      throw new Error('[y-jotai] Map key must be a non-empty string');
    }
  }

  const decode: (value: TValue | undefined) => TSnapshot =
    opts?.decode ?? ((value) => value as TSnapshot);
  const encode: (value: TSnapshot) => TValue =
    opts?.encode ?? ((value) => value as TValue);
  const equals: Equals<TSnapshot> =
    opts?.equals ?? ((a, b) => defaultEquals(a, b));

  return createYAtom({
    y: map,
    read: (m) => decode(m.get(key)),
    write: (m, next) => {
      m.set(key, encode(next));
    },
    equals,
    eventFilter: (evt) => (evt.keysChanged ? evt.keysChanged.has(key) : true),
  });
}

/**
 * Y.Array index atom: exposes a single index snapshot with decode/encode.
 * The eventFilter attempts to be precise using delta, but `equals` still guards safety.
 */
export function createYArrayIndexAtom<
  TItem,
  TSnapshot extends TItem | undefined = TItem | undefined
>(
  arr: Y.Array<TItem>,
  index: number,
  opts?: {
    decode?: (v: TItem | undefined) => TSnapshot;
    encode?: (v: TSnapshot) => TItem;
    equals?: Equals<TSnapshot>;
  }
): WritableAtom<
  TSnapshot,
  [TSnapshot | ((prev: TSnapshot) => TSnapshot)],
  void
> {
  if (process.env.NODE_ENV !== 'production') {
    if (!Number.isInteger(index) || index < 0) {
      throw new Error('[y-jotai] Array index must be a non-negative integer');
    }
  }

  const decode: (value: TItem | undefined) => TSnapshot =
    opts?.decode ?? ((value) => value as TSnapshot);
  const encode: (value: TSnapshot) => TItem =
    opts?.encode ?? ((value) => value as TItem);
  const equals: Equals<TSnapshot> =
    opts?.equals ?? ((a, b) => defaultEquals(a, b));

  return createYAtom({
    y: arr,
    read: (a) => decode(a.get(index)),
    write: (a, next) => {
      // Replace at index using native Y ops
      a.delete(index, 1);
      a.insert(index, [encode(next)]);
    },
    equals,
    eventFilter: (evt) => {
      const rawDelta = evt.changes?.delta;
      if (!Array.isArray(rawDelta)) return true;
      const delta = rawDelta as YArrayDelta<TItem>;
      let pos = 0;
      for (const change of delta) {
        if ('retain' in change) {
          pos += change.retain;
          continue;
        }
        if ('insert' in change) {
          const ins = change.insert;
          // Insert affects index if it happens at or before the index
          if (pos <= index) return true;
          pos += ins.length;
          continue;
        }
        if ('delete' in change) {
          const del = change.delete;
          // Delete affects index if the deleted range overlaps with or comes before the index
          if (pos <= index && pos + del > index) return true;
          if (pos <= index) return true; // Deletion before index shifts it
          continue;
        }
        return true;
      }
      return false;
    },
  });
}

/**
 * Y.Text atom: expose the entire string content.
 * For high-frequency editing, consider a diff-based writer for better perf.
 */
export function createYTextAtom(
  txt: Y.Text
): WritableAtom<string, [string | ((prev: string) => string)], void> {
  return createYAtom({
    y: txt,
    read: (t) => t.toString(),
    write: (t, next) => {
      const current = t.toString();
      if (current === next) return;

      const patches = diff(current, next);
      let offset = 0;

      for (const [op, text] of patches) {
        if (op === diff.DELETE) {
          t.delete(offset, text.length);
        } else if (op === diff.INSERT) {
          t.insert(offset, text);
          offset += text.length;
        } else {
          // diff.EQUAL
          offset += text.length;
        }
      }
    },
    equals: (a, b) => a === b,
  });
}

/**
 * Generic deep path atom (Map/Array traversal). For convenience when you cannot
 * subscribe narrowly. Prefer specialized atoms when possible for performance.
 */
type PathTransactionOrigin = (params: {
  root: Y.AbstractType<any>;
  path: Array<string | number>;
  type: 'write';
}) => unknown;

export function createYPathAtom<TSnapshot>(
  root: Y.AbstractType<any>,
  path: Array<string | number>,
  opts?: {
    read: (node: unknown) => TSnapshot;
    write?: (parent: unknown, last: string | number, next: TSnapshot) => void;
    equals?: Equals<TSnapshot>;
    deep?: boolean;
     transactionOrigin?: unknown | PathTransactionOrigin;
  }
): WritableAtom<
  TSnapshot,
  [TSnapshot | ((prev: TSnapshot) => TSnapshot)],
  void
> {
  if (process.env.NODE_ENV !== 'production') {
    if (!Array.isArray(path) || path.length === 0) {
      throw new Error('[y-jotai] Path must be a non-empty array');
    }
  }

  const equals: Equals<TSnapshot> =
    opts?.equals ?? ((a, b) => defaultEquals(a, b));

  const resolve = (node: unknown, seg: string | number): unknown => {
    if (node instanceof Y.Map) return node.get(String(seg));
    if (node instanceof Y.Array) return node.get(Number(seg));
    return undefined;
  };

  const readAtPath = (): TSnapshot => {
    let cur: unknown = root;
    for (const seg of path) {
      cur = resolve(cur, seg);
      if (cur === undefined) break;
    }
    const projector = opts?.read ?? ((value: unknown) => value as TSnapshot);
    return projector(cur);
  };

  const writeAtPath = (next: TSnapshot): void => {
    const write = opts?.write;
    if (write) {
      // Delegate to caller-provided writer for full control
      const parent = path
        .slice(0, -1)
        .reduce<unknown>((acc, seg) => resolve(acc, seg), root);
      const last = path[path.length - 1]!;
      write(parent, last, next);
      return;
    }
    // Default writer for common Map/Array endpoints
    if (path.length === 0) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('createYPathAtom: empty path cannot be written');
      }
      return;
    }
    const parent = path
      .slice(0, -1)
      .reduce<unknown>((acc, seg) => resolve(acc, seg), root);
    const last = path[path.length - 1]!;
    if (!(parent instanceof Y.Map) && !(parent instanceof Y.Array)) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(
          'createYPathAtom: unable to resolve parent for path, skipping write',
          path
        );
      }
      return;
    }
    if (parent instanceof Y.Map) {
      const key = String(last);
      if (next === undefined) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn(
            '[y-jotai] createYPathAtom default writer ignores undefined; use a custom writer or explicit delete atom to remove keys.',
            path
          );
        }
        return;
      }
      const current = parent.get(key);
      if (deepEquals(current, next)) return;
      parent.set(key, next);
      return;
    }
    const idx = Number(last);
    if (!Number.isFinite(idx)) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(
          'createYPathAtom: array index is not finite, skipping write',
          last
        );
      }
      return;
    }
    const boundedIndex = Math.min(Math.max(idx, 0), parent.length);
    const hasSlot = idx >= 0 && idx < parent.length;
    if (next === undefined) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(
          '[y-jotai] createYPathAtom default writer ignores undefined; use a custom writer or explicit delete atom to remove indices.',
          path
        );
      }
      return;
    }
    if (hasSlot) {
      const current = parent.get(idx);
      if (deepEquals(current, next)) return;
      parent.delete(idx, 1);
      parent.insert(idx, [next]);
      return;
    }
    parent.insert(boundedIndex, [next]);
  };

  const isPathTransactionOrigin = (
    value: unknown
  ): value is PathTransactionOrigin => typeof value === 'function';

  const pathOrigin = opts?.transactionOrigin;
  const atomTransactionOrigin =
    isPathTransactionOrigin(pathOrigin)
      ? (_params: { y: Y.AbstractType<any>; type: 'write' }) =>
          pathOrigin({ root, path, type: 'write' })
      : pathOrigin ?? PATH_WRITE_ORIGIN;

  return createYAtom({
    y: root,
    read: () => readAtPath(),
    write: (_y, next) => writeAtPath(next),
    equals,
    deep: opts?.deep ?? true, // path atom typically needs deep observation
    transactionOrigin: atomTransactionOrigin,
  });
}

// Export utility functions for custom equality comparisons
export { shallowEqual, deepEquals } from './utils';
