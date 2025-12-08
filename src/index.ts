export type Atom<Value> = PrimitiveAtom<Value> | DerivedAtom<Value>;
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
export type DerivedAtom<Value> = CommonAtom<Value>;

export type AtomWatcher = () => void;
export type AtomSubscribe<Value> = (
	value: Value,
	options: AtomSubscriberOptions,
) => void;
export type AtomInit<Value> = Value | AtomGetter<Value>;
export type AtomUpdater<Value> = Value | AtomReducer<Value>;
// TODO: readonly
export type AtomInactiveState<Value> = {
	promise: typeof inactive;
	error: any;
	value?: Value;
};
export type AtomPromiseState<Value> = {
	promise: PromiseLike<Value>;
	error: any;
	value?: Value;
};
export type AtomSuccessState<Value> = {
	promise: undefined;
	error: undefined;
	value: Value;
};
export type AtomErrorState<Value> = {
	promise: undefined;
	error: any;
	value?: Value;
};
export type AtomState<Value> =
	| AtomInactiveState<Value>
	| AtomPromiseState<Value>
	| AtomSuccessState<Value>
	| AtomErrorState<Value>;

export type AtomSubscriberOptions = { readonly signal: ThenableSignal };
export type AtomGetter<Value> = (
	get: GetAtom,
	options: AtomGetOptions,
) => Value | PromiseLike<Value>;
export type AtomReducer<Value> = (value: Value) => Value;

export type AtomGetOptions = { readonly signal: ThenableSignal };
export type ThenableSignal = AbortSignal & { then: (f: () => void) => void };
type ThenableSignalController = {
	abort: () => void;
	signal: ThenableSignal;
};

export type GetAtom = {
	<Value>(anotherAtom: Atom<Value>, unwrap?: true): Value;
	<Value>(anotherAtom: Atom<Value>, unwrap: false): AtomState<Value>;
};

type CreateAtom = {
	<Value>(
		init: AtomGetter<Value>,
		options?: AtomOptions<Value>,
	): DerivedAtom<Value>;
	<Value>(init: Value, options?: AtomOptions<Value>): PrimitiveAtom<Value>;
	<Value>(
		init: Value | AtomGetter<Value>,
		options?: AtomOptions<Value>,
	): Atom<Value>;
};
export type AtomOptions<Value> = {
	equals?: AtomEquals<Value>;
	persist?: boolean;
	eager?: boolean;
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

export type SetLike<Key> =
	| Key[]
	| Set<Key>
	| (Key extends object ? WeakSet<Key> : never);
export type MapLike<Key, Value> =
	| Map<Key, Value>
	| (Key extends object ? WeakMap<Key, Value> : never)
	| (Key extends string | number | symbol ? Record<Key, Value> : never);

type GetAtomInternal = {
	<Value>(anotherAtom: AtomInternal<Value>, unwrap?: true): Value;
	<Value>(anotherAtom: AtomInternal<Value>, unwrap: false): AtomState<Value>;
};
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
	_nextError: any | undefined;
	_children: Set<DerivedAtomInternal<any>> | undefined;
	_watchers: Set<AtomWatcher> | undefined;
	_subscribers: Set<AtomSubscribeInternal<Value>> | undefined;

	abstract readonly _source: boolean;
	abstract _active: boolean;
	abstract _needExecute: boolean;
	abstract _needPropagate: boolean;
	abstract _marked: boolean;

	abstract readonly _init: Value | AtomGetterInternal<Value>;
	abstract readonly _equals: AtomEquals<Value> | undefined;

	abstract readonly state: AtomState<Value>;


	get(): Value {
		if (!this._active) {
			execute(this as unknown as DerivedAtomInternal<Value>);
			disableAtom(this as unknown as AtomInternal<Value>);
		}
		if (this.state.error) throw this.state.error;
		if (this.state.promise) throw this.state.promise;
		return this.state.value!;
	}

	watch(watcher: AtomWatcher): () => void {
		if (!this._active) {
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
		if (!this._active) {
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
	declare readonly _active: true;
	declare readonly _needExecute: false;
	_needPropagate: boolean = false;
	_marked: boolean = false;

	declare readonly _init: Value;
	declare readonly _equals: AtomEquals<Value> | undefined;

	declare state: AtomSuccessState<Value>;


	constructor(init: Value, options?: AtomOptions<Value>) {
		super();
		this._init = init;
		this._equals = options?.equals;
		this._nextValue = init;
		this.state = {
			promise: undefined,
			error: undefined,
			value: init,
		};
	}

	set(this: PrimitiveAtomInternal<Value>, value: AtomUpdater<Value>) {
		const nextValue =
			value instanceof Function ? value(this._nextValue!) : value;
		if (!equals(nextValue, this.state.value, this._equals)) {
			this._nextValue = nextValue;
			requestPropagate(this);
		}
	}
}
// @ts-expect-error
PrimitiveAtomInternal.prototype._source = true;
// @ts-expect-error
PrimitiveAtomInternal.prototype._active = true;
// @ts-expect-error
PrimitiveAtomInternal.prototype._needExecute = false;

class DerivedAtomInternal<Value> extends CommonAtomInternal<Value> {
	declare readonly _source: false;

	_active = false;
	_needExecute = false;
	_needPropagate = false;
	_marked = false;

	_counter = 0;
	_ctrl: ThenableSignalController | undefined;
	_dependencies: Set<AtomInternal<any>> | undefined;
	_nextDependencies: Set<AtomInternal<any>> | undefined;

	declare readonly _init: AtomGetterInternal<Value>;
	declare readonly _equals: AtomEquals<Value> | undefined;
	declare readonly _persist: boolean;
	declare readonly _options: AtomGetOptions;

	declare state: AtomState<Value>;


	constructor(init: AtomGetter<Value>, options?: AtomOptions<Value>) {
		super();
		this._init = init as AtomGetterInternal<Value>;
		this._equals = options?.equals;
		this._persist = !!options?.persist;

		const self = this;
		this._options = {
			get signal() {
				return (self._ctrl ||= createThenableSignal()).signal;
			},
		};

		this.state = {
			promise: inactive,
			error: undefined,
			value: undefined,
		};
	}
}
// @ts-expect-error
DerivedAtomInternal.prototype._source = false;


const ouroboros: any = () => ouroboros;
const toUndefined = () => undefined;
Object.setPrototypeOf(
	ouroboros,
	new Proxy(ouroboros, {
		get: (_, k) => (k === Symbol.toPrimitive ? toUndefined : ouroboros),
	}),
);

export const inactive = Promise.reject();
inactive.catch(toUndefined);

export const $: CreateAtom = <Value>(
	init: Value | AtomGetter<Value>,
	options?: AtomOptions<Value>,
) => {
	if (init instanceof Function)
		return new DerivedAtomInternal(init, options);
	return new PrimitiveAtomInternal(init, options) as any;
};
export const $$ = <Value>(init: AtomGetter<Value>) =>
	$((get, options) => {
		let promises: PromiseLike<unknown>[] | undefined;
		let error: unknown;
		const result = init((atom) => {
			const state = get(atom, false);
			if (state.error) error = state.error;
			else if (state.promise) (promises ||= []).push(state.promise);
			else return state.value;
			return ouroboros;
		}, options);
		if (error) throw error;
		if (promises) throw Promise.all(promises);
		return result;
	}, {
		equals: shallowEquals,
	});

export const isAtom = (x: unknown): x is Atom<unknown> =>
	x instanceof CommonAtomInternal;

export type AtomValuePair<Value> =
	| [Atom<Value>, Value | PrimitiveAtom<Value>]
	| [DerivedAtom<Value>, Value | Atom<Value>];
export const createScope = <T extends AtomValuePair<unknown>[]>(
	parentScope?: AtomScope | null,
	atomValuePairs?: T,
): AtomScope => {
	const scopeMap = new WeakMap<Atom<any>, Atom<any>>();
	const atomMap = new WeakMap<Atom<any>, Atom<any>>();
	const scope = (<T extends Atom<unknown>>(baseAtom: T, strict = false) => {
		let scopedAtom = scopeMap.get(baseAtom);
		// TODO: 현재 스코프마다 사용되는 모든 아톰을 저장해서 메모리 사용이 비효율적인데 해결할 수 있을까?
		// 의존성이 동적이라 많이 어렵다
		if (!scopedAtom) {
			const parentAtom = parentScope?.(baseAtom, true);
			if (strict) return parentAtom;
			const realBaseAtom = parentAtom || baseAtom;
			atomMap.set(
				baseAtom,
				scopedAtom = (
					(realBaseAtom as AtomInternal<never>)._init instanceof Function
					? $((get, options) => (realBaseAtom as AtomInternal<never>)._init(
						(atom, unwrap) => get(scope(atom), unwrap as any),
						options,
					), {
						equals: (realBaseAtom as AtomInternal<never>)._equals,
						persist: (realBaseAtom as DerivedAtomInternal<never>)._persist,
					})
					: parentAtom || $((realBaseAtom as AtomInternal<any>)._init)
				) as T,
			);
		}
		return scopedAtom;
	}) as AtomScope;
	if (atomValuePairs) {
		for (const [atom, value] of atomValuePairs) {
			scopeMap.set(atom, isAtom(value) ? scope(value) : $(value));
		}
	}
	return scope;
};

const shallowEquals = (a: any, b: any): boolean => {
	if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
	const c = a.constructor;
	if (c !== b.constructor) return false;

	if (c === Array) {
		let i = a.length;
		if (i !== b.length) return false;
		while ((i = i - 1 | 0) >= 0) if (!Object.is(a[i], b[i])) return false;
		return true;
	}

	let n = 0;
	for (const k in a) {
		if (!(k in b && Object.is(a[k], b[k]))) return false;
		n = n + 1 | 0;
	}
	for (const _ in b) if ((n = n - 1 | 0) < 0) return false;
	return true;
};

let pendingUpdateAtoms = false;
let updateQueue: AtomInternal<any>[] = [];
let stack: AtomInternal<any>[] = [];
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
			atom.state.promise = undefined;
			atom.state.error = atom._nextError;
			atom.state.value = atom._nextValue;
			mark(atom);
		}
	}
	const markedAtoms = stack;
	stack = [];
	for (let i = markedAtoms.length; i--; ) {
		const atom = markedAtoms[i];
		atom._marked = false;
		if (atom._needExecute) {
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
	if (!atom.state.error && !atom.state.promise) {
		if (atom._subscribers) {
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
};
const mark = (atom: AtomInternal<any>) => {
	if (!atom._marked) {
		atom._marked = true;
		if (atom._children) {
			for (const child of atom._children) {
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
const execute = <Value>(atom: DerivedAtomInternal<Value>) => {
	const counter = ++atom._counter;
	atom._active = true;
	atom._needExecute = false;
	atom.state.promise = undefined;

	if (atom._ctrl) {
		atom._ctrl.abort();
		atom._ctrl = undefined;
	}

	try {
		const value = atom._init(
			<V>(anotherAtom: AtomInternal<V>, unwrap = true) => {
				if (counter !== atom._counter) throw expired;
				if ((atom as unknown) !== anotherAtom) {
					if (!anotherAtom._active) {
						execute(anotherAtom);
						if (anotherAtom._needPropagate) {
							propagate(anotherAtom);
						}
					}
					(atom._nextDependencies ||= new Set()).add(anotherAtom);
					(anotherAtom._children ||= new Set()).add(atom);
				}
				if (!unwrap) return anotherAtom.state;
				if (anotherAtom.state.error)
					throw new Wrapped(anotherAtom.state.error);
				if (anotherAtom.state.promise)
					throw new Wrapped(anotherAtom.state.promise);
				return anotherAtom.state.value as V;
			},
			atom._options,
		);

		if (isPromiseLike(value)) {
			atom.state.promise = value;
			value.then(
				(value) => {
					if (counter === atom._counter) {
						finalizeExecution(atom);
						if (equals(value, atom.state.value, atom._equals)) {
							atom.state.promise = undefined;
							// 동일한 값인데 propagate해줘야 되는 거 마음에 안 든다
							// watchers만 호출할까?
						} else {
							atom._nextValue = value;
							atom._nextError = undefined;
						}
						requestPropagate(atom);
					}
				},
				(e) => {
					if (counter === atom._counter) {
						finalizeExecution(atom);
						if (e instanceof Wrapped) {
							e = e.e;
						} else {
							logError(e);
						}
						atom._nextError = e;
						requestPropagate(atom);
					}
				},
			);
		} else {
			finalizeExecution(atom);
			atom.state.error = undefined;
			if (equals(value, atom.state.value, atom._equals)) {
				atom._needPropagate = false;
			} else {
				atom.state.value = atom._nextValue = value;
			}
		}
	} catch (e) {
		finalizeExecution(atom);
		if (e === expired) {
			atom._needPropagate = false;
		} else {
			if (e instanceof Wrapped) {
				e = e.e;
			} else {
				logError(e);
			}
			atom.state.error = e;
		}
	}
};

const finalizeExecution = <Value>(atom: DerivedAtomInternal<Value>) => {
	++atom._counter;

	const oldDependencies = atom._dependencies;
	atom._dependencies = atom._nextDependencies;
	if (oldDependencies) {
		for (const dep of oldDependencies) {
			if (!atom._dependencies?.has(dep)) {
				dep._children!.delete(atom);
				disableAtom(dep);
			}
		}
		oldDependencies.clear();
	}
	atom._nextDependencies = oldDependencies;
};

let runningGc = false;
let gcCandidates: Set<DerivedAtomInternal<any>> = new Set();
const disableAtom = <Value>(atom: AtomInternal<Value>) => {
	if (
		!atom._source &&
		!atom._persist &&
		!atom._children?.size &&
		!atom._watchers?.size &&
		!atom._subscribers?.size
	) {
		gcCandidates.add(atom);
		if (!runningGc) {
			runningGc = true;
			setTimeout(gc, 0);
		}
	}
};
const gc = () => {
	for (const atom of gcCandidates) {
		if (
			!atom._source &&
			!atom._persist &&
			!atom._children?.size &&
			!atom._watchers?.size &&
			!atom._subscribers?.size
		) {
			atom.state.promise = inactive;
			atom._nextValue =
				atom._nextError =
				atom.state.error =
				atom.state.value =
					undefined;
			atom._needPropagate = atom._needExecute = atom._active = false;
			if (atom._ctrl) {
				atom._ctrl.abort();
				atom._ctrl = undefined;
			}
			if (atom._dependencies) {
				for (const dep of atom._dependencies) {
					dep._children!.delete(atom);
					disableAtom(dep);
				}
				atom._dependencies.clear();

				if (atom._nextDependencies) {
					for (const dep of atom._nextDependencies) {
						dep._children!.delete(atom);
						disableAtom(dep);
					}
					atom._nextDependencies.clear();
				}
			}
		}
	}
	gcCandidates.clear();
	runningGc = false;
};

const equals = <Value>(
	value: Value,
	prevValue?: Value,
	equalsFn?: (value: Value, prevValue: Value) => boolean,
) =>
	Object.is(value, prevValue) ||
	(equalsFn !== undefined &&
		prevValue !== undefined &&
		equalsFn(value, prevValue));

const isPromiseLike = (x: unknown): x is PromiseLike<unknown> =>
	typeof (x as PromiseLike<unknown>)?.then === 'function';

const createThenableSignal = () => {
	const ctrl = new AbortController();
	const signal = ctrl.signal as ThenableSignal;
	const promise = new Promise((resolve) => {
		signal.then = (f: () => void) => promise.then(f);
		signal.addEventListener('abort', resolve, {
			once: true,
			passive: true,
		});
	});
	return {
		abort: () => ctrl.abort(),
		signal,
	};
};

const logError = (e: unknown) => {
	// Chrome's console.error doesn't follow the stack trace of the given Error
	queueMicrotask(() => {
		throw e;
	});
};
