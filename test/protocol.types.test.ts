import type {
  ColumnMetadata,
  CsvOptions,
  HostToWebviewMessage,
  QueryRequest,
  QueryResult,
  WebviewToHostMessage,
} from "../src/shared/protocol";

function acceptCsvOptions(_options: CsvOptions): void {}
function acceptColumn(_column: ColumnMetadata): void {}
function acceptQueryRequest(_request: QueryRequest): void {}
function acceptQueryResult(_result: QueryResult): void {}
function acceptWebviewMessage(_message: WebviewToHostMessage): void {}
function acceptHostMessage(_message: HostToWebviewMessage): void {}

acceptCsvOptions({
  delimiter: { mode: "auto" },
  header: "auto",
  encoding: "utf-8",
});

acceptCsvOptions({
  delimiter: { mode: "manual", value: ";" },
  header: "present",
  encoding: "latin-1",
});

acceptColumn({ name: "amount", type: "DECIMAL(18,2)" });

acceptQueryRequest({
  requestId: "query-1",
  sql: "SELECT * FROM csv",
  page: 0,
  pageSize: 200,
});

acceptQueryResult({
  requestId: "query-1",
  columns: [
    { name: "id", type: "BIGINT" },
    { name: "metadata", type: "STRUCT" },
  ],
  rows: [["9007199254740993", { active: true, tags: ["csv", null] }]],
  page: 0,
  pageSize: 200,
  hasNextPage: false,
});

acceptWebviewMessage({ type: "ready" });
acceptWebviewMessage({
  type: "runQuery",
  request: {
    requestId: "query-2",
    sql: "SELECT count(*) FROM csv",
    page: 0,
    pageSize: 200,
  },
});
acceptWebviewMessage({
  type: "updateCsvOptions",
  requestId: "settings-1",
  options: {
    delimiter: { mode: "manual", value: "\t" },
    header: "absent",
    encoding: "utf-16",
  },
});

acceptHostMessage({
  type: "initialize",
  fileName: "sales.csv",
  options: {
    delimiter: { mode: "auto" },
    header: "auto",
    encoding: "utf-8",
  },
  initialQuery: "SELECT * FROM csv",
});
acceptHostMessage({
  type: "queryError",
  requestId: "query-2",
  message: "Invalid query",
});
acceptHostMessage({
  type: "fileStatus",
  status: "missing",
  revision: 2,
  message: "CSV file was deleted",
});

acceptCsvOptions({
  delimiter: { mode: "auto" },
  header: "auto",
  // @ts-expect-error unsupported encodings must be rejected
  encoding: "windows-1252",
});

acceptQueryRequest({
  requestId: "query-3",
  sql: "SELECT * FROM csv",
  // @ts-expect-error page must be numeric
  page: "first",
  pageSize: 200,
});

acceptQueryResult({
  requestId: "query-3",
  columns: [{ name: "id", type: "BIGINT" }],
  // @ts-expect-error bigint is not directly safe to send to the webview
  rows: [[1n]],
  page: 0,
  pageSize: 200,
  hasNextPage: false,
});

acceptWebviewMessage({
  // @ts-expect-error unknown message discriminants must be rejected
  type: "deleteCsv",
});

acceptHostMessage({
  type: "queryResult",
  // @ts-expect-error queryResult messages require a QueryResult payload
  result: { requestId: "query-4" },
});
