import type {
  CsvFileStatus,
  CsvOptions,
  HostToWebviewMessage,
  QueryRequest,
  QueryResult,
  QuerySort,
} from "../shared/protocol";

export const QUERY_PAGE_SIZE = 200;
export type QueryAction = "run" | "reload" | "previous" | "next";

export type WebviewState =
  | { readonly status: "loading" }
  | {
      readonly status: "ready";
      readonly fileName: string;
      readonly initialQuery: string;
      readonly options: CsvOptions;
      readonly fileStatus: CsvFileStatus;
      readonly fileRevision: number;
      readonly fileMessage?: string;
      readonly queryText: string;
      readonly executedSql: string;
      readonly page: number;
      readonly sort?: QuerySort;
      readonly pendingRequestId?: string;
      readonly pendingSettingsRequestId?: string;
      readonly settingsError?: string;
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
      fileStatus: message.fileStatus ?? "ready",
      fileRevision: message.fileRevision ?? 0,
      fileMessage: message.fileMessage,
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
        state.fileStatus !== "ready" ||
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
        state.fileStatus !== "ready" ||
        state.pendingRequestId === undefined ||
        message.requestId !== state.pendingRequestId
      ) {
        return state;
      }

      return {
        ...state,
        pendingRequestId: undefined,
        error: message.message,
      };
    case "csvOptionsUpdated":
      return {
        ...state,
        options: message.options,
        page: 0,
        sort: undefined,
        pendingRequestId: undefined,
        pendingSettingsRequestId:
          message.requestId === state.pendingSettingsRequestId
            ? undefined
            : state.pendingSettingsRequestId,
        settingsError: undefined,
        error: undefined,
      };
    case "csvOptionsError":
      if (message.requestId !== state.pendingSettingsRequestId) {
        return state;
      }

      return {
        ...state,
        pendingSettingsRequestId: undefined,
        settingsError: message.message,
      };
    case "fileStatus":
      if (
        message.revision < state.fileRevision ||
        (message.revision === state.fileRevision &&
          state.fileStatus !== "reloading") ||
        (message.revision === state.fileRevision &&
          message.status === state.fileStatus &&
          message.message === state.fileMessage)
      ) {
        return state;
      }

      return {
        ...state,
        fileStatus: message.status,
        fileRevision: message.revision,
        fileMessage: message.message,
        page: 0,
        sort: undefined,
        pendingRequestId: undefined,
        result:
          message.status === "missing" || message.status === "error"
            ? undefined
            : state.result,
        error: undefined,
      };
  }
}

export function beginSettingsUpdate(
  state: WebviewState,
  requestId: string,
): WebviewState | null {
  if (state.status !== "ready" || state.pendingSettingsRequestId !== undefined) {
    return null;
  }

  return {
    ...state,
    page: 0,
    pendingRequestId: undefined,
    pendingSettingsRequestId: requestId,
    settingsError: undefined,
    error: undefined,
  };
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
  if (
    state.status !== "ready" ||
    state.pendingRequestId !== undefined ||
    state.pendingSettingsRequestId !== undefined ||
    state.fileStatus !== "ready"
  ) {
    return null;
  }

  let sql: string;
  let page: number;
  let sort: QuerySort | undefined;

  switch (action) {
    case "run":
      sql = state.queryText;
      page = 0;
      sort = undefined;
      break;
    case "reload":
      sql = state.executedSql;
      page = 0;
      sort = state.sort;
      break;
    case "previous":
      if (state.result === undefined || state.page === 0) {
        return null;
      }

      sql = state.executedSql;
      page = state.page - 1;
      sort = state.sort;
      break;
    case "next":
      if (state.result === undefined || !state.result.hasNextPage) {
        return null;
      }

      sql = state.executedSql;
      page = state.page + 1;
      sort = state.sort;
      break;
  }

  const request: QueryRequest = {
    requestId,
    sql,
    page,
    pageSize: QUERY_PAGE_SIZE,
    sort,
  };

  return {
    request,
    state: {
      ...state,
      executedSql: sql,
      page,
      sort,
      pendingRequestId: requestId,
      error: undefined,
    },
  };
}

export function beginSort(
  state: WebviewState,
  columnIndex: number,
  requestId: string,
): { readonly state: WebviewState; readonly request: QueryRequest } | null {
  if (
    state.status !== "ready" ||
    state.pendingRequestId !== undefined ||
    state.pendingSettingsRequestId !== undefined ||
    state.fileStatus !== "ready" ||
    state.result === undefined ||
    !Number.isSafeInteger(columnIndex) ||
    columnIndex < 0 ||
    columnIndex >= state.result.columns.length
  ) {
    return null;
  }

  const sort: QuerySort = {
    columnIndex,
    direction:
      state.sort?.columnIndex === columnIndex &&
      state.sort.direction === "ascending"
        ? "descending"
        : "ascending",
  };
  const request: QueryRequest = {
    requestId,
    sql: state.executedSql,
    page: 0,
    pageSize: QUERY_PAGE_SIZE,
    sort,
  };

  return {
    request,
    state: {
      ...state,
      page: 0,
      sort,
      pendingRequestId: requestId,
      error: undefined,
    },
  };
}
