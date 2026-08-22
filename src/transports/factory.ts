import type { ResolvedSettings, Transport } from '../types';
import { AsyncTransport } from './async';
import { ConsoleTransport } from './console';
import { DatabaseTransport } from './database';
import { DateBasedFileTransport } from './dateBasedFile';
import { FileTransport } from './file';
import { MultiTransport } from './multi';

export const buildTransports = (settings: ResolvedSettings): Transport => {
  const transports: Transport[] = [];

  if (settings.mode === 'json' || settings.colors !== false) {
    transports.push(new ConsoleTransport(settings));
  }

  if (settings.file) {
    const fileSettings = settings.file;
    const fileOptions = {
      ...fileSettings,
      contextFormat: settings.formatContext,
      format: settings.format,
      tagCase: settings.tagCase,
    };
    const fileTransport: Transport = fileSettings.rotation === 'daily'
      ? new DateBasedFileTransport(fileSettings.path ?? 'logs', fileOptions)
      : new FileTransport(fileSettings.path ?? 'logs', fileOptions);
    transports.push(fileTransport);
  }

  if (settings.database) {
    transports.push(new DatabaseTransport(settings.database));
  }

  if (transports.length === 0) {
    transports.push(new ConsoleTransport(settings));
  }

  const combined: Transport =
    transports.length === 1
      ? transports[0]
      : new MultiTransport(transports);

  return settings.async ? new AsyncTransport(combined, settings.async) : combined;
};
