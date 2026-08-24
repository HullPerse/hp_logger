/** W3C Trace Context ids: 32-hex trace id, 16-hex span id. */
export interface TraceContext {
  spanId: string;
  traceId: string;
}

const HEX = "0123456789abcdef";
const randomHex = (length: number): string => {
  let out = "";
  for (let i = 0; i < length; i += 1) out += HEX[Math.floor(Math.random() * 16)];
  return out;
};

export const randomTraceId = (): string => randomHex(32);
export const randomSpanId = (): string => randomHex(16);

const isHex = (value: string, length: number): boolean => {
  if (value.length !== length) return false;
  for (const char of value) {
    if (!HEX.includes(char)) return false;
  }
  return true;
};

/**
 * Parse a W3C `traceparent` header (`00-<trace-id>-<parent-id>-<flags>`).
 * Returns null for anything malformed, so callers can fall back to a fresh
 * trace instead of trusting hostile input.
 */
export const parseTraceparent = (header?: string): TraceContext | null => {
  if (header === undefined) return null;
  const parts = header.trim().split("-");
  if (parts.length !== 4) return null;
  const [, traceId, spanId] = parts;
  if (traceId === undefined || spanId === undefined) return null;
  if (!isHex(traceId, 32) || !isHex(spanId, 16)) return null;
  if (/^0+$/u.test(traceId) || /^0+$/u.test(spanId)) return null;
  return { spanId, traceId };
};

/** Build a W3C `traceparent` header value from ids. */
export const buildTraceparent = (context: TraceContext, flags = "01"): string =>
  `00-${context.traceId}-${context.spanId}-${flags}`;
