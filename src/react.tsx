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
  AtomSuccessState,
  AtomState,
  AtomUpdater,
  AtomValuePair,
  CommonAtom,
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

/**
 * How long an atom woken up by a render stays alive without a subscriber.
 * Longer than React's fallback throttle (300ms), so a retry after suspending
 * still finds it.
 */
const RENDER_RETAIN_MS = 1000;

/**
 * Rendering reads the atom before React subscribes to it, and a render may be
 * retried later or thrown away. `get()` on an inactive atom only keeps it alive
 * until its value is ready, so without this the atom could be collected in
 * between: the retry, or the commit that subscribes, would compute it again
 * (send the request again, open the connection again).
 */
const retainForRender = <Value,>(atom: Atom<Value>) => {
  const release = atom.watch(() => {});
  const later = () => setTimeout(release, RENDER_RETAIN_MS);
  const { promise } = atom.state;
  if (promise) promise.then(later, later);
  else later();
};
export const useAtomValue = <Value,>(
  readable: CommonAtom<Value>,
  getServerSnapshot?: null | (() => Value),
) => {
  // Every atom is an `Atom`; `CommonAtom` only widens what callers may pass.
  const atom = useScopedAtom(readable as Atom<Value>);
  const subscribe = useCallback((watcher: () => void) => atom.watch(watcher), [atom]);
  const getSnapshot = useCallback(() => {
    const wasActive = atom.state.active;
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
    } finally {
      if (!wasActive) retainForRender(atom);
    }
  }, [atom]);
  return useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot === undefined
      ? getSnapshot
      : getServerSnapshot === null
        ? throwPromise
        : getServerSnapshot,
  );
};

const ssrPromise = new Promise(() => {});
const throwPromise = () => {
  if (REACT_USE) React.use(ssrPromise);
  throw ssrPromise;
};
const sameAtomState = <Value,>(a: AtomState<Value>, b: AtomState<Value>) =>
  a.active === b.active &&
  a.promise === b.promise &&
  Object.is(a.error, b.error) &&
  Object.is(a.value, b.value);

type UseAtomState = {
  <Value>(
    atom: PrimitiveAtom<Value>,
    getServerSnapshot?: null | (() => Value),
  ): AtomSuccessState<Value>;
  <Value>(atom: DerivedAtom<Value>, getServerSnapshot?: null | (() => Value)): AtomState<Value>;
  <Value>(atom: Atom<Value>, getServerSnapshot?: null | (() => Value)): AtomState<Value>;
  <Value>(atom: CommonAtom<Value>, getServerSnapshot?: null | (() => Value)): AtomState<Value>;
};

export const useAtomState = (<Value,>(
  atom: Atom<Value>,
  getServerSnapshot?: null | (() => Value),
) => {
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
  const getStateSnapshot = useCallback(() => {
    if (!sameAtomState(stateSnapshot.current, atom.state)) {
      stateSnapshot.current = { ...atom.state };
    }
    return stateSnapshot.current;
  }, [atom]);
  const getServerStateSnapshot = useCallback(
    () =>
      getServerSnapshot
        ? {
            active: true,
            error: undefined,
            promise: undefined,
            value: getServerSnapshot(),
          }
        : stateSnapshot.current,
    [getServerSnapshot],
  );
  return useSyncExternalStore(
    subscribe,
    getStateSnapshot,
    getServerSnapshot === undefined ? getStateSnapshot : getServerStateSnapshot,
  );
}) as UseAtomState;

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
