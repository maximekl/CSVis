import type { DuckDBType, DuckDBValue } from "@duckdb/node-api";

import type { DuckDBAdapter } from "../duckdb/duckdbAdapter";
import type { ColumnMetadata, QueryRequest } from "../shared/protocol";
import { validateQuery } from "./queryValidator";

export const MAX_QUERY_PAGE_SIZE = 200;

export interface RawQueryPage {
  readonly requestId: string;
  readonly columns: readonly ColumnMetadata[];
  readonly columnTypes: readonly DuckDBType[];
  readonly rows: readonly (readonly DuckDBValue[])[];
  readonly page: number;
  readonly pageSize: number;
  readonly hasNextPage: boolean;
}

export class QueryExecutor {
  public constructor(private readonly database: DuckDBAdapter) {}

  public async execute(request: QueryRequest): Promise<RawQueryPage> {
    validateRequest(request);

    const sql = await validateQuery(this.database, request.sql);
    const offset = request.page * request.pageSize;

    if (!Number.isSafeInteger(offset)) {
      throw new RangeError("Query offset exceeds the safe integer range");
    }

    const orderBy = request.sort === undefined
      ? ""
      : `ORDER BY ${request.sort.columnIndex + 1} ${
          request.sort.direction === "ascending" ? "ASC" : "DESC"
        }\n`;
    const result = await this.database.query(
      `SELECT * FROM (\n${sql}\n) AS __csvis_query\n` +
        orderBy +
        `LIMIT ${request.pageSize + 1} OFFSET ${offset}`,
    );
    const fetchedRows = result.getRows();
    const hasNextPage = fetchedRows.length > request.pageSize;

    return {
      requestId: request.requestId,
      columns: result.columnNames().map((name, index) => ({
        name,
        type: result.columnType(index).toString(),
      })),
      columnTypes: result.columnTypes(),
      rows: fetchedRows.slice(0, request.pageSize),
      page: request.page,
      pageSize: request.pageSize,
      hasNextPage,
    };
  }
}

function validateRequest(request: QueryRequest): void {
  if (request.requestId.length === 0) {
    throw new RangeError("Query request ID cannot be empty");
  }

  if (!Number.isSafeInteger(request.page) || request.page < 0) {
    throw new RangeError("Query page must be a non-negative safe integer");
  }

  if (
    !Number.isSafeInteger(request.pageSize) ||
    request.pageSize < 1 ||
    request.pageSize > MAX_QUERY_PAGE_SIZE
  ) {
    throw new RangeError(
      `Query page size must be between 1 and ${MAX_QUERY_PAGE_SIZE}`,
    );
  }

  if (
    request.sort !== undefined &&
    (
      !Number.isSafeInteger(request.sort.columnIndex) ||
      request.sort.columnIndex < 0 ||
      (request.sort.direction !== "ascending" &&
        request.sort.direction !== "descending")
    )
  ) {
    throw new RangeError("Query sort must contain a valid column and direction");
  }
}
