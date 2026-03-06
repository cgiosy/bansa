import { $ } from "../src/index.ts";
import { useAtom } from "../src/react.tsx";

const countAtom = $(0);

export const TypecheckComponent = () => {
  const [, setCount] = useAtom(countAtom);
  setCount((count) => count + 1);
  return null;
};
