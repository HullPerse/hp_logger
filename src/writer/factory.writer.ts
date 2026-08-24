import { DEFAULT_LOG_DIR } from "../config/writer.config";
import type { ResolvedSettings } from "../types/logger";
import type { Transport } from "../types/transport";
import { AdaptiveTransport } from "./adaptive.writer";
import { AsyncTransport } from "./buffer.writer";
import { ConsoleTransport } from "./console.writer";
import { DatabaseTransport } from "./database.writer";
import { DateBasedFileTransport } from "./dateBased.writer";
import { FileTransport } from "./file.writer";
import { MultiTransport } from "./group.writer";
import { RepeatTransport } from "./repeat.writer";
import { SizeBasedFileTransport } from "./sizeBased.writer";

export const buildTransports = (settings: ResolvedSettings): Transport => {
  const transports: Transport[] = [new ConsoleTransport(settings)];

  if (settings.file) {
    const fileSettings = settings.file;
    const fileOptions = {
      ...fileSettings,
      contextFormat: settings.formatContext,
      format: settings.format,
      stripControl: settings.stripControl,
      tagCase: settings.tagCase,
    };
    const { rotation } = fileSettings;
    const logDir = fileSettings.path ?? DEFAULT_LOG_DIR;
    let fileTransport: Transport;
    if (rotation === "daily") {
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
    transports.push(new DatabaseTransport(settings.database, tap));
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
