import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, writeSync } from "node:fs";
import path from "node:path";

// Durable writes: the data is flushed to disk before it replaces the old file,
// so a power cut leaves either the old file or the new one, never half of one.
// (On Windows a directory can't be fsynced; the rename itself is atomic.)
export function writeFileDurably(file: string, data: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  const fd = openSync(tmp, "w");
  try {
    writeSync(fd, data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, file);
  if (process.platform !== "win32") {
    const dir = openSync(path.dirname(file), "r");
    try {
      fsyncSync(dir);
    } finally {
      closeSync(dir);
    }
  }
}
