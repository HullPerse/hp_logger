// Public surface of the package: explicit named re-exports (no export-*),
// so the entry stays tree-shakeable and the barrel detector stays quiet.
export type * from "./types/index.types";

export {
  Logger,
  createLogger,
  captureConsole,
  fromEnv,
  formatContext,
  formatDuration,
  installErrorHandlers,
  redact,
} from "./api/index.api";

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
} from "./config/index.config";

export { AdaptiveTransport } from "./writer/adaptive.writer";
export { AsyncTransport } from "./writer/buffer.writer";
export { ConsoleTransport } from "./writer/console.writer";
export { DateBasedFileTransport } from "./writer/dateBased.writer";
export { FileTransport } from "./writer/file.writer";
export { MultiTransport } from "./writer/group.writer";
export { LeveledTransport } from "./writer/leveled.writer";
export { RepeatTransport } from "./writer/repeat.writer";
export { SizeBasedFileTransport } from "./writer/sizeBased.writer";
export { BaseFileTransport } from "./writer/base.writer";
export { buildTransports } from "./writer/factory.writer";

export { registerToken } from "./format/template.format";

export { ResolverSet, buildResolverSet } from "./resolvers/index.resolver";

export {
  BaseMetric,
  Counter,
  Gauge,
  Histogram,
  Registry,
  createProcessMetrics,
} from "./metrics/index.metric";
