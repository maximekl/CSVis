import path from "node:path";
import * as vscode from "vscode";

import {
  CsvCustomDocument,
  CsvSessionManager,
} from "./csvSessionManager";

export const CSV_EDITOR_VIEW_TYPE = "csvis.csvViewer";
export const OPEN_CSV_COMMAND = "csvis.openCsvAsTable";

export class CsvEditorProvider
  implements vscode.CustomReadonlyEditorProvider<CsvCustomDocument>
{
  public constructor(private readonly sessions: CsvSessionManager) {}

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
    const fileName = escapeHtml(path.basename(document.uri.fsPath));

    webviewPanel.webview.options = { enableScripts: false };
    webviewPanel.webview.html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CSVis</title>
  </head>
  <body>
    <p>Preparing ${fileName}&hellip;</p>
  </body>
</html>`;
  }

  public dispose(): void {
    this.sessions.dispose();
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return character;
    }
  });
}
