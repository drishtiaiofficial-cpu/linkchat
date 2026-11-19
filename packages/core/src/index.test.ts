import { describe, it, expect } from "vitest";
import { clampGap } from "./index";
describe("safety floor", () => {
  it("never goes below 15s", () => { expect(clampGap(1)).toBe(15); });
  it("keeps higher values", () => { expect(clampGap(20)).toBe(20); });
});
