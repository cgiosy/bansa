import { afterEach, vi } from "vitest";

export const flushMicrotasks = () =>
  new Promise((resolve) => {
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = resolve;
    port2.postMessage(null);
  });
export const wait = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 4);
  });

export const inc = (x: number) => x + 1;
export const dec = (x: number) => x - 1;
export const nop = () => {};
export const nops = (): (() => void)[] => [];
