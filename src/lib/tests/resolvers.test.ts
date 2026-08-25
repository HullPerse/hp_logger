import { describe, expect, test } from "bun:test";

import { createLogger } from "@/index.logger";
import { captureLogger, withMutedConsole } from "@/lib/tests/test.transport";
import type { LogEntry } from "@/types/logger";

const settle = (ms = 15): Promise<void> => Bun.sleep(ms);

const firstEntry = (entries: LogEntry[]): LogEntry => {
  expect(entries.length).toBeGreaterThan(0);
  return entries[0] as LogEntry;
};

describe("resolvers: basic enrichment", () => {
  test("scalar result lands under `as` next to the raw key", async () => {
    const { entries, logger } = captureLogger({
      resolvers: {
        userId: {
          as: "username",
          resolve: async (id) => (id === "u1" ? "alice" : "unknown"),
        },
      },
    });
    logger.info("login", { userId: "u1" });
    await settle();
    const entry = firstEntry(entries);
    expect(entry.context.userId).toBe("u1");
    expect(entry.context.username).toBe("alice");
  });

  test("object result merges its own keys", async () => {
    const { entries, logger } = captureLogger({
      resolvers: {
        userId: {
          resolve: async (id) => ({ tenant: "acme", username: `user-${id}` }),
        },
      },
    });
    logger.info("login", { userId: 7 });
    await settle();
    const entry = firstEntry(entries);
    expect(entry.context).toMatchObject({
      tenant: "acme",
      userId: 7,
      username: "user-7",
    });
  });

  test("literal marker strings are treated as resolver data", async () => {
    const { entries, logger } = captureLogger({
      resolvers: {
        errorCode: {
          as: "label",
          resolve: async (value) => String(value),
        },
      },
    });
    logger.info("markers", { errorCode: "TIMEOUT" });
    await settle();
    const entry = firstEntry(entries);
    expect(entry.context.label).toBe("TIMEOUT");
  });

  test("null result adds nothing and keeps the raw key", async () => {
    const { entries, logger } = captureLogger({
      resolvers: {
        userId: { resolve: async () => null },
      },
    });
    logger.info("login", { userId: "ghost" });
    await settle();
    const entry = firstEntry(entries);
    expect(entry.context.userId).toBe("ghost");
    expect(Object.keys(entry.context)).toEqual(["userId"]);
  });

  test("context keys without resolvers are untouched", async () => {
    let calls = 0;
    const { entries, logger } = captureLogger({
      resolvers: {
        userId: {
          resolve: async () => {
            calls += 1;
            return { username: "alice" };
          },
        },
      },
    });
    logger.info("plain", { method: "GET" });
    await settle();
    const entry = firstEntry(entries);
    expect(entry.context.method).toBe("GET");
    expect(calls).toBe(0);
    expect(entry.context.username).toBeUndefined();
  });
});

describe("resolvers: cache", () => {
  test("warm value skips the lookup", async () => {
    let calls = 0;
    const { entries, logger } = captureLogger({
      resolvers: {
        userId: {
          as: "username",
          resolve: async (id) => {
            calls += 1;
            return `user-${id}`;
          },
        },
      },
    });
    logger.info("a", { userId: "same" });
    await settle();
    logger.info("b", { userId: "same" });
    await settle();
    expect(calls).toBe(1);
    expect(entries).toHaveLength(2);
    expect((entries[1] as LogEntry).context.username).toBe("user-same");
  });

  test("distinct values each resolve once", async () => {
    let calls = 0;
    const { logger } = captureLogger({
      resolvers: {
        userId: {
          as: "username",
          resolve: async () => {
            calls += 1;
            return "x";
          },
        },
      },
    });
    logger.info("a", { userId: 1 });
    await settle();
    logger.info("b", { userId: 2 });
    await settle();
    expect(calls).toBe(2);
  });

  test("expired ttl re-resolves", async () => {
    let calls = 0;
    const { entries, logger } = captureLogger({
      resolvers: {
        userId: {
          as: "username",
          resolve: async (id) => {
            calls += 1;
            return `user-${id}`;
          },
          ttlMs: 30,
        },
      },
    });
    logger.info("a", { userId: "hot" });
    await settle();
    logger.info("b", { userId: "hot" });
    await settle();
    expect(calls).toBe(1);
    await settle(40);
    logger.info("c", { userId: "hot" });
    await settle();
    expect(calls).toBe(2);
    expect((entries[2] as LogEntry).context.username).toBe("user-hot");
  });
});

describe("resolvers: failure and timeout", () => {
  test("timeout falls back to the raw value and still logs", async () => {
    const { entries, logger } = captureLogger({
      resolvers: {
        userId: {
          as: "username",
          resolve: async () => {
            await settle(200);
            return "too-late";
          },
          timeoutMs: 5,
        },
      },
    });
    logger.info("slow", { userId: "u9" });
    await settle(30);
    const entry = firstEntry(entries);
    expect(entry.context.userId).toBe("u9");
    expect(entry.context.username).toBeUndefined();
  });

  test("default onError=skip keeps the raw key", async () => {
    const { entries, logger } = captureLogger({
      resolvers: {
        userId: {
          resolve: async () => {
            throw new Error("db down");
          },
        },
      },
    });
    logger.info("boom", { userId: 1 });
    await settle();
    const entry = firstEntry(entries);
    expect(entry.context.userId).toBe(1);
    expect(Object.keys(entry.context)).toEqual(["userId"]);
  });

  test("onError=mark records the marker", async () => {
    const { entries, logger } = captureLogger({
      resolvers: {
        userId: {
          onError: "mark",
          resolve: async () => {
            throw new Error("db down");
          },
        },
      },
    });
    logger.info("boom", { userId: 1 });
    await settle();
    const entry = firstEntry(entries);
    expect(entry.context.userId).toBe("[RESOLVER ERROR]");
  });
});

describe("resolvers: static and async context", () => {
  test("static context is resolved", async () => {
    const { entries, logger } = captureLogger({
      resolvers: {
        userId: {
          as: "username",
          resolve: async (id) => `user-${id}`,
        },
      },
    });
    logger.addContext({ userId: "static-7" });
    logger.info("static");
    await settle();
    const entry = firstEntry(entries);
    expect(entry.context.userId).toBe("static-7");
    expect(entry.context.username).toBe("user-static-7");
  });

  test("async local context is resolved", async () => {
    const { entries, logger } = captureLogger({
      resolvers: {
        userId: {
          as: "username",
          resolve: async (id) => `user-${id}`,
        },
      },
    });
    logger.withContext({ userId: "ctx-1" }, () => {
      logger.info("scoped");
    });
    await settle();
    const entry = firstEntry(entries);
    expect(entry.context.username).toBe("user-ctx-1");
  });
});

describe("resolvers: lifecycle", () => {
  test("settings() hot-swap rebuilds the resolver set", async () => {
    // settings() rebuilds the transport from settings too, so re-attach the
    // capture transport after the swap to keep observing the same logger.
    const captured = captureLogger({});
    captured.logger.settings({
      resolvers: {
        userId: { as: "username", resolve: async () => "alice" },
      },
    });
    captured.logger.transport = captured.transport;
    captured.logger.info("swapped", { userId: 1 });
    await settle();
    const entry = firstEntry(captured.entries);
    expect(entry.context.username).toBe("alice");
  });

  test("close waits for an active resolver before closing", async () => {
    const captured = captureLogger({
      resolvers: {
        userId: {
          as: "username",
          resolve: async () => {
            await settle(20);
            return "alice";
          },
        },
      },
    });
    captured.logger.info("integration", { userId: 1 });
    await captured.logger.close();
    expect(captured.entries[0]?.context.username).toBe("alice");
  });

  test("worker pairs with createLogger config path", async () =>
    withMutedConsole(async () => {
      const logger = createLogger({
        settings: {
          mode: "json",
          resolvers: {
            userId: { as: "username", resolve: async () => "alice" },
          },
        },
      });
      logger.info("integration", { userId: 1 });
      await settle();
      await logger.close();
    }));
});