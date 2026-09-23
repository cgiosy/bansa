import { Suspense } from "react";
import { prerender } from "react-dom/static";
import { describe, expect, it } from "vitest";
import { $ } from "../src/index.ts";
import { useAtomValue } from "../src/react.tsx";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const html = async (node: React.ReactNode) => {
  const { prelude } = await prerender(node);
  return new Response(prelude).text();
};

describe("useAtomValue with an inactive async atom", () => {
  it("suspends once, then renders the value without computing it again", async () => {
    let runs = 0;
    const atom = $(async () => {
      runs++;
      await wait(20);
      return "loaded";
    });
    const Value = () => <p>{useAtomValue(atom)}</p>;
    const result = await Promise.race([
      html(
        <Suspense fallback="loading">
          <Value />
        </Suspense>,
      ),
      wait(2000).then(() => "timed out"),
    ]);
    expect(result).toContain("loaded");
    expect(runs).toBe(1);
  });
});
