import { createContext, use, useContext, useState, useSyncExternalStore } from 'react';
import { $, createScope } from '.';
import type { Atom, AtomGetter, AtomOptions, AtomScope, DerivedAtom, PrimitiveAtom } from '.';

export const ScopeContext = createContext<AtomScope>(
	((x) => x) as AtomScope
);

export const ScopeProvider = ({ children }: { children: React.ReactNode; }) => {
	const parentScope = useContext(ScopeContext);
	const scope = useState(() => createScope(parentScope))[0];
	return (
		<ScopeContext.Provider value={scope}>
			{children}
		</ScopeContext.Provider>
	);
};

export const useAtomValue = <Value,>(atom: Atom<Value>) => (
	atom = useContext(ScopeContext)(atom),
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
	)
);

export const useAtomState = <Value,>(atom: DerivedAtom<Value>) => (
	atom = useContext(ScopeContext)(atom),
	useSyncExternalStore(
		(watcher) => atom.watch(watcher),
		() => {
			// avoid https://github.com/facebook/react/issues/31730
			try {
				atom.get();
			} catch (_) {}
			return atom.state;
		},
	)
);

export const useAtom = <Value,>(atom: PrimitiveAtom<Value>) => (
	atom = useContext(ScopeContext)(atom),
	[useAtomValue(atom), (newState: Value) => atom.set(newState)] as const
);

export const useLocalAtom = ((init, options) => useState(() => $(init, options))[0]) as typeof $;
export const useLocalAtomValue = <Value, >(init: Value | AtomGetter<Value>, options?: AtomOptions<Value>): Value => useAtomValue(useLocalAtom(init, options));

export const useStateAtom = <Value,>(atom: PrimitiveAtom<Value>) => {
	atom = useContext(ScopeContext)(atom);
	const [state, setState] = useState(() => atom.get());
	const setStateWithAtom = (newState: Value) => {
		setState(newState);
		atom.set(newState);
	};
	return [state, setStateWithAtom] as const;
};
