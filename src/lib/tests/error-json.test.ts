import { describe, expect, test } from "bun:test";

import { createLogger } from "../../index.logger.js";
import { redact } from "../../redact/index.redact.js";

describe("error serialization before redaction", () => {
  test("json without redaction still carries the full error", async () => {
    const lines: string[] = [];
    const originalError = console.error;
    console.error = (line: unknown): void => {
      lines.push(String(line));
    };
    const logger = createLogger({ settings: { mode: "json", redactKeys: null } });
    logger.error("broke", { error: new Error("boom", { cause: new Error("root") }) });
    await logger.close();
    console.error = originalError;

    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0] as string) as {
      error: { message: string; name: string; stack?: string; cause?: { message: string } };
    };
    expect(parsed.error.name).toBe("Error");
    expect(parsed.error.message).toBe("boom");
    expect(typeof parsed.error.stack).toBe("string");
    expect(parsed.error.cause?.message).toBe("root");
  });

  test("reason key expands the same way without redaction", async () => {
    const logger = createLogger({ settings: { mode: "json", redactKeys: null } });
    const seen: unknown[] = [];
    logger.transport = {
      write: (entry) => {
        seen.push((entry.context as { reason: unknown }).reason);
      },
    };
    logger.warn("warned", { reason: new Error("why") });
    await logger.close();

    const reason = seen[0] as { message: string; stack?: string };
    expect(reason.message).toBe("why");
    expect(typeof reason.stack).toBe("string");
  });

  test("default redaction output is unchanged by the early branch", async () => {
    const logger = createLogger({ settings: { mode: "json" } });
    const seen: unknown[] = [];
    logger.transport = {
      write: (entry) => {
        seen.push(entry.context);
      },
    };
    logger.error("guarded", {
      error: new Error("boom"),
      password: "s3cret",
    });
    await logger.close();

    const context = seen[0] as { error: { message: string }; password?: string };
    expect(context.error.message).toBe("boom");
    expect(context.password).toBe("[REDACTED]");
  });

  test("redaction passes an already-serialized error untouched", () => {
    const first = redact(new Error("once"), null) as Record<string, unknown>;
    const second = redact(first, null);
    expect(second).toBe(first);
  });

  test("blackbox stores the expanded error without redaction", async () => {
    const logger = createLogger({
      settings: { blackbox: { size: 8 }, mode: "json", redactKeys: null },
    });
    logger.error("recorded", { error: new Error("bb") });
    await logger.dump();
    await logger.close();

    const stats = logger.stats();
    expect(stats.dropped).toBe(0);
  });
});
