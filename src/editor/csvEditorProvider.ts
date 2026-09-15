import path from "node:path";
import * as vscode from "vscode";

import { parseCsvOptions } from "../csv/csvOptions";
import type {
  HostToWebviewMessage,
  WebviewToHostMessage,
} from "../shared/protocol";
import {
  CsvCustomDocument,
  CsvSessionManager,
} from "./csvSessionManager";
import { CsvFileMonitor } from "./csvFileMonitor";
import { executeQueryRequest, isRunQueryMessage } from "./queryMessageHandler";
import { CsvSettingsStore } from "./csvSettingsStore";
import { renderWebviewHtml } from "./webviewHtml";

export const CSV_EDITOR_VIEW_TYPE = "csvis.csvViewer";
export const OPEN_CSV_COMMAND = "csvis.openCsvAsTable";
const INITIAL_QUERY = "SELECT * FROM csv";

interface PanelEndpoint {
  readonly webview: vscode.Webview;
  readonly isClosed: () => boolean;
}

export class CsvEditorProvider
  implements vscode.CustomReadonlyEditorProvider<CsvCustomDocument>
{
  private readonly panelResources = new Set<vscode.Disposable>();
  private readonly panelsByUri = new Map<string, Set<PanelEndpoint>>();
  private readonly settingsUpdateTails = new Map<string, Promise<void>>();
  private readonly monitorsByUri = new Map<string, CsvFileMonitor>();

  public constructor(
    private readonly sessions: CsvSessionManager,
    private readonly extensionUri: vscode.Uri,
    private readonly settings: CsvSettingsStore,
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
    const uriKey = document.uri.toString();
    const panel = { webview, isClosed: () => panelClosed };
    const openPanels = this.panelsByUri.get(uriKey) ?? new Set<PanelEndpoint>();
    openPanels.add(panel);
    this.panelsByUri.set(uriKey, openPanels);
    this.ensureFileMonitor(document);

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
            void this.initializePanel(
              document,
              webview,
              fileName,
              () => panelClosed,
            );
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
        } else if (initialized && isUpdateCsvOptionsMessage(value)) {
          void this.enqueueSettingsUpdate(
            document,
            panel,
            value.requestId,
            value.options,
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
        openPanels.delete(panel);

        if (openPanels.size === 0) {
          this.panelsByUri.delete(uriKey);
          this.monitorsByUri.get(uriKey)?.dispose();
          this.monitorsByUri.delete(uriKey);
        }

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
      options: this.settings.get(document.uri),
      initialQuery: INITIAL_QUERY,
      fileStatus: document.session.currentFileStatus,
      fileRevision: document.session.currentFileRevision,
      ...(document.session.currentFileMessage === undefined
        ? {}
        : { fileMessage: document.session.currentFileMessage }),
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
    const fileRevision = document.session.currentFileRevision;
    const response = await executeQueryRequest(document.session, request);

    if (
      !isClosed() &&
      fileRevision === document.session.currentFileRevision &&
      document.session.currentFileStatus === "ready"
    ) {
      try {
        await webview.postMessage(response);
      } catch {
        // The panel may have closed while the result was being sent.
      }
    }
  }

  private ensureFileMonitor(document: CsvCustomDocument): void {
    const key = document.uri.toString();

    if (this.monitorsByUri.has(key)) {
      return;
    }

    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(
        vscode.Uri.file(path.dirname(document.uri.fsPath)),
        path.basename(document.uri.fsPath),
      ),
    );
    const monitor = new CsvFileMonitor(
      document.session,
      watcher,
      () => this.settings.get(document.uri),
      (message) => {
        void this.broadcastFileStatus(key, message);
      },
    );
    this.monitorsByUri.set(key, monitor);
  }

  private async broadcastFileStatus(
    key: string,
    message: Extract<HostToWebviewMessage, { readonly type: "fileStatus" }>,
  ): Promise<void> {
    await Promise.all(
      [...(this.panelsByUri.get(key) ?? [])].map((panel) =>
        this.postPanelMessage(panel, message),
      ),
    );
  }

  private enqueueSettingsUpdate(
    document: CsvCustomDocument,
    panel: PanelEndpoint,
    requestId: string,
    options: unknown,
  ): Promise<void> {
    const key = document.uri.toString();
    const previous = this.settingsUpdateTails.get(key) ?? Promise.resolve();
    const update = previous.then(() =>
      this.applySettingsUpdate(document, panel, requestId, options),
    );
    const tail = update.then(() => undefined, () => undefined);
    this.settingsUpdateTails.set(key, tail);
    void tail.then(() => {
      if (this.settingsUpdateTails.get(key) === tail) {
        this.settingsUpdateTails.delete(key);
      }
    });
    return update;
  }

  private async applySettingsUpdate(
    document: CsvCustomDocument,
    panel: PanelEndpoint,
    requestId: string,
    options: unknown,
  ): Promise<void> {
    const previousOptions = this.settings.get(document.uri);

    try {
      const validated = parseCsvOptions(options);
      await document.session.updateOptions(validated);

      try {
        await this.settings.set(document.uri, validated);
      } catch (error: unknown) {
        await document.session.updateOptions(previousOptions);
        throw error;
      }

      for (const openPanel of this.panelsByUri.get(document.uri.toString()) ?? []) {
        await this.postPanelMessage(openPanel, {
          type: "csvOptionsUpdated",
          options: validated,
          ...(openPanel === panel ? { requestId } : {}),
        });
      }
    } catch (error: unknown) {
      await this.postPanelMessage(panel, {
        type: "csvOptionsError",
        requestId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async postPanelMessage(
    panel: PanelEndpoint,
    message: HostToWebviewMessage,
  ): Promise<void> {
    if (panel.isClosed()) {
      return;
    }

    try {
      await panel.webview.postMessage(message);
    } catch {
      // A panel may close while a settings response is being sent.
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

function isUpdateCsvOptionsMessage(
  value: unknown,
): value is Extract<WebviewToHostMessage, { readonly type: "updateCsvOptions" }> {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "updateCsvOptions" &&
    "options" in value &&
    "requestId" in value &&
    typeof value.requestId === "string" &&
    value.requestId.length > 0
  );
}
