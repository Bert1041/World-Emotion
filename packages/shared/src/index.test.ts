import { describe, expect, it } from "vitest";
import { PACKAGE_NAME } from "./index";

describe("@world-emotion/shared harness", () => {
  it("is wired into the workspace test run", () => {
    expect(PACKAGE_NAME).toBe("@world-emotion/shared");
  });
});
