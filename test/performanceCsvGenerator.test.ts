import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { generatePerformanceCsv } from "../scripts/generatePerformanceCsv";

test("streams a CSV fixture without building the target file in memory", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "csvis-generator-"));
  const filePath = path.join(directory, "small.csv");

  try {
    const generated = await generatePerformanceCsv(filePath, 128 * 1024);
    const fileStat = await stat(filePath);
    assert.equal(fileStat.size, generated.byteLength);
    assert.ok(fileStat.size >= 128 * 1024);
    assert.ok(fileStat.size < 129 * 1024);
    assert.ok(generated.rowCount > 1000);

    const content = await readFile(filePath, "utf8");
    const lines = content.trimEnd().split("\n");
    assert.equal(lines[0], "id,label,payload");
    assert.equal(lines.length - 1, generated.rowCount);
    assert.equal(lines.at(-1), "1,alpha," + "x".repeat(96));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
