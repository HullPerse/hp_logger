import { afterEach, describe, expect, test } from "bun:test";

import { Logger } from "@/index.logger";
import { captureLogger as captureTestLogger } from "@/lib/tests/test.transport";
import type { LogEntry } from "@/types/logger";
import { bunServe } from "@/plugins/bun.server";
import { fastifyPlugin } from "@/plugins/fastify.plugin";
import { honoMiddleware } from "@/plugins/hono.plugin";
import { nodeServer } from "@/plugins/node.server";
import { levelForStatus, pathFromUrl, resolveCorrelationId } from "@/plugins/shared.plugin";

const captureLogger = (): { entries: LogEntry[]; logger: Logger } =>
  captureTestLogger({ level: "trace", mode: "json" });

afterEach(() => {
  Logger.clearTransports();
});

describe("request integration helpers", () => {
  test.each([
    [200, "info"],
    [399, "info"],
    [400, "warn"],
    [499, "warn"],
    [500, "error"],
  ] as const)("maps HTTP status %s to %s", (status, level) => {
    expect(levelForStatus(status)).toBe(level);
  });

  test("extracts URL paths and preserves a supplied correlation ID", () => {
    expect(pathFromUrl("https://example.test/users?active=true")).toBe("/users");
    expect(resolveCorrelationId(" request-1 ")).toBe("request-1");
    expect(resolveCorrelationId([" request-2 ", "ignored"])).toBe("request-2");
  });

  test("generates a correlation ID when the header is absent", () => {
    const missingHeader: string | undefined = undefined;
    expect(resolveCorrelationId(missingHeader)).toMatch(/^[0-9a-f-]{36}$/u);
  });
});

describe("bunServe", () => {
  test("returns the handler response and logs its status and path", async () => {
    const { entries, logger } = captureLogger();
    const handler = bunServe(
      () => new Response("ok", { status: 201 }),
      logger,
    );
    const response = await handler(new Request("http://localhost/items", {
      headers: { "x-correlation-id": "req-1" },
    }));

    expect(response.status).toBe(201);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      context: {
        correlationId: "req-1",
        method: "GET",
        path: "/items",
        status: 201,
      },
      level: "info",
      message: "request",
    });
  });

  test("user logs inside the handler inherit the correlation id", async () => {
    const { entries, logger } = captureLogger();
    const handler = bunServe(() => {
      logger.info("inside");
      return new Response("ok");
    }, logger);

    await handler(new Request("http://localhost/items", {
      headers: { "x-correlation-id": "req-ctx" },
    }));

    const inside = entries.find((entry) => entry.message === "inside");
    expect(inside?.context.correlationId).toBe("req-ctx");
  });
});

describe("honoMiddleware", () => {
  test("logs the response after downstream middleware completes", async () => {
    const { entries, logger } = captureLogger();
    const middleware = honoMiddleware(logger);
    const request = new Request("http://localhost/items", {
      headers: { "x-correlation-id": "req-2" },
    });
    const context = {
      req: { raw: request },
      res: new Response("ok", { status: 204 }),
    } as never;

    let forwarded = false;
    await middleware(context, () => {
      forwarded = true;
      return Promise.resolve();
    });

    expect(forwarded).toBe(true);
    expect(entries[0]).toMatchObject({
      context: { correlationId: "req-2", path: "/items", status: 204 },
      level: "info",
      message: "request",
    });
  });
});

describe("fastifyPlugin", () => {
  test("logs the response after request and response hooks", () => {
    const { entries, logger } = captureLogger();
    const hooks = new Map<string, (request: never, reply: never, done: () => void) => void>();
    const fastify = {
      addHook(name: string, hook: (request: never, reply: never, done: () => void) => void) {
        hooks.set(name, hook);
      },
    } as never;
    fastifyPlugin(fastify, logger);

    const request = { headers: { "x-correlation-id": "req-3" }, method: "GET", url: "/items" } as never;
    const reply = { statusCode: 202 } as never;
    hooks.get("onRequest")?.(request, reply, () => {});
    hooks.get("onResponse")?.(request, reply, () => {});

    expect(entries[0]).toMatchObject({
      context: { correlationId: "req-3", path: "/items", status: 202 },
      level: "info",
      message: "request",
    });
  });

  test("onRoute wraps handlers with the correlation context", () => {
    const { entries, logger } = captureLogger();
    const hooks = new Map<string, (request: never, reply: never, done: () => void) => void>();
    const fastify = {
      addHook(name: string, hook: (request: never, reply: never, done: () => void) => void) {
        hooks.set(name, hook);
      },
    } as never;
    fastifyPlugin(fastify, logger);

    const routeOptions: { handler: (request: never, reply: never) => void } = {
      handler: () => {
        logger.info("inside route");
      },
    };
    const onRoute = hooks.get("onRoute") as unknown as (
      options: { handler: (request: never, reply: never) => void },
    ) => void;
    onRoute(routeOptions);

    routeOptions.handler(
      { headers: { "x-correlation-id": "req-5" }, method: "GET", url: "/x" } as never,
      {} as never,
    );

    const inside = entries.find((entry) => entry.message === "inside route");
    expect(inside?.context.correlationId).toBe("req-5");
  });
});

describe("nodeServer", () => {
  test("logs when the response emits finish", () => {
    const { entries, logger } = captureLogger();
    const response = new EventTarget() as EventTarget & {
      on: (event: string, listener: () => void) => void;
      statusCode: number;
    };
    response.statusCode = 204;
    response.on = (_event, listener) => {
      response.addEventListener("finish", listener);
    };
    const handler = nodeServer((_request, _response) => {}, logger);
    const request = {
      headers: { "x-correlation-id": "req-4" },
      method: "GET",
      url: "/items",
    } as never;

    handler(request, response as never);
    response.dispatchEvent(new Event("finish"));

    expect(entries[0]).toMatchObject({
      context: { correlationId: "req-4", path: "/items", status: 204 },
      level: "info",
      message: "request",
    });
  });
});
