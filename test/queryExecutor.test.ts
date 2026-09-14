import assert from "node:assert/strict";
import { test } from "node:test";

import { DuckDBAdapter } from "../src/duckdb/duckdbAdapter";
import {
  MAX_QUERY_PAGE_SIZE,
  QueryExecutor,
} from "../src/query/queryExecutor";
import type { QueryRequest } from "../src/shared/protocol";

test("executes filters, aggregates, sorts, and CTEs", async (t) => {
  const database = await DuckDBAdapter.createInMemory();
  const executor = new QueryExecutor(database);
  const cases: readonly {
    readonly name: string;
    readonly sql: string;
    readonly rows: readonly (readonly unknown[])[];
  }[] = [
    {
      name: "filter",
      sql: "SELECT i FROM range(6) AS values(i) WHERE i % 2 = 0 ORDER BY i",
      rows: [[0n], [2n], [4n]],
    },
    {
      name: "aggregate",
      sql: "SELECT count(*) AS total FROM range(10)",
      rows: [[10n]],
    },
    {
      name: "sort",
      sql: "SELECT i FROM range(3) AS values(i) ORDER BY i DESC",
      rows: [[2n], [1n], [0n]],
    },
    {
      name: "cte",
      sql: "WITH values AS (SELECT i FROM range(3) AS source(i)) " +
        "SELECT i + 1 AS value FROM values ORDER BY value",
      rows: [[1n], [2n], [3n]],
    },
  ];

  try {
    for (const queryCase of cases) {
      await t.test(queryCase.name, async () => {
        const page = await executor.execute(request(queryCase.sql));

        assert.deepEqual(page.rows, queryCase.rows);
        assert.equal(page.hasNextPage, false);
      });
    }
  } finally {
    database.dispose();
  }
});

test("returns at most 200 rows and detects the next page", async () => {
  const database = await DuckDBAdapter.createInMemory();
  const executor = new QueryExecutor(database);
  const sql = "SELECT i AS value FROM range(401) AS values(i) ORDER BY i";

  try {
    const firstPage = await executor.execute(request(sql, 0));
    const secondPage = await executor.execute(request(sql, 1));
    const lastPage = await executor.execute(request(sql, 2));
    const exactPage = await executor.execute(
      request("SELECT i FROM range(200) AS values(i) ORDER BY i"),
    );

    assert.equal(firstPage.rows.length, 200);
    assert.deepEqual(firstPage.rows.at(0), [0n]);
    assert.deepEqual(firstPage.rows.at(-1), [199n]);
    assert.equal(firstPage.hasNextPage, true);

    assert.equal(secondPage.rows.length, 200);
    assert.deepEqual(secondPage.rows.at(0), [200n]);
    assert.deepEqual(secondPage.rows.at(-1), [399n]);
    assert.equal(secondPage.hasNextPage, true);

    assert.deepEqual(lastPage.rows, [[400n]]);
    assert.equal(lastPage.hasNextPage, false);

    assert.equal(exactPage.rows.length, 200);
    assert.equal(exactPage.hasNextPage, false);
    assert.deepEqual(firstPage.columns, [{ name: "value", type: "BIGINT" }]);
  } finally {
    database.dispose();
  }
});

test("rejects invalid pagination", async () => {
  const database = await DuckDBAdapter.createInMemory();
  const executor = new QueryExecutor(database);

  try {
    await assert.rejects(executor.execute(request("SELECT 1", -1)), RangeError);
    await assert.rejects(
      executor.execute({
        ...request("SELECT 1"),
        pageSize: MAX_QUERY_PAGE_SIZE + 1,
      }),
      RangeError,
    );
  } finally {
    database.dispose();
  }
});

function request(sql: string, page = 0): QueryRequest {
  return {
    requestId: `request-${page}`,
    sql,
    page,
    pageSize: MAX_QUERY_PAGE_SIZE,
  };
}
