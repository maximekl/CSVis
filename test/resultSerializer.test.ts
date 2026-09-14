import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import { DuckDBAdapter } from "../src/duckdb/duckdbAdapter";
import { QueryExecutor } from "../src/query/queryExecutor";
import { serializeQueryPage } from "../src/query/resultSerializer";

const fixturePath = path.resolve(
  __dirname,
  "../../test/fixtures/result-types.sql",
);

test("serializes DuckDB values without precision loss", async () => {
  const database = await DuckDBAdapter.createInMemory();
  const executor = new QueryExecutor(database);

  try {
    const sql = await readFile(fixturePath, "utf8");
    const rawPage = await executor.execute({
      requestId: "all-types",
      sql,
      page: 0,
      pageSize: 200,
    });
    const result = serializeQueryPage(rawPage);

    assert.deepEqual(
      result.columns.map(({ name }) => name),
      [
        "null_value",
        "bigint_value",
        "decimal_value",
        "date_value",
        "timestamp_value",
        "list_value",
        "struct_value",
        "map_value",
      ],
    );
    assert.deepEqual(result.rows, [
      [
        null,
        "9007199254740993",
        "12345678901234567890.1234",
        "2026-09-14",
        "2026-09-14 12:34:56.123456",
        ["1", null, "3"],
        { label: "duck", count: "42" },
        [
          { key: "first", value: "1" },
          { key: "second", value: "2" },
        ],
      ],
    ]);
    assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  } finally {
    database.dispose();
  }
});
