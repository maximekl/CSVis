import { createRoot } from "react-dom/client";

import type {
  HostToWebviewMessage,
  WebviewToHostMessage,
} from "../shared/protocol";
import { App } from "./App";
import { applyHostMessage, INITIAL_WEBVIEW_STATE } from "./state";
import "./styles.css";
import "./grid/dataGrid.css";

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

root.render(<App state={state} />);

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (!isHostMessage(event.data)) {
    return;
  }

  state = applyHostMessage(state, event.data);
  root.render(<App state={state} />);
});

vscodeApi.postMessage({ type: "ready" });

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
        "columns" in value.result &&
        Array.isArray(value.result.columns) &&
        "rows" in value.result &&
        Array.isArray(value.result.rows)
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
