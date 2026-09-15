import { createRoot } from "react-dom/client";

import type {
  HostToWebviewMessage,
  WebviewToHostMessage,
} from "../shared/protocol";
import { App } from "./App";
import {
  applyHostMessage,
  beginQuery,
  INITIAL_WEBVIEW_STATE,
  updateQueryText,
  type QueryAction,
} from "./state";
import "./styles.css";
import "./grid/dataGrid.css";
import "./sqlConsole.css";

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

const actions = {
  onQueryTextChange: (queryText: string): void => {
    state = updateQueryText(state, queryText);
    render();
  },
  onRunQuery: (): void => submitQuery("run"),
  onPreviousPage: (): void => submitQuery("previous"),
  onNextPage: (): void => submitQuery("next"),
};

render();

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (!isHostMessage(event.data)) {
    return;
  }

  state = applyHostMessage(state, event.data);
  render();

  if (event.data.type === "initialize") {
    submitQuery("run");
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
        value.options !== null
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
        value.options !== null
      );
    default:
      return false;
  }
}
