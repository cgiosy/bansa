import { use, useState, useSyncExternalStore } from 'react';
import { $ } from '.';
import type { Atom, AtomGetter, AtomOptions, DerivedAtom, PrimitiveAtom } from '.';

export const useAtomValue = <Value,>(atom: Atom<Value>) =>
	useSyncExternalStore(
		(watcher) => atom.watch(watcher),
		() => {
			// https://github.com/facebook/react/pull/34032
			try {
				return atom.get();
			} catch (_) {
				if (atom.state.promise) use(Promise.resolve(atom.state.promise));
				throw atom.state.error;
			}
		},
	);

export const useAtomState = <Value,>(atom: DerivedAtom<Value>) =>
	useSyncExternalStore(
		(watcher) => atom.watch(watcher),
		() => {
			// avoid https://github.com/facebook/react/issues/31730
			try {
				atom.get();
			} catch (_) {}
			return atom.state;
		},
	);

export const useAtom = <Value,>(atom: PrimitiveAtom<Value>) =>
	[useAtomValue(atom), (newState: Value) => atom.set(newState)] as const;

export const useLocalAtom = ((init, options) => useState(() => $(init, options))[0]) as typeof $;
export const useLocalAtomValue = <Value, >(init: Value | AtomGetter<Value>, options?: AtomOptions<Value>): Value => useAtomValue(useLocalAtom(init, options));

export const useStateAtom = <Value,>(atom: PrimitiveAtom<Value>) => {
	const [state, setState] = useState(() => atom.get());
	const setStateWithAtom = (newState: Value) => {
		setState(newState);
		atom.set(newState);
	};
	return [state, setStateWithAtom] as const;
};
