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
} & {
	get: {
		<Value>(baseAtom: PrimitiveAtom<Value>): PrimitiveAtom<Value>;
		<Value>(baseAtom: DerivedAtom<Value>): DerivedAtom<Value>;
		<Value>(baseAtom: Atom<Value>): Atom<Value>;
	};
};

export type SetLike<Key> =
	| Key[]
	| Set<Key>
	| (Key extends object ? WeakSet<Key> : never);
export type MapLike<Key, Value> =
	| Map<Key, Value>
	| (Key extends object ? WeakMap<Key, Value> : never)
	| (Key extends string | number | symbol ? Record<Key, Value> : never);

type AtomInternal<Value> =
	| PrimitiveAtomInternal<Value>
	| DerivedAtomInternal<Value>;
type CommonAtomInternal<Value> = {
	_equals?: AtomEquals<Value>;

	_marked: boolean;
	_nextError?: any;
	_nextValue?: Value;
	_children?: Set<DerivedAtomInternal<any>>;
	_watchers?: Set<AtomWatcher>;
	_subscribers?: Set<AtomSubscribeInternal<Value>>;
};
type PrimitiveAtomInternal<Value> = CommonAtomInternal<Value> &
	PrimitiveAtom<Value> & {
		readonly _source: true;
		readonly _active: true;
		_needPropagate: boolean;

		// _init: Value;
	};
type DerivedAtomInternal<Value> = CommonAtomInternal<Value> &
	DerivedAtom<Value> & {
		readonly _source: false;
		readonly _persist: boolean;
		_active: boolean;
		_needExecute: boolean;
		_needPropagate: boolean;

		_init: AtomGetterInternal<Value>;
		_options: AtomGetOptions;
		_counter: number;
		_ctrl?: ThenableSignalController;
		_dependencies?: Set<AtomInternal<any>>;
	};

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

// JS에서 자료형을 만드는 방법은 여러 가지가 있다:
// 클로저를 활용해서 익명 함수로 메서드가 구현된 객체 반환하기
// -> 제일 쉽고 직관적이지만 공통 메서드/멤버 변수가 매번 새로 선언되므로 시간/메모리 측면에서 비효율적이다.
// 공통 메서드/멤버 변수만 별도의 객체로 추출한 뒤 Object.create로 프로토타입 설정하기
// -> Object.create가 new보다 2~3배 느린 걸로 보인다. 프로토타입 직접 건드리는 거라 그런가...
// class 쓰기
// -> 공통 멤버 변수를 프로토타입에 박을 방법이 없다.
// function 쓰기
// -> 그나마 최선의 해결책.

const AtomPrototype = function <Value>(
	this: AtomInternal<Value>,
) {} as unknown as { new <_Value>(): AtomInternal<_Value> };
AtomPrototype.prototype.get = function <Value>(this: AtomInternal<Value>) {
	if (!this._active) {
		execute(this);
		disableAtom(this);
	}
	if (this.state.promise) throw this.state.promise;
	if (this.state.error) throw this.state.error;
	return this.state.value!;
};
AtomPrototype.prototype.watch = function <Value>(
	this: AtomInternal<Value>,
	watcher: AtomWatcher,
) {
	if (!this._active) {
		requestActivate(this);
	}
	(this._watchers ??= new Set()).add(watcher);
	return () => {
		this._watchers!.delete(watcher);
		if (!this._watchers!.size) {
			disableAtom(this);
		}
	};
};
AtomPrototype.prototype.subscribe = function <Value>(
	this: AtomInternal<Value>,
	subscriber: AtomSubscribe<unknown>,
) {
	const atomSubscriber: AtomSubscribeInternal<unknown> = {
		_subscriber: subscriber,
		_options: {
			get signal() {
				return (atomSubscriber._ctrl ??= createThenableSignal()).signal;
			},
		},
	};
	if (!this._active) {
		requestActivate(this);
	} else if (!this.state.promise && !this.state.error) {
		try {
			subscriber(this.state.value!, atomSubscriber._options);
		} catch (e) {
			logError(e);
		}
	}
	(this._subscribers ??= new Set()).add(atomSubscriber);
	return () => {
		this._subscribers!.delete(atomSubscriber);
		if (atomSubscriber._ctrl) {
			atomSubscriber._ctrl.abort();
			atomSubscriber._ctrl = undefined;
		}
		if (!this._subscribers!.size) {
			disableAtom(this);
		}
	};
};
AtomPrototype.prototype[Symbol.toPrimitive] = function <Value>(
	this: AtomInternal<Value>,
) {
	return this.state.value;
};

const PrimitiveAtomPrototype = function <Value>(
	this: PrimitiveAtomInternal<Value>,
	init: Value,
	options?: AtomOptions<Value>,
) {
	// this._init = init;
	this._equals = options?.equals;

	(this as any).state = {
		promise: undefined,
		error: undefined,
		value: init,
	};
	this.state.value = this._nextValue = init;
} as unknown as {
	new <_Value>(
		init: _Value,
		options?: AtomOptions<_Value>,
	): PrimitiveAtomInternal<_Value>;
};

PrimitiveAtomPrototype.prototype.set = function <Value>(
	this: PrimitiveAtomInternal<Value>,
	value: AtomUpdater<unknown>,
) {
	const nextValue =
		value instanceof Function ? value(this._nextValue!) : value;
	if (!equals(nextValue, this.state.value, this._equals)) {
		this._nextValue = nextValue;
		requestPropagate(this);
	}
};
PrimitiveAtomPrototype.prototype._source = true;
PrimitiveAtomPrototype.prototype._active = true;
PrimitiveAtomPrototype.prototype._needPropagate = false;
Object.setPrototypeOf(
	PrimitiveAtomPrototype.prototype,
	AtomPrototype.prototype,
);

const DerivedAtomPrototype = function <Value>(
	this: DerivedAtomInternal<Value>,
	init: AtomGetter<Value>,
	options?: AtomOptions<Value>,
) {
	this._init = init as AtomGetterInternal<Value>;
	this._equals = options?.equals;
	(this as any)._persist = options?.persist;
	(this as any).state = {
		promise: inactive,
		error: undefined,
		value: undefined,
	};

	const self = this;
	this._options = {
		get signal() {
			return (self._ctrl ??= createThenableSignal()).signal;
		},
	};
} as unknown as {
	new <Value>(
		init: AtomGetter<Value>,
		options?: AtomOptions<Value>,
	): DerivedAtomInternal<Value>;
};

DerivedAtomPrototype.prototype._source = false;
DerivedAtomPrototype.prototype._active = false;
DerivedAtomPrototype.prototype._needPropagate = false;
DerivedAtomPrototype.prototype._counter = 0;
Object.setPrototypeOf(DerivedAtomPrototype.prototype, AtomPrototype.prototype);

const ouroboros: any = () => ouroboros;
const toUndefined = () => undefined;
Object.setPrototypeOf(
	ouroboros,
	new Proxy(ouroboros, {
		get: (_, k) => (k === Symbol.toPrimitive ? toUndefined : ouroboros),
	}),
);

export const inactive = Promise.resolve();
export const $: CreateAtom = <Value>(
	init: Value | AtomGetter<Value>,
	options?: AtomOptions<Value>,
) => {
	if (init instanceof Function)
		return new DerivedAtomPrototype(init, options);
	return new PrimitiveAtomPrototype(init, options) as any;
};
export const $$ = <Value>(init: AtomGetter<Value>) =>
	$((get, options) => {
		let promises: PromiseLike<Value>[] | undefined;
		let error: unknown;
		const result = init((atom) => {
			try {
				return get(atom);
			} catch (e) {
				if (!e) {
					throw e;
				}
				if (isPromiseLike(e)) {
					(promises ??= []).push(e as PromiseLike<Value>);
				} else {
					error = e;
				}
			}
			return ouroboros;
		}, options);
		if (error) throw error;
		if (promises) throw Promise.all(promises);
		return result;
	});

let pendingUpdateAtoms = false;
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
		stack.push(atom);
		if (!pendingUpdateAtoms) {
			pendingUpdateAtoms = true;
			queueMicrotask(updateAtoms);
		}
	}
};
const updateAtoms = () => {
	pendingUpdateAtoms = false;
	{
		const updatedAtoms = stack;
		stack = [];
		for (const atom of updatedAtoms) {
			atom.state.promise = undefined;
			atom.state.error = atom._nextError;
			atom.state.value = atom._nextValue;
			mark(atom);
		}
	}
	const markedAtoms = stack as DerivedAtomInternal<any>[];
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
	if (atom._children) {
		for (const child of atom._children) {
			child._needExecute = true;
		}
	}
	if (atom._watchers) {
		for (const watcher of atom._watchers) {
			watcher();
		}
	}
	if (atom._subscribers && !atom.state.promise && !atom.state.error) {
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
const execute = <Value>(atom: DerivedAtomInternal<Value>) => {
	const counter = ++atom._counter;
	atom._active = true;
	atom._needExecute = false;
	atom.state.promise = undefined;

	if (atom._ctrl) {
		atom._ctrl.abort();
		atom._ctrl = undefined;
	}

	// TODO: nextDependencies
	const oldDependencies = atom._dependencies;
	if (oldDependencies) {
		atom._dependencies = new Set();
	}
	try {
		const value = atom._init(
			<V>(anotherAtom: AtomInternal<V>, unwrap = true) => {
				if (counter !== atom._counter) throw undefined;
				if ((atom as unknown) !== anotherAtom) {
					if (!anotherAtom._active) {
						execute(anotherAtom);
						if (anotherAtom._needPropagate) {
							anotherAtom._needPropagate = false;
							propagate(anotherAtom);
						}
					}
					oldDependencies?.delete(anotherAtom);
					(atom._dependencies ??= new Set()).add(anotherAtom);
					(anotherAtom._children ??= new Set()).add(atom);
				}
				if (!unwrap) return anotherAtom.state;
				if (anotherAtom.state.promise)
					throw new Wrapped(anotherAtom.state.promise);
				if (anotherAtom.state.error)
					throw new Wrapped(anotherAtom.state.error);
				return anotherAtom.state.value as V;
			},
			atom._options,
		);

		if (isPromiseLike(value)) {
			atom.state.promise = value;
			value.then(
				(value) => {
					if (counter === atom._counter) {
						if (equals(value, atom.state.value, atom._equals)) {
							atom.state.promise = undefined;
							// watchers 재실행 해야 할까?
						} else {
							atom._nextValue = value;
							atom._nextError = undefined;
							requestPropagate(atom);
						}
					}
				},
				(e) => {
					if (counter === atom._counter) {
						if (e instanceof Promise) {
							atom.state.promise = undefined;
						} else {
							if (e instanceof Wrapped) {
								e = e.e;
							} else {
								logError(e);
							}
							atom._nextError = e;
							requestPropagate(atom);
						}
					}
				},
			);
		} else {
			++atom._counter;
			atom.state.error = undefined;
			if (equals(value, atom.state.value, atom._equals)) {
				atom._needPropagate = false;
			} else {
				atom.state.value = atom._nextValue = value;
			}
		}
	} catch (e) {
		++atom._counter;
		if (!e) {
			atom._needPropagate = false;
		} else {
			if (e instanceof Wrapped) {
				e = e.e;
			} else {
				logError(e);
			}
			if (isPromiseLike(e)) {
				atom.state.promise = e as PromiseLike<Value>;
			} else {
				atom.state.error = e;
			}
		}
	}

	if (oldDependencies) {
		for (const dep of oldDependencies) {
			dep._children!.delete(atom);
			disableAtom(dep);
		}
	}
};

// TODO: 좀 대충 짜놨는데 개선할 수 있을지 고민해봐야
let disabling = false;
const disableAtom = <Value>(atom: AtomInternal<Value>) => {
	if (
		!atom._source &&
		!atom._persist &&
		!atom._children?.size &&
		!atom._watchers?.size &&
		!atom._subscribers?.size
	) {
		if (!disabling) {
			setTimeout(() => {
				disabling = true;
				disableAtom(atom);
				disabling = false;
			}, 0);
			return;
		}
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
		}
	}
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
