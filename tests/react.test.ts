import { afterEach, describe, expect, it, vi } from "vitest";

const flushMicrotasks = () =>
  new Promise((resolve) => {
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = resolve;
    port2.postMessage(null);
  });

type UseSyncExternalStore = (
  subscribe: (listener: VoidFunction) => () => void,
  getSnapshot: () => unknown,
  getServerSnapshot?: () => unknown,
) => unknown;

const createReactMock = (options?: {
  use?: (value: unknown) => unknown;
  useSyncExternalStore?: UseSyncExternalStore;
}) => {
  let memoDeps: unknown[] | undefined;
  let memoValue: unknown;

  return {
    createContext: (defaultValue: unknown) => ({
      _currentValue: defaultValue,
    }),
    use:
      options?.use ??
      ((value: unknown) => {
        if (value && typeof (value as PromiseLike<unknown>).then === "function") {
          throw value;
        }
        return value;
      }),
    useContext: (context: { _currentValue: unknown }) => context._currentValue,
    useMemo: (factory: () => unknown, deps: unknown[]) => {
      if (
        memoDeps &&
        deps.length === memoDeps.length &&
        deps.every((dep, index) => Object.is(dep, memoDeps![index]))
      ) {
        return memoValue;
      }
      memoDeps = deps.slice();
      memoValue = factory();
      return memoValue;
    },
    useRef: <T>(value: T) => ({ current: value }),
    useSyncExternalStore:
      options?.useSyncExternalStore ??
      ((_subscribe, getSnapshot, getServerSnapshot) => (getServerSnapshot ?? getSnapshot)()),
  };
};

afterEach(() => {
  vi.resetModules();
  vi.unmock("react");
});

describe("React Bindings", () => {
  it("caches useAtomState snapshots when the store is unchanged", async () => {
    const comparisons: boolean[] = [];
    vi.doMock("react", () =>
      createReactMock({
        useSyncExternalStore: (_subscribe, getSnapshot, getServerSnapshot) => {
          const snapshot = (getServerSnapshot ?? getSnapshot)();
          comparisons.push(snapshot === (getServerSnapshot ?? getSnapshot)());
          return snapshot;
        },
      }),
    );
    const { useAtomState } = await import("../src/react.tsx");
    const { $ } = await import("../src/index.ts");

    const atom = $(() => 1);
    const snapshot = useAtomState(atom);

    expect(snapshot.value).toBe(1);
    expect(comparisons).toEqual([true]);
  });

  it("passes a server snapshot getter to useSyncExternalStore", async () => {
    const hasServerSnapshot: boolean[] = [];
    vi.doMock("react", () =>
      createReactMock({
        useSyncExternalStore: (_subscribe, getSnapshot, getServerSnapshot) => {
          hasServerSnapshot.push(typeof getServerSnapshot === "function");
          return (getServerSnapshot ?? getSnapshot)();
        },
      }),
    );
    const { useAtomValue, useAtomState } = await import("../src/react.tsx");
    const { $ } = await import("../src/index.ts");

    const count = $(1);
    const doubled = $((get) => get(count) * 2);

    expect(useAtomValue(count)).toBe(1);
    expect(useAtomState(doubled).value).toBe(2);
    expect(hasServerSnapshot).toEqual([true, true]);
  });

  it("returns a stable setter that accepts updater functions", async () => {
    vi.doMock("react", () => createReactMock());
    const { useAtom } = await import("../src/react.tsx");
    const { $ } = await import("../src/index.ts");

    const atom = $(0);
    const [, setAtom1] = useAtom(atom);
    const [, setAtom2] = useAtom(atom);

    expect(setAtom1).toBe(setAtom2);
    setAtom1((value) => value + 1);
    await flushMicrotasks();
    expect(atom.get()).toBe(1);
  });
});
