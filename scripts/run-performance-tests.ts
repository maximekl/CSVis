import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { runExtensionHostTests } from "./extensionTestHost";
import { generatePerformanceCsv } from "./generatePerformanceCsv";

const TARGET_BYTES = 500 * 1024 * 1024;

async function main(): Promise<void> {
  const fixtureDir = await mkdtemp(path.join(os.tmpdir(), "csvis-performance-"));
  const fixturePath = path.join(fixtureDir, "benchmark.csv");

  try {
    const generationStarted = performance.now();
    const generated = await generatePerformanceCsv(
      fixturePath,
      TARGET_BYTES,
    );
    const fileStat = await stat(fixturePath);
    assert.equal(fileStat.size, generated.byteLength);
    assert.ok(fileStat.size >= TARGET_BYTES);
    console.log(JSON.stringify({
      phase: "fixture",
      fileBytes: fileStat.size,
      rowCount: generated.rowCount,
      generationMs: Math.round(performance.now() - generationStarted),
    }));

    await runExtensionHostTests("performance/index.js", {
      CSVIS_PERFORMANCE_CSV_PATH: fixturePath,
    });
  } finally {
    const cleanupStarted = performance.now();
    await rm(fixtureDir, { recursive: true, force: true });
    await assert.rejects(stat(fixturePath), { code: "ENOENT" });
    console.log(JSON.stringify({
      phase: "cleanup",
      fixtureRemoved: true,
      cleanupMs: Math.round(performance.now() - cleanupStarted),
    }));
  }
}

void main().catch((error: unknown) => {
  console.error("500 MiB CSV performance test failed:", error);
  process.exitCode = 1;
});
