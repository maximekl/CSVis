import * as vscode from "vscode";

import {
  CSV_EDITOR_VIEW_TYPE,
  CsvEditorProvider,
  OPEN_CSV_COMMAND,
} from "./editor/csvEditorProvider";
import { CsvSessionManager } from "./editor/csvSessionManager";

export function activate(context: vscode.ExtensionContext): void {
  const provider = new CsvEditorProvider(
    new CsvSessionManager(),
    context.extensionUri,
  );
  const providerRegistration = vscode.window.registerCustomEditorProvider(
    CSV_EDITOR_VIEW_TYPE,
    provider,
    {
      supportsMultipleEditorsPerDocument: true,
      webviewOptions: { retainContextWhenHidden: false },
    },
  );
  const commandRegistration = vscode.commands.registerCommand(
    OPEN_CSV_COMMAND,
    async (resource?: vscode.Uri) => {
      const uri = resource ?? vscode.window.activeTextEditor?.document.uri;

      if (uri === undefined) {
        await vscode.window.showErrorMessage("Open a CSV file first.");
        return;
      }

      await vscode.commands.executeCommand(
        "vscode.openWith",
        uri,
        CSV_EDITOR_VIEW_TYPE,
      );
    },
  );

  context.subscriptions.push(
    providerRegistration,
    commandRegistration,
    provider,
  );
}

export function deactivate(): void {}
