import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { $, createScope } from "../src/index.ts";
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
