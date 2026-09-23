export type Atom<Value> = PrimitiveAtom<Value> | DerivedAtom<Value>;
/**
 * Any atom, seen only as something to read. Unlike `Atom<Value>` it is covariant
 * (`set` makes `PrimitiveAtom` invariant), so a place that only reads can accept
 * e.g. an empty placeholder atom typed for a narrower value.
 */
export type CommonAtom<Value> = {
  readonly get: () => Value;
  readonly watch: (watcher: AtomWatcher) => () => void;
  readonly subscribe: (subscriber: AtomSubscribe<Value>) => () => void;
  readonly state: AtomState<Value>;
};
export type PrimitiveAtom<Value> = CommonAtom<Value> & {
  readonly set: (value: AtomUpdater<Value>) => void;
  readonly state: AtomSuccessState<Value>;
};
export type DerivedAtom<Value> = CommonAtom<Value> & {
  readonly refresh: () => void;
};

export type AtomWatcher = () => void;
export type AtomSubscribe<Value> = (value: Value, options: AtomSubscriberOptions) => void;
export type AtomInit<Value> = Value | AtomGetter<Value>;
export type AtomUpdater<Value> = Value | AtomReducer<Value>;
// TODO: readonly
export type AtomInactiveState<Value> = {
  active: false;
  error: unknown;
  promise: undefined;
  value?: Value;
};
export type AtomPromiseState<Value> = {
  active: true;
  error: unknown;
  promise: PromiseLike<Value>;
  value?: Value;
};
export type AtomSuccessState<Value> = {
  active: true;
  error: undefined;
  promise: undefined;
  value: Value;
};
export type AtomErrorState<Value> = {
  active: true;
  error: unknown;
  promise: undefined;
  value?: Value;
};
export type AtomState<Value> =
  | AtomInactiveState<Value>
  | AtomPromiseState<Value>
  | AtomErrorState<Value>
  | AtomSuccessState<Value>;

export type AtomSubscriberOptions = { readonly signal: ThenableSignal };
export type AtomGetter<Value> = (
  get: GetAtom,
  options: AtomGetOptions,
) => Value | PromiseLike<Value>;
export type AtomReducer<Value> = (value: Value) => Value;

export type AtomGetOptions = {
  readonly $: CreateAtom;
  readonly signal: ThenableSignal;
  /**
   * Recomputes this atom. Use it instead of closing over the atom: a scope runs
   * the same getter for its own copy, and the closed-over atom is the original.
   */
  readonly refresh: () => void;
};
export type ThenableSignal = AbortSignal & { then: (f: () => void) => void };
type ThenableSignalController = {
  abort: () => void;
  signal: ThenableSignal;
};

export type GetAtom = {
  <Value>(anotherAtom: CommonAtom<Value>, watch?: false): Value;
  <Value>(
    anotherAtom: CommonAtom<Value>,
    watch: true,
  ): AtomPromiseState<Value> | AtomErrorState<Value> | AtomSuccessState<Value>;
};

type CreateAtom = {
  <Value>(init: AtomGetter<Value>, options?: AtomOptions<Value>): DerivedAtom<Value>;
  <Value>(init: Value, options?: AtomOptions<Value>): PrimitiveAtom<Value>;
  <Value>(init: Value | AtomGetter<Value>, options?: AtomOptions<Value>): Atom<Value>;
};
export type AtomOptions<Value> = {
  equals?: AtomEquals<Value>;
  global?: boolean;
  eager?: boolean;
  gcDelay?: number;
  scope?: AtomScope;
  $?: CreateAtom;
};

export type AtomEquals<Value> = (value: Value, prevValue: Value) => boolean;
export type AtomScope = {
  <Value>(baseAtom: PrimitiveAtom<Value>): PrimitiveAtom<Value>;
  <Value>(baseAtom: DerivedAtom<Value>): DerivedAtom<Value>;
  <Value>(baseAtom: Atom<Value>): Atom<Value>;
  <Value>(baseAtom: PrimitiveAtom<Value>, strict: true): PrimitiveAtom<Value> | undefined;
  <Value>(baseAtom: DerivedAtom<Value>, strict: true): DerivedAtom<Value> | undefined;
  <Value>(baseAtom: Atom<Value>, strict: true): Atom<Value> | undefined;
};

export type SetLike<Key> = Key[] | Set<Key> | (Key extends object ? WeakSet<Key> : never);
export type MapLike<Key, Value> =
  | Map<Key, Value>
  | (Key extends object ? WeakMap<Key, Value> : never)
  | (Key extends string | number | symbol ? Record<Key, Value> : never);

type GetAtomInternal = <Value>(anotherAtom: AtomInternal<Value>) => Value;
type AtomGetterInternal<Value> = (
  get: GetAtomInternal,
  options: AtomGetOptions,
) => Value | PromiseLike<Value>;
type AtomSubscribeInternal<Value> = {
  _subscriber: AtomSubscribe<Value>;
  _options: AtomSubscriberOptions;
  _ctrl?: ThenableSignalController;
};

type AtomInternal<Value> = PrimitiveAtomInternal<Value> | DerivedAtomInternal<Value>;

/**
 * A derived atom reading another atom. Both ends keep the same object, so a
 * computation marks what it read once. `NONE` means an earlier computation read
 * it and the current one has not (yet): the reader holds on to it but is not
 * told about its changes.
 */
type Edge = { r: typeof NONE | typeof READ | typeof WATCH };
const NONE = 0;
const READ = 1;
/** Read with `get(atom, true)`: told about every change, errors and loading included. */
const WATCH = 2;

abstract class CommonAtomInternal<Value> {
  _nextValue: Value | undefined;
  _nextError: unknown | undefined;
  /** Derived atoms reading this one; the other end of their `_dependencies`. */
  _children: Map<DerivedAtomInternal<any>, Edge> | undefined;
  _watchers: Set<AtomWatcher> | undefined;
  _subscribers: Set<AtomSubscribeInternal<Value>> | undefined;
  _valueChanged = true;
  /** The last copy of `state` handed out by `snapshot`. */
  _snapshot: AtomState<Value> | undefined;

  abstract readonly _source: boolean;
  abstract _needExecute: boolean;
  abstract _needPropagate: boolean;
  abstract _marked: boolean;
  abstract _resolve: ((value: Value) => void) | undefined;
  abstract _reject: ((reason: unknown) => void) | undefined;

  abstract readonly _init: Value | AtomGetterInternal<Value>;
  abstract readonly _equals: AtomEquals<Value> | undefined;
  abstract readonly _scope: AtomScope | undefined;
  abstract readonly _global: boolean;

  abstract readonly state: AtomState<Value>;

  get(): Value {
    if (!this.state.active) {
      execute(this as unknown as DerivedAtomInternal<Value>);
      // Narrowed to the inactive state above, but `execute` has just changed it.
      const { promise } = this.state as AtomState<Value>;
      if (promise) {
        // The caller is about to wait on this promise. Collecting the atom now
        // would abort the computation and leave the promise pending forever,
        // so keep the atom alive until it settles.
        const release = this.watch(() => {});
        promise.then(release, release);
      } else {
        disableAtom(this as unknown as AtomInternal<Value>);
      }
    }
    if (this.state.promise) throw this.state.promise;
    if (this.state.error) throw this.state.error;
    return this.state.value!;
  }

  watch(watcher: AtomWatcher): () => void {
    if (!this.state.active) {
      requestActivate(this as unknown as DerivedAtomInternal<Value>);
    }
    // A new entry per call: the same function may watch twice, and each
    // unwatch must remove only its own.
    const entry = () => watcher();
    (this._watchers ||= new Set()).add(entry);
    return () => {
      this._watchers!.delete(entry);
      if (!this._watchers!.size) {
        disableAtom(this as unknown as AtomInternal<Value>);
      }
    };
  }

  subscribe(subscriber: AtomSubscribe<Value>): () => void {
    const atomSubscriber: AtomSubscribeInternal<Value> = {
      _subscriber: subscriber,
      _options: {
        get signal() {
          return (atomSubscriber._ctrl ||= createThenableSignal()).signal;
        },
      },
    };
    if (!this.state.active) {
      requestActivate(this as unknown as DerivedAtomInternal<Value>);
    } else if (!this.state.error && !this.state.promise) {
      try {
        subscriber(this.state.value!, atomSubscriber._options);
      } catch (e) {
        logError(e);
      }
    }
    (this._subscribers ||= new Set()).add(atomSubscriber);
    return () => {
      this._subscribers!.delete(atomSubscriber);
      if (atomSubscriber._ctrl) {
        atomSubscriber._ctrl.abort();
        atomSubscriber._ctrl = undefined;
      }
      if (!this._subscribers!.size) {
        disableAtom(this as unknown as AtomInternal<Value>);
      }
    };
  }

  [Symbol.toPrimitive](): Value | undefined {
    return this.state.value;
  }
}

class PrimitiveAtomInternal<Value> extends CommonAtomInternal<Value> {
  declare readonly _source: true;
  declare readonly _needExecute: false;
  _needPropagate: boolean = false;
  _marked: boolean = false;

  declare readonly _init: Value;
  declare readonly _equals: AtomEquals<Value> | undefined;
  declare readonly _scope: AtomScope | undefined;
  declare readonly _global: boolean;

  declare state: AtomSuccessState<Value>;
  declare _hasValue: true;
  declare _nextValue: Value;
  declare _nextError: undefined;
  declare _resolve: undefined;
  declare _reject: undefined;

  constructor(init: Value, options?: AtomOptions<Value>) {
    super();
    this._nextValue = this._init = init;
    this._equals = options?.equals;
    this._scope = options?.scope;
    this._global = !!options?.global;
    this.state = {
      active: true,
      promise: undefined,
      error: undefined,
      value: init,
    };
  }

  set(this: PrimitiveAtomInternal<Value>, value: AtomUpdater<Value>) {
    const nextValue = value instanceof Function ? value(this._nextValue!) : value;
    if (!Object.is(nextValue, this._nextValue)) {
      this._nextValue = nextValue;
      requestPropagate(this);
    }
  }
}
// @ts-expect-error
PrimitiveAtomInternal.prototype._source = true;
PrimitiveAtomInternal.prototype._hasValue = true;
// @ts-expect-error
PrimitiveAtomInternal.prototype._needExecute = false;

class DerivedAtomInternal<Value> extends CommonAtomInternal<Value> {
  declare readonly _source: false;

  _hasValue = false;
  _needExecute = false;
  _needPropagate = false;
  _marked = false;

  _counter = 0;
  _resolve: ((value: Value) => void) | undefined;
  _reject: ((reason: unknown) => void) | undefined;
  _ctrl: ThenableSignalController | undefined;
  _gcTimer: ReturnType<typeof setTimeout> | undefined;
  /**
   * What this atom reads. Dependencies of earlier computations stay (as `NONE`)
   * until a computation succeeds: a new one may read them only after an `await`,
   * or stop early at a loading dependency, and dropping them at its start would
   * collect them and compute them again when read. Those it did not read are let
   * go when it succeeds.
   */
  _dependencies: Map<AtomInternal<any>, Edge> | undefined;
  /** How many of `_dependencies` the current computation has read. */
  _read = 0;

  declare readonly _init: AtomGetterInternal<Value>;
  declare readonly _equals: AtomEquals<Value> | undefined;
  declare readonly _scope: AtomScope | undefined;
  declare readonly _gcDelay: number | undefined;
  declare readonly _global: boolean;
  declare readonly _options: AtomGetOptions;

  declare state: AtomState<Value>;

  constructor(init: AtomGetter<Value>, options?: AtomOptions<Value>) {
    super();
    this._init = init as AtomGetterInternal<Value>;
    this._equals = options?.equals;
    this._scope = options?.scope;
    this._gcDelay = options?.gcDelay;
    this._global = !!options?.global;

    const self = this;
    this._options = {
      $: options?.$ ?? $,
      get signal() {
        return (self._ctrl ||= createThenableSignal()).signal;
      },
      refresh: () => self.refresh(),
    };

    this.state = {
      active: false,
      promise: undefined,
      error: undefined,
      value: undefined,
    };
  }

  refresh() {
    this._hasValue = false;
    this._needExecute = true;
    requestPropagate(this);
  }
}
// @ts-expect-error
DerivedAtomInternal.prototype._source = false;

export const $: CreateAtom = <Value>(
  init: Value | AtomGetter<Value>,
  options?: AtomOptions<Value>,
) => {
  if (init instanceof Function) return new DerivedAtomInternal(init, options);
  return new PrimitiveAtomInternal(init, options) as any;
};

export const isAtom = (x: unknown): x is Atom<unknown> => x instanceof CommonAtomInternal;

export const isPrimitiveAtom = (x: unknown): x is PrimitiveAtom<unknown> =>
  x instanceof PrimitiveAtomInternal;

export type AtomValuePair<Value> =
  | [Atom<Value>, Value | PrimitiveAtom<Value>]
  | [DerivedAtom<Value>, Value | Atom<Value>];
export const createScope = (
  parentScope?: AtomScope | null,
  atomValuePairs?: AtomValuePair<any>[],
): AtomScope => {
  const scopeMap = new WeakMap<Atom<any>, Atom<any>>();
  const atomMap = parentScope ? new WeakMap<Atom<any>, Atom<any>>() : scopeMap;
  const inner$ = ((init, options) => $(init, { ...options, scope, $: inner$ })) as CreateAtom;
  const scope = (<T extends Atom<never>>(baseAtom: T, strict = false) => {
    if ((baseAtom as AtomInternal<never>)._scope === scope) return baseAtom;
    let scopedAtom = scopeMap.get(baseAtom);
    const scopedDerivedAtom = atomMap.get(baseAtom);
    if (!strict || (scopedDerivedAtom as AtomInternal<never> | undefined)?._global)
      scopedAtom ||= scopedDerivedAtom;
    // TODO: 현재 스코프마다 사용되는 모든 아톰을 저장해서 메모리 사용이 비효율적인데 해결할 수 있을까?
    // 의존성이 동적이라 많이 어렵다
    if (!scopedAtom) {
      const parentAtom = parentScope?.(baseAtom, true);
      if (
        strict ||
        (parentAtom &&
          (!((parentAtom as AtomInternal<never>)._init instanceof Function) ||
            (parentAtom as AtomInternal<never>)._global))
      )
        return parentAtom;
      const realBaseAtom = parentAtom || baseAtom;
      atomMap.set(
        baseAtom,
        (scopedAtom = $((realBaseAtom as DerivedAtomInternal<never>)._init, {
          equals: (realBaseAtom as DerivedAtomInternal<never>)._equals,
          global: (realBaseAtom as DerivedAtomInternal<never>)._global,
          gcDelay: (realBaseAtom as DerivedAtomInternal<never>)._gcDelay,
          scope,
          $: inner$,
        }) as T),
      );
    }
    return scopedAtom;
  }) as AtomScope;
  if (atomValuePairs) {
    for (const [atom, value] of atomValuePairs) {
      scopeMap.set(atom, isAtom(value) ? (parentScope || scope)(value) : $(value));
    }
  }
  return scope;
};

let pendingUpdateAtoms = false;
let updateQueue: AtomInternal<any>[] = [];
let stack: AtomInternal<unknown>[] = [];
const requestActivate = <Value>(atom: DerivedAtomInternal<Value>) => {
  if (!atom._needExecute) {
    atom._needExecute = true;
    requestPropagate(atom);
  }
};
const requestPropagate = <Value>(atom: AtomInternal<Value>) => {
  if (!atom._needPropagate) {
    atom._needPropagate = true;
    updateQueue.push(atom);
    if (!pendingUpdateAtoms) {
      pendingUpdateAtoms = true;
      queueMicrotask(updateAtoms);
    }
  }
};
const updateAtoms = () => {
  pendingUpdateAtoms = false;
  {
    const updatedAtoms = updateQueue;
    updateQueue = [];
    for (const atom of updatedAtoms) {
      if (atom.state.active) {
        const prevSuccess = atom._hasValue && !atom.state.promise && !atom.state.error;
        if ((atom.state.error = atom._nextError)) {
          atom._nextValue = atom.state.value;
          rejectPending(atom, atom._nextError);
        } else {
          if (isNewValue(atom, atom._nextValue, atom.state.value)) {
            atom.state.value = atom._nextValue;
            atom._valueChanged = atom._hasValue = true;
          } else {
            atom._nextValue = atom.state.value;
            if (prevSuccess) {
              atom._needPropagate = false;
              continue;
            }
          }
          resolvePending(atom, atom._nextValue);
        }
      }
      mark(atom);
    }
  }
  const markedAtoms = stack;
  stack = [];
  for (let i = markedAtoms.length; i--; ) {
    const atom = markedAtoms[i]!;
    atom._marked = false;
    if (atom._needExecute) {
      if (!isObserved(atom)) {
        // Nobody reads it (it is only waiting out `gcDelay`, or everyone left in
        // this tick). Computing it would repeat its side effects (requests,
        // connections) for nobody; drop it and let the next reader compute it.
        deactivate(atom as DerivedAtomInternal<unknown>);
        continue;
      }
      atom._needPropagate = true;
      execute(atom);
    }
    if (atom._needPropagate) {
      propagate(atom);
    }
  }
};
const propagate = <Value>(atom: AtomInternal<Value>) => {
  atom._needPropagate = false;
  if (atom._watchers) {
    for (const watcher of atom._watchers) {
      try {
        watcher();
      } catch (e) {
        logError(e);
      }
    }
  }
  const { state } = atom;
  const success = !state.promise && !state.error;
  if (success && atom._valueChanged && atom._subscribers) {
    for (const subscriber of atom._subscribers) {
      if (subscriber._ctrl) {
        subscriber._ctrl.abort();
        subscriber._ctrl = undefined;
      }
      try {
        subscriber._subscriber(state.value!, subscriber._options);
      } catch (e) {
        logError(e);
      }
    }
  }
  let passedOn = false;
  if (atom._children) {
    for (const [child, edge] of atom._children) {
      if (edge.r === NONE) continue;
      passedOn = true;
      if (edge.r === WATCH || success) {
        child._needExecute = true;
      } else if (state.promise) {
        child.state.promise ||= createPromise(child);
        child._needPropagate = true;
      } else {
        fail(child, state.error);
        child._needPropagate = true;
      }
    }
  }
  // Watchers read the error from `state`, and children pass it on. Subscribers
  // only ever see values, so an error that ends here reached nobody.
  if (!success && !state.promise && !passedOn && !atom._watchers?.size)
    reportUnreceived(state.error);
  atom._valueChanged = false;
};
/** How deep `mark` recurses before it goes on with an explicit stack. */
const MAX_MARK_DEPTH = 500;

/**
 * Marks the atom and everything reading it, pushing each after all its readers:
 * walking `stack` backwards then visits every atom before its readers.
 */
const mark = (atom: AtomInternal<unknown>, depth = 0) => {
  if (atom._marked) return;
  if (depth === MAX_MARK_DEPTH) return markDeep(atom);
  atom._marked = true;
  if (atom._children) {
    for (const [child, edge] of atom._children) {
      if (edge.r !== NONE) mark(child, depth + 1);
    }
  }
  stack.push(atom);
};
/** `mark` without recursion, for graphs deep enough to overflow the call stack. */
const markDeep = (root: AtomInternal<unknown>) => {
  root._marked = true;
  const path: AtomInternal<unknown>[] = [root];
  const readers: (Iterator<[DerivedAtomInternal<any>, Edge]> | undefined)[] = [
    root._children?.entries(),
  ];
  while (path.length) {
    const next = readers[readers.length - 1]?.next();
    if (next && !next.done) {
      const [child, edge] = next.value;
      if (edge.r !== NONE && !child._marked) {
        child._marked = true;
        path.push(child);
        readers.push(child._children?.entries());
      }
    } else {
      readers.pop();
      stack.push(path.pop()!);
    }
  }
};

class Wrapped {
  e: unknown;
  constructor(e: unknown) {
    this.e = e;
  }
}
const expired = Symbol();
const loading = Symbol();

/**
 * How many inactive atoms a computation may compute on the spot, one reading the
 * next. Each level recurses through user code; beyond this the rest is deferred.
 */
const MAX_EXECUTE_DEPTH = 500;
let executeDepth = 0;
const execute = <Value>(atom: DerivedAtomInternal<Value>) => {
  const counter = ++atom._counter;
  const prevSuccess = atom._hasValue && !atom.state.promise && !atom.state.error;

  atom.state.active = true;
  atom._needExecute = false;

  if (atom._dependencies) {
    for (const edge of atom._dependencies.values()) edge.r = NONE;
  }
  atom._read = 0;
  if (atom._ctrl) {
    atom._ctrl.abort();
    atom._ctrl = undefined;
  }

  executeDepth++;
  try {
    const value = atom._init(<V>(anotherAtom: AtomInternal<V>, watch = false) => {
      if (counter !== atom._counter) throw expired;
      if (atom._scope) anotherAtom = atom._scope(anotherAtom) as AtomInternal<V>;

      if ((atom as unknown) !== anotherAtom) {
        if (!anotherAtom.state.active) {
          // Only derived atoms are ever inactive.
          const inactive = anotherAtom as DerivedAtomInternal<V>;
          if (executeDepth < MAX_EXECUTE_DEPTH) {
            execute(inactive);
          } else {
            // Computing it here would recurse once more through user code, and a
            // long enough chain of inactive atoms overflows the stack. Compute it
            // in the next update instead; until then it is loading.
            inactive.state.promise ||= createPromise(inactive);
            requestActivate(inactive);
          }
        }
        let edge = atom._dependencies?.get(anotherAtom);
        if (!edge) {
          edge = { r: NONE };
          (atom._dependencies ||= new Map()).set(anotherAtom, edge);
          (anotherAtom._children ||= new Map()).set(atom, edge);
        }
        if (edge.r === NONE) atom._read++;
        // Read both ways in one computation: watching covers reading.
        edge.r = watch || edge.r === WATCH ? WATCH : READ;
      }

      const { state } = anotherAtom;
      if (watch) return snapshot(anotherAtom) as V;
      if (state.promise) throw loading;
      if (state.error) throw new Wrapped(state.error);
      return state.value as V;
    }, atom._options);

    if (isPromiseLike(value)) {
      atom.state.promise ||= createPromise(atom);
      value.then(
        (value) => {
          if (counter === atom._counter) {
            ++atom._counter;
            if (!atom._hasValue || !Object.is(value, atom._nextValue!)) atom._nextValue = value;
            atom._nextError = undefined;
            releaseUnread(atom);
            requestPropagate(atom);
          }
        },
        (e) => {
          if (counter === atom._counter && e !== expired) {
            ++atom._counter;
            if (e !== loading) {
              if (e instanceof Wrapped) e = e.e;
              atom._nextError = e;
              requestPropagate(atom);
            }
          }
        },
      );
    } else {
      ++atom._counter;
      if (isNewValue(atom, value, atom._nextValue)) {
        atom.state.value = atom._nextValue = value;
        atom._valueChanged = atom._hasValue = true;
      } else if (prevSuccess) {
        atom._needPropagate = false;
      }
      atom.state.error = atom._nextError = undefined;
      resolvePending(atom, atom._nextValue);
      releaseUnread(atom);
    }
  } catch (e) {
    // assert(e !== expired);
    ++atom._counter;
    if (e === loading) {
      atom.state.promise ||= createPromise(atom);
    } else {
      fail(atom, e instanceof Wrapped ? e.e : e);
    }
  } finally {
    executeDepth--;
  }
};

/** Someone reads it (or may read it again), or it must stay active anyway. */
const isObserved = <Value>(atom: AtomInternal<Value>) =>
  atom._source ||
  atom._global ||
  !!atom._children?.size ||
  !!atom._watchers?.size ||
  !!atom._subscribers?.size;

let runningGc = false;
let gcCandidates: Set<DerivedAtomInternal<any>> = new Set();
const disableAtom = <Value>(atom: AtomInternal<Value>) => {
  if (!atom._source && !isObserved(atom)) {
    if (atom._gcDelay) {
      // Counted from the last time it lost its readers, not the first.
      clearTimeout(atom._gcTimer);
      atom._gcTimer = setTimeout(() => {
        atom._gcTimer = undefined;
        if (!isObserved(atom)) deactivate(atom);
      }, atom._gcDelay);
    } else {
      gcCandidates.add(atom);
      if (!runningGc) {
        runningGc = true;
        setTimeout(gc, 0);
      }
    }
  }
};
const gc = () => {
  for (const atom of gcCandidates) {
    if (!isObserved(atom)) deactivate(atom);
  }
  gcCandidates.clear();
  runningGc = false;
};
const deactivate = <Value>(atom: DerivedAtomInternal<Value>) => {
  clearTimeout(atom._gcTimer);
  atom._gcTimer = undefined;
  atom._ctrl?.abort();
  // Whoever still waits on the pending value would otherwise wait forever.
  rejectPending(
    atom,
    new DOMException("The atom was deactivated before it settled.", "AbortError"),
  );
  ++atom._counter;
  atom._nextValue = atom._nextError = atom.state.error = atom.state.value = atom._ctrl = undefined;
  atom._needPropagate = atom._needExecute = atom._hasValue = atom.state.active = false;
  atom._valueChanged = atom._source;
  if (atom._dependencies) {
    for (const dep of atom._dependencies.keys()) {
      dep._children!.delete(atom);
      disableAtom(dep);
    }
    atom._dependencies.clear();
  }
};

/** After a successful computation: let go of earlier dependencies it did not read. */
const releaseUnread = (atom: DerivedAtomInternal<any>) => {
  // Usually it read all of them again.
  if (!atom._dependencies || atom._read === atom._dependencies.size) return;
  for (const [dep, edge] of atom._dependencies) {
    if (edge.r !== NONE) continue;
    atom._dependencies.delete(dep);
    dep._children!.delete(atom);
    disableAtom(dep);
  }
};

const nop = () => {};

/**
 * A copy of `state`, since `state` is updated in place: handing it out would let
 * a result change later without its atom noticing (it compares by identity).
 * The same copy is reused while nothing in it changed, so readers share it and a
 * recomputed atom returning it does not count as a change.
 */
const snapshot = <Value>(atom: AtomInternal<Value>): AtomState<Value> => {
  const { state } = atom;
  const last = atom._snapshot;
  if (
    last &&
    last.active === state.active &&
    last.promise === state.promise &&
    Object.is(last.error, state.error) &&
    Object.is(last.value, state.value)
  )
    return last;
  return (atom._snapshot = { ...state } as AtomState<Value>);
};

/** Whether `value` replaces `prev`: always for the first value, else unless `equals` says so. */
const isNewValue = <Value>(
  atom: AtomInternal<Value>,
  value: Value | undefined,
  prev: Value | undefined,
) => !atom._hasValue || (!Object.is(value, prev) && !atom._equals?.(value!, prev!));

/** Settles the promise handed out while loading, if there is one. */
const resolvePending = <Value>(atom: AtomInternal<Value>, value: Value | undefined) => {
  const resolve = atom._resolve;
  if (resolve) {
    atom._resolve = atom._reject = atom.state.promise = undefined;
    resolve(value!);
  }
};
const rejectPending = <Value>(atom: AtomInternal<Value>, error: unknown) => {
  const reject = atom._reject;
  if (reject) {
    atom._resolve = atom._reject = atom.state.promise = undefined;
    reject(error);
  }
};

const fail = <Value>(atom: DerivedAtomInternal<Value>, error: unknown) => {
  atom.state.error = atom._nextError = error;
  rejectPending(atom, error);
};

/**
 * `state.promise` of a loading atom. Nobody may be waiting on it: its rejection
 * is also delivered as `state.error`, so it must not surface as an unhandled
 * rejection by itself. Callers who do wait still receive the rejection.
 */
const createPromise = <Value>(atom: DerivedAtomInternal<Value>) => {
  const promise = new Promise<Value>((resolve, reject) => {
    atom._resolve = resolve;
    atom._reject = reject;
  });
  promise.then(undefined, nop);
  return promise;
};

const isPromiseLike = (x: unknown): x is PromiseLike<unknown> =>
  typeof (x as PromiseLike<unknown>)?.then === "function";

const createThenableSignal = () => {
  const ctrl = new AbortController();
  const signal = ctrl.signal as ThenableSignal;
  // Made on the first `then`: most signals are only handed to `fetch` and friends.
  let aborted: Promise<void> | undefined;
  signal.then = (f: () => void) =>
    (aborted ||= new Promise<void>((resolve) => {
      if (signal.aborted) resolve();
      else signal.addEventListener("abort", () => resolve(), { once: true, passive: true });
    })).then(f);
  return {
    abort: () => ctrl.abort(),
    signal,
  };
};

/** One error can reach several dependents that nobody reads; report it once. */
const reported = new WeakSet<object>();
const reportUnreceived = (e: unknown) => {
  if ((typeof e === "object" && e !== null) || typeof e === "function") {
    if (reported.has(e)) return;
    reported.add(e);
  }
  logError(e);
};

const logError = (e: unknown) => {
  // Chrome's console.error doesn't follow the stack trace of the given Error
  queueMicrotask(() => {
    throw e;
  });
};
