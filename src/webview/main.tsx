import { createRoot } from "react-dom/client";

import type {
  CsvOptions,
  HostToWebviewMessage,
  WebviewToHostMessage,
} from "../shared/protocol";
import { App } from "./App";
import {
  applyHostMessage,
  beginQuery,
  beginSort,
  beginSettingsUpdate,
  INITIAL_WEBVIEW_STATE,
  updateQueryText,
  type QueryAction,
} from "./state";
import "./styles.css";
import "./grid/dataGrid.css";
import "./sqlConsole.css";
import "./csvSettings.css";

interface VsCodeApi {
  postMessage(message: WebviewToHostMessage): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const rootElement = document.getElementById("root");

if (rootElement === null) {
  throw new Error("CSVis webview root is missing");
}

const root = createRoot(rootElement);
const vscodeApi = acquireVsCodeApi();
let state = INITIAL_WEBVIEW_STATE;
let nextRequestNumber = 0;
let nextSettingsRequestNumber = 0;

const actions = {
  onQueryTextChange: (queryText: string): void => {
    state = updateQueryText(state, queryText);
    render();
  },
  onRunQuery: (): void => submitQuery("run"),
  onPreviousPage: (): void => submitQuery("previous"),
  onNextPage: (): void => submitQuery("next"),
  onSortColumn: (columnIndex: number): void => submitSort(columnIndex),
  onApplyCsvOptions: (options: CsvOptions): void => {
    const requestId = `settings-${++nextSettingsRequestNumber}`;
    const pending = beginSettingsUpdate(state, requestId);

    if (pending === null) {
      return;
    }

    state = pending;
    render();
    vscodeApi.postMessage({ type: "updateCsvOptions", requestId, options });
  },
};

render();

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (!isHostMessage(event.data)) {
    return;
  }

  const message = event.data;
  const previousState = state;
  state = applyHostMessage(state, message);
  render();

  if (
    message.type === "initialize" &&
    state.status === "ready" &&
    state.fileStatus === "ready"
  ) {
    submitQuery("run");
  } else if (
    (message.type === "csvOptionsUpdated" ||
      message.type === "csvOptionsError") &&
    state !== previousState &&
    state.status === "ready" &&
    state.pendingSettingsRequestId === undefined
  ) {
    submitQuery("reload");
  } else if (
    message.type === "fileStatus" &&
    message.status === "ready" &&
    state !== previousState &&
    state.status === "ready"
  ) {
    submitQuery("reload");
  }
});

vscodeApi.postMessage({ type: "ready" });

function render(): void {
  root.render(<App state={state} actions={actions} />);
}

function submitQuery(action: QueryAction): void {
  const attempt = beginQuery(
    state,
    action,
    `query-${nextRequestNumber + 1}`,
  );

  if (attempt === null) {
    return;
  }

  nextRequestNumber += 1;
  state = attempt.state;
  render();
  vscodeApi.postMessage({ type: "runQuery", request: attempt.request });
}

function submitSort(columnIndex: number): void {
  const attempt = beginSort(
    state,
    columnIndex,
    `query-${nextRequestNumber + 1}`,
  );

  if (attempt === null) {
    return;
  }

  nextRequestNumber += 1;
  state = attempt.state;
  render();
  vscodeApi.postMessage({ type: "runQuery", request: attempt.request });
}

function isHostMessage(value: unknown): value is HostToWebviewMessage {
  if (typeof value !== "object" || value === null || !("type" in value)) {
    return false;
  }

  switch (value.type) {
    case "initialize":
      return (
        "fileName" in value &&
        typeof value.fileName === "string" &&
        "initialQuery" in value &&
        typeof value.initialQuery === "string" &&
        "options" in value &&
        typeof value.options === "object" &&
        value.options !== null &&
        (!("fileStatus" in value) ||
          value.fileStatus === "ready" ||
          value.fileStatus === "reloading" ||
          value.fileStatus === "missing" ||
          value.fileStatus === "error") &&
        (!("fileRevision" in value) ||
          (typeof value.fileRevision === "number" &&
            Number.isSafeInteger(value.fileRevision) &&
            value.fileRevision >= 0)) &&
        (!("fileMessage" in value) ||
          value.fileMessage === undefined ||
          typeof value.fileMessage === "string")
      );
    case "queryResult":
      return (
        "result" in value &&
        typeof value.result === "object" &&
        value.result !== null &&
        "requestId" in value.result &&
        typeof value.result.requestId === "string" &&
        "columns" in value.result &&
        Array.isArray(value.result.columns) &&
        "rows" in value.result &&
        Array.isArray(value.result.rows) &&
        "page" in value.result &&
        typeof value.result.page === "number" &&
        "pageSize" in value.result &&
        typeof value.result.pageSize === "number" &&
        "hasNextPage" in value.result &&
        typeof value.result.hasNextPage === "boolean"
      );
    case "queryError":
      return (
        "requestId" in value &&
        typeof value.requestId === "string" &&
        "message" in value &&
        typeof value.message === "string"
      );
    case "csvOptionsUpdated":
      return (
        "options" in value &&
        typeof value.options === "object" &&
        value.options !== null &&
        (!("requestId" in value) || typeof value.requestId === "string")
      );
    case "csvOptionsError":
      return (
        "requestId" in value &&
        typeof value.requestId === "string" &&
        "message" in value &&
        typeof value.message === "string"
      );
    case "fileStatus":
      return (
        "status" in value &&
        (value.status === "ready" ||
          value.status === "reloading" ||
          value.status === "missing" ||
          value.status === "error") &&
        "revision" in value &&
        Number.isSafeInteger(value.revision) &&
        typeof value.revision === "number" &&
        value.revision >= 0 &&
        (!("message" in value) ||
          value.message === undefined ||
          typeof value.message === "string")
      );
    default:
      return false;
  }
}
