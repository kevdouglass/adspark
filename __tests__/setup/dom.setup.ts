/**
 * DOM test setup — runs once per DOM-project test file before the
 * file's tests execute.
 *
 * 1. Imports `@testing-library/jest-dom/vitest` so matchers like
 *    `.toBeInTheDocument()`, `.toHaveClass()`, `.toBeDisabled()` are
 *    augmented onto vitest's `expect`.
 *
 * 2. Registers an `afterEach` cleanup that unmounts every component
 *    rendered by `@testing-library/react` during the previous test.
 *    Without this, mounted trees leak into the next test and cause
 *    duplicate-query failures (e.g. two buttons with the same label).
 */

import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
