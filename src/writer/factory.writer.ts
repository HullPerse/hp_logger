import { DEFAULT_LOG_DIR } from "../config/writer.config";
import type { ResolvedSettings } from "../types/logger";
import type { Transport } from "../types/transport";
import { AsyncTransport } from "./buffer.writer";
import { ConsoleTransport } from "./console.writer";
import { DatabaseTransport } from "./database.writer";
import { DateBasedFileTransport } from "./dateBased.writer";
import { FileTransport } from "./file.writer";
import { MultiTransport } from "./group.writer";

export const buildTransports = (settings: ResolvedSettings): Transport => {
  const transports: Transport[] = [new ConsoleTransport(settings)];

  if (settings.file) {
    const fileSettings = settings.file;
    const fileOptions = {
      ...fileSettings,
      contextFormat: settings.formatContext,
      format: settings.format,
      tagCase: settings.tagCase,
    };
    const fileTransport: Transport =
      fileSettings.rotation === "daily"
        ? new DateBasedFileTransport(fileSettings.path ?? DEFAULT_LOG_DIR, fileOptions)
        : new FileTransport(fileSettings.path ?? DEFAULT_LOG_DIR, fileOptions);
    transports.push(fileTransport);
  }

  if (settings.database) {
    transports.push(new DatabaseTransport(settings.database));
  }

  const combined: Transport =
    transports.length === 1 ? transports[0] : new MultiTransport(transports);

  return settings.batching ? new AsyncTransport(combined, settings.batching) : combined;
};
