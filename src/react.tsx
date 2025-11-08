import { useState, useSyncExternalStore } from 'react';
import { $ } from '.';
import type { Atom, AtomGetter, AtomOptions, DerivedAtom, PrimitiveAtom } from '.';

export const useAtomValue = <Value,>(atom: Atom<Value>) =>
	useSyncExternalStore(
		(watcher) => atom.watch(watcher),
		() => atom.get(),
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
