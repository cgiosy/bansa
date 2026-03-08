import { afterEach, describe, expect, it, vi } from "vitest";
import { $ } from "../src/index.ts";
import { flushMicrotasks, inc, wait } from "./bansa-test-lib.ts";

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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Atom Library - Error Tests", () => {
  it("sync atom (get)", async () => {
    const asdf = captureQueuedErrors();

    const atom = $(1);
    const derivedAtom = $((get) => {
      const value = get(atom) + 10;
      if (value > 11) throw new Error(`Value exceeds 11: ${value}`);
      return value;
    });
    expect(derivedAtom.get()).toBe(11);

    // The update occurs in the next microtask. This is the behavior of batch updates.
    atom.set(inc);
    expect(derivedAtom.get()).toBe(11);

    await flushMicrotasks();
    expect(() => derivedAtom.get()).toThrowError("Value exceeds 11: 12");

    // Second error
    atom.set(inc);
    expect(() => derivedAtom.get()).toThrowError("Value exceeds 11: 12");

    await flushMicrotasks();
    expect(() => derivedAtom.get()).toThrowError("Value exceeds 11: 13");

    // Recovery
    atom.set(0);
    await flushMicrotasks();
    expect(derivedAtom.get()).toBe(10);
  });

  it("sync atom (watch + state)", async () => {
    const asdf = captureQueuedErrors();

    const atom = $(1);
    const derivedAtom = $((get) => {
      const value = get(atom) + 10;
      if (value > 11) throw new Error(`Value exceeds 11: ${value}`);
      return value;
    });
    expect(derivedAtom.get()).toBe(11);
    expect(derivedAtom.state.error).toBeUndefined();
    expect(derivedAtom.state.promise).toBeUndefined();
    expect(derivedAtom.state.value).toBe(11);

    const watch = vi.fn();
    derivedAtom.watch(watch);
    await flushMicrotasks();
    expect(watch).toHaveBeenCalledTimes(0);

    // The update occurs in the next microtask. This is the behavior of batch updates.
    atom.set(inc);
    expect(watch).toHaveBeenCalledTimes(0);
    expect(derivedAtom.get()).toBe(11);
    expect(derivedAtom.state.error).toBeUndefined();
    expect(derivedAtom.state.promise).toBeUndefined();
    expect(derivedAtom.state.value).toBe(11);

    await flushMicrotasks();
    expect(watch).toHaveBeenCalledTimes(1);

    expect(derivedAtom.state.error).toEqual(new Error("Value exceeds 11: 12"));
    expect(derivedAtom.state.promise).toBeUndefined();
    expect(derivedAtom.state.value).toBe(11); // The value remains the same until the next successful get.

    // Second error
    atom.set(inc);
    expect(watch).toHaveBeenCalledTimes(1);
    expect(() => derivedAtom.get()).toThrowError("Value exceeds 11: 12");
    expect(derivedAtom.state.error).toEqual(new Error("Value exceeds 11: 12"));
    expect(derivedAtom.state.promise).toBeUndefined();
    expect(derivedAtom.state.value).toBe(11);

    await flushMicrotasks();
    expect(watch).toHaveBeenCalledTimes(2);

    expect(derivedAtom.state.error).toEqual(new Error("Value exceeds 11: 13"));
    expect(derivedAtom.state.promise).toBeUndefined();
    expect(derivedAtom.state.value).toBe(11); // The value remains the same until the next successful get.

    // Recovery
    atom.set(0);
    await flushMicrotasks();
    expect(watch).toHaveBeenCalledTimes(3);
    expect(derivedAtom.get()).toBe(10);

    expect(derivedAtom.state.error).toBeUndefined();
    expect(derivedAtom.state.promise).toBeUndefined();
    expect(derivedAtom.state.value).toBe(10);
  });

  it("sync atom (subscribe)", async () => {
    const asdf = captureQueuedErrors();

    const atom = $(1);
    const derivedAtom = $((get) => {
      const value = get(atom) + 10;
      if (value > 11) throw new Error(`Value exceeds 11: ${value}`);
      return value;
    });

    const subscriber = vi.fn();
    derivedAtom.subscribe(subscriber);
    expect(subscriber).toHaveBeenCalledTimes(0);

    await flushMicrotasks();
    expect(subscriber).toHaveBeenCalledTimes(1);
    expect(subscriber).toHaveBeenCalledWith(11, expect.anything());

    // The update occurs in the next microtask. This is the behavior of batch updates.
    atom.set(inc);
    expect(subscriber).toHaveBeenCalledTimes(1);

    await flushMicrotasks();
    expect(subscriber).toHaveBeenCalledTimes(1); // Subscribers should not be called when the value doesn't change due to an error.
    expect(derivedAtom.state.error).toEqual(new Error("Value exceeds 11: 12"));
    expect(() => derivedAtom.get()).toThrowError("Value exceeds 11: 12");

    // Second error
    atom.set(inc);
    expect(subscriber).toHaveBeenCalledTimes(1);

    await flushMicrotasks();
    expect(subscriber).toHaveBeenCalledTimes(1); // Subscribers should not be called when the value doesn't change due to an error.
    expect(derivedAtom.state.error).toEqual(new Error("Value exceeds 11: 13"));
    expect(() => derivedAtom.get()).toThrowError("Value exceeds 11: 13");

    // Recovery
    atom.set(0);
    await flushMicrotasks();
    expect(subscriber).toHaveBeenCalledTimes(2);
    expect(subscriber).toHaveBeenLastCalledWith(10, expect.anything());

    expect(derivedAtom.state.error).toBeUndefined();
    expect(derivedAtom.state.promise).toBeUndefined();
    expect(derivedAtom.state.value).toBe(10);
  });

  it("async atom (subscribe)", async () => {
    const asdf = captureQueuedErrors();
    let resolve: ((value?: unknown) => void) | undefined;

    const atom = $(1);

    const asyncAtom = $(async (get) => {
      const value = get(atom) + 10;
      await new Promise((res) => {
        resolve = res;
      });
      if (value > 11) throw new Error(`Value exceeds 11: ${value}`);
      return value;
    });

    const subscriber = vi.fn();
    asyncAtom.subscribe(subscriber);
    expect(subscriber).toHaveBeenCalledTimes(0);

    // waiting resolve
    await flushMicrotasks();
    expect(subscriber).toHaveBeenCalledTimes(0);
    expect(resolve).toBeDefined();
    expect(asyncAtom.state.promise).toBeDefined();

    resolve!();
    resolve = undefined;
    await flushMicrotasks();
    expect(subscriber).toHaveBeenCalledTimes(1);
    expect(subscriber).toHaveBeenCalledWith(11, expect.anything());
    expect(asyncAtom.state.promise).toBeUndefined();
    expect(asyncAtom.state.error).toBeUndefined();
    expect(asyncAtom.state.value).toBe(11);

    // The update occurs in the next microtask. This is the behavior of batch updates.
    atom.set(inc);
    expect(subscriber).toHaveBeenCalledTimes(1);

    // waiting resolve
    await flushMicrotasks();
    expect(subscriber).toHaveBeenCalledTimes(1);
    expect(resolve).toBeDefined();
    expect(asyncAtom.state.promise).toBeDefined();

    resolve!();
    resolve = undefined;
    await flushMicrotasks();
    expect(subscriber).toHaveBeenCalledTimes(1);
    expect(asyncAtom.state.promise).toBeUndefined();
    expect(asyncAtom.state.error).toEqual(new Error("Value exceeds 11: 12"));
    expect(asyncAtom.state.value).toBe(11); // The value remains the same until the next successful get.

    // Second error
    atom.set(inc);
    expect(subscriber).toHaveBeenCalledTimes(1);

    // waiting resolve
    await flushMicrotasks();
    expect(subscriber).toHaveBeenCalledTimes(1);
    expect(resolve).toBeDefined();
    expect(asyncAtom.state.promise).toBeDefined();

    resolve!();
    resolve = undefined;
    await flushMicrotasks();
    expect(subscriber).toHaveBeenCalledTimes(1);
    expect(asyncAtom.state.promise).toBeUndefined();
    expect(asyncAtom.state.error).toEqual(new Error("Value exceeds 11: 13"));
    expect(asyncAtom.state.value).toBe(11); // The value remains the same until the next successful get.

    // Recovery
    atom.set(0);
    await flushMicrotasks();
    expect(resolve).toBeDefined();
    expect(asyncAtom.state.promise).toBeDefined();

    resolve!();
    resolve = undefined;
    await flushMicrotasks();
    expect(subscriber).toHaveBeenCalledTimes(2);
    expect(subscriber).toHaveBeenLastCalledWith(10, expect.anything());
    expect(asyncAtom.state.promise).toBeUndefined();
    expect(asyncAtom.state.error).toBeUndefined();
    expect(asyncAtom.state.value).toBe(10);
  });
  
  it("sync atom (children)", async () => {
    captureQueuedErrors();

    const atom = $(1);
    const derivedAtom1 = $((get) => {
      get(atom);
      throw new Error(`Error in derivedAtom1`);
    });
    const derivedAtom2 = $((get) => {
      get(derivedAtom1);
      throw new Error(`Error in derivedAtom2`);
    });

    expect(() => derivedAtom2.get()).toThrowError("Error in derivedAtom1");
  });
  
  it("async atom (children)", async () => {
    captureQueuedErrors();

    const atom = $(1);
    const derivedAtom1 = $(async (get) => {
      get(atom);
      throw new Error(`Error in derivedAtom1`);
    });
    const derivedAtom2 = $(async (get) => {
      get(derivedAtom1);
      throw new Error(`Error in derivedAtom2`);
    });
    const derivedAtom3 = $((get) => {
      get(derivedAtom1);
      throw new Error(`Error in derivedAtom3`);
    });

    derivedAtom2.subscribe(() => {});
    derivedAtom3.subscribe(() => {});
    await flushMicrotasks();
    await flushMicrotasks();
    await flushMicrotasks();
    await flushMicrotasks();
    expect(derivedAtom1.state.promise).toBeUndefined();
    expect(derivedAtom1.state.error).toEqual(new Error("Error in derivedAtom1"));
    expect(derivedAtom2.state.promise).toBeUndefined();
    expect(derivedAtom2.state.error).toEqual(new Error("Error in derivedAtom1"));
    expect(derivedAtom3.state.promise).toBeUndefined();
    expect(derivedAtom3.state.error).toEqual(new Error("Error in derivedAtom1"));
  });
});
