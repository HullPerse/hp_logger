import { describe, expect, test } from "bun:test";

import { LruCache } from "@/brain/lru.utils";
import { Memoize } from "@/brain/memo.utils";
import { RingBuffer } from "@/brain/ring.utils";

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
