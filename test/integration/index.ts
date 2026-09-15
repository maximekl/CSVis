import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import * as vscode from "vscode";

import type { IntegrationTestApi } from "../../src/extension";
import type { HostToWebviewMessage, QueryRequest } from "../../src/shared/protocol";

const EXTENSION_ID = "MaximeK.csvis";
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

    const weatherCsvPath = process.env.CSVIS_RECIPE_WEATHER_CSV_PATH;

    if (weatherCsvPath !== undefined) {
      const weatherUri = vscode.Uri.file(weatherCsvPath);
      const originalCsv = await readFile(weatherCsvPath, "utf8");

      console.log("Recipe: real CSV opens by default and SQL aggregation succeeds");
      await vscode.commands.executeCommand("vscode.open", weatherUri);
      await waitForCustomTab(weatherUri);
      await waitFor(() => api.activeSessionCount() === 1, "weather CSV session");

      const weatherResult = await api.executeQuery(
        weatherUri,
        request(
          "weather",
          "SELECT count(*) AS days, " +
            "count(*) FILTER (WHERE precipitation > 0) AS rainy_days FROM csv",
        ),
      );
      assert.equal(weatherResult.type, "queryResult");
      assert.equal(Number(weatherResult.result.rows[0]?.[0]), 1461);
      assert.equal(Number(weatherResult.result.rows[0]?.[1]), 623);

      console.log("Recipe: reopen the real CSV in the text editor unchanged");
      await vscode.commands.executeCommand("vscode.openWith", weatherUri, "default");
      await waitFor(() => {
        const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
        return (
          input instanceof vscode.TabInputText &&
          input.uri.toString() === weatherUri.toString()
        );
      }, "text editor for weather CSV");
      const textDocument = await vscode.workspace.openTextDocument(weatherUri);
      assert.equal(textDocument.getText(), originalCsv);

      const customTabs = vscode.window.tabGroups.all
        .flatMap((group) => group.tabs)
        .filter((tab) =>
          tab.input instanceof vscode.TabInputCustom &&
          tab.input.viewType === VIEW_TYPE &&
          tab.input.uri.toString() === weatherUri.toString()
        );
      assert.equal(customTabs.length, 1);
      assert.equal(await vscode.window.tabGroups.close(customTabs), true);
      await waitFor(() => api.activeSessionCount() === 0, "weather session closed");
      await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    }

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
