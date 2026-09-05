/** Outcome of a call: success carries a value, failure carries a normalized Error. */
export type Result<T> = { ok: true; value: T } | { error: Error; ok: false };

/** Run a synchronous call, normalizing a throw into a Result. */
export const attempt = <T>(fn: () => T): Result<T> => {
  try {
    return { ok: true, value: fn() };
  } catch (error) {
    return { error: error instanceof Error ? error : new Error(String(error)), ok: false };
  }
};

/** Run a sync or async call, normalizing a rejection into a Result. */
export const attemptAsync = async <T>(fn: () => Promise<T> | T): Promise<Result<T>> => {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return { error: error instanceof Error ? error : new Error(String(error)), ok: false };
  }
};
