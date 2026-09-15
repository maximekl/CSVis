import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { Uri } from "vscode";

import { CsvSource } from "../src/csv/csvSource";
import {
  DUCKDB_MEMORY_LIMIT,
  DuckDBAdapter,
} from "../src/duckdb/duckdbAdapter";
import { CsvSession } from "../src/editor/csvSession";
import { validateQuery, QueryValidationError } from "../src/query/queryValidator";

test("opens only its CSV and denies COPY, ATTACH, INSTALL, other files and config changes", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "csvis-security-"));
  const csvPath = path.join(directory, "opened.csv");
  const otherPath = path.join(directory, "private.csv");
  const outputPath = path.join(directory, "export.csv");
  const databasePath = path.join(directory, "attached.duckdb");
  await writeFile(csvPath, "id,name\n1,Alice\n2,Bob\n");
  await writeFile(otherPath, "secret\nnot-for-csvis\n");
  const database = await DuckDBAdapter.createInMemory(csvPath);
  const source = new CsvSource(database);

  try {
    await source.replace(csvPath);
    const allowed = await database.query("SELECT * FROM csv ORDER BY id");
    assert.deepEqual(allowed.getRows(), [
      [1n, "Alice"],
      [2n, "Bob"],
    ]);
    assert.deepEqual(
      (await database.query(`SELECT count(*) FROM read_csv(${sqlString(csvPath)})`))
        .getRows(),
      [[2n]],
    );

    const forbiddenSql = [
      `COPY (SELECT * FROM csv) TO ${sqlString(outputPath)}`,
      `ATTACH ${sqlString(databasePath)}`,
      "INSTALL httpfs",
      `SELECT * FROM read_csv(${sqlString(otherPath)})`,
      `SELECT * FROM read_text(${sqlString(otherPath)})`,
      "SET memory_limit = '2GB'",
      "SET enable_external_access = true",
      "SET allowed_paths = []",
      "RESET memory_limit",
    ];

    for (const sql of forbiddenSql) {
      await assert.rejects(database.query(sql), Error, sql);
    }

    await assert.rejects(readFile(outputPath), { code: "ENOENT" });
    await assert.rejects(readFile(databasePath), { code: "ENOENT" });

    const settings = await database.query(
      "SELECT name, value FROM duckdb_settings() WHERE name IN (" +
        "'enable_external_access', 'lock_configuration', " +
        "'autoinstall_known_extensions', 'autoload_known_extensions', " +
        "'allow_community_extensions', 'allow_unsigned_extensions', " +
        "'allow_persistent_secrets', 'memory_limit', " +
        "'max_temp_directory_size', 'temp_directory', 'allowed_directories', " +
        "'allowed_configs')",
    );
    const values = new Map(settings.getRows() as [string, string][]);

    for (const name of [
      "enable_external_access",
      "autoinstall_known_extensions",
      "autoload_known_extensions",
      "allow_community_extensions",
      "allow_unsigned_extensions",
      "allow_persistent_secrets",
    ]) {
      assert.equal(values.get(name), "false", name);
    }

    assert.equal(values.get("lock_configuration"), "true");
    assert.equal(values.get("allowed_directories"), "[]");
    assert.equal(values.get("allowed_configs"), "[]");
    assert.equal(values.get("temp_directory"), "");
    assert.equal(values.get("memory_limit"), "512.0 MiB");
    assert.equal(values.get("max_temp_directory_size"), "0 bytes");
    assert.equal(DUCKDB_MEMORY_LIMIT, "512MiB");
  } finally {
    database.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("SELECT remains usable through a CSV session while explicit extension loading is rejected", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "csvis-secure-session-"));
  const csvPath = path.join(directory, "quoted'file.csv");
  await writeFile(csvPath, "id,name\n1,Zoë\n");
  const session = await CsvSession.create(fileUri(csvPath));
  const database = await DuckDBAdapter.createInMemory(csvPath);

  try {
    const result = await session.executeQuery({
      requestId: "safe-select",
      sql: "SELECT * FROM csv",
      page: 0,
      pageSize: 200,
    });
    assert.deepEqual(result.rows, [["1", "Zoë"]]);

    for (const sql of [
      "LOAD json",
      "INSTALL httpfs",
      "ATTACH 'other.duckdb'",
      "COPY (SELECT 1) TO 'other.csv'",
      "SET memory_limit = '2GB'",
    ]) {
      await assert.rejects(validateQuery(database, sql), QueryValidationError);
    }
  } finally {
    database.dispose();
    session.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("unscoped adapters deny all external files and paths must be absolute", async () => {
  await assert.rejects(
    DuckDBAdapter.createInMemory("relative.csv"),
    /Allowed CSV path must be absolute/,
  );
  await assert.rejects(
    DuckDBAdapter.createInMemory("/tmp/evil\0.csv"),
    /Allowed CSV path must be absolute/,
  );

  const database = await DuckDBAdapter.createInMemory();

  try {
    assert.deepEqual((await database.query("SELECT 42")).getRows(), [[42]]);
    const fixturePath = path.resolve(__dirname, "../../test/fixtures/comma.csv");
    await assert.rejects(
      database.query(`SELECT * FROM read_csv(${sqlString(fixturePath)})`),
      /file system operations are disabled/,
    );
  } finally {
    database.dispose();
  }
});

test("glob characters in the opened file name are rejected before DuckDB reads files", async () => {
  if (process.platform === "win32") {
    return;
  }

  const directory = await mkdtemp(path.join(os.tmpdir(), "csvis-glob-"));
  const openedPath = path.join(directory, "sample*.csv");
  const otherPath = path.join(directory, "sample-secret.csv");
  await writeFile(openedPath, "id,name\n1,Opened\n");
  await writeFile(otherPath, "id,name\n2,Private\n");

  try {
    await assert.rejects(
      CsvSession.create(fileUri(openedPath)),
      /glob characters/,
    );
    assert.deepEqual(await readFile(otherPath, "utf8"), "id,name\n2,Private\n");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function fileUri(filePath: string): Uri {
  return {
    fsPath: filePath,
    toString: () => `file://${filePath}`,
  } as Uri;
}
