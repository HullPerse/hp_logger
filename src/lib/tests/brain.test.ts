import { describe, expect, test } from "bun:test";

import { GroupCounter } from "@/brain/group.utils";
import { LruCache } from "@/brain/lru.utils";
import { Memoize } from "@/brain/memo.utils";
import { RingBuffer } from "@/brain/ring.utils";

interface TestGroup {
  count: number;
  tag: string;
}

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
