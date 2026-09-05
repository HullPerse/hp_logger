import type { TimestampFormat } from "../types/logger.js";

const pad = (n: number): string => String(n).padStart(2, "0");

export const formatTimestamp = (format: TimestampFormat): string => {
  if (format === "local") {
    const now = new Date();
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  }
  return new Date().toISOString().slice(0, 19).replace("T", " ");
};

/** ISO timestamp, computed at most once per second (cheap in hot loops). */
let tsSecond = 0;
let tsValue = "";
export const cachedTimestamp = (): string => {
  const now = Math.floor(Date.now() / 1000);
  if (tsSecond === now) return tsValue;
  tsSecond = now;
  tsValue = new Date(now * 1000).toISOString().slice(0, 19).replace("T", " ");
  return tsValue;
};
