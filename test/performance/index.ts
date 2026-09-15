import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import { performance } from "node:perf_hooks";

import * as vscode from "vscode";

import type { IntegrationTestApi } from "../../src/extension";
import type { HostToWebviewMessage, QueryRequest } from "../../src/shared/protocol";

const EXTENSION_ID = "MaximeK.csvis";
const VIEW_TYPE = "csvis.csvViewer";
const OPEN_COMMAND = "csvis.openCsvAsTable";
const MIN_FILE_BYTES = 500 * 1024 * 1024;
const PAGE_SIZE = 200;

export async function run(): Promise<void> {
  const filePath = process.env.CSVIS_PERFORMANCE_CSV_PATH;
  assert.ok(filePath, "performance fixture path must be provided");
  const fileStat = await stat(filePath);
  assert.ok(fileStat.size >= MIN_FILE_BYTES, "fixture must be at least 500 MiB");
  const uri = vscode.Uri.file(filePath);
  const extension = vscode.extensions.getExtension<IntegrationTestApi | undefined>(
    EXTENSION_ID,
  );
  assert.ok(extension, "CSVis must be installed in the test host");

  const baselineRss = process.memoryUsage().rss;
  let peakRss = baselineRss;
  const sample = (): void => {
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  };
  const monitor = setInterval(sample, 50);

  try {
    console.log("Performance: opening the 500 MiB CSV in CSVis");
    const openStarted = performance.now();
    await vscode.commands.executeCommand(OPEN_COMMAND, uri);
    await waitFor(() => {
      const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
      return (
        input instanceof vscode.TabInputCustom &&
        input.viewType === VIEW_TYPE &&
        input.uri.toString() === uri.toString()
      );
    }, "performance custom editor");
    assert.equal(extension.isActive, true);
    const api = extension.exports;
    assert.ok(api, "test-only session probe must be available");
    await waitFor(() => api.activeSessionCount() === 1, "open CSV session");
    const openMs = Math.round(performance.now() - openStarted);
    const afterOpenRss = process.memoryUsage().rss;

    console.log("Performance: querying two 200-row pages");
    const firstStarted = performance.now();
    const firstResponse = await api.executeQuery(
      uri,
      request("page-0", 0),
    );
    const firstPageMs = Math.round(performance.now() - firstStarted);
    const firstTransferBytes = assertBoundedPage(firstResponse, "page-0", 0);
    const afterFirstPageRss = process.memoryUsage().rss;

    const secondStarted = performance.now();
    const secondResponse = await api.executeQuery(
      uri,
      request("page-1", 1),
    );
    const secondPageMs = Math.round(performance.now() - secondStarted);
    const secondTransferBytes = assertBoundedPage(secondResponse, "page-1", 1);
    const afterSecondPageRss = process.memoryUsage().rss;

    console.log("Performance: closing and checking session cleanup");
    const closeStarted = performance.now();
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    await waitFor(() => api.activeSessionCount() === 0, "closed CSV session");
    const closeMs = Math.round(performance.now() - closeStarted);
    assert.throws(
      () => api.executeQuery(uri, request("closed", 0)),
      /No open CSV session/u,
    );
    sample();
    const afterCloseRss = process.memoryUsage().rss;
    peakRss = Math.max(peakRss, afterCloseRss);

    console.log(JSON.stringify({
      phase: "extensionHost",
      fileBytes: fileStat.size,
      openMs,
      firstPageMs,
      secondPageMs,
      closeMs,
      firstTransferBytes,
      secondTransferBytes,
      baselineRss,
      afterOpenRss,
      afterFirstPageRss,
      afterSecondPageRss,
      afterCloseRss,
      peakRss,
    }));
    console.log("Performance: all 500 MiB CSV checks passed");
  } finally {
    clearInterval(monitor);
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
  }
}

function request(requestId: string, page: number): QueryRequest {
  return { requestId, sql: "SELECT * FROM csv", page, pageSize: PAGE_SIZE };
}

function assertBoundedPage(
  response: HostToWebviewMessage,
  requestId: string,
  page: number,
): number {
  assert.equal(response.type, "queryResult");
  assert.equal(response.result.requestId, requestId);
  assert.equal(response.result.page, page);
  assert.equal(response.result.rows.length, PAGE_SIZE);
  assert.equal(response.result.hasNextPage, true);
  assert.ok(response.result.rows.length <= 201);

  const transferBytes = Buffer.byteLength(JSON.stringify(response));
  assert.ok(
    transferBytes < 256 * 1024,
    "the webview message must contain only one small result page",
  );
  return transferBytes;
}

async function waitFor(
  condition: () => boolean,
  description: string,
): Promise<void> {
  const deadline = Date.now() + 120_000;

  while (!condition()) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for ${description}`);
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
}
