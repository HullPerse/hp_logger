import { describe, expect, test } from "bun:test";

import { Counter, Gauge, Histogram, Registry } from "../../metrics/index.metric.js";

describe("Counter", () => {
  test("increments and renders with labels", () => {
    const registry = new Registry();
    const counter = new Counter({
      help: "Total requests",
      labelNames: ["method", "status"],
      name: "http_requests_total",
      registers: [registry],
    });

    counter.inc({ method: "GET", status: "200" });
    counter.inc({ method: "GET", status: "200" });
    counter.inc({ method: "POST", status: "201" }, 3);

    const text = registry.metrics();
    expect(text).toContain("# HELP http_requests_total Total requests");
    expect(text).toContain("# TYPE http_requests_total counter");
    expect(text).toContain('http_requests_total{method="GET",status="200"} 2');
    expect(text).toContain('http_requests_total{method="POST",status="201"} 3');
  });

  test("renders without labels", () => {
    const registry = new Registry();
    const counter = new Counter({
      help: "Plain",
      name: "plain_counter",
      registers: [registry],
    });
    counter.inc();
    expect(registry.metrics()).toContain("plain_counter 1");
  });

  test("escapes label values", () => {
    const registry = new Registry();
    const counter = new Counter({
      help: "Escaped",
      labelNames: ["path"],
      name: "escaped_counter",
      registers: [registry],
    });
    counter.inc({ path: 'a"b\\c\nd' });
    const text = registry.metrics();
    expect(text).toContain('escaped_counter{path="a\\"b\\\\c\\nd"} 1');
  });

  test("rejects invalid metric name", () => {
    expect(
      () =>
        new Counter({
          help: "bad",
          name: "1bad-name",
          registers: [new Registry()],
        }),
    ).toThrow();
  });

  test("get returns current value", () => {
    const counter = new Counter({ help: "G", name: "g_counter" });
    counter.inc();
    expect(counter.get()).toBe(1);
  });
});

describe("Gauge", () => {
  test("set, inc, dec and render", () => {
    const registry = new Registry();
    const gauge = new Gauge({
      help: "Clients",
      name: "ws_clients",
      registers: [registry],
    });
    gauge.set(5);
    gauge.inc();
    gauge.dec();
    gauge.dec();
    const text = registry.metrics();
    expect(text).toContain("# TYPE ws_clients gauge");
    expect(text).toContain("ws_clients 4");
    expect(gauge.get()).toBe(4);
  });

  test("supports labels", () => {
    const registry = new Registry();
    const gauge = new Gauge({
      help: "By route",
      labelNames: ["route"],
      name: "route_gauge",
      registers: [registry],
    });
    gauge.set(2, { route: "/a" });
    expect(registry.metrics()).toContain('route_gauge{route="/a"} 2');
  });
});

describe("Histogram", () => {
  test("renders buckets, sum and count", () => {
    const registry = new Registry();
    const histogram = new Histogram({
      buckets: [5, 10],
      help: "Duration",
      labelNames: ["method"],
      name: "request_duration_ms",
      registers: [registry],
    });

    histogram.observe({ method: "GET" }, 3);
    histogram.observe({ method: "GET" }, 7);
    histogram.observe({ method: "GET" }, 12);

    const text = registry.metrics();
    expect(text).toContain("# TYPE request_duration_ms histogram");
    expect(text).toContain('request_duration_ms_bucket{le="5",method="GET"} 1');
    expect(text).toContain('request_duration_ms_bucket{le="10",method="GET"} 2');
    expect(text).toContain('request_duration_ms_bucket{le="+Inf",method="GET"} 3');
    expect(text).toContain('request_duration_ms_sum{method="GET"} 22');
    expect(text).toContain('request_duration_ms_count{method="GET"} 3');
  });

  test("uses default buckets when not provided", () => {
    const registry = new Registry();
    const histogram = new Histogram({
      help: "Default buckets",
      name: "default_histogram",
      registers: [registry],
    });
    histogram.observe({}, 0.5);
    expect(registry.metrics()).toContain('default_histogram_bucket{le="0.5"} 1');
  });

  test("quantile estimates the rank inside the crossing bucket", () => {
    const histogram = new Histogram({
      buckets: [5, 10, 25],
      help: "Duration",
      name: "quantile_histogram",
      registers: [],
    });
    for (let i = 0; i < 100; i += 1) histogram.observe({}, i % 25);

    const p50 = histogram.quantile(0.5);
    expect(p50).toBeGreaterThan(10);
    expect(p50).toBeLessThan(25);
    const p99 = histogram.quantile(0.99);
    expect(p99).toBeLessThanOrEqual(25);
    expect(histogram.quantile(0)).toBe(0);
    expect(histogram.quantile(1)).toBeLessThanOrEqual(25);
  });

  test("quantile is NaN without observations and rejects bad ranks", () => {
    const histogram = new Histogram({
      help: "Duration",
      name: "empty_histogram",
      registers: [],
    });
    expect(histogram.quantile(0.5)).toBeNaN();
    expect(() => histogram.quantile(1.5)).toThrow("between 0 and 1");
    expect(() => histogram.quantile(Number.NaN)).toThrow("between 0 and 1");
  });
});

describe("BaseMetric registration", () => {
  test("each metric registers itself with the provided registries", () => {
    const registry = new Registry();
    const counter = new Counter({
      help: "Self-register",
      name: "self_counter",
      registers: [registry],
    });
    const gauge = new Gauge({
      help: "Self-register",
      name: "self_gauge",
      registers: [registry],
    });
    const histogram = new Histogram({
      help: "Self-register",
      name: "self_histogram",
      registers: [registry],
    });

    // No explicit .register() calls anywhere - BaseMetric constructor does it.
    // Also verify each instance renders, proving the object is live and registered.
    expect(counter.toText()).toContain("# TYPE self_counter counter");
    expect(gauge.toText()).toContain("# TYPE self_gauge gauge");
    expect(histogram.toText()).toContain("# TYPE self_histogram histogram");
    expect(registry.metrics()).toContain("self_counter");
    expect(registry.metrics()).toContain("self_gauge");
    expect(registry.metrics()).toContain("self_histogram");
  });

  test("duplicate registration still rejected when constructed via registers", () => {
    const registry = new Registry();
    const first = new Counter({
      help: "A",
      name: "dup2",
      registers: [registry],
    });
    expect(first.toText()).toContain("dup2");
    expect(() => new Counter({ help: "B", name: "dup2", registers: [registry] })).toThrow(
      "already registered",
    );
  });
});

describe("Registry", () => {
  test("rejects duplicate metric names", () => {
    const registry = new Registry();
    const first = new Counter({
      help: "A",
      name: "dup",
      registers: [registry],
    });
    expect(first.toText()).toContain("dup");
    expect(() => new Counter({ help: "B", name: "dup", registers: [registry] })).toThrow(
      "already registered",
    );
  });

  test("sorts metrics by name", () => {
    const registry = new Registry();
    const bMetric = new Counter({
      help: "B",
      name: "b_metric",
      registers: [registry],
    });
    const aMetric = new Counter({
      help: "A",
      name: "a_metric",
      registers: [registry],
    });
    expect(bMetric.toText()).toContain("b_metric");
    expect(aMetric.toText()).toContain("a_metric");
    const text = registry.metrics();
    expect(text.indexOf("a_metric")).toBeLessThan(text.indexOf("b_metric"));
  });

  test("unregister removes metric", () => {
    const registry = new Registry();
    const counter = new Counter({
      help: "A",
      name: "gone",
      registers: [registry],
    });
    registry.unregister(counter.name);
    expect(registry.metrics()).not.toContain("gone");
  });
});
