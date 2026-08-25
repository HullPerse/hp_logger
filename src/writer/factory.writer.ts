import { LEVEL_NAMES } from "../config/levels.config";
import { DEFAULT_LOG_DIR } from "../config/writer.config";
import type { ResolvedSettings } from "../types/logger";
import type { FileTransportOptions, Transport } from "../types/transport";
import { AdaptiveTransport } from "./adaptive.writer";
import { AsyncTransport } from "./buffer.writer";
import { ConsoleTransport } from "./console.writer";
import { DateBasedFileTransport } from "./dateBased.writer";
import { FileTransport } from "./file.writer";
import { MultiTransport } from "./group.writer";
import { LazyDatabaseTransport } from "./lazyDatabase.writer";
import { LeveledTransport } from "./leveled.writer";
import { RepeatTransport } from "./repeat.writer";
import { SizeBasedFileTransport } from "./sizeBased.writer";

/** `logs/app.log` + "error" -> `logs/app.error.log` (extension-aware). */
const withLevelSuffix = (filepath: string, level: string): string => {
  const dot = filepath.lastIndexOf(".");
  const base = dot === -1 ? filepath : filepath.slice(0, dot);
  const ext = dot === -1 ? "" : filepath.slice(dot);
  return `${base}.${level}${ext}`;
};

export const buildTransports = (settings: ResolvedSettings): Transport => {
  const transports: Transport[] = [new ConsoleTransport(settings)];

  if (settings.file) {
    const { rotation } = settings.file;
    const logDir = settings.file.path ?? DEFAULT_LOG_DIR;
    const fileOptions: FileTransportOptions = {
      ...settings.file,
      contextFormat: settings.formatContext,
      format: settings.format,
      stripControl: settings.stripControl,
      tagCase: settings.tagCase,
    };

    let fileTransport: Transport;
    if (settings.file.splitByLevel) {
      const perLevel: Transport[] = LEVEL_NAMES.map((level) => {
        const options: FileTransportOptions = { ...fileOptions, namePrefix: level };
        let inner: Transport;
        if (rotation === "daily") {
          inner = new DateBasedFileTransport(logDir, options);
        } else if (rotation === "size") {
          inner = new SizeBasedFileTransport(withLevelSuffix(logDir, level), options);
        } else {
          inner = new FileTransport(withLevelSuffix(logDir, level), options);
        }
        return new LeveledTransport(inner, level, true);
      });
      const [first] = perLevel;
      fileTransport =
        perLevel.length === 1 && first !== undefined ? first : new MultiTransport(perLevel);
    } else if (rotation === "daily") {
      fileTransport = new DateBasedFileTransport(logDir, fileOptions);
    } else if (rotation === "size") {
      fileTransport = new SizeBasedFileTransport(logDir, fileOptions);
    } else {
      fileTransport = new FileTransport(logDir, fileOptions);
    }
    transports.push(fileTransport);
  }

  if (settings.database) {
    // Retry/drop notices flow to the console/file transports, never back into
    // the database transport itself (which also filters its own author).
    const tap: Transport =
      transports.length === 1 && transports[0] !== undefined
        ? transports[0]
        : new MultiTransport(transports);
    transports.push(new LazyDatabaseTransport(settings.database, tap));
  }

  const [singleTransport] = transports;
  const combined: Transport =
    transports.length === 1 && singleTransport !== undefined
      ? singleTransport
      : new MultiTransport(transports);
  const withRepeat: Transport = settings.repeat
    ? new RepeatTransport(combined, settings.repeat)
    : combined;
  // Adaptive sits outside repeat: it decides what repeat sees, so a storm
  // floods the repeat groups at full rate while verbose levels are sampled.
  const withAdaptive: Transport = settings.adaptive
    ? new AdaptiveTransport(withRepeat, settings.adaptive)
    : withRepeat;

  return settings.batching ? new AsyncTransport(withAdaptive, settings.batching) : withAdaptive;
};
