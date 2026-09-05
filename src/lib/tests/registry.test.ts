import { describe, expect, test } from "bun:test";

import { LruCache } from "../../brain/lru.utils.js";
import { brainSnapshots, registerBrainCache } from "../../brain/registry.utils.js";

describe("brain registry", () => {
  test("aggregates registered snapshots under their names", () => {
    const cache = new LruCache<string, number>(4);
    cache.set("k", 1);
    registerBrainCache("registry-test.alpha", () => cache.stats());
    registerBrainCache("registry-test.beta", () => ({ marks: 7 }));
    const snapshots = brainSnapshots();
    const alpha = snapshots["registry-test.alpha"] as { sets: number };
    expect(alpha.sets).toBe(1);
    expect(snapshots["registry-test.beta"]).toEqual({ marks: 7 });
  });

  test("rejects duplicate names", () => {
    registerBrainCache("registry-test.dup", () => ({}));
    expect(() => registerBrainCache("registry-test.dup", () => ({}))).toThrow(
      /already registered/u,
    );
  });

  test("a failing provider cannot break the whole snapshot pass", () => {
    registerBrainCache("registry-test.boom", () => {
      throw new Error("boom");
    });
    const snapshots = brainSnapshots();
    expect(snapshots["registry-test.boom"]).toEqual({ error: "snapshot failed" });
  });
});
