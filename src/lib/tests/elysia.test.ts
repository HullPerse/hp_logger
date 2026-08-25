import { afterEach, describe, expect, test } from "bun:test";

import { Elysia } from "elysia";

import { Logger } from "@/index.logger";
import { captureLogger as captureTestLogger } from "@/lib/tests/test.transport";
import { elysiaPlugin } from "@/plugins/elysia.plugin";
import type { LogEntry } from "@/types/logger";

const captureLogger = (): { entries: LogEntry[]; logger: Logger } =>
  captureTestLogger({ level: "debug", mode: "json" });

afterEach(() => {
  Logger.clearTransports();
});

describe("elysia integration", () => {
  test("plugin logs request status, path, and correlation ID", async () => {
    const { entries, logger } = captureLogger();
    const app = new Elysia().use(elysiaPlugin(logger)).get("/", () => "ok");

    const res = await app.handle(
      new Request("http://localhost/", {
        headers: { "x-correlation-id": "req-elysia" },
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      context: {
        correlationId: "req-elysia",
        method: "GET",
        path: "/",
        status: 200,
      },
      level: "info",
      message: "request",
    });
  });

  test("plugin skips configured paths but still reports finish information", async () => {
    const { logger } = captureLogger();
    const finished: { path: string; status: number }[] = [];
    const app = new Elysia()
      .use(
        elysiaPlugin(logger, {
          onFinish: ({ path, status }) => finished.push({ path, status }),
          skipPaths: ["/health"],
        }),
      )
      .get("/", () => "ok")
      .get("/health", () => ({ ok: true }));

    await app.handle(new Request("http://localhost/"));
    await app.handle(new Request("http://localhost/health"));

    expect(finished).toEqual([
      { path: "/", status: 200 },
      { path: "/health", status: 200 },
    ]);
  });

  test("maps server errors to an error-level request entry", async () => {
    const { entries, logger } = captureLogger();
    const app = new Elysia().use(elysiaPlugin(logger)).get("/broken", ({ set }) => {
      set.status = 503;
      return "unavailable";
    });

    const response = await app.handle(new Request("http://localhost/broken"));

    expect(response.status).toBe(503);
    expect(entries[0]).toMatchObject({
      context: { path: "/broken", status: 503 },
      level: "error",
      message: "request",
    });
  });
});
