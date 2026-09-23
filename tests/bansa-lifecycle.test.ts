import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { $ } from "../src/index.ts";
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
