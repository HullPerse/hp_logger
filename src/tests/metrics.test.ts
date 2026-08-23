import { describe, expect, test } from 'bun:test';

import { Counter, Gauge, Histogram, Registry } from '../metrics';

describe('Counter', () => {
  test('increments and renders with labels', () => {
    const registry = new Registry();
    const counter = new Counter({
      help: 'Total requests',
      labelNames: ['method', 'status'],
      name: 'http_requests_total',
      registers: [registry],
    });

    counter.inc({ method: 'GET', status: '200' });
    counter.inc({ method: 'GET', status: '200' });
    counter.inc({ method: 'POST', status: '201' }, 3);

    const text = registry.metrics();
    expect(text).toContain('# HELP http_requests_total Total requests');
    expect(text).toContain('# TYPE http_requests_total counter');
    expect(text).toContain('http_requests_total{method="GET",status="200"} 2');
    expect(text).toContain('http_requests_total{method="POST",status="201"} 3');
  });

  test('renders without labels', () => {
    const registry = new Registry();
    const counter = new Counter({
      help: 'Plain',
      name: 'plain_counter',
      registers: [registry],
    });
    counter.inc();
    expect(registry.metrics()).toContain('plain_counter 1');
  });

  test('escapes label values', () => {
    const registry = new Registry();
    const counter = new Counter({
      help: 'Escaped',
      labelNames: ['path'],
      name: 'escaped_counter',
      registers: [registry],
    });
    counter.inc({ path: 'a"b\\c\nd' });
    const text = registry.metrics();
    expect(text).toContain('escaped_counter{path="a\\"b\\\\c\\nd"} 1');
  });

  test('rejects invalid metric name', () => {
    expect(
      () => new Counter({ help: 'bad', name: '1bad-name', registers: [new Registry()] })
    ).toThrow();
  });

  test('get returns current value', () => {
    const counter = new Counter({ help: 'G', name: 'g_counter' });
    counter.inc();
    expect(counter.get()).toBe(1);
  });
});

describe('Gauge', () => {
  test('set, inc, dec and render', () => {
    const registry = new Registry();
    const gauge = new Gauge({
      help: 'Clients',
      name: 'ws_clients',
      registers: [registry],
    });
    gauge.set(5);
    gauge.inc();
    gauge.dec();
    gauge.dec();
    const text = registry.metrics();
    expect(text).toContain('# TYPE ws_clients gauge');
    expect(text).toContain('ws_clients 4');
    expect(gauge.get()).toBe(4);
  });

  test('supports labels', () => {
    const registry = new Registry();
    const gauge = new Gauge({
      help: 'By route',
      labelNames: ['route'],
      name: 'route_gauge',
      registers: [registry],
    });
    gauge.set(2, { route: '/a' });
    expect(registry.metrics()).toContain('route_gauge{route="/a"} 2');
  });
});

describe('Histogram', () => {
  test('renders buckets, sum and count', () => {
    const registry = new Registry();
    const histogram = new Histogram({
      buckets: [5, 10],
      help: 'Duration',
      labelNames: ['method'],
      name: 'request_duration_ms',
      registers: [registry],
    });

    histogram.observe({ method: 'GET' }, 3);
    histogram.observe({ method: 'GET' }, 7);
    histogram.observe({ method: 'GET' }, 12);

    const text = registry.metrics();
    expect(text).toContain('# TYPE request_duration_ms histogram');
    expect(text).toContain('request_duration_ms_bucket{le="5",method="GET"} 1');
    expect(text).toContain('request_duration_ms_bucket{le="10",method="GET"} 2');
    expect(text).toContain('request_duration_ms_bucket{le="+Inf",method="GET"} 3');
    expect(text).toContain('request_duration_ms_sum{method="GET"} 22');
    expect(text).toContain('request_duration_ms_count{method="GET"} 3');
  });

  test('uses default buckets when not provided', () => {
    const registry = new Registry();
    const histogram = new Histogram({
      help: 'Default buckets',
      name: 'default_histogram',
      registers: [registry],
    });
    histogram.observe({}, 0.5);
    expect(registry.metrics()).toContain('default_histogram_bucket{le="0.5"} 1');
  });
});

describe('Registry', () => {
  test('rejects duplicate metric names', () => {
    const registry = new Registry();
    void new Counter({ help: 'A', name: 'dup', registers: [registry] });
    expect(() => new Counter({ help: 'B', name: 'dup', registers: [registry] })).toThrow(
      'already registered'
    );
  });

  test('sorts metrics by name', () => {
    const registry = new Registry();
    void new Counter({ help: 'B', name: 'b_metric', registers: [registry] });
    void new Counter({ help: 'A', name: 'a_metric', registers: [registry] });
    const text = registry.metrics();
    expect(text.indexOf('a_metric')).toBeLessThan(text.indexOf('b_metric'));
  });

  test('unregister removes metric', () => {
    const registry = new Registry();
    const counter = new Counter({ help: 'A', name: 'gone', registers: [registry] });
    registry.unregister(counter.name);
    expect(registry.metrics()).not.toContain('gone');
  });
});
