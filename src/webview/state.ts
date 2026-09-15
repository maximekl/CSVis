import type {
  CsvOptions,
  HostToWebviewMessage,
  QueryResult,
} from "../shared/protocol";

export type WebviewState =
  | { readonly status: "loading" }
  | {
      readonly status: "ready";
      readonly fileName: string;
      readonly initialQuery: string;
      readonly options: CsvOptions;
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
    };
  }

  if (state.status === "loading") {
    return state;
  }

  switch (message.type) {
    case "queryResult":
      return { ...state, result: message.result, error: undefined };
    case "queryError":
      return { ...state, result: undefined, error: message.message };
    case "csvOptionsUpdated":
      return { ...state, options: message.options };
  }
}
