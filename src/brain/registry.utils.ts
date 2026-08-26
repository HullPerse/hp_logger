/**
 * Registry for module-level brain primitives (redact verdict memo, template
 * warned tokens). These caches belong to no logger instance, so Logger.stats()
 * aggregates them from here. Registration happens once at module load and
 * costs nothing on hot paths; snapshots are read only on demand.
 */

/** A frozen stats snapshot produced by a brain primitive's stats() method. */
export type BrainSnapshot = object;

type BrainStatsProvider = () => BrainSnapshot;

const providers = new Map<string, BrainStatsProvider>();

/** Register a named snapshot provider. Duplicate names are a wiring bug. */
export const registerBrainCache = (name: string, provider: BrainStatsProvider): void => {
  if (providers.has(name)) {
    throw new Error(`hp_logger: brain cache "${name}" is already registered`);
  }
  providers.set(name, provider);
};

/** Snapshot every registered primitive, keyed by name. Never throws. */
export const brainSnapshots = (): Record<string, BrainSnapshot> => {
  const out: Record<string, BrainSnapshot> = {};
  for (const [name, provider] of providers) {
    try {
      out[name] = provider();
    } catch {
      out[name] = { error: "snapshot failed" };
    }
  }
  return out;
};
