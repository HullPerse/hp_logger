import type { ResolvedSettings, Transport } from '../types';
import { ConsoleTransport } from './console';
import { DateBasedFileTransport } from './dateBasedFile';
import { FileTransport } from './file';
import { AsyncTransport } from './async';
import { MultiTransport } from './multi';

export const buildTransports = (settings: ResolvedSettings): Transport => {
  const transports: Transport[] = [];

  if (settings.mode === 'json' || settings.colors !== false) {
    transports.push(new ConsoleTransport(settings));
  }

  if (settings.file) {
    const fileSettings = settings.file;
    const fileTransport: Transport = fileSettings.rotation === 'daily'
      ? new DateBasedFileTransport(fileSettings.path ?? 'logs', fileSettings)
      : new FileTransport(fileSettings.path ?? 'logs', fileSettings);
    transports.push(fileTransport);
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
