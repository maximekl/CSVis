import assert from "node:assert/strict";
import { test } from "node:test";

import { DuckDBAdapter } from "../src/duckdb/duckdbAdapter";

test("executes a query against an in-memory DuckDB instance", async () => {
  const adapter = await DuckDBAdapter.createInMemory();

  try {
    const pendingResult = adapter.query("SELECT 42 AS answer");

    assert.ok(pendingResult instanceof Promise);

    const result = await pendingResult;

    assert.deepEqual(result.columnNames(), ["answer"]);
    assert.deepEqual(result.getRows(), [[42]]);
  } finally {
    adapter.dispose();
  }

  await assert.rejects(
    adapter.query("SELECT 1"),
    /DuckDB adapter has been disposed/,
  );

  assert.doesNotThrow(() => adapter.dispose());
});
