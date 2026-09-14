import {
  JsonDuckDBValueConverter,
  type DuckDBType,
  type DuckDBValue,
} from "@duckdb/node-api";

import type { RawQueryPage } from "./queryExecutor";
import type { JsonValue, QueryResult } from "../shared/protocol";

export function serializeQueryPage(page: RawQueryPage): QueryResult {
  if (page.columns.length !== page.columnTypes.length) {
    throw new Error("DuckDB column metadata and logical types do not match");
  }

  return {
    requestId: page.requestId,
    columns: page.columns,
    rows: page.rows.map((row) => serializeRow(row, page.columnTypes)),
    page: page.page,
    pageSize: page.pageSize,
    hasNextPage: page.hasNextPage,
  };
}

function serializeRow(
  row: readonly DuckDBValue[],
  columnTypes: readonly DuckDBType[],
): readonly JsonValue[] {
  if (row.length !== columnTypes.length) {
    throw new Error("DuckDB row and column counts do not match");
  }

  return row.map((value, columnIndex) => {
    const columnType = columnTypes[columnIndex];

    if (columnType === undefined) {
      throw new Error("DuckDB column type is missing");
    }

    return JsonDuckDBValueConverter(
      value,
      columnType,
      JsonDuckDBValueConverter,
    );
  });
}
