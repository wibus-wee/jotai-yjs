import { atom, type Atom, type WritableAtom } from 'jotai'
import * as Y from 'yjs'
import { isEqual } from 'es-toolkit/compat'

/** Equality function used to suppress redundant updates. */
type Equals<T> = (a: T, b: T) => boolean;
const defaultEquals = <T>(a: T, b: T): boolean => isEqual(a, b);
const UNSET: unique symbol = Symbol('jotai-yjs/UNSET');

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
export function withTransact(doc: Y.Doc | null, fn: () => void): void {
  if (doc) doc.transact(fn);
  else fn();
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
  } = opts as CreateYAtomSharedOptions<YType, T> &
    Partial<{ y: YType; yAtom: Atom<YType> }>;
  const hasYAtom = (opts as any).yAtom !== undefined;

  // Normalize source: always use an Atom<YType> as the source of truth.
  const ySourceAtom: Atom<YType> =
    (opts as any).yAtom ?? atom((opts as any).y as YType);

  // Snapshot cache controlled by Y event subscription and equals.
  const snapAtom = atom<T | typeof UNSET>(UNSET);
  const lastYAtom = atom<YType | null>(null);

  // Derived state for consumers: SSR/first frame returns read(get(ySourceAtom)).
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

  // Subscription manager: installs Y observers and syncs snapshot when events fire.
  // Uses AbortSignal to cleanup and re-run when ySourceAtom changes.
  type SubAction = { type: 'sync' } | { type: 'init' };

  // For disabling resubscribe, capture the initial Y per-store and reuse it.
  const yRefAtom = atom<YType | null>(null);
  const subAtom = atom<null, [SubAction?], void>(
    (get, { signal, setSelf }) => {
      // Determine which Y to subscribe to
      let y: YType;
      if (resubscribeOnSourceChange) {
        y = get(ySourceAtom);
      } else {
        const yRef = get(yRefAtom);
        y = yRef ?? get(ySourceAtom);
      }

      let lastTxn: Y.Transaction | null = null;
      const unsubscribe = subscribeY(
        y,
        (evt, tr) => {
          if (!Array.isArray(evt) && eventFilter && !eventFilter(evt as any)) return;
          if (tr && lastTxn && tr === lastTxn) return;
          lastTxn = tr ?? null;
          setSelf({ type: 'sync' });
          // reset the guard after the current macrotask
          setTimeout(() => {
            lastTxn = null;
          }, 0);
        },
        { deep }
      );

      signal.addEventListener('abort', unsubscribe);
      return null;
    },
    (get, set, action) => {
      if (!action || action.type === 'sync') {
        const y = resubscribeOnSourceChange
          ? get(ySourceAtom)
          : (get(yRefAtom) ?? get(ySourceAtom));
        const next = read(y);
        const prev = get(snapAtom);
        if (prev === UNSET || !equals(prev as T, next)) {
          set(snapAtom, next);
          set(lastYAtom, y);
        } else {
          // still stamp lastY to align with current source
          set(lastYAtom, y);
        }
      } else if (action.type === 'init') {
        if (!resubscribeOnSourceChange) {
          const y = get(ySourceAtom);
          set(yRefAtom, y);
        }
        // initialize snapshot for consistent first read only when using yAtom source
        if (hasYAtom) {
          const y = resubscribeOnSourceChange
            ? get(ySourceAtom)
            : (get(yRefAtom) ?? get(ySourceAtom));
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
      get(subAtom);
      return get(stateAtom);
    },
    (get, _set, update) => {
      if (!write) return;
      const y = get(ySourceAtom);
      const current = read(y);
      const next =
        typeof update === 'function'
          ? (update as (p: T) => T)(current)
          : update;
      if (equals(current, next)) return;
      withTransact(y.doc, () => write(y, next));
    }
  );

  // Initialize per-store refs and populate first snapshot on mount.
  subAtom.onMount = (set) => set({ type: 'init' });

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
          if (pos <= index) return true;
          pos += ins.length;
          continue;
        }
        if ('delete' in change) {
          if (pos <= index) return true;
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
      // Naive replace: delete all, insert new content.
      // This is simple and correct; can be replaced by a diff algorithm if needed.
      const len = t.length;
      if (len > 0) t.delete(0, len);
      if (next.length > 0) t.insert(0, next);
    },
    equals: (a, b) => a === b,
  });
}

/**
 * Generic deep path atom (Map/Array traversal). For convenience when you cannot
 * subscribe narrowly. Prefer specialized atoms when possible for performance.
 */
export function createYPathAtom<TSnapshot>(
  root: Y.AbstractType<any>,
  path: Array<string | number>,
  opts?: {
    read: (node: unknown) => TSnapshot;
    write?: (parent: unknown, last: string | number, next: TSnapshot) => void;
    equals?: Equals<TSnapshot>;
    deep?: boolean;
  }
): WritableAtom<
  TSnapshot,
  [TSnapshot | ((prev: TSnapshot) => TSnapshot)],
  void
> {
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
      withTransact(root.doc, () => write(parent, last, next));
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
    withTransact(root.doc, () => {
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
          if (parent.has(key)) parent.delete(key);
          return;
        }
        const current = parent.get(key);
        if (isEqual(current, next)) return;
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
        if (hasSlot) parent.delete(idx, 1);
        return;
      }
      if (hasSlot) {
        const current = parent.get(idx);
        if (isEqual(current, next)) return;
        parent.delete(idx, 1);
        parent.insert(idx, [next]);
        return;
      }
      parent.insert(boundedIndex, [next]);
    });
  };

  return createYAtom({
    y: root,
    read: () => readAtPath(),
    write: (_y, next) => writeAtPath(next),
    equals,
    deep: opts?.deep ?? true, // path atom typically needs deep observation
  });
}
