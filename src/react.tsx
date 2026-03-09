import React, { createContext, useContext, useMemo, useRef, useSyncExternalStore } from "react";
import { createScope } from "./atom.ts";
import type {
  Atom,
  AtomScope,
  AtomState,
  AtomUpdater,
  AtomValuePair,
  DerivedAtom,
  PrimitiveAtom,
} from "./atom.ts";

export const ScopeContext = createContext<AtomScope>((x) => x as any);

export const ScopeProvider = ({
  value,
  children,
}: {
  value?: AtomValuePair<unknown>[];
  children: React.ReactNode;
}) => {
  const parentScope = useContext(ScopeContext);
  const scope = useMemo(
    () => createScope(value && parentScope, value),
    // oxlint-disable-next-line exhaustive-deps
    [parentScope, ...(value || []).flat()],
  );
  return <ScopeContext.Provider value={scope}>{children}</ScopeContext.Provider>;
};

// TODO: cleanup
const sameAtomState = <Value,>(a: AtomState<Value>, b: AtomState<Value>) =>
  a.promise === b.promise && Object.is(a.error, b.error) && Object.is(a.value, b.value);

const REACT_MAJOR_VERSION = Number(React.version.split(".")[0]);
export const useAtomValue = <Value,>(atom: Atom<Value>) => {
  atom = useContext(ScopeContext)(atom);
  const getSnapshot = () => {
    // https://github.com/facebook/react/pull/34032
    try {
      return atom.get();
    } catch (_) {
      if (atom.state.promise) {
        const promise = Promise.resolve(atom.state.promise);
        if (REACT_MAJOR_VERSION >= 19) React.use(promise);
        throw promise;
      }
      throw atom.state.error;
    }
  };
  return useSyncExternalStore((watcher) => atom.watch(watcher), getSnapshot, getSnapshot);
};

export const useAtomState = <Value,>(atom: DerivedAtom<Value>) => {
  atom = useContext(ScopeContext)(atom);
  const stateSnapshot = useRef({ ...atom.state });
  const getSnapshot = () => {
    // avoid https://github.com/facebook/react/issues/31730
    try {
      atom.get();
    } catch (_) {}
    if (!sameAtomState(stateSnapshot.current, atom.state)) {
      stateSnapshot.current = { ...atom.state };
    }
    return stateSnapshot.current;
  };
  return useSyncExternalStore(
    (watcher) =>
      atom.watch(() => {
        if (!sameAtomState(stateSnapshot.current, atom.state)) {
          stateSnapshot.current = { ...atom.state };
          watcher();
        }
      }),
    getSnapshot,
    getSnapshot,
  );
};

export const useScopedAtom = (<Value,>(atom: Atom<Value>) =>
  useContext(ScopeContext)(atom)) as UseScopedAtom;

export const useAtom = <Value,>(atom: PrimitiveAtom<Value>) => {
  atom = useScopedAtom(atom);
  const setAtom = useMemo(() => (newState: AtomUpdater<Value>) => atom.set(newState), [atom]);
  return [useAtomValue(atom), setAtom] as const;
};

export type UseScopedAtom = {
  <Value>(baseAtom: PrimitiveAtom<Value>): PrimitiveAtom<Value>;
  <Value>(baseAtom: DerivedAtom<Value>): DerivedAtom<Value>;
  <Value>(baseAtom: Atom<Value>): Atom<Value>;
};
