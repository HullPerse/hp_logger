import { LEVEL_NAMES } from "../config/levels.config.js";
import { DEFAULT_LOG_DIR } from "../config/writer.config.js";
import { splitExtension } from "../lib/transport.utils.js";
import type { ResolvedSettings } from "../types/logger.js";
import type { FileTransportOptions, Transport } from "../types/transport.js";
import { AdaptiveTransport } from "./adaptive.writer.js";
import { AsyncTransport } from "./buffer.writer.js";
import { ConsoleTransport } from "./console.writer.js";
import { DateBasedFileTransport } from "./dateBased.writer.js";
import { FileTransport } from "./file.writer.js";
import { MultiTransport } from "./group.writer.js";
import { LazyDatabaseTransport } from "./lazyDatabase.writer.js";
import { LeveledTransport } from "./leveled.writer.js";
import { RepeatTransport } from "./repeat.writer.js";
import { SizeBasedFileTransport } from "./sizeBased.writer.js";

/** `logs/app.log` + "error" -> `logs/app.error.log` (extension-aware). */
const withLevelSuffix = (filepath: string, level: string): string => {
  const { base, ext } = splitExtension(filepath);
  return `${base}.${level}${ext}`;
};

type FileCtor = new (path: string, options: FileTransportOptions) => Transport;

const FILE_CTOR_BY_ROTATION: Record<string, FileCtor> = {
  daily: DateBasedFileTransport as unknown as FileCtor,
  size: SizeBasedFileTransport as unknown as FileCtor,
};

const createFileTransport = (
  path: string,
  options: FileTransportOptions,
  rotation: string | undefined,
): Transport => {
  const Ctor = (rotation === undefined ? undefined : FILE_CTOR_BY_ROTATION[rotation]) ?? FileTransport;
  return new Ctor(path, options);
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
        const path = withLevelSuffix(logDir, level);
        const inner = createFileTransport(path, options, rotation);
        return new LeveledTransport(inner, level, true);
      });
      const [first] = perLevel;
      fileTransport =
        perLevel.length === 1 && first !== undefined ? first : new MultiTransport(perLevel);
    } else {
      fileTransport = createFileTransport(logDir, fileOptions, rotation);
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
