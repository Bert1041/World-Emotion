import { describe, expect, it } from "vitest";
import { hexToOklab, mixOklab, oklabToCss } from "./oklab";

const hex = (css: string) => {
  const [r, g, b] = (css.match(/\d+/g) ?? []).map(Number);
  return `#${[r, g, b].map((v) => (v ?? 0).toString(16).padStart(2, "0")).join("")}`;
};

describe("OKLab", () => {
  it("matches Ottosson's reference values", () => {
    const close = (a: readonly number[], b: readonly number[]) => {
      for (const [i, v] of a.entries()) expect(v).toBeCloseTo(b[i] as number, 3);
    };
    close(hexToOklab("#ffffff"), [1, 0, 0]);
    close(hexToOklab("#ff0000"), [0.62796, 0.22486, 0.12585]);
    close(hexToOklab("#0000ff"), [0.45201, -0.03246, -0.31153]);
  });

  it("round-trips sRGB colours exactly", () => {
    for (const c of ["#000000", "#ffffff", "#7fd6e0", "#05070a", "#f4efe6", "#3d8a5c", "#c23b22"])
      expect(hex(oklabToCss(hexToOklab(c)))).toBe(c);
  });

  it("mixes perceptually: black↔white midpoint is L = 0.5, not sRGB 50%", () => {
    const mid = mixOklab(hexToOklab("#000000"), hexToOklab("#ffffff"), 0.5);
    expect(mid[0]).toBeCloseTo(0.5, 6); // white is L = 0.99999999 at the matrices' precision
    expect(oklabToCss(mid)).toBe("rgb(99,99,99)");
  });

  it("emits rgba only when translucent", () => {
    expect(oklabToCss(hexToOklab("#ffffff"), 0.5)).toBe("rgba(255,255,255,0.5)");
  });
});
