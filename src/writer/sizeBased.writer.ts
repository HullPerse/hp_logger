import { mkdirSync, existsSync, renameSync, rmSync, statSync } from "node:fs";
import { readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";

import { DEFAULT_MAX_BYTES, DEFAULT_MAX_FILES } from "../config/writer.config";
import type { FileTransportOptions } from "../types/transport";
import { BaseFileTransport } from "./base.writer";

/** Gzip a rotated segment in the background; the .gz replaces the original. */
const compressGz = (file: string): void => {
  const archive = `${file}.gz`;
  const run = async (): Promise<void> => {
    try {
      const data = await readFile(file);
      await writeFile(archive, gzipSync(data));
      await rm(file);
    } catch (error: unknown) {
      console.error(`hp_logger: gzip rotation failed for ${file}: ${String(error)}`);
    }
  };
  run();
};

/**
 * Size-based rotation: the active file is `filepath`; when it reaches
 * `maxBytes` it becomes segment 1 (`app.1.log`), older segments shift one
 * slot up and everything past `maxFiles` disappears. Segments are gzipped
 * when `gzip` is on. Rotation happens after a flush, never mid-write.
 */
export class SizeBasedFileTransport extends BaseFileTransport {
  private readonly filepath: string;
  private readonly maxBytes: number;
  private readonly maxFiles: number;
  private readonly gzip: boolean;

  constructor(filepath: string, options: FileTransportOptions) {
    super(options);
    this.filepath = filepath;
    this.maxBytes = Math.max(1, options.maxBytes ?? DEFAULT_MAX_BYTES);
    this.maxFiles = Math.max(1, options.maxFiles ?? DEFAULT_MAX_FILES);
    this.gzip = options.gzip ?? false;
    mkdirSync(path.dirname(filepath), { recursive: true });
  }

  protected targetFilepath(): string {
    return this.filepath;
  }

  override async flush(): Promise<void> {
    await super.flush();
    const size = existsSync(this.filepath) ? statSync(this.filepath).size : 0;
    if (size >= this.maxBytes) await this.rotate();
  }

  private segment(index: number): string {
    const dot = this.filepath.lastIndexOf(".");
    const base = dot === -1 ? this.filepath : this.filepath.slice(0, dot);
    const ext = dot === -1 ? "" : this.filepath.slice(dot);
    return `${base}.${index}${ext}`;
  }

  private async rotate(): Promise<void> {
    await this.closeStream();
    // The oldest segment falls off the cliff; its gzip ghost goes too.
    rmSync(`${this.segment(this.maxFiles)}.gz`, { force: true });
    for (let index = this.maxFiles - 1; index >= 1; index -= 1) {
      const from = this.segment(index);
      if (existsSync(from)) renameSync(from, this.segment(index + 1));
      rmSync(`${this.segment(index + 1)}.gz`, { force: true });
    }
    if (existsSync(this.filepath)) renameSync(this.filepath, this.segment(1));
    if (this.gzip) compressGz(this.segment(1));
  }
}
