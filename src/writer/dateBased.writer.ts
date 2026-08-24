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

  constructor(baseDir: string, options: FileTransportOptions) {
    super(options);
    this.baseDir = baseDir;
    this.maxFilesPerDay = options.maxFilesPerDay ?? DEFAULT_MAX_FILES_PER_DAY;
  }

  protected async targetFilepath(): Promise<string> {
    const dateDir = this.getDateDir();
    const key = `${this.baseDir}::${dateDir}`;

    let filepath = sharedFilepaths.get(key);
    if (!filepath) {
      filepath = await this.getNextFilepath(dateDir);
      sharedFilepaths.set(key, filepath);
    }

    if (filepath !== this.currentFilepath) {
      // Day changed or first write: close the old file and open the new one.
      await this.closeStream();
      this.currentFilepath = filepath;
    }

    return filepath;
  }

  private getDateDir(): string {
    const [dateStr] = new Date().toISOString().split("T");
    return path.join(this.baseDir, dateStr);
  }

  private async getNextFilepath(dateDir: string): Promise<string> {
    await mkdir(dateDir, { recursive: true });

    const files = await readdir(dateDir);
    const indices = files
      .filter((f) => f.startsWith("log_") && f.endsWith(".log"))
      .map((f) => Math.trunc(Number(f.slice(4, -4))))
      .filter((n) => !Number.isNaN(n));

    let nextIndex = indices.length > 0 ? Math.max(...indices) + 1 : 1;

    if (nextIndex > this.maxFilesPerDay) {
      nextIndex = 1;
    }

    return path.join(dateDir, `log_${String(nextIndex).padStart(3, "0")}.log`);
  }
}
