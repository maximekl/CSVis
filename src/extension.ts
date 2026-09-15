import * as vscode from "vscode";

import {
  CSV_EDITOR_VIEW_TYPE,
  CsvEditorProvider,
  OPEN_CSV_COMMAND,
} from "./editor/csvEditorProvider";
import { CsvSessionManager } from "./editor/csvSessionManager";
import { CsvSession } from "./editor/csvSession";
import { CsvSettingsStore } from "./editor/csvSettingsStore";
import { executeQueryRequest } from "./editor/queryMessageHandler";
import type { HostToWebviewMessage, QueryRequest } from "./shared/protocol";

export interface IntegrationTestApi {
  readonly activeSessionCount: () => number;
  readonly executeQuery: (
    uri: vscode.Uri,
    request: QueryRequest,
  ) => Promise<HostToWebviewMessage>;
}

export function activate(
  context: vscode.ExtensionContext,
): IntegrationTestApi | undefined {
  const settings = new CsvSettingsStore(context.workspaceState);
  const sessions = new CsvSessionManager((uri) =>
    CsvSession.create(uri, settings.get(uri))
  );
  const provider = new CsvEditorProvider(
    sessions,
    context.extensionUri,
    settings,
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

  if (process.env.CSVIS_INTEGRATION_TEST !== "1") {
    return undefined;
  }

  // VS Code's test host can verify the real provider session without a UI driver.
  return {
    activeSessionCount: () => sessions.activeSessionCount,
    executeQuery: (uri, request) => {
      const session = sessions.getSession(uri);

      if (session === undefined) {
        throw new Error("No open CSV session for this URI");
      }

      return executeQueryRequest(session, request);
    },
  };
}

export function deactivate(): void {}
