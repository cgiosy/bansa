import { describe, expect, it } from "vitest";
import { $, isAtom } from "../src/atom.ts";
import { $$, atomize, collectAtoms, setAtoms } from "../src/utils.ts";

describe("utils", () => {
  it("only traverses own enumerable keys", () => {
    const proto = { inherited: 1 };
    const tree = Object.create(proto) as { own: number; inherited: number };
    tree.own = 2;

    const atomized = atomize(tree);
    expect(isAtom(atomized.own)).toBe(true);
    expect("inherited" in atomized).toBe(false);

    const collected = collectAtoms({ own: $(2), __proto__: { inherited: $(1) } });
    expect(collected).toEqual({ own: 2 });
    expect("inherited" in collected).toBe(false);
  });

  it("allows partial nested updates", async () => {
    const tree = {
      nested: {
        count: $(0),
        label: $("old"),
      },
    };

    setAtoms(tree, { nested: { count: 1 } });
    await Promise.resolve();

    expect(tree.nested.count.get()).toBe(1);
    expect(tree.nested.label.get()).toBe("old");

    expect(() => setAtoms(tree, {})).not.toThrow();
  });

  it("does not treat inherited keys as equal shallow keys", async () => {
    const step = $(0);
    const inherited = Object.create({ value: 1 });
    const own = { value: 1 };
    const atom = $$((get) => (get(step) === 0 ? inherited : own));
    const values: unknown[] = [];

    atom.subscribe((value) => values.push(value));
    await Promise.resolve();

    step.set(1);
    await Promise.resolve();

    expect(values).toEqual([inherited, own]);
  });
});
