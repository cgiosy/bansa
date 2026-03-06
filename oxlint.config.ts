import { defineConfig } from "oxlint";

export default defineConfig({
  plugins: ["react", "jsx-a11y"],
  rules: {
    "no-ex-assign": ["off"],
    "no-unused-vars": [
      "warn",
      {
        args: "none",
        vars: "all",
        varsIgnorePattern: "^_",
        caughtErrors: "none",
      },
    ],
  },
});
