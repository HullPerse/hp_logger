import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";

import { DEFAULT_MAX_FILES_PER_DAY } from "../config/writer.config";
import type { FileTransportOptions } from "../types/transport";
import { BaseFileTransport } from "./base.writer";

// One file per day shared by all transport instances with the same baseDir.
// Without this every logger (SYSTEM, HTTP, ...) would open its own file and
// each flush could jump to the next index - production needs one file per day.
const sharedFilepaths = new Map<string, string>();

export class DateBasedFileTransport extends BaseFileTransport {
  private currentFilepath: string | null = null;
  private readonly baseDir: string;
  private readonly maxFilesPerDay: number;
  private readonly namePrefix: string;

  constructor(baseDir: string, options: FileTransportOptions) {
    super(options);
    this.baseDir = baseDir;
    this.maxFilesPerDay = options.maxFilesPerDay ?? DEFAULT_MAX_FILES_PER_DAY;
    this.namePrefix = options.namePrefix ?? "log";
  }

  protected async targetFilepath(): Promise<string> {
    const dateDir = this.getDateDir();
    const key = `${this.baseDir}::${dateDir}::${this.namePrefix}`;

    let filepath = sharedFilepaths.get(key);
    if (!filepath) {
      filepath = await this.getNextFilepath(dateDir);
      sharedFilepaths.set(key, filepath);
    }

    if (filepath !== this.currentFilepath) {
      await this.closeStream();
      this.currentFilepath = filepath;
    }

    return filepath;
  }

  private getDateDir(): string {
    // ISO timestamps are always "YYYY-MM-DDTHH:mm:ss.sssZ", so the first ten
    // characters are the calendar date without a split allocation.
    const dateStr = new Date().toISOString().slice(0, 10);
    return path.join(this.baseDir, dateStr);
  }

  private async getNextFilepath(dateDir: string): Promise<string> {
    await mkdir(dateDir, { recursive: true });

    const files = await readdir(dateDir);
    const marker = `${this.namePrefix}_`;
    const indices = files
      .filter((f) => f.startsWith(marker) && f.endsWith(".log"))
      .map((f) => Math.trunc(Number(f.slice(marker.length, -4))))
      .filter((n) => !Number.isNaN(n));

    let nextIndex = indices.length > 0 ? Math.max(...indices) + 1 : 1;

    if (nextIndex > this.maxFilesPerDay) {
      nextIndex = 1;
    }

    return path.join(dateDir, `${marker}${String(nextIndex).padStart(3, "0")}.log`);
  }
}
