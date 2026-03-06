import { afterEach, describe, expect, it, vi } from "vitest";
import { $ } from "../src/index.ts";

const flushMicrotasks = () =>
  new Promise((resolve) => {
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = resolve;
    port2.postMessage(null);
  });

const waitForTimers = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

const captureQueuedErrors = () => {
  const realQueueMicrotask = globalThis.queueMicrotask;
  const uncaught: unknown[] = [];
  vi.stubGlobal("queueMicrotask", (callback: VoidFunction) => {
    realQueueMicrotask(() => {
      try {
        callback();
      } catch (error) {
        uncaught.push(error);
      }
    });
  });
  return uncaught;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Known Bug Reproductions", () => {
  it("notifies watchers again when a sync atom recovers to the previous value", async () => {
    const uncaught = captureQueuedErrors();
    const step = $(0);
    const boom = new Error("boom");

    const atom = $((get) => {
      if (get(step) === 1) throw boom;
      return 123;
    });

    const watch = vi.fn();
    const subscriber = vi.fn();
    atom.watch(watch);
    atom.subscribe(subscriber);
    await flushMicrotasks();
    watch.mockClear();
    subscriber.mockClear();

    step.set(1);
    await flushMicrotasks();
    await flushMicrotasks();
    expect(watch).toHaveBeenCalledTimes(1);
    expect(subscriber).not.toHaveBeenCalled();

    step.set(2);
    await flushMicrotasks();
    expect(watch).toHaveBeenCalledTimes(2);
    expect(subscriber).toHaveBeenCalled();
    expect(uncaught).toEqual([boom]);
  });

  it("applies custom equality even when the previous value is undefined", async () => {
    const atom = $<number | undefined>(undefined, {
      equals: (a, b) => (a ?? 0) === (b ?? 0),
    });
    const subscriber = vi.fn();
    atom.subscribe(subscriber);
    await flushMicrotasks();
    subscriber.mockClear();

    atom.set(0);
    await flushMicrotasks();

    expect(atom.state.value).toBeUndefined();
    expect(subscriber).not.toHaveBeenCalled();
  });

  it("does not notify subscribers when an async reload resolves to an equal value", async () => {
    const step = $(0);
    const atom = $(
      async (get) => {
        get(step);
        await Promise.resolve();
        return { stable: 1 };
      },
      {
        equals: (a, b) => a.stable === b.stable,
      },
    );

    const watcher = vi.fn();
    const subscriber = vi.fn();
    atom.watch(watcher);
    atom.subscribe(subscriber);
    await flushMicrotasks();
    await flushMicrotasks();
    await flushMicrotasks();
    watcher.mockClear();
    subscriber.mockClear();

    step.set(1);
    await flushMicrotasks();
    await flushMicrotasks();
    await flushMicrotasks();

    expect(watcher).toHaveBeenCalled();
    expect(subscriber).not.toHaveBeenCalled();
  });

  it("keeps the previous async error when recovery resolves to the same value", async () => {
    captureQueuedErrors();

    const step = $(0);
    const boom = new Error("boom");
    let rejectNext = false;
    let resolve: (() => void) | undefined;

    const atom = $(async (get) => {
      get(step);
      await new Promise<void>((r) => {
        resolve = r;
      });
      if (rejectNext) throw boom;
      return 1;
    });

    atom.subscribe(() => {});
    await flushMicrotasks();
    resolve?.();
    await flushMicrotasks();
    await flushMicrotasks();

    rejectNext = true;
    step.set(1);
    await flushMicrotasks();
    resolve?.();
    await flushMicrotasks();
    await waitForTimers();
    expect(atom.state.error).toBe(boom);

    rejectNext = false;
    step.set(2);
    await flushMicrotasks();
    resolve?.();
    await flushMicrotasks();
    await waitForTimers();

    expect(atom.state.error).toBeUndefined();
    expect(atom.state.value).toBe(1);
  });

  it("keeps a stale success snapshot when an async dependency reloads", async () => {
    const id = $(1);
    let resolve: (() => void) | undefined;
    const user = $(async (get) => {
      const currentId = get(id);
      await new Promise<void>((r) => {
        resolve = r;
      });
      return { id: currentId, name: `user-${currentId}` };
    });
    const userName = $((get) => get(user).name);

    userName.subscribe(() => {});
    await flushMicrotasks();

    resolve?.();
    await flushMicrotasks();
    await flushMicrotasks();
    expect(!!userName.state.promise).toBe(false);

    id.set(2);
    await flushMicrotasks();

    expect(!!userName.state.promise).toBe(true);
    expect(userName.state.error).toBeUndefined();
  });
});
