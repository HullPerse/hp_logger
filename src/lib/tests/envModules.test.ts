import { describe, expect, test } from "bun:test";

import { matchEnvModule, resolveEnvModules } from "../settings.utils.js";
import { captureLogger } from "./test.transport.js";

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

describe("LOG_MODULES wildcard prefixes", () => {
  test("a trailing * matches the module and its children", () => {
    const map = resolveEnvModules({ LOG_MODULES: "web*:debug" });
    expect(matchEnvModule(map, "web")).toBe("debug");
    expect(matchEnvModule(map, "web/api")).toBe("debug");
    expect(matchEnvModule(map, "network")).toBeUndefined();
  });

  test("exact pairs beat wildcards, longer prefixes beat shorter ones", () => {
    const map = resolveEnvModules({
      LOG_MODULES: "web*:debug,web/api:trace,web/db*:fatal,*:warn",
    });
    expect(matchEnvModule(map, "web/api")).toBe("trace");
    expect(matchEnvModule(map, "web/db/pool")).toBe("fatal");
    expect(matchEnvModule(map, "web/other")).toBe("debug");
    expect(matchEnvModule(map, "unrelated")).toBe("warn");
  });

  test("wildcards apply through logger.module()", () => {
    const envModuleLevels = resolveEnvModules({ LOG_MODULES: "auth*:trace" });
    const { entries, logger, transport } = captureLogger(
      { level: "warn", mode: "json" },
      envModuleLevels,
    );

    const authApi = logger.module("auth/api");
    authApi.transport = transport;
    authApi.trace("traced through wildcard");

    const other = logger.module("other");
    other.transport = transport;
    other.trace("still suppressed");

    const messages = entries.map((item) => item.message);
    expect(messages).toContain("traced through wildcard");
    expect(messages).not.toContain("still suppressed");
  });
});
