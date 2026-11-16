import { parentPort } from "node:worker_threads";
import { HttpError } from "../../middleware/errorHandler";
import { readGrid } from "../spreadsheet";

// Test-only worker for xlsHardening.test.ts (Stage 9): reads one uploaded file at a time with the product's own reader (readGrid → the .xls reader or ExcelJS) inside
// a worker thread, so the test can cap its memory (resourceLimits) and kill it on a wall-clock limit. Replies with the outcome only: never the file's contents.
parentPort!.on("message", async (m: { id: number; buf: Uint8Array; maxBytes: number }) => {
  const started = performance.now();
  try {
    const grid = await readGrid(Buffer.from(m.buf), '"upload.xls"', m.maxBytes);
    const cells = grid.reduce((n, r) => n + r.length, 0);
    parentPort!.postMessage({ id: m.id, ok: true, rows: grid.length, cells, ms: performance.now() - started, heapMb: process.memoryUsage().heapUsed / 1048576 });
  } catch (err) {
    const http = err instanceof HttpError;
    parentPort!.postMessage({
      id: m.id,
      ok: false,
      http,
      status: http ? err.status : 500,
      code: http ? err.code : (err as Error)?.constructor?.name,
      message: String((err as Error)?.message ?? err).slice(0, 200),
      ms: performance.now() - started,
      heapMb: process.memoryUsage().heapUsed / 1048576,
    });
  }
});
