import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import * as vscode from "vscode";

import type { IntegrationTestApi } from "../../src/extension";
import type { HostToWebviewMessage, QueryRequest } from "../../src/shared/protocol";

const EXTENSION_ID = "csvis.csvis";
const VIEW_TYPE = "csvis.csvViewer";
const OPEN_COMMAND = "csvis.openCsvAsTable";

export async function run(): Promise<void> {
  const fixtureDir = await mkdtemp(path.join(os.tmpdir(), "csvis-integration-"));
  const firstUri = vscode.Uri.file(path.join(fixtureDir, "command.csv"));
  const secondUri = vscode.Uri.file(path.join(fixtureDir, "default.csv"));
  const otherUri = vscode.Uri.file(path.join(fixtureDir, "other.csv"));

  try {
    await writeFile(firstUri.fsPath, "id,name\n1,Ada\n2,Lin\n");
    await writeFile(secondUri.fsPath, "id,name\n3,Pat\n4,Sam\n");
    await writeFile(otherUri.fsPath, "secret\nprivate\n");

    const extension = vscode.extensions.getExtension<IntegrationTestApi | undefined>(
      EXTENSION_ID,
    );
    assert.ok(extension, "CSVis must be installed in the test host");

    console.log("Integration: command activation and custom editor opening");
    await vscode.commands.executeCommand(OPEN_COMMAND, firstUri);
    await waitForCustomTab(firstUri);
    assert.equal(extension.isActive, true);
    const api = extension.exports;
    assert.ok(api, "test-only session probe must be available");
    await waitFor(() => api.activeSessionCount() === 1, "command session");

    console.log("Integration: query result and SQL/security errors");
    const result = await api.executeQuery(
      firstUri,
      request("good", "SELECT count(*) AS total FROM csv"),
    );
    assert.equal(result.type, "queryResult");
    assert.equal(Number(result.result.rows[0]?.[0]), 2);

    const invalidSql = await api.executeQuery(
      firstUri,
      request("invalid", "DELETE FROM csv"),
    );
    assertQueryError(invalidSql, "invalid");

    const forbiddenFile = await api.executeQuery(
      firstUri,
      request(
        "forbidden",
        `SELECT * FROM read_csv('${otherUri.fsPath.replaceAll("'", "''")}')`,
      ),
    );
    assertQueryError(forbiddenFile, "forbidden");

    console.log("Integration: closing releases the DuckDB session");
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    await waitFor(() => api.activeSessionCount() === 0, "closed session");
    assert.throws(
      () => api.executeQuery(firstUri, request("closed", "SELECT * FROM csv")),
      /No open CSV session/u,
    );

    console.log("Integration: a CSV opens in CSVis by default");
    await vscode.commands.executeCommand("vscode.open", secondUri);
    await waitForCustomTab(secondUri);
    await waitFor(() => api.activeSessionCount() === 1, "default session");
    const defaultResult = await api.executeQuery(
      secondUri,
      request("default", "SELECT name FROM csv ORDER BY id"),
    );
    assert.equal(defaultResult.type, "queryResult");
    assert.deepEqual(defaultResult.result.rows, [["Pat"], ["Sam"]]);

    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    await waitFor(() => api.activeSessionCount() === 0, "final close");
    console.log("Integration: all Extension Development Host scenarios passed");
  } finally {
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    await rm(fixtureDir, { recursive: true, force: true });
  }
}

function request(requestId: string, sql: string): QueryRequest {
  return { requestId, sql, page: 0, pageSize: 200 };
}

function assertQueryError(
  response: HostToWebviewMessage,
  requestId: string,
): void {
  assert.equal(response.type, "queryError");
  assert.equal(response.requestId, requestId);
  assert.ok(response.message.length > 0);
}

async function waitForCustomTab(uri: vscode.Uri): Promise<void> {
  await waitFor(() => {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    return (
      input instanceof vscode.TabInputCustom &&
      input.viewType === VIEW_TYPE &&
      input.uri.toString() === uri.toString()
    );
  }, `custom editor for ${uri.fsPath}`);
}

async function waitFor(
  condition: () => boolean,
  description: string,
): Promise<void> {
  const deadline = Date.now() + 15_000;

  while (!condition()) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for ${description}`);
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
}
