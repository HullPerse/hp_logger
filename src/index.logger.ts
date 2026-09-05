// Public surface of the package: explicit named re-exports (no export-*),
// so the entry stays tree-shakeable and the barrel detector stays quiet.
export type * from "./types/index.types.js";

export {
  Logger,
  createLogger,
  captureConsole,
  fromEnv,
  formatContext,
  formatDuration,
  installErrorHandlers,
  redact,
} from "./api/index.api.js";

export {
  BEARER_PATTERN,
  DEFAULT_AUTHOR,
  DEFAULT_BATCH_SIZE,
  DEFAULT_BUCKETS,
  DEFAULT_FLUSH_INTERVAL,
  DEFAULT_INTERVAL,
  DEFAULT_LEVEL_COLORS,
  DEFAULT_LOG_DIR,
  DEFAULT_MAX_BUFFER_SIZE,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_FILES,
  DEFAULT_MAX_FILES_PER_DAY,
  DEFAULT_MAX_QUEUE_SIZE,
  DEFAULT_PROCESS_METRICS_INTERVAL,
  DEFAULT_REDACT_KEYS,
  DEFAULT_SKIP_PATHS,
  DEFAULT_TABLE_NAME,
  DEFAULT_TIMEOUT,
  ELYSIA_ERROR_STATUS,
  EMPTY_CONTEXT,
  KEY_VALUE_PATTERN,
  LABEL_NAME_PATTERN,
  LEVEL_EMOJIS,
  LEVEL_NAMES,
  LOG_LEVELS,
  MESSAGE_REDACTION_PATTERN,
  METRIC_NAME_PATTERN,
  SENSITIVE_KEY_FRAGMENTS,
  SPINNER_FRAMES,
  TASK_GLYPHS,
} from "./config/index.config.js";

export { AdaptiveTransport } from "./writer/adaptive.writer.js";
export { AsyncTransport } from "./writer/buffer.writer.js";
export { ConsoleTransport } from "./writer/console.writer.js";
export { DateBasedFileTransport } from "./writer/dateBased.writer.js";
export { FileTransport } from "./writer/file.writer.js";
export { MultiTransport } from "./writer/group.writer.js";
export { LeveledTransport } from "./writer/leveled.writer.js";
export { PassthroughTransport } from "./writer/passthrough.writer.js";
export { RepeatTransport } from "./writer/repeat.writer.js";
export { SizeBasedFileTransport } from "./writer/sizeBased.writer.js";
export { BaseFileTransport } from "./writer/base.writer.js";
export { buildTransports } from "./writer/factory.writer.js";

export { registerToken } from "./format/template.format.js";

export { ResolverSet, buildResolverSet } from "./resolvers/index.resolver.js";

export {
  BaseMetric,
  Counter,
  Gauge,
  Histogram,
  Registry,
  createProcessMetrics,
} from "./metrics/index.metric.js";
