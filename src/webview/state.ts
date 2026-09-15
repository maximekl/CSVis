import type {
  CsvOptions,
  HostToWebviewMessage,
  QueryRequest,
  QueryResult,
} from "../shared/protocol";

export const QUERY_PAGE_SIZE = 200;
export type QueryAction = "run" | "previous" | "next";

export type WebviewState =
  | { readonly status: "loading" }
  | {
      readonly status: "ready";
      readonly fileName: string;
      readonly initialQuery: string;
      readonly options: CsvOptions;
      readonly queryText: string;
      readonly executedSql: string;
      readonly page: number;
      readonly pendingRequestId?: string;
      readonly result?: QueryResult;
      readonly error?: string;
    };

export const INITIAL_WEBVIEW_STATE: WebviewState = { status: "loading" };

export function applyHostMessage(
  state: WebviewState,
  message: HostToWebviewMessage,
): WebviewState {
  if (message.type === "initialize") {
    return {
      status: "ready",
      fileName: message.fileName,
      initialQuery: message.initialQuery,
      options: message.options,
      queryText: message.initialQuery,
      executedSql: message.initialQuery,
      page: 0,
    };
  }

  if (state.status === "loading") {
    return state;
  }

  switch (message.type) {
    case "queryResult":
      if (
        state.pendingRequestId === undefined ||
        message.result.requestId !== state.pendingRequestId
      ) {
        return state;
      }

      return {
        ...state,
        page: message.result.page,
        pendingRequestId: undefined,
        result: message.result,
        error: undefined,
      };
    case "queryError":
      if (
        state.pendingRequestId === undefined ||
        message.requestId !== state.pendingRequestId
      ) {
        return state;
      }

      return {
        ...state,
        pendingRequestId: undefined,
        result: undefined,
        error: message.message,
      };
    case "csvOptionsUpdated":
      return { ...state, options: message.options };
  }
}

export function updateQueryText(
  state: WebviewState,
  queryText: string,
): WebviewState {
  return state.status === "ready" ? { ...state, queryText } : state;
}

export function beginQuery(
  state: WebviewState,
  action: QueryAction,
  requestId: string,
): { readonly state: WebviewState; readonly request: QueryRequest } | null {
  if (state.status !== "ready" || state.pendingRequestId !== undefined) {
    return null;
  }

  let sql: string;
  let page: number;

  switch (action) {
    case "run":
      sql = state.queryText;
      page = 0;
      break;
    case "previous":
      if (state.result === undefined || state.page === 0) {
        return null;
      }

      sql = state.executedSql;
      page = state.page - 1;
      break;
    case "next":
      if (state.result === undefined || !state.result.hasNextPage) {
        return null;
      }

      sql = state.executedSql;
      page = state.page + 1;
      break;
  }

  const request: QueryRequest = {
    requestId,
    sql,
    page,
    pageSize: QUERY_PAGE_SIZE,
  };

  return {
    request,
    state: {
      ...state,
      executedSql: sql,
      page,
      pendingRequestId: requestId,
      result: undefined,
      error: undefined,
    },
  };
}
