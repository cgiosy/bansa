import { createContext, use, useContext, useMemo, useSyncExternalStore } from 'react';
import { createScope } from '.';
import type { Atom, AtomScope, AtomValuePair, DerivedAtom, PrimitiveAtom } from '.';

export const ScopeContext = createContext<AtomScope>((x) => x as any);

export const ScopeProvider = ({ value, children }: {
	value?: AtomValuePair<unknown>[],
	children: React.ReactNode;
}) => {
	const parentScope = value && useContext(ScopeContext);
	const scope = useMemo(() => createScope(parentScope, value), [parentScope]);
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

export const useScopedAtom = (<Value,>(atom: Atom<Value>) =>
	useContext(ScopeContext)(atom)
) as UseScopedAtom;

export const useAtom = <Value,>(atom: PrimitiveAtom<Value>) => (
	atom = useScopedAtom(atom),
	[useAtomValue(atom), (newState: Value) => atom.set(newState)] as const
);

export type UseScopedAtom = {
	<Value>(baseAtom: PrimitiveAtom<Value>): PrimitiveAtom<Value>;
	<Value>(baseAtom: DerivedAtom<Value>): DerivedAtom<Value>;
	<Value>(baseAtom: Atom<Value>): Atom<Value>;
};
