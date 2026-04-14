import * as React from "react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useSyncExternalStore,
  version,
} from "react";
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

const forkedAtomParentMap = new WeakMap<Atom<any>, AtomScope>();
export const useScopedAtom = (<Value,>(atom: Atom<Value>) => {
  const scope = useContext(ScopeContext);
  if (forkedAtomParentMap.get(atom) === scope) return atom;
  return scope(atom);
}) as UseScopedAtom;

const useForkedScope = (injectedEntries?: AtomValuePair<any>[]) => {
  const parentScope = useContext(ScopeContext);
  const deps = injectedEntries?.flat() || [];
  deps.push(parentScope);
  // oxlint-disable-next-line exhaustive-deps
  return useMemo(() => createScope(injectedEntries && parentScope, injectedEntries), deps);
};

export const useForkedAtom = <Value,>(
  atom: DerivedAtom<Value>,
  injectedEntries?: AtomValuePair<any>[],
) => {
  atom = useForkedScope(injectedEntries)(atom);
  forkedAtomParentMap.set(atom, useContext(ScopeContext));
  return atom;
};

// TODO: cleanup
const REACT_MAJOR_VERSION = parseInt(version || "19", 10) || 19;
const REACT_USE = REACT_MAJOR_VERSION >= 19 && "use" in React;
export const useAtomValue = <Value,>(atom: Atom<Value>) => {
  atom = useScopedAtom(atom);
  const subscribe = useCallback((watcher: () => void) => atom.watch(watcher), [atom]);
  const getSnapshot = useCallback(() => {
    // https://github.com/facebook/react/pull/34032
    try {
      return atom.get();
    } catch (_) {
      if (atom.state.promise) {
        const promise = Promise.resolve(atom.state.promise);
        if (REACT_USE) React.use(promise);
        throw promise;
      }
      throw atom.state.error;
    }
  }, [atom]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
};

const sameAtomState = <Value,>(a: AtomState<Value>, b: AtomState<Value>) =>
  a.promise === b.promise && Object.is(a.error, b.error) && Object.is(a.value, b.value);

export const useAtomState = <Value,>(atom: DerivedAtom<Value>) => {
  atom = useScopedAtom(atom);
  const stateSnapshot = useRef({ ...atom.state });
  const subscribe = useCallback(
    (watcher: () => void) =>
      atom.watch(() => {
        if (!sameAtomState(stateSnapshot.current, atom.state)) {
          stateSnapshot.current = { ...atom.state };
          watcher();
        }
      }),
    [atom],
  );
  const getSnapshot = useCallback(() => {
    // avoid https://github.com/facebook/react/issues/31730
    try {
      atom.get();
    } catch (_) {}
    if (!sameAtomState(stateSnapshot.current, atom.state)) {
      stateSnapshot.current = { ...atom.state };
    }
    return stateSnapshot.current;
  }, [atom]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
};

export const useAtom = <Value,>(atom: PrimitiveAtom<Value>) => {
  atom = useScopedAtom(atom);
  const setAtom = useMemo(() => (newState: AtomUpdater<Value>) => atom.set(newState), [atom]);
  return [useAtomValue(atom), setAtom] as const;
};

export const ScopeProvider = ({
  value,
  children,
}: {
  value?: AtomValuePair<any>[];
  children: React.ReactNode;
}) => <ScopeContext.Provider value={useForkedScope(value)}>{children}</ScopeContext.Provider>;

export type UseScopedAtom = {
  <Value>(baseAtom: PrimitiveAtom<Value>): PrimitiveAtom<Value>;
  <Value>(baseAtom: DerivedAtom<Value>): DerivedAtom<Value>;
  <Value>(baseAtom: Atom<Value>): Atom<Value>;
};
