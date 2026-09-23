import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { $, createScope, type Atom } from "../src/index.ts";
import { wait } from "./bansa-test-lib.ts";

// Getter errors are also rethrown from a microtask (`logError`); keep them out of the run.
const captureQueuedErrors = () => {
  const realQueueMicrotask = globalThis.queueMicrotask;
  const uncaught: unknown[] = [];
  vi.stubGlobal("queueMicrotask", (callback: VoidFunction) => {
    if (callback.toString().includes("throw e;")) {
      try {
        callback();
      } catch (e) {
        uncaught.push(e);
      }
      return;
    }
    realQueueMicrotask(callback);
  });
  return uncaught;
};

// The tests run in Node; the package itself does not depend on Node types.
declare const process: {
  on(event: "unhandledRejection", listener: (reason: unknown) => void): void;
  off(event: "unhandledRejection", listener: (reason: unknown) => void): void;
};
const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => unhandled.push(reason);
beforeEach(() => {
  unhandled.length = 0;
  process.on("unhandledRejection", onUnhandled);
});
afterEach(() => {
  process.off("unhandledRejection", onUnhandled);
  vi.unstubAllGlobals();
});

describe("internal promises", () => {
  it("do not leak unhandled rejections when a loading atom fails", async () => {
    captureQueuedErrors();
    const boom = new Error("boom");
    const source = $(async () => {
      await Promise.resolve();
      throw boom;
    });
    const child = $((get) => get(source));
    child.watch(() => {});
    await wait();
    await wait();
    expect(child.state.error).toBe(boom);
    expect(unhandled).toEqual([]);
  });

  it("still reject for callers who wait on them", async () => {
    captureQueuedErrors();
    const boom = new Error("boom");
    const source = $(async () => {
      await Promise.resolve();
      throw boom;
    });
    source.watch(() => {});
    await Promise.resolve();
    const promise = source.state.promise;
    expect(promise).toBeDefined();
    await expect(promise).rejects.toBe(boom);
  });
});

describe("get() on an inactive atom", () => {
  it("settles the promise it throws, and the value is readable afterwards", async () => {
    let runs = 0;
    const atom = $(async () => {
      runs++;
      await wait();
      return 1;
    });
    let thrown: unknown;
    try {
      atom.get();
    } catch (e) {
      thrown = e;
    }
    // Longer than the zero-delay collection that used to abort it.
    await expect(thrown).resolves.toBe(1);
    expect(atom.get()).toBe(1);
    expect(runs).toBe(1);
  });

  it("is collected once the value is ready and nobody subscribed", async () => {
    let aborted = 0;
    const atom = $(async (_, { signal }) => {
      signal.then(() => aborted++);
      await wait();
      return 1;
    });
    try {
      atom.get();
    } catch {}
    await wait();
    await wait();
    await wait();
    expect(atom.state.active).toBe(false);
    expect(aborted).toBe(1);
  });
});

describe("collecting a loading atom", () => {
  it("rejects the pending promise instead of leaving it pending", async () => {
    const atom = $(() => new Promise<number>(() => {}));
    const unwatch = atom.watch(() => {});
    await Promise.resolve();
    const promise = atom.state.promise;
    expect(promise).toBeDefined();
    unwatch();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(atom.state.active).toBe(false);
    expect(unhandled).toEqual([]);
  });
});

describe("atoms nobody observes", () => {
  it("are not recomputed while they wait out gcDelay", async () => {
    const $source = $(0);
    let runs = 0;
    const atom = $(
      (get) => {
        runs++;
        return get($source);
      },
      { gcDelay: 1000 },
    );
    const unsubscribe = atom.subscribe(() => {});
    await Promise.resolve();
    expect(runs).toBe(1);
    unsubscribe();
    $source.set(1);
    await wait();
    $source.set(2);
    await wait();
    expect(runs).toBe(1);

    const values: number[] = [];
    atom.subscribe((value) => values.push(value));
    await wait();
    expect(values).toEqual([2]);
    expect(runs).toBe(2);
  });

  it("are not recomputed when everyone leaves in the same tick", async () => {
    const $source = $(0);
    let runs = 0;
    const atom = $((get) => {
      runs++;
      return get($source);
    });
    const unsubscribe = atom.subscribe(() => {});
    await Promise.resolve();
    unsubscribe();
    $source.set(1);
    await wait();
    expect(runs).toBe(1);
  });

  it("are not refreshed", async () => {
    let runs = 0;
    const atom = $(
      () => {
        runs++;
        return runs;
      },
      { gcDelay: 1000 },
    );
    const unsubscribe = atom.subscribe(() => {});
    await Promise.resolve();
    unsubscribe();
    atom.refresh();
    await wait();
    expect(runs).toBe(1);
  });
});

describe("watch-mode dependencies", () => {
  it("stay active while a dependent watches them", async () => {
    const $source = $(0);
    const atom = $((get) => get($source));
    const watcher = $((get) => get(atom, true).value);
    const values: (number | undefined)[] = [];
    watcher.subscribe((value) => values.push(value));
    const unsubscribe = atom.subscribe(() => {});
    await wait();
    unsubscribe();
    await wait();
    expect(atom.state.active).toBe(true);
    $source.set(1);
    await wait();
    expect(values.at(-1)).toBe(1);
  });
});

describe("getter errors", () => {
  it("are not rethrown when a watcher receives them", async () => {
    const uncaught = captureQueuedErrors();
    const atom = $(() => {
      throw new Error("boom");
    });
    atom.watch(() => {});
    await wait();
    expect(atom.state.error).toBeInstanceOf(Error);
    expect(uncaught).toEqual([]);
  });

  it("are not rethrown when a dependent passes them to a watcher", async () => {
    const uncaught = captureQueuedErrors();
    const source = $(async () => {
      await Promise.resolve();
      throw new Error("boom");
    });
    const child = $((get) => get(source));
    child.watch(() => {});
    await wait();
    expect(child.state.error).toBeInstanceOf(Error);
    expect(uncaught).toEqual([]);
  });

  it("are rethrown once when they reach only subscribers", async () => {
    const uncaught = captureQueuedErrors();
    const boom = new Error("boom");
    const source = $(async () => {
      await Promise.resolve();
      throw boom;
    });
    const left = $((get) => get(source));
    const right = $((get) => get(source));
    left.subscribe(() => {});
    right.subscribe(() => {});
    await wait();
    expect(uncaught).toEqual([boom]);
  });

  it("are not rethrown when get() throws them to the caller", async () => {
    const uncaught = captureQueuedErrors();
    const atom = $(() => {
      throw new Error("boom");
    });
    expect(() => atom.get()).toThrow("boom");
    await wait();
    expect(uncaught).toEqual([]);
  });
});

describe("get(atom, true)", () => {
  it("returns a snapshot that later updates do not change", async () => {
    const $source = $(0);
    const states: { value?: number }[] = [];
    const atom = $((get) => get($source, true));
    atom.subscribe((state) => states.push(state));
    await wait();
    $source.set(1);
    await wait();
    $source.set(2);
    await wait();
    expect(states.map((state) => state.value)).toEqual([0, 1, 2]);
  });
});

describe("getter options in a scope", () => {
  it("refresh() recomputes the scoped copy, not the original", async () => {
    const $flag = $(false);
    let scopedRuns = 0;
    let refreshCopy = () => {};
    const atom = $((get, { refresh }) => {
      if (get($flag)) {
        scopedRuns++;
        refreshCopy = refresh;
      }
      return 0;
    });
    const scoped = createScope(undefined, [[$flag, true]])(atom);
    scoped.subscribe(() => {});
    await wait();
    expect(scopedRuns).toBe(1);
    refreshCopy();
    await wait();
    expect(scopedRuns).toBe(2);
  });
});

describe("signal", () => {
  it("runs then() callbacks registered before and after the abort", async () => {
    const calls: string[] = [];
    let signal: import("../src/index.ts").ThenableSignal | undefined;
    const atom = $((_, options) => {
      signal = options.signal;
      signal.then(() => calls.push("before"));
      return 0;
    });
    const unsubscribe = atom.subscribe(() => {});
    await wait();
    unsubscribe();
    await wait();
    expect(signal!.aborted).toBe(true);
    signal!.then(() => calls.push("after"));
    await wait();
    expect(calls).toEqual(["before", "after"]);
  });
});

describe("gcDelay", () => {
  it("counts from the last time the atom lost its readers", async () => {
    vi.useFakeTimers();
    try {
      const atom = $(() => 1, { gcDelay: 100 });
      let unsubscribe = atom.subscribe(() => {});
      await vi.advanceTimersByTimeAsync(0);
      unsubscribe();
      await vi.advanceTimersByTimeAsync(60);
      unsubscribe = atom.subscribe(() => {});
      await vi.advanceTimersByTimeAsync(0);
      unsubscribe();
      await vi.advanceTimersByTimeAsync(60);
      expect(atom.state.active).toBe(true);
      await vi.advanceTimersByTimeAsync(50);
      expect(atom.state.active).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps one timer per atom however often it is left", async () => {
    vi.useFakeTimers();
    try {
      const atom = $(() => 1, { gcDelay: 100 });
      const unsubscribe = atom.subscribe(() => {});
      await vi.advanceTimersByTimeAsync(0);
      unsubscribe();
      expect(atom.state.active).toBe(true);
      for (let i = 0; i < 20; i++) atom.subscribe(() => {})();
      expect(vi.getTimerCount()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("dependencies a computation stops reading", () => {
  it("are let go once a computation succeeds without them", async () => {
    const $flag = $(true);
    let aborted = 0;
    const dep = $((_, { signal }) => {
      signal.then(() => aborted++);
      return 1;
    });
    const atom = $((get) => (get($flag) ? get(dep) : 0));
    atom.subscribe(() => {});
    await wait();
    expect(dep.state.active).toBe(true);
    $flag.set(false);
    await wait();
    await wait();
    expect(dep.state.active).toBe(false);
    expect(aborted).toBe(1);
  });

  it("are kept while a computation reads them only after an await", async () => {
    const $n = $(0);
    let depRuns = 0;
    const dep = $(() => ++depRuns);
    const atom = $(async (get) => {
      const n = get($n);
      await new Promise((resolve) => setTimeout(resolve, 20));
      return n + get(dep);
    });
    const values: number[] = [];
    atom.subscribe((value) => values.push(value));
    await new Promise((resolve) => setTimeout(resolve, 40));
    $n.set(1);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(values).toEqual([1, 2]);
    expect(depRuns).toBe(1);
  });

  it("are kept across computations that replace each other", async () => {
    const $n = $(0);
    let depRuns = 0;
    const dep = $(() => ++depRuns);
    const atom = $(async (get) => {
      const n = get($n);
      await new Promise((resolve) => setTimeout(resolve, 20));
      return n + get(dep);
    });
    const values: number[] = [];
    atom.subscribe((value) => values.push(value));
    await new Promise((resolve) => setTimeout(resolve, 40));
    $n.set(1);
    await wait();
    $n.set(2);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(values).toEqual([1, 3]);
    expect(depRuns).toBe(1);
  });

  it("are kept while a computation stops at a loading dependency", async () => {
    let resolveSlow = (_: number) => {};
    const $n = $(0);
    const slow = $((get) => {
      get($n);
      return new Promise<number>((resolve) => (resolveSlow = resolve));
    });
    let depRuns = 0;
    const dep = $(() => ++depRuns);
    const atom = $((get) => get(slow) + get(dep));
    atom.subscribe(() => {});
    await wait();
    resolveSlow(1);
    await wait();
    expect(atom.state.value).toBe(2);
    $n.set(1);
    await wait();
    await wait();
    resolveSlow(2);
    await wait();
    expect(atom.state.value).toBe(3);
    expect(depRuns).toBe(1);
  });

  it("are let go when the atom itself is collected", async () => {
    const $flag = $(true);
    const dep = $(() => 1);
    const atom = $((get) => {
      if (!get($flag)) throw new Error("stop");
      return get(dep);
    });
    const unwatch = atom.watch(() => {});
    await wait();
    $flag.set(false);
    await wait();
    expect(dep.state.active).toBe(true);
    unwatch();
    await wait();
    await wait();
    expect(atom.state.active).toBe(false);
    expect(dep.state.active).toBe(false);
  });
});

describe("watch", () => {
  it("unwatching one of two watches with the same function keeps the other", async () => {
    const $source = $(0);
    const atom = $((get) => get($source));
    let calls = 0;
    const watcher = () => calls++;
    const unwatch = atom.watch(watcher);
    atom.watch(watcher);
    await wait();
    unwatch();
    await wait();
    expect(atom.state.active).toBe(true);
    calls = 0;
    $source.set(1);
    await wait();
    expect(calls).toBe(1);
  });
});

describe("deep graphs", () => {
  const chain = (length: number) => {
    const $source = $(0);
    let last: Atom<number> = $source;
    for (let i = 0; i < length; i++) {
      const previous: Atom<number> = last;
      last = $((get): number => get(previous) + 1);
    }
    return { $source, last };
  };

  it("activate a long chain of inactive atoms without overflowing the stack", async () => {
    const { last } = chain(20000);
    const values: number[] = [];
    last.subscribe((value) => values.push(value));
    await wait();
    expect(values).toEqual([20000]);
  });

  it("update a long chain without overflowing the stack", async () => {
    const { $source, last } = chain(20000);
    const values: number[] = [];
    last.subscribe((value) => values.push(value));
    await wait();
    $source.set(5);
    await wait();
    expect(values).toEqual([20000, 20005]);
  });

  it("settle get() on a long inactive chain", async () => {
    const { last } = chain(20000);
    let thrown: unknown;
    try {
      last.get();
    } catch (e) {
      thrown = e;
    }
    await expect(thrown).resolves.toBe(20000);
  });
});
