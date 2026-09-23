import { describe, it } from "vitest";
import { $ } from "../src/atom.ts";
import type { AtomState, AtomSuccessState, PrimitiveAtom } from "../src/atom.ts";
import { useAtomState, useAtomValue } from "../src/react.tsx";

describe("react types", () => {
  it("useAtomState accepts primitive atoms", () => {
    const atom = $(0);
    const Component = () => {
      const state = useAtomState(atom);
      state satisfies AtomSuccessState<number>;
      state.value satisfies number;
      return null;
    };

    void Component;
  });

  it("useAtomState returns atom state for derived atoms", () => {
    const atom = $(() => 0);
    const Component = () => {
      const state = useAtomState(atom);
      state satisfies AtomState<number>;
      return null;
    };

    void Component;
  });

  it("hooks and get accept a narrower placeholder where they only read", () => {
    const $none = $<never[]>([]);
    const $count = $(() => 1);
    const Component = ({ list }: { list: PrimitiveAtom<number[]> | null }) => {
      const state = useAtomState(list ?? $none);
      state satisfies AtomState<number[]>;
      const value = useAtomValue(list ?? $none);
      value satisfies number[];
      return null;
    };
    const $length = $((get) => get($none).length + get($count));
    $length satisfies { get: () => number };

    void Component;
  });
});
