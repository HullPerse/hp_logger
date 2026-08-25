import path from "node:path";
import { fileURLToPath } from "node:url";

// V8/Bun stack frames: "    at fn (/path/file.ts:84:15)",
// "    at /path/file.ts:84:15", or file:/// URLs.
const FRAME = /\(?(?<loc>(?<file>[^()\s]+?):(?<line>\d+):(?<col>\d+))\)?/u;

/**
 * Package root derived from this module's location: three levels up from
 * src/lib (development) or dist/lib (published build). Frames under it are
 * logger internals; everything else is a candidate caller.
 */
const PKG_ROOT = path
  .dirname(path.dirname(path.dirname(import.meta.dirname)))
  .replaceAll("\\", "/");

const isInternalFrame = (rawFile: string): boolean => {
  const file = rawFile.replaceAll("\\", "/");
  return file.startsWith(`${PKG_ROOT}/`) || file.startsWith("node:");
};

/**
 * Pick the first caller frame outside this package from a stack string.
 * Returns "path:line:column" with file:// URLs converted to plain paths.
 */
export const resolveCaller = (stack: string): string | undefined => {
  for (const line of stack.split("\n")) {
    const match = FRAME.exec(line);
    if (!match) continue;
    const {
      file,
      line: lineNo,
      col,
    } = match.groups as {
      col: string;
      file: string;
      line: string;
    };
    let filePath = file;
    if (filePath.startsWith("file://")) {
      try {
        filePath = fileURLToPath(filePath);
      } catch {
        // Keep the raw URL when the path is not a valid file URL.
      }
    }
    if (isInternalFrame(filePath)) continue;
    return `${filePath}:${lineNo}:${col}`;
  }
  return undefined;
};

/** Capture the current call site; used by the error/fatal write path. */
export const captureCaller = (): string | undefined => {
  const error = new Error("hp_logger callSite capture");
  return error.stack === undefined ? undefined : resolveCaller(error.stack);
};
