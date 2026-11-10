import { describe, expect, it } from "vitest";
import { readConfig } from "./config";

const cfg = (q: string) => readConfig(new URLSearchParams(q));

describe("readConfig", () => {
  it("has the production defaults with no parameters", () => {
    const c = cfg("");
    expect(c).toMatchObject({
      bench: false,
      particles: 700,
      dragLod: "move",
      moveKeep: 0.25,
      dprCap: 2,
      debug: false,
      benchRipple: false,
      dev: false,
      autoCycle: true,
    });
    expect([...c.opt]).toEqual(["precision0", "cull"]);
  });

  it("reads numbers only when present and finite", () => {
    expect(cfg("particles=0").particles).toBe(0);
    expect(cfg("particles=abc").particles).toBe(700);
    expect(cfg("dpr=1.5").dprCap).toBe(1.5);
  });

  it("accepts only known map names for dragLod", () => {
    expect(cfg("dragLod=110m").dragLod).toBe("110m");
    expect(cfg("dragLod=50m").dragLod).toBe("50m");
    expect(cfg("dragLod=huge").dragLod).toBe("move");
  });

  it("parses the optimisation list, dropping empties", () => {
    expect([...cfg("opt=cull,,nonight").opt]).toEqual(["cull", "nonight"]);
    expect([...cfg("opt=").opt]).toEqual([]);
  });

  it("?auto=0 and bench runs both stop the demo from cycling", () => {
    expect(cfg("auto=0").autoCycle).toBe(false);
    expect(cfg("bench=1").autoCycle).toBe(false);
    expect(cfg("bench=1").bench).toBe(true);
  });
});
