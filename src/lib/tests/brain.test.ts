import { describe, expect, test } from "bun:test";

import { GroupCounter } from "@/brain/group.utils";
import { LruCache } from "@/brain/lru.utils";
import { Memoize } from "@/brain/memo.utils";
import { RingBuffer } from "@/brain/ring.utils";

interface TestGroup {
  count: number;
  tag: string;
}

// Module scope keeps the constant-returning helper out of function-scoping
// lint while staying literal about what Memoize must not cache.
const returnUndefined = (): string | undefined => undefined;

describe("brain edge capacities", () => {
  test("capacity zero is clamped to one in every structure", () => {
    const lru = new LruCache<string, number>(0);
    lru.set("a", 1);
    lru.set("b", 2);
    expect(lru.size).toBe(1);
    expect(lru.get("a")).toBeUndefined();
    expect(lru.get("b")).toBe(2);

    const ring = new RingBuffer<number>(0);
    for (const value of [1, 2]) ring.push(value);
    expect(ring.toArray()).toEqual([2]);
    expect(ring.stats().overwritten).toBe(1);

    const memo = new Memoize<string, number>(0);
    let n = 0;
    const fn = (): number => {
      n += 1;
      return n;
    };
    memo.call("a", fn);
    memo.call("b", fn);
    expect(memo.stats().size).toBe(1);
    expect(memo.call("b", fn)).toBe(2);

    const groups = new GroupCounter<string, TestGroup>(0);
    groups.start("a", { count: 1, tag: "a" });
    groups.start("b", { count: 1, tag: "b" });
    expect(groups.size).toBe(1);
    expect(groups.take("a")).toBeUndefined();
    expect(groups.take("b")?.tag).toBe("b");
  });

  test("an eviction callback that touches the same cache cannot corrupt state", () => {
    const seen: string[] = [];
    const cache = new LruCache<string, number>(2, (key) => {
      seen.push(key);
      cache.delete(key);
      if (cache.size !== 1) throw new Error("cache mutated mid-eviction");
    });
    cache.set("pending", 9);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    expect(seen).toEqual(["pending", "a"]);
    expect(cache.keys()).toEqual(["b", "c"]);
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
    expect(cache.stats().evictions).toBe(2);
  });
});

describe("GroupCounter", () => {
  test("absorb reports misses and bumps the count of existing groups", () => {
    const groups = new GroupCounter<string, TestGroup>(10);
    expect(groups.absorb("a")).toBe(false);
    groups.start("a", { count: 1, tag: "first" });
    expect(groups.absorb("a")).toBe(true);
    expect(groups.absorb("a")).toBe(true);
    expect(groups.take("a")?.count).toBe(3);
  });

  test("take removes the group so a later absorb misses", () => {
    const groups = new GroupCounter<string, TestGroup>(10);
    groups.start("a", { count: 1, tag: "x" });
    expect(groups.take("a")?.tag).toBe("x");
    expect(groups.take("a")).toBeUndefined();
    expect(groups.absorb("a")).toBe(false);
    expect(groups.size).toBe(0);
  });

  test("drain visits every group oldest-first and empties the counter", () => {
    const groups = new GroupCounter<string, TestGroup>(10);
    for (const tag of ["a", "b", "c"]) groups.start(tag, { count: 2, tag });
    const visited: string[] = [];
    groups.drain((group) => {
      visited.push(group.tag);
      group.count += 1;
    });
    expect(visited).toEqual(["a", "b", "c"]);
    expect(groups.size).toBe(0);
    expect(groups.absorb("a")).toBe(false);
  });

  test("onEvict reports dropped groups at capacity", () => {
    const evicted: string[] = [];
    const groups = new GroupCounter<string, TestGroup>(1, (key) => {
      evicted.push(key);
    });
    groups.start("a", { count: 1, tag: "a" });
    groups.start("b", { count: 1, tag: "b" });
    expect(evicted).toEqual(["a"]);
  });
});

describe("LruCache", () => {
  test("evicts the least-recently-used entry at capacity", () => {
    const cache = new LruCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
  });

  test("get bumps recency so the entry survives eviction", () => {
    const cache = new LruCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.get("a");
    cache.set("c", 3);
    expect(cache.get("a")).toBe(1);
    expect(cache.get("b")).toBeUndefined();
  });

  test("onEvict reports the dropped key and value", () => {
    const evicted: [string, number][] = [];
    const cache = new LruCache<string, number>(1, (key, value) => {
      evicted.push([key, value]);
    });
    cache.set("a", 1);
    cache.set("b", 2);
    expect(evicted).toEqual([["a", 1]]);
  });
});

describe("Memoize", () => {
  test("computes once per key", () => {
    const memo = new Memoize<string, number>();
    let calls = 0;
    const fn = (): number => {
      calls += 1;
      return calls;
    };
    expect(memo.call("x", fn)).toBe(1);
    expect(memo.call("x", fn)).toBe(1);
    expect(memo.call("y", fn)).toBe(2);
  });

  test("evicts the oldest entry at capacity", () => {
    const memo = new Memoize<string, number>(2);
    let n = 0;
    const fn = (): number => {
      n += 1;
      return n;
    };
    memo.call("a", fn);
    memo.call("b", fn);
    // capacity 2: inserting "c" evicts "a" (oldest), so it recomputes.
    memo.call("c", fn);
    expect(memo.call("a", fn)).toBe(4);
  });

  test("recomputes undefined results instead of caching them", () => {
    const memo = new Memoize<string, string | undefined>();
    let calls = 0;
    const fn = (): string | undefined => {
      calls += 1;
      return undefined;
    };
    expect(memo.call("x", fn)).toBeUndefined();
    expect(memo.call("x", fn)).toBeUndefined();
    expect(calls).toBe(2);
  });
});

describe("RingBuffer", () => {
  test("returns values in insertion order", () => {
    const ring = new RingBuffer<number>(3);
    for (const value of [1, 2, 3]) ring.push(value);
    expect(ring.toArray()).toEqual([1, 2, 3]);
    expect(ring.size).toBe(3);
  });

  test("drops the oldest value when full", () => {
    const ring = new RingBuffer<number>(2);
    for (const value of [1, 2, 3]) ring.push(value);
    expect(ring.toArray()).toEqual([2, 3]);
  });

  test("clear empties the buffer", () => {
    const ring = new RingBuffer<number>(2);
    ring.push(1);
    ring.clear();
    expect(ring.toArray()).toEqual([]);
  });
});

describe("brain primitive stats", () => {
  test("LruCache counts hits, misses, reuse sets, evictions and watermark", () => {
    const cache = new LruCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("a", 10);
    expect(cache.get("a")).toBe(10);
    expect(cache.get("nope")).toBeUndefined();
    cache.set("c", 3);
    const stats = cache.stats();
    expect(stats).toEqual({
      capacity: 2,
      evictions: 1,
      hitRate: 0.5,
      hits: 1,
      misses: 1,
      reuseSets: 1,
      sets: 4,
      size: 2,
      sizeWatermark: 2,
    });
    expect(Object.isFrozen(stats)).toBe(true);
  });

  test("peek and clear stay out of hit stats; resetStats opens a new window", () => {
    const cache = new LruCache<string, number>(2);
    cache.set("a", 1);
    expect(cache.peek("a")).toBe(1);
    expect(cache.peek("zz")).toBeUndefined();
    const before = cache.stats();
    expect(before.hits).toBe(0);
    expect(before.misses).toBe(0);
    cache.get("a");
    cache.resetStats();
    const fresh = cache.stats();
    expect(fresh.hits).toBe(0);
    expect(fresh.misses).toBe(0);
    expect(fresh.sizeWatermark).toBe(1);
  });

  test("Memoize attributes recomputes to its own evictions", () => {
    const memo = new Memoize<string, number>(2);
    let n = 0;
    const fn = (): number => {
      n += 1;
      return n;
    };
    memo.call("a", fn);
    memo.call("b", fn);
    // The third key evicts "a" at the cap of 2.
    memo.call("c", fn);
    // Attributed: "a" is requested again after its eviction.
    memo.call("a", fn);
    // Never seen before: a plain miss, no churn attribution.
    memo.call("new", fn);
    const stats = memo.stats();
    expect(stats.evictions).toBe(3);
    expect(stats.recomputesAfterEvict).toBe(1);
    expect(stats.misses).toBe(5);
    expect(stats.hits).toBe(0);
    expect(stats.hitRate).toBe(0);
  });

  test("Memoize counts every undefined result as a miss", () => {
    const memo = new Memoize<string, string | undefined>();
    memo.call("x", returnUndefined);
    memo.call("x", returnUndefined);
    const stats = memo.stats();
    expect(stats.misses).toBe(2);
    expect(stats.hits).toBe(0);
  });

  test("RingBuffer counts pushes, overwrites, clears and watermark", () => {
    const ring = new RingBuffer<number>(2);
    for (const value of [1, 2, 3, 4]) ring.push(value);
    ring.clear();
    ring.push(9);
    expect(ring.stats()).toEqual({
      capacity: 2,
      clears: 1,
      overwritten: 2,
      pushed: 5,
      size: 1,
      sizeWatermark: 2,
    });
  });

  test("GroupCounter reports dedupe effectiveness and eviction passthrough", () => {
    const groups = new GroupCounter<string, TestGroup>(1);
    groups.start("a", { count: 1, tag: "a" });
    expect(groups.absorb("a")).toBe(true);
    expect(groups.absorb("a")).toBe(true);
    groups.start("b", { count: 1, tag: "b" });
    const stats = groups.stats();
    expect(stats.started).toBe(2);
    expect(stats.absorbed).toBe(2);
    expect(stats.evicted).toBe(1);
    expect(stats.absorbRatio).toBeCloseTo(0.5);
    const drainedTags: string[] = [];
    groups.drain((group) => {
      drainedTags.push(group.tag);
    });
    expect(groups.stats().drained).toBe(1);
    expect(drainedTags).toEqual(["b"]);
  });
});
