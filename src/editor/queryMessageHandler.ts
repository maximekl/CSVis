import type { CsvSession } from "./csvSession";
import type {
  HostToWebviewMessage,
  QueryRequest,
  WebviewToHostMessage,
} from "../shared/protocol";

export async function executeQueryRequest(
  session: CsvSession,
  request: QueryRequest,
): Promise<HostToWebviewMessage> {
  try {
    return {
      type: "queryResult",
      result: await session.executeQuery(request),
    };
  } catch (error: unknown) {
    return {
      type: "queryError",
      requestId: request.requestId,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export function isRunQueryMessage(
  value: unknown,
): value is Extract<WebviewToHostMessage, { readonly type: "runQuery" }> {
  if (
    typeof value !== "object" ||
    value === null ||
    !("type" in value) ||
    value.type !== "runQuery" ||
    !("request" in value) ||
    typeof value.request !== "object" ||
    value.request === null
  ) {
    return false;
  }

  const request = value.request;

  return (
    "requestId" in request &&
    typeof request.requestId === "string" &&
    "sql" in request &&
    typeof request.sql === "string" &&
    "page" in request &&
    typeof request.page === "number" &&
    "pageSize" in request &&
    typeof request.pageSize === "number"
  );
}
