import { describe, expect, it } from "vitest";
import { type HeadlineState, nextHeadline } from "./hysteresis";

const CFG = { margin: 0.03, streak: 2 };
/** happy=0 vs calm=1 split; the rest share what's left evenly. */
const d = (happy: number, calm: number) => {
  const rest = (1 - happy - calm) / 4;
  return [happy, calm, rest, rest, rest, rest];
};
const holding = (headline: 0 | 1): HeadlineState => ({ headline, challenger: null, streak: 0 });

describe("nextHeadline", () => {
  it("takes the leader when there is no history", () => {
    expect(nextHeadline(d(0.2, 0.4), undefined, CFG)).toEqual(holding(1));
  });

  it("keeps the headline on an exact tie", () => {
    expect(nextHeadline(d(0.4, 0.4), holding(0), CFG)).toEqual(holding(0));
  });

  it("never flips on a sustained exact tie, even when the headline is not the lowest id", () => {
    // Without preferring the current headline, a tie would hand the lead to happy (id 0) and
    // the streak rule would flip calm → happy after two snapshots of a dead heat.
    const s1 = nextHeadline(d(0.4, 0.4), holding(1), CFG);
    const s2 = nextHeadline(d(0.4, 0.4), s1, CFG);
    expect(s2).toEqual(holding(1));
  });

  it("does not flip on a near-tie under the margin (first snapshot)", () => {
    expect(nextHeadline(d(0.4, 0.42), holding(0), CFG)).toEqual({
      headline: 0,
      challenger: 1,
      streak: 1,
    });
  });

  it("flips immediately when the lead reaches the margin", () => {
    expect(nextHeadline(d(0.4, 0.43), holding(0), CFG)).toEqual(holding(1));
  });

  it("flips at exactly the margin despite float noise", () => {
    // 0.43 - 0.40 is 0.029999999999999971 in IEEE 754.
    expect(nextHeadline(d(0.4, 0.43), holding(0), CFG).headline).toBe(1);
  });

  it("flips when the same challenger leads two snapshots in a row", () => {
    const s1 = nextHeadline(d(0.4, 0.41), holding(0), CFG);
    const s2 = nextHeadline(d(0.4, 0.41), s1, CFG);
    expect(s1.headline).toBe(0);
    expect(s2).toEqual(holding(1));
  });

  it("resets the streak when the headline retakes the lead", () => {
    const s1 = nextHeadline(d(0.4, 0.41), holding(0), CFG);
    const s2 = nextHeadline(d(0.42, 0.4), s1, CFG);
    const s3 = nextHeadline(d(0.4, 0.41), s2, CFG);
    expect(s2).toEqual(holding(0));
    expect(s3).toEqual({ headline: 0, challenger: 1, streak: 1 });
  });

  it("restarts the count when a different challenger takes over", () => {
    const calmLeads = nextHeadline(d(0.3, 0.31), holding(0), CFG);
    const excitedLeads = nextHeadline([0.3, 0.29, 0.31, 0.04, 0.03, 0.03], calmLeads, CFG);
    expect(excitedLeads).toEqual({ headline: 0, challenger: 2, streak: 1 });
  });

  it("follows a sudden spike at once", () => {
    expect(nextHeadline(d(0.1, 0.8), holding(0), CFG)).toEqual(holding(1));
  });

  it("respects a configured streak of 1 (no stickiness beyond the margin)", () => {
    expect(nextHeadline(d(0.4, 0.41), holding(0), { margin: 0.03, streak: 1 })).toEqual(holding(1));
  });
});
