import { describe, expect, it } from "vitest";
import { type FlagStore, firstTime } from "./hints";

const memory = (): FlagStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};

describe("firstTime", () => {
  it("is true once per key, then false, and leaves the flag behind", () => {
    const s = memory();
    expect(firstTime("a", s)).toBe(true);
    expect(firstTime("a", s)).toBe(false);
    expect(firstTime("b", s), "keys are independent").toBe(true);
    expect([...s.data.keys()].sort()).toEqual(["a", "b"]);
  });

  it("with no storage, or storage that throws, it is always the first time", () => {
    expect(firstTime("a", null)).toBe(true);
    expect(firstTime("a", null)).toBe(true);
    const broken: FlagStore = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(firstTime("a", broken)).toBe(true);
    expect(firstTime("a", broken)).toBe(true);
  });
});
