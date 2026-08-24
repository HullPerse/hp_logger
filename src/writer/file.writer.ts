import { mkdirSync } from "node:fs";
import path from "node:path";

import type { FileTransportOptions } from "../types/transport";
import { BaseFileTransport } from "./base.writer";

export class FileTransport extends BaseFileTransport {
  private readonly filepath: string;

  constructor(filepath: string, options: FileTransportOptions) {
    super(options);
    this.filepath = filepath;
    mkdirSync(path.dirname(filepath), { recursive: true });
  }

  protected targetFilepath(): string {
    return this.filepath;
  }
}
