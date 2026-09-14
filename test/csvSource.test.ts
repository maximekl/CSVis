import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { CsvSource } from "../src/csv/csvSource";
import { DuckDBAdapter } from "../src/duckdb/duckdbAdapter";
import type { ColumnMetadata } from "../src/shared/protocol";

interface FixtureExpectation {
  readonly fileName: string;
  readonly columns: readonly ColumnMetadata[];
  readonly rows: readonly (readonly unknown[])[];
}

const fixturesDirectory = path.resolve(__dirname, "../../test/fixtures");

const fixtures: readonly FixtureExpectation[] = [
  {
    fileName: "comma.csv",
    columns: [
      { name: "id", type: "BIGINT" },
      { name: "name", type: "VARCHAR" },
      { name: "score", type: "DOUBLE" },
    ],
    rows: [
      [1n, "Alice", 10.5],
      [2n, "Bob", 20.25],
    ],
  },
  {
    fileName: "semicolon.csv",
    columns: [
      { name: "city", type: "VARCHAR" },
      { name: "country", type: "VARCHAR" },
      { name: "population", type: "BIGINT" },
    ],
    rows: [
      ["Paris", "France", 2_148_000n],
      ["Brussels", "Belgium", 1_209_000n],
    ],
  },
  {
    fileName: "tab.csv",
    columns: [
      { name: "id", type: "BIGINT" },
      { name: "active", type: "BOOLEAN" },
      { name: "label", type: "VARCHAR" },
    ],
    rows: [
      [1n, true, "alpha"],
      [2n, false, "beta"],
    ],
  },
  {
    fileName: "quoted.csv",
    columns: [
      { name: "id", type: "BIGINT" },
      { name: "description", type: "VARCHAR" },
    ],
    rows: [
      [1n, "contains, a comma"],
      [2n, 'She said "hello"'],
    ],
  },
  {
    fileName: "multiline.csv",
    columns: [
      { name: "id", type: "BIGINT" },
      { name: "notes", type: "VARCHAR" },
    ],
    rows: [
      [1n, "first line\nsecond line"],
      [2n, "single line"],
    ],
  },
];

test("creates and replaces the csv view using DuckDB auto-detection", async (t) => {
  const database = await DuckDBAdapter.createInMemory();
  const source = new CsvSource(database);

  try {
    for (const fixture of fixtures) {
      await t.test(fixture.fileName, async () => {
        const columns = await source.replace(
          path.join(fixturesDirectory, fixture.fileName),
        );
        const result = await database.query("SELECT * FROM csv");

        assert.deepEqual(columns, fixture.columns);
        assert.deepEqual(result.getRows(), fixture.rows);
      });
    }
  } finally {
    database.dispose();
  }
});
