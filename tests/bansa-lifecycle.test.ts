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
