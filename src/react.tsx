import { useState, useSyncExternalStore } from 'react';
import type { Atom, DerivedAtom, PrimitiveAtom } from '.';

export const useAtom = <Value,>(atom: PrimitiveAtom<Value>) =>
	[useSyncExternalStore(atom.watch, atom.get), atom.set] as const;

export const useAtomValue = <Value,>(atom: Atom<Value>) =>
	useSyncExternalStore(atom.watch, atom.get);

export const useAtomState = <Value,>(atom: DerivedAtom<Value>) =>
	useSyncExternalStore(atom.watch, () => {
		// avoid https://github.com/facebook/react/issues/31730
		try {
			atom.get();
		} catch (_) {}
		return atom.state;
	});

export const useStateAtom = <Value,>(atom: PrimitiveAtom<Value>) => {
	const [state, setState] = useState(() => atom.get());
	const setStateWithAtom = (newState: Value) => {
		setState(newState);
		atom.set(newState);
	};
	return [state, setStateWithAtom] as const;
};
