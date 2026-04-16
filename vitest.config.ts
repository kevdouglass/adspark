import { defineConfig } from "vitest/config";
import path from "path";

/**
 * Two test projects sharing the same `@` alias but running in different
 * environments:
 *
 *   - "node": existing pipeline / API / pure-logic tests. Fast, no DOM
 *     overhead. Matches `__tests__/** / *.test.ts` EXCEPT files that end
 *     in `.dom.test.ts` / `.dom.test.tsx`.
 *
 *   - "dom":  React component tests + DOM-dependent hook tests. Boots
 *     happy-dom per file (≈50 ms startup). Matches files that end in
 *     `.dom.test.ts` / `.dom.test.tsx`, loads the shared `dom.setup.ts`
 *     which wires up @testing-library/jest-dom matchers + per-test
 *     cleanup, and uses the React 17+ automatic JSX runtime so test
 *     files don't need to `import React from "react"` explicitly.
 *
 * The naming convention (`.dom.test.*`) is load-bearing: the node
 * project's `exclude` pattern is how we prevent pipeline tests from
 * booting happy-dom they do not need.
 *
 * If you add a future React test, name it `*.dom.test.tsx`. If you add
 * a future pipeline test, name it `*.test.ts` as before.
 */

const alias = {
  "@": path.resolve(__dirname, "."),
};

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          globals: true,
          environment: "node",
          include: ["__tests__/**/*.test.ts"],
          exclude: [
            "__tests__/**/*.dom.test.ts",
            "__tests__/**/*.dom.test.tsx",
            "**/node_modules/**",
          ],
        },
        resolve: { alias },
      },
      {
        test: {
          name: "dom",
          globals: true,
          environment: "happy-dom",
          include: [
            "__tests__/**/*.dom.test.ts",
            "__tests__/**/*.dom.test.tsx",
          ],
          setupFiles: ["./__tests__/setup/dom.setup.ts"],
        },
        resolve: { alias },
        // tsconfig.json has `jsx: "preserve"` because Next.js owns the
        // JSX transform at build time. Vitest goes through esbuild
        // directly and must be told to use React 17+ automatic JSX
        // runtime, otherwise every .tsx test throws
        // `ReferenceError: React is not defined`.
        esbuild: {
          jsx: "automatic",
        },
      },
    ],
  },
});
