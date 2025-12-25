import { type PrimitiveAtom, type Atom, type AtomGetter, type DerivedAtom, $, isAtom, isPrimitiveAtom } from "./atom";

export type Atomized<T> =
	T extends object
		? { [K in keyof T]: Atomized<T[K]> }
		: PrimitiveAtom<T>;

export type CollectedAtoms<T> =
	T extends Atom<infer U>
	? U
	: T extends object
		? { [K in keyof T]: CollectedAtoms<T[K]> }
		: T;

type CollectAtom = {
	<Value>(init: AtomGetter<Value>): DerivedAtom<Value>;
	<Value>(init: Value): DerivedAtom<CollectedAtoms<Value>>;
};

export type RecursiveOptional<T> = T | (T extends object ? {
	[P in keyof T]: RecursiveOptional<T[P]>;
} : never);

const ouroboros: any = () => ouroboros;
const toUndefined = () => undefined;
Object.setPrototypeOf(
	ouroboros,
	new Proxy(ouroboros, {
		get: (_, k) => (k === Symbol.toPrimitive ? toUndefined : ouroboros),
	}),
);

export const atomize = <T, >(tree: T): Atomized<T> => {
	if (typeof tree !== 'object' || tree === null) return $(tree) as any;
	if (Array.isArray(tree)) return tree.map(atomize) as any;
	const result = Object.create(null);
	for (const k in tree) result[k] = atomize(tree[k]);
	return result;
};

const getAtom = <T, >(atom: Atom<T>): T => atom.get();
export const collectAtoms = <T, >(tree: T, get = getAtom): CollectedAtoms<T> => {
	const recurse = <T, >(t: T): CollectedAtoms<T> => {
		if (typeof t !== 'object' || t === null) return t as any;
		if (isAtom(t)) return get(t) as any;
		if (Array.isArray(t)) return t.map(recurse) as any;
		const result = Object.create(null);
		for (const k in t) result[k] = recurse(t[k] as any);
		return result;
	};
	return recurse(tree);
};

export const setAtoms = <T, >(tree: T, values: RecursiveOptional<CollectedAtoms<T>>): void => {
	const recurse = (t: any, v: any) => {
		if (typeof t === 'object' && t !== null) {
			if (isAtom(t)) {
				if (isPrimitiveAtom(t)) t.set(v);
			} else {
				for (const k in v) recurse(t[k], v[k]);
			}
		}
	};
	recurse(tree, values);
};

export const $$: CollectAtom = <Value>(init: Value | AtomGetter<Value>) => (
	init instanceof Function
	? $((get, options) => {
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
	})
	: $$((get) => collectAtoms(init, get))
);

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
