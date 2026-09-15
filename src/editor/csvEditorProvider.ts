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
import { renderWebviewHtml } from "./webviewHtml";

export const CSV_EDITOR_VIEW_TYPE = "csvis.csvViewer";
export const OPEN_CSV_COMMAND = "csvis.openCsvAsTable";
const INITIAL_QUERY = "SELECT * FROM csv";
const INITIAL_REQUEST_ID = "initial-preview";

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
        if (!isReadyMessage(value) || initialized || panelClosed) {
          return;
        }

        initialized = true;
        void this.initializePanel(
          document,
          webview,
          fileName,
          () => panelClosed,
        );
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
    document: CsvCustomDocument,
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
      if (!(await webview.postMessage(initializeMessage)) || isClosed()) {
        return;
      }

      const result = await document.session.executeQuery({
        requestId: INITIAL_REQUEST_ID,
        sql: INITIAL_QUERY,
        page: 0,
        pageSize: 200,
      });

      if (!isClosed()) {
        const resultMessage: HostToWebviewMessage = {
          type: "queryResult",
          result,
        };
        await webview.postMessage(resultMessage);
      }
    } catch (error: unknown) {
      if (!isClosed()) {
        const errorMessage: HostToWebviewMessage = {
          type: "queryError",
          requestId: INITIAL_REQUEST_ID,
          message: error instanceof Error ? error.message : String(error),
        };
        try {
          await webview.postMessage(errorMessage);
        } catch {
          // The panel may have closed while the error was being reported.
        }
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
