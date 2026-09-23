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

abstract class CommonAtomInternal<Value> {
  _nextValue: Value | undefined;
  _nextError: unknown | undefined;
  _children: Set<DerivedAtomInternal<any>> | undefined;
  _wchildren: Set<DerivedAtomInternal<any>> | undefined;
  _watchers: Set<AtomWatcher> | undefined;
  _subscribers: Set<AtomSubscribeInternal<Value>> | undefined;
  _valueChanged = true;

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
    (this._watchers ||= new Set()).add(watcher);
    return () => {
      this._watchers!.delete(watcher);
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
  _dependencies: Set<AtomInternal<any>> | undefined;
  _wdependencies: Set<AtomInternal<any>> | undefined;

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
          if (atom._reject) {
            atom._reject(atom._nextError);
            atom._resolve = atom._reject = atom.state.promise = undefined;
          }
        } else {
          if (
            !atom._hasValue ||
            (!Object.is(atom._nextValue, atom.state.value) &&
              !atom._equals?.(atom._nextValue, atom.state.value!))
          ) {
            atom.state.value = atom._nextValue;
            atom._valueChanged = atom._hasValue = true;
          } else {
            atom._nextValue = atom.state.value;
            if (prevSuccess) {
              atom._needPropagate = false;
              continue;
            }
          }
          if (atom._resolve) {
            atom._resolve(atom._nextValue!);
            atom._resolve = atom._reject = atom.state.promise = undefined;
          }
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
  if (atom._wchildren) {
    for (const wchild of atom._wchildren) {
      wchild._needExecute = true;
    }
  }
  if (atom.state.promise) {
    if (atom._children) {
      for (const child of atom._children) {
        child.state.promise ||= createPromise(child);
        child._needPropagate = true;
      }
    }
  } else if (atom.state.error) {
    if (atom._children) {
      for (const child of atom._children) {
        child.state.error = child._nextError = atom.state.error;
        if (child._reject) {
          child._reject(child._nextError);
          child._resolve = child._reject = child.state.promise = undefined;
        }
        child._needPropagate = true;
      }
    }
    // Watchers read the error from `state`, and children pass it on. Subscribers
    // only ever see values, so an error that ends here reached nobody.
    if (!atom._watchers?.size && !atom._wchildren?.size && !atom._children?.size)
      reportUnreceived(atom.state.error);
  } else {
    if (atom._valueChanged && atom._subscribers) {
      for (const subscriber of atom._subscribers) {
        if (subscriber._ctrl) {
          subscriber._ctrl.abort();
          subscriber._ctrl = undefined;
        }
        try {
          subscriber._subscriber(atom.state.value!, subscriber._options);
        } catch (e) {
          logError(e);
        }
      }
    }
    if (atom._children) {
      for (const child of atom._children) {
        child._needExecute = true;
      }
    }
  }
  atom._valueChanged = false;
};
const mark = (atom: AtomInternal<unknown>) => {
  if (!atom._marked) {
    atom._marked = true;
    if (atom._children) {
      for (const child of atom._children) {
        mark(child);
      }
    }
    if (atom._wchildren) {
      for (const child of atom._wchildren) {
        mark(child);
      }
    }
    stack.push(atom);
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
const execute = <Value>(atom: DerivedAtomInternal<Value>) => {
  const counter = ++atom._counter;
  const prevSuccess = atom._hasValue && !atom.state.promise && !atom.state.error;

  atom.state.active = true;
  atom._needExecute = false;

  if (atom._dependencies) {
    for (const dep of atom._dependencies) {
      dep._children!.delete(atom);
      // TODO?: if (dep.aggressiveGc) disableAtom(dep);
    }
    atom._dependencies.clear();
  }
  if (atom._wdependencies) {
    for (const dep of atom._wdependencies) {
      dep._wchildren!.delete(atom);
      // TODO?: if (dep.aggressiveGc) disableAtom(dep);
    }
    atom._wdependencies.clear();
  }
  if (atom._ctrl) {
    atom._ctrl.abort();
    atom._ctrl = undefined;
  }

  try {
    const value = atom._init(<V>(anotherAtom: AtomInternal<V>, watch = false) => {
      if (counter !== atom._counter) throw expired;
      if (atom._scope) anotherAtom = atom._scope(anotherAtom) as AtomInternal<V>;

      if ((atom as unknown) !== anotherAtom) {
        if (!anotherAtom.state.active) {
          execute(anotherAtom as DerivedAtomInternal<V>);
        }
        if (watch) {
          atom._dependencies?.delete(anotherAtom);
          (atom._wdependencies ||= new Set()).add(anotherAtom);
          (anotherAtom._wchildren ||= new Set()).add(atom);
        } else if (!atom._wdependencies?.has(anotherAtom)) {
          (atom._dependencies ||= new Set()).add(anotherAtom);
          (anotherAtom._children ||= new Set()).add(atom);
        }
      }

      const { state } = anotherAtom;
      // A copy: `state` is updated in place, so handing it out would let the
      // result change later without this atom noticing (it compares by identity).
      if (watch) return { ...state } as V;
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
      if (
        !atom._hasValue ||
        (!Object.is(value, atom._nextValue) && !atom._equals?.(value, atom._nextValue!))
      ) {
        atom.state.value = atom._nextValue = value;
        atom._valueChanged = atom._hasValue = true;
      } else if (prevSuccess) {
        atom._needPropagate = false;
      }
      atom.state.error = atom._nextError = undefined;
      if (atom._resolve) {
        atom._resolve(atom._nextValue!);
        atom._resolve = atom._reject = atom.state.promise = undefined;
      }
    }
  } catch (e) {
    // assert(e !== expired);
    ++atom._counter;
    if (e === loading) {
      atom.state.promise ||= createPromise(atom);
    } else {
      if (e instanceof Wrapped) e = e.e;
      atom.state.error = atom._nextError = e;
      if (atom._reject) {
        atom._reject(e);
        atom._resolve = atom._reject = atom.state.promise = undefined;
      }
    }
  }
};

/** Someone reads it, or it must stay active anyway. Watch-mode dependents count too. */
const isObserved = <Value>(atom: AtomInternal<Value>) =>
  atom._source ||
  atom._global ||
  !!atom._children?.size ||
  !!atom._wchildren?.size ||
  !!atom._watchers?.size ||
  !!atom._subscribers?.size;

let runningGc = false;
let gcCandidates: Set<DerivedAtomInternal<any>> = new Set();
const disableAtom = <Value>(atom: AtomInternal<Value>) => {
  if (!atom._source && !isObserved(atom)) {
    if (atom._gcDelay) {
      setTimeout(() => {
        gcCandidates.add(atom);
        gc();
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
  atom._ctrl?.abort();
  // Whoever still waits on the pending value would otherwise wait forever.
  const reject = atom._reject;
  ++atom._counter;
  atom._nextValue =
    atom._nextError =
    atom.state.error =
    atom.state.value =
    atom.state.promise =
    atom._resolve =
    atom._reject =
    atom._ctrl =
      undefined;
  atom._needPropagate = atom._needExecute = atom._hasValue = atom.state.active = false;
  atom._valueChanged = atom._source;
  reject?.(new DOMException("The atom was deactivated before it settled.", "AbortError"));
  if (atom._dependencies) {
    for (const dep of atom._dependencies) {
      dep._children!.delete(atom);
      disableAtom(dep);
    }
    atom._dependencies.clear();
  }
  if (atom._wdependencies) {
    for (const dep of atom._wdependencies) {
      dep._wchildren!.delete(atom);
      disableAtom(dep);
    }
    atom._wdependencies.clear();
  }
};

const nop = () => {};

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
  const promise = new Promise((resolve) => {
    signal.then = (f: () => void) => promise.then(f);
    signal.addEventListener("abort", resolve, {
      once: true,
      passive: true,
    });
  });
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
