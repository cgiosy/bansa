import { describe, expect, it, vi } from "vitest";
import { $ } from "../src/index.ts";
import { flushMicrotasks, inc } from "./bansa-test-lib.ts";

describe("Atom Library - Basic Tests", () => {
  it("primitive atom (batch updates)", async () => {
    const atom = $(1);
    expect(atom.get()).toBe(1);

    // The update occurs in the next microtask. This is the behavior of batch updates.
    atom.set(inc);
    expect(atom.get()).toBe(1);

    await flushMicrotasks();
    expect(atom.get()).toBe(2);

    atom.set(inc);
    expect(atom.get()).toBe(2);

    await flushMicrotasks();
    expect(atom.get()).toBe(3);

    // If multiple updates occur before the next microtask, only the last update should be applied.
    for (let i = 1; i <= 10; i++) atom.set(i);
    expect(atom.get()).toBe(3);

    await flushMicrotasks();
    expect(atom.get()).toBe(10);
  });

  it("derived atom (refresh)", async () => {
    let outer = 1;
    const derivedAtom1 = $(() => outer + 10);
    expect(derivedAtom1.get()).toBe(11);
    
    outer = 2;
    derivedAtom1.refresh();
    await flushMicrotasks();
    expect(derivedAtom1.get()).toBe(12);
  });

  it("derived atom (batch updates)", async () => {
    const atom = $(1);
    const derivedAtom1 = $((get) => get(atom) + 10);
    const derivedAtom2 = $((get) => get(derivedAtom1) + 100);
    expect(derivedAtom2.get()).toBe(111);

    // The update occurs in the next microtask. This is the behavior of batch updates.
    atom.set(inc);
    expect(derivedAtom2.get()).toBe(111);

    await flushMicrotasks();
    expect(derivedAtom2.get()).toBe(112);

    atom.set(inc);
    expect(derivedAtom2.get()).toBe(112);

    await flushMicrotasks();
    expect(derivedAtom2.get()).toBe(113);

    // If multiple updates occur before the next microtask, only the last update should be applied.
    for (let i = 1; i <= 10; i++) atom.set(i);
    expect(derivedAtom2.get()).toBe(113);

    await flushMicrotasks();
    expect(derivedAtom2.get()).toBe(120);
  });

  it("primitive atom subscribe (batch updates)", async () => {
    const atom = $(1);
    const mockFn = vi.fn();
    atom.subscribe(mockFn);

    // Primitive atoms should trigger updates to subscribers immediately.
    expect(mockFn).toHaveBeenCalledTimes(1);
    expect(mockFn).toHaveBeenCalledWith(1, expect.anything());

    // The update occurs in the next microtask. This is the behavior of batch updates.
    atom.set(inc);
    expect(mockFn).toHaveBeenCalledTimes(1);

    await flushMicrotasks();
    expect(mockFn).toHaveBeenCalledTimes(2);
    expect(mockFn).toHaveBeenCalledWith(2, expect.anything());

    atom.set(inc);
    expect(mockFn).toHaveBeenCalledTimes(2);

    await flushMicrotasks();
    expect(mockFn).toHaveBeenCalledTimes(3);
    expect(mockFn).toHaveBeenCalledWith(3, expect.anything());

    // If multiple updates occur before the next microtask, only the last update should be applied.
    for (let i = 1; i <= 10; i++) atom.set(i);
    expect(mockFn).toHaveBeenCalledTimes(3);

    await flushMicrotasks();
    expect(mockFn).toHaveBeenCalledTimes(4);
    expect(mockFn).toHaveBeenCalledWith(10, expect.anything());
  });

  it("derived atom subscribe", async () => {
    const atom = $(1);
    const derivedAtom = $((get) => get(atom) + 10);
    const mockFn = vi.fn();
    const mockFn2 = vi.fn();
    derivedAtom.subscribe(mockFn);

    // Inactive derived atoms should not trigger updates to subscribers immediately.
    expect(mockFn).toHaveBeenCalledTimes(0);

    await flushMicrotasks();
    expect(mockFn).toHaveBeenCalledTimes(1);
    expect(mockFn).toHaveBeenCalledWith(11, expect.anything());

    // Subscribing to an already active derived atom should trigger an immediate update to the new subscriber.
    derivedAtom.subscribe(mockFn2);
    expect(mockFn2).toHaveBeenCalledTimes(1);
    expect(mockFn2).toHaveBeenCalledWith(11, expect.anything());

    atom.set(inc);
    expect(mockFn).toHaveBeenCalledTimes(1);

    await flushMicrotasks();
    expect(mockFn).toHaveBeenCalledTimes(2);
    expect(mockFn).toHaveBeenCalledWith(12, expect.anything());
  });

  it("derived atom subscribe (batch updates)", async () => {
    const atom = $(1);
    const derivedAtom = $((get) => get(atom) + 10);
    const mockFn = vi.fn();
    const mockFn2 = vi.fn();
    derivedAtom.subscribe(mockFn);

    // Inactive derived atoms should not trigger updates to subscribers immediately.
    expect(mockFn).toHaveBeenCalledTimes(0);

    // The update occurs in the next microtask. This is the behavior of batch updates.
    atom.set(inc);
    expect(mockFn).toHaveBeenCalledTimes(0);

    await flushMicrotasks();
    expect(mockFn).toHaveBeenCalledTimes(1);
    expect(mockFn).toHaveBeenCalledWith(12, expect.anything());

    // Subscribing to an already active derived atom should trigger an immediate update to the new subscriber.
    derivedAtom.subscribe(mockFn2);
    expect(mockFn2).toHaveBeenCalledTimes(1);
    expect(mockFn2).toHaveBeenCalledWith(12, expect.anything());

    atom.set(inc);
    expect(mockFn).toHaveBeenCalledTimes(1);

    await flushMicrotasks();
    expect(mockFn).toHaveBeenCalledTimes(2);
    expect(mockFn).toHaveBeenCalledWith(13, expect.anything());

    // If multiple updates occur before the next microtask, only the last update should be applied.
    for (let i = 1; i <= 10; i++) atom.set(i);
    expect(mockFn).toHaveBeenCalledTimes(2);

    await flushMicrotasks();
    expect(mockFn).toHaveBeenCalledTimes(3);
    expect(mockFn).toHaveBeenCalledWith(20, expect.anything());
  });

  it("async atom", async () => {
    const atom = $(1);

    let resolve: ((value?: unknown) => void) | undefined;
    const asyncAtom = $(async (get) => {
      const value = get(atom);
      await new Promise((res) => {
        resolve = res;
      });
      return value + 10;
    });

    const mockFn = vi.fn();
    asyncAtom.subscribe(mockFn);

    // The update occurs in the next microtask. This is the behavior of batch updates.
    expect(resolve).toBeUndefined();
    expect(asyncAtom.state.promise).toBeUndefined();
    expect(mockFn).toHaveBeenCalledTimes(0);

    // Initializer called and promise is pending.
    await flushMicrotasks();
    expect(resolve).toBeDefined();
    expect(asyncAtom.state.promise).toBeDefined();
    expect(mockFn).toHaveBeenCalledTimes(0);

    resolve!();
    await flushMicrotasks();
    expect(asyncAtom.state.promise).toBeUndefined();
    expect(mockFn).toHaveBeenCalledTimes(1);
    expect(asyncAtom.state.value).toBe(11);

    // Update dependency and check if it triggers the async atom again.
    resolve = undefined;
    atom.set(2);
    // The update occurs in the next microtask. This is the behavior of batch updates.
    expect(resolve).toBeUndefined();
    expect(asyncAtom.state.promise).toBeUndefined();
    expect(mockFn).toHaveBeenCalledTimes(1);

    await flushMicrotasks();
    expect(resolve).toBeDefined();
    expect(asyncAtom.state.promise).toBeDefined();
    expect(mockFn).toHaveBeenCalledTimes(1);

    resolve!();
    await flushMicrotasks();
    expect(asyncAtom.state.promise).toBeUndefined();
    expect(mockFn).toHaveBeenCalledTimes(2);
    expect(asyncAtom.state.value).toBe(12);
  });

  it("async atom with multiple dependencies (batch updates)", async () => {
    const atom1 = $(1);
    const atom2 = $(10);
    const atom3 = $(100);

    let resolve: ((value?: unknown) => void) | undefined;
    const asyncAtom = $(async (get) => {
      const value1 = get(atom1);
      const value2 = get(atom2);
      const value3 = get(atom3);
      await new Promise((res) => {
        resolve = res;
      });
      return value1 + value2 + value3;
    });

    const mockFn = vi.fn();
    asyncAtom.subscribe(mockFn);

    // The update occurs in the next microtask. This is the behavior of batch updates.
    expect(resolve).toBeUndefined();
    expect(asyncAtom.state.promise).toBeUndefined();
    expect(mockFn).toHaveBeenCalledTimes(0);

    // Initializer called and promise is pending.
    await flushMicrotasks();
    expect(resolve).toBeDefined();
    expect(asyncAtom.state.promise).toBeDefined();
    expect(mockFn).toHaveBeenCalledTimes(0);

    resolve!();
    await flushMicrotasks();
    expect(asyncAtom.state.promise).toBeUndefined();
    expect(mockFn).toHaveBeenCalledTimes(1);
    expect(asyncAtom.state.value).toBe(111);

    // Update dependencies and check if it triggers the async atom again.
    resolve = undefined;
    atom1.set(2);
    atom2.set(20);
    atom3.set(200);
    // The update occurs in the next microtask. This is the behavior of batch updates.
    expect(resolve).toBeUndefined();
    expect(asyncAtom.state.promise).toBeUndefined();
    expect(mockFn).toHaveBeenCalledTimes(1);

    await flushMicrotasks();
    expect(resolve).toBeDefined();
    expect(asyncAtom.state.promise).toBeDefined();
    expect(mockFn).toHaveBeenCalledTimes(1);

    resolve!();
    await flushMicrotasks();
    expect(asyncAtom.state.promise).toBeUndefined();
    expect(mockFn).toHaveBeenCalledTimes(2);
    expect(asyncAtom.state.value).toBe(222);
  });
});
