import { describe, it } from "vitest";
import { $ } from "../src/atom.ts";
import type { AtomState, AtomSuccessState } from "../src/atom.ts";
import { useAtomState } from "../src/react.tsx";

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
});
