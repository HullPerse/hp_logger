import { describe, expect, test } from "bun:test";

import { resolveEnvModules } from "@/lib/settings.utils";
import { captureLogger } from "@/lib/tests/test.transport";

describe("resolveEnvModules", () => {
  test("parses name:level pairs and skips garbage", () => {
    const map = resolveEnvModules({ LOG_MODULES: "auth:debug, http:warn , broken, x:nonsense" });
    expect(map.get("auth")).toBe("debug");
    expect(map.get("http")).toBe("warn");
    expect(map.has("broken")).toBe(false);
    expect(map.has("x")).toBe(false);
  });

  test("empty or missing env yields an empty map", () => {
    expect(resolveEnvModules({}).size).toBe(0);
    expect(resolveEnvModules({ LOG_MODULES: "" }).size).toBe(0);
  });

  test("a * entry sets the default for any module", () => {
    const map = resolveEnvModules({ LOG_MODULES: "*:trace" });
    expect(map.get("*")).toBe("trace");
  });
});

describe("LOG_MODULES application", () => {
  test("an env pair raises one module's level above the logger default", () => {
    const envModuleLevels = resolveEnvModules({ LOG_MODULES: "auth:debug" });
    const { entries, logger, transport } = captureLogger(
      { level: "warn", mode: "json" },
      envModuleLevels,
    );

    const auth = logger.module("auth");
    auth.transport = transport;
    auth.debug("should appear");

    const other = logger.module("other");
    other.transport = transport;
    other.debug("should not appear");

    const messages = entries.map((item) => item.message);
    expect(messages).toContain("should appear");
    expect(messages).not.toContain("should not appear");
  });

  test("a * entry applies to modules without their own pair", () => {
    const envModuleLevels = resolveEnvModules({ LOG_MODULES: "*:trace,auth:fatal" });
    const { entries, logger, transport } = captureLogger(
      { level: "warn", mode: "json" },
      envModuleLevels,
    );

    const anything = logger.module("anything");
    anything.transport = transport;
    anything.trace("traced via star");

    const auth = logger.module("auth");
    auth.transport = transport;
    auth.trace("suppressed by exact pair");

    const messages = entries.map((item) => item.message);
    expect(messages).toContain("traced via star");
    expect(messages).not.toContain("suppressed by exact pair");
  });
});
