import path from "node:path";
import * as vscode from "vscode";

import { DEFAULT_CSV_OPTIONS } from "../csv/csvOptions";
import type {
  HostToWebviewMessage,
  WebviewToHostMessage,
} from "../shared/protocol";
import {
  CsvCustomDocument,
  CsvSessionManager,
} from "./csvSessionManager";
import { executeQueryRequest, isRunQueryMessage } from "./queryMessageHandler";
import { renderWebviewHtml } from "./webviewHtml";

export const CSV_EDITOR_VIEW_TYPE = "csvis.csvViewer";
export const OPEN_CSV_COMMAND = "csvis.openCsvAsTable";
const INITIAL_QUERY = "SELECT * FROM csv";

export class CsvEditorProvider
  implements vscode.CustomReadonlyEditorProvider<CsvCustomDocument>
{
  private readonly panelResources = new Set<vscode.Disposable>();

  public constructor(
    private readonly sessions: CsvSessionManager,
    private readonly extensionUri: vscode.Uri,
  ) {}

  public async openCustomDocument(
    uri: vscode.Uri,
    _openContext: vscode.CustomDocumentOpenContext,
    token: vscode.CancellationToken,
  ): Promise<CsvCustomDocument> {
    if (token.isCancellationRequested) {
      throw new vscode.CancellationError();
    }

    const document = await this.sessions.open(uri);

    if (token.isCancellationRequested) {
      document.dispose();
      throw new vscode.CancellationError();
    }

    return document;
  }

  public resolveCustomEditor(
    document: CsvCustomDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): void {
    const assetsUri = vscode.Uri.joinPath(this.extensionUri, "dist", "webview");
    const webview = webviewPanel.webview;
    const fileName = path.basename(document.uri.fsPath);
    let initialized = false;
    let panelClosed = false;

    webview.options = {
      enableScripts: true,
      localResourceRoots: [assetsUri],
    };

    const messageSubscription = webview.onDidReceiveMessage(
      (value: unknown) => {
        if (panelClosed) {
          return;
        }

        if (isReadyMessage(value)) {
          if (!initialized) {
            initialized = true;
            void this.initializePanel(webview, fileName, () => panelClosed);
          }

          return;
        }

        if (initialized && isRunQueryMessage(value)) {
          void this.executePanelQuery(
            document,
            webview,
            value.request,
            () => panelClosed,
          );
        }
      },
    );
    let closeSubscription: vscode.Disposable | undefined;
    const panelResource: vscode.Disposable = {
      dispose: () => {
        panelClosed = true;
        messageSubscription.dispose();
        closeSubscription?.dispose();
        this.panelResources.delete(panelResource);
      },
    };

    closeSubscription = webviewPanel.onDidDispose(() => {
      panelResource.dispose();
    });
    this.panelResources.add(panelResource);

    webview.html = renderWebviewHtml({
      fileName,
      scriptUri: webview
        .asWebviewUri(vscode.Uri.joinPath(assetsUri, "main.js"))
        .toString(),
      styleUri: webview
        .asWebviewUri(vscode.Uri.joinPath(assetsUri, "main.css"))
        .toString(),
      cspSource: webview.cspSource,
    });
  }

  public dispose(): void {
    for (const resource of [...this.panelResources]) {
      resource.dispose();
    }

    this.sessions.dispose();
  }

  private async initializePanel(
    webview: vscode.Webview,
    fileName: string,
    isClosed: () => boolean,
  ): Promise<void> {
    const initializeMessage: HostToWebviewMessage = {
      type: "initialize",
      fileName,
      options: DEFAULT_CSV_OPTIONS,
      initialQuery: INITIAL_QUERY,
    };

    if (isClosed()) {
      return;
    }

    try {
      await webview.postMessage(initializeMessage);
    } catch {
      // The panel may have closed while initialization was being sent.
    }
  }

  private async executePanelQuery(
    document: CsvCustomDocument,
    webview: vscode.Webview,
    request: Extract<
      WebviewToHostMessage,
      { readonly type: "runQuery" }
    >["request"],
    isClosed: () => boolean,
  ): Promise<void> {
    const response = await executeQueryRequest(document.session, request);

    if (!isClosed()) {
      try {
        await webview.postMessage(response);
      } catch {
        // The panel may have closed while the result was being sent.
      }
    }
  }
}

function isReadyMessage(
  value: unknown,
): value is Extract<WebviewToHostMessage, { readonly type: "ready" }> {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "ready"
  );
}
