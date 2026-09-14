import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { CsvSource } from "../src/csv/csvSource";
import { DuckDBAdapter } from "../src/duckdb/duckdbAdapter";
import type {
  ColumnMetadata,
  CsvEncoding,
  CsvHeaderMode,
  CsvOptions,
} from "../src/shared/protocol";

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

test("rebuilds the csv view with every supported option combination", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "csvis-options-"));
  const database = await DuckDBAdapter.createInMemory();
  const source = new CsvSource(database);
  const delimiters: readonly CsvOptions["delimiter"][] = [
    { mode: "auto" },
    { mode: "manual", value: ";" },
  ];
  const headers: readonly CsvHeaderMode[] = ["auto", "present", "absent"];
  const encodings: readonly CsvEncoding[] = ["utf-8", "utf-16", "latin-1"];

  try {
    for (const delimiter of delimiters) {
      for (const header of headers) {
        for (const encoding of encodings) {
          const caseName = `${delimiter.mode}-${header}-${encoding}`;

          await t.test(caseName, async () => {
            const hasHeader = header !== "absent";
            const content =
              (hasHeader ? "id;name\n" : "") + "1;Café\n2;Zoë\n";
            const filePath = path.join(directory, `${caseName}.csv`);

            await writeFile(filePath, encodeCsv(content, encoding));

            const columns = await source.replace(filePath, {
              delimiter,
              header,
              encoding,
            });
            const result = await database.query("SELECT * FROM csv");

            assert.deepEqual(columns, [
              { name: hasHeader ? "id" : "column0", type: "BIGINT" },
              { name: hasHeader ? "name" : "column1", type: "VARCHAR" },
            ]);
            assert.deepEqual(result.getRows(), [
              [1n, "Café"],
              [2n, "Zoë"],
            ]);
          });
        }
      }
    }
  } finally {
    database.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("corrects a bad header detection without reopening the file", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "csvis-header-"));
  const filePath = path.join(directory, "cities.csv");
  const database = await DuckDBAdapter.createInMemory();
  const source = new CsvSource(database);

  try {
    await writeFile(filePath, "Alice;Paris\nBob;London\n", "utf8");

    await source.replace(filePath);
    const autoDetected = await database.query("SELECT * FROM csv");

    assert.deepEqual(autoDetected.columnNames(), ["Alice", "Paris"]);
    assert.deepEqual(autoDetected.getRows(), [["Bob", "London"]]);

    const correctedColumns = await source.replace(filePath, {
      delimiter: { mode: "manual", value: ";" },
      header: "absent",
      encoding: "utf-8",
    });
    const corrected = await database.query("SELECT * FROM csv");

    assert.deepEqual(correctedColumns, [
      { name: "column0", type: "VARCHAR" },
      { name: "column1", type: "VARCHAR" },
    ]);
    assert.deepEqual(corrected.getRows(), [
      ["Alice", "Paris"],
      ["Bob", "London"],
    ]);
  } finally {
    database.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

function encodeCsv(content: string, encoding: CsvEncoding): Buffer {
  switch (encoding) {
    case "utf-8":
      return Buffer.from(content, "utf8");
    case "utf-16":
      return Buffer.concat([
        Buffer.from([0xff, 0xfe]),
        Buffer.from(content, "utf16le"),
      ]);
    case "latin-1":
      return Buffer.from(content, "latin1");
  }
}
