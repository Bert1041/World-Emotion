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

  it("?votes=N is a whole number of check-ins, or nothing", () => {
    expect(cfg("").votes).toBeUndefined();
    expect(cfg("votes=0").votes).toBe(0);
    expect(cfg("votes=4").votes).toBe(4);
    expect(cfg("votes=-1").votes).toBeUndefined();
    expect(cfg("votes=2.5").votes).toBeUndefined();
    expect(cfg("votes=lots").votes).toBeUndefined();
  });

  it("?auto=0 and bench runs both stop the demo from cycling", () => {
    expect(cfg("auto=0").autoCycle).toBe(false);
    expect(cfg("bench=1").autoCycle).toBe(false);
    expect(cfg("bench=1").bench).toBe(true);
  });
});

describe("live: which data the app shows (Phase 6)", () => {
  const env = {
    VITE_SNAPSHOT_URL: "https://cdn.example/snapshot.json",
    VITE_API_URL: "https://api.example",
  };
  const live = (q: string, host: string, e: typeof env | Record<string, never> = {}) =>
    readConfig(new URLSearchParams(q), { host, env: e }).live;

  it("the demo when the build names no endpoints", () => {
    expect(live("", "world-emotion.example")).toBeNull();
  });
  it("the build's endpoints when it has them", () => {
    expect(live("", "world-emotion.example", env)).toEqual({
      snapshotUrl: env.VITE_SNAPSHOT_URL,
      apiUrl: env.VITE_API_URL,
    });
  });
  it("?demo=1 and bench runs always use the demo", () => {
    expect(live("demo=1", "world-emotion.example", env)).toBeNull();
    expect(live("bench=1", "world-emotion.example", env)).toBeNull();
  });
  it("?live= points a page on this machine at a local API", () => {
    expect(live("live=http://127.0.0.1:8788", "127.0.0.1")).toEqual({
      snapshotUrl: "http://127.0.0.1:8788/snapshot.json",
      apiUrl: "http://127.0.0.1:8788",
    });
    expect(live("live=http://localhost:8787", "localhost")).not.toBeNull();
  });
  it("?live= is ignored on the real site, and never points anywhere but this machine", () => {
    // A link to the real site must not be able to show a made-up world.
    expect(live("live=http://127.0.0.1:8788", "world-emotion.example", env)?.apiUrl).toBe(
      env.VITE_API_URL,
    );
    expect(live("live=https://evil.example", "localhost")).toBeNull();
    expect(live("live=not a url", "localhost")).toBeNull();
  });
});

describe("demo cadence", () => {
  it("one run every 2 s unless ?step= says otherwise, never faster than 100 ms", () => {
    expect(cfg("").demoStepMs).toBe(2000);
    expect(cfg("step=600000").demoStepMs).toBe(600000);
    expect(cfg("step=1").demoStepMs).toBe(100);
  });
});
