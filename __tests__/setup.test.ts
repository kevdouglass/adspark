import { describe, it, expect } from "vitest";
import { ASPECT_RATIO_CONFIG, VALID_SEASONS } from "@/lib/pipeline/types";

describe("Vitest setup verification", () => {
  it("runs a basic assertion", () => {
    expect(1 + 1).toBe(2);
  });

  it("resolves @/ path aliases to project root", () => {
    // If this test runs, path aliases are working —
    // the imports at the top would fail otherwise.
    expect(VALID_SEASONS).toContain("summer");
    expect(ASPECT_RATIO_CONFIG["1:1"].width).toBe(1080);
  });
});
