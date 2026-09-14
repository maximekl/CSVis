import assert from "node:assert/strict";
import { test } from "node:test";

import { DuckDBAdapter } from "../src/duckdb/duckdbAdapter";
import {
  QueryValidationError,
  validateQuery,
} from "../src/query/queryValidator";

test("accepts one SELECT or WITH query", async () => {
  const database = await DuckDBAdapter.createInMemory();

  try {
    const queries = [
      "SELECT 42",
      "SELECT ';' AS value;",
      "WITH answer AS (SELECT 42 AS value) SELECT value FROM answer",
      "-- leading comment\nSELECT 42",
      "/* leading comment */ WITH answer AS (SELECT 42) SELECT * FROM answer",
      "SELECT 42; -- trailing comment",
    ];

    for (const query of queries) {
      const validated = await validateQuery(database, query);
      const result = await database.query(
        `SELECT * FROM (\n${validated}\n) AS validated_query`,
      );

      assert.ok(validated.length > 0);
      assert.ok(!validated.endsWith(";"));
      assert.equal(result.getRows().length, 1);
    }
  } finally {
    database.dispose();
  }
});

test("rejects empty, multiple, DDL, DML, and non-SELECT queries", async () => {
  const database = await DuckDBAdapter.createInMemory();

  try {
    const queries = [
      "",
      "SELECT 1; SELECT 2",
      "CREATE TABLE forbidden (id INTEGER)",
      "DROP TABLE forbidden",
      "INSERT INTO forbidden VALUES (1)",
      "UPDATE forbidden SET id = 2",
      "DELETE FROM forbidden",
      "VALUES (42)",
      "EXPLAIN SELECT 42",
    ];

    for (const query of queries) {
      await assert.rejects(
        validateQuery(database, query),
        QueryValidationError,
      );
    }

    const sideEffectCheck = await database.query(
      "SELECT count(*)::INTEGER AS count " +
        "FROM information_schema.tables WHERE table_name = 'forbidden'",
    );

    assert.deepEqual(sideEffectCheck.getRows(), [[0]]);
  } finally {
    database.dispose();
  }
});
