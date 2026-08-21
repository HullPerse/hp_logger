import type { ContextFormat, FileSettings } from '../types';
import { BaseFileTransport } from './baseFile';

export class FileTransport extends BaseFileTransport {
  private readonly filepath: string;

  constructor(
    filepath: string,
    options: Omit<FileSettings, 'enabled'> & { contextFormat?: ContextFormat }
  ) {
    super(options);
    this.filepath = filepath;
  }

  protected targetFilepath(): string {
    return this.filepath;
  }
}
