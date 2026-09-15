import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, rmdir, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Disposable, FileSystemWatcher, Uri } from "vscode";

import { DEFAULT_CSV_OPTIONS } from "../src/csv/csvOptions";
import { CsvFileMonitor } from "../src/editor/csvFileMonitor";
import { CsvSession } from "../src/editor/csvSession";
import type { HostToWebviewMessage, QueryRequest } from "../src/shared/protocol";
import { App } from "../src/webview/App";
import {
  applyHostMessage,
  beginQuery,
  INITIAL_WEBVIEW_STATE,
  type WebviewState,
} from "../src/webview/state";

type FileStatusMessage = Extract<HostToWebviewMessage, { readonly type: "fileStatus" }>;
const QUERY: QueryRequest = {
  requestId: "file-query",
  sql: "SELECT * FROM csv ORDER BY id",
  page: 0,
  pageSize: 200,
};

test("invalidates stale queries, reloads changed content, and handles deletion and recreation", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "csvis-file-watch-"));
  const filePath = path.join(directory, "watched.csv");
  await writeFile(filePath, "id,name\n1,Alice\n");
  const uri = fileUri(filePath);
  const session = await CsvSession.create(uri);
  const watcher = new FakeWatcher();
  const messages: FileStatusMessage[] = [];
  const monitor = new CsvFileMonitor(
    session,
    watcher as unknown as FileSystemWatcher,
    () => DEFAULT_CSV_OPTIONS,
    (message) => messages.push(message),
  );

  try {
    const firstResult = await session.executeQuery(QUERY);
    assert.deepEqual(firstResult.rows, [["1", "Alice"]]);
    let state = initialState();
    const firstRequest = beginQuery(state, "run", "first-request");
    assert.ok(firstRequest);
    state = applyHostMessage(firstRequest.state, {
      type: "queryResult",
      result: { ...firstResult, requestId: "first-request" },
    });
    assert.equal(state.status, "ready");

    await writeFile(filePath, "id,name\n1,Bob\n2,Zoë\n");
    const pendingQuery = session.executeQuery({ ...QUERY, requestId: "stale" });
    watcher.emitChange(uri);
    const loading = messages.at(-1);
    assert.equal(loading?.status, "reloading");
    assert.equal(loading?.revision, 1);
    await assert.rejects(pendingQuery, /CSV file changed or is unavailable/);
    state = applyHostMessage(state, loading!);
    assert.equal(state.status, "ready");
    if (state.status !== "ready") {
      throw new Error("Webview unexpectedly closed");
    }
    assert.equal(state.result, undefined);
    assert.equal(state.pendingRequestId, undefined);
    assert.equal(beginQuery(state, "reload", "not-yet"), null);
    assert.equal(
      applyHostMessage(state, {
        type: "queryResult",
        result: { ...firstResult, requestId: "first-request" },
      }),
      state,
    );
    assert.doesNotMatch(renderToStaticMarkup(createElement(App, { state })), /Alice/);

    const ready = await waitForStatus(messages, "ready", 1);
    state = applyHostMessage(state, ready);
    const reloadRequest = beginQuery(state, "reload", "new-data");
    assert.ok(reloadRequest);
    assert.equal(reloadRequest.request.page, 0);
    const changedResult = await session.executeQuery(reloadRequest.request);
    assert.deepEqual(changedResult.rows, [["1", "Bob"], ["2", "Zoë"]]);

    await unlink(filePath);
    watcher.emitDelete(uri);
    const missing = messages.at(-1);
    assert.equal(missing?.status, "missing");
    state = applyHostMessage(reloadRequest.state, missing!);
    assert.equal(state.status, "ready");
    if (state.status !== "ready") {
      throw new Error("Webview unexpectedly closed");
    }
    assert.equal(state.result, undefined);
    assert.equal(beginQuery(state, "reload", "deleted"), null);
    await assert.rejects(session.executeQuery(QUERY), /CSV file changed or is unavailable/);
    const deletedMarkup = renderToStaticMarkup(createElement(App, { state }));
    assert.match(deletedMarkup, /CSV file was deleted/);
    assert.doesNotMatch(deletedMarkup, /Bob/);

    await writeFile(filePath, "id,name\n1,Recreated\n");
    watcher.emitCreate(uri);
    assert.equal(messages.at(-1)?.status, "reloading");
    const recreated = await waitForStatus(messages, "ready", 3);
    state = applyHostMessage(state, recreated);
    const restoredRequest = beginQuery(state, "reload", "recreated");
    assert.ok(restoredRequest);
    const restoredResult = await session.executeQuery(restoredRequest.request);
    assert.deepEqual(restoredResult.rows, [["1", "Recreated"]]);
    assert.equal(restoredRequest.request.page, 0);
  } finally {
    monitor.dispose();
    session.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("latest event wins, an unreadable path shows an error, and a later change recovers", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "csvis-file-error-"));
  const filePath = path.join(directory, "recover.csv");
  await writeFile(filePath, "id,name\n1,Valid\n");
  const uri = fileUri(filePath);
  const session = await CsvSession.create(uri);
  const watcher = new FakeWatcher();
  const messages: FileStatusMessage[] = [];
  const monitor = new CsvFileMonitor(
    session,
    watcher as unknown as FileSystemWatcher,
    () => DEFAULT_CSV_OPTIONS,
    (message) => messages.push(message),
  );

  try {
    await unlink(filePath);
    await mkdir(filePath);
    watcher.emitChange(uri);
    watcher.emitChange(uri);
    assert.equal(messages.at(-1)?.revision, 2);
    assert.equal(messages.at(-1)?.status, "reloading");
    const failed = await waitForStatus(messages, "error", 2);
    assert.match(failed.message ?? "", /CSV|read_csv|file/i);
    assert.equal(session.currentFileStatus, "error");
    assert.equal(beginQuery(applyHostMessage(initialState(), failed), "run", "bad"), null);
    const errored = applyHostMessage(
      applyHostMessage(initialState(), messages[0]!),
      failed,
    );
    assert.match(renderToStaticMarkup(createElement(App, { state: errored })), /CSV reload failed/);
    assert.equal(
      applyHostMessage(errored, {
        type: "fileStatus",
        status: "ready",
        revision: 1,
      }),
      errored,
    );

    await rmdir(filePath);
    await writeFile(filePath, "id,name\n1,Recovered\n");
    watcher.emitChange(uri);
    await waitForStatus(messages, "ready", 3);
    assert.equal(session.currentFileStatus, "ready");
    const result = await session.executeQuery(QUERY);
    assert.deepEqual(result.rows, [["1", "Recovered"]]);

    monitor.dispose();
    assert.equal(watcher.disposed, true);
    const revision = session.currentFileRevision;
    watcher.emitChange(uri);
    assert.equal(session.currentFileRevision, revision);
  } finally {
    monitor.dispose();
    session.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

function initialState(): WebviewState {
  return applyHostMessage(INITIAL_WEBVIEW_STATE, {
    type: "initialize",
    fileName: "watched.csv",
    options: DEFAULT_CSV_OPTIONS,
    initialQuery: "SELECT * FROM csv",
    fileStatus: "ready",
    fileRevision: 0,
  });
}

async function waitForStatus(
  messages: readonly FileStatusMessage[],
  status: FileStatusMessage["status"],
  revision: number,
): Promise<FileStatusMessage> {
  const deadline = Date.now() + 3000;

  while (Date.now() < deadline) {
    const match = messages.find(
      (message) => message.status === status && message.revision === revision,
    );

    if (match !== undefined) {
      return match;
    }

    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  throw new Error(`Timed out waiting for ${status} at revision ${revision}`);
}

class FakeWatcher {
  public disposed = false;
  private readonly changes = new Set<(uri: Uri) => void>();
  private readonly creations = new Set<(uri: Uri) => void>();
  private readonly deletions = new Set<(uri: Uri) => void>();

  public onDidChange = (listener: (uri: Uri) => void): Disposable =>
    this.subscribe(this.changes, listener);
  public onDidCreate = (listener: (uri: Uri) => void): Disposable =>
    this.subscribe(this.creations, listener);
  public onDidDelete = (listener: (uri: Uri) => void): Disposable =>
    this.subscribe(this.deletions, listener);

  public emitChange(uri: Uri): void {
    for (const listener of this.changes) {
      listener(uri);
    }
  }

  public emitCreate(uri: Uri): void {
    for (const listener of this.creations) {
      listener(uri);
    }
  }

  public emitDelete(uri: Uri): void {
    for (const listener of this.deletions) {
      listener(uri);
    }
  }

  public dispose(): void {
    this.disposed = true;
    this.changes.clear();
    this.creations.clear();
    this.deletions.clear();
  }

  private subscribe(
    listeners: Set<(uri: Uri) => void>,
    listener: (uri: Uri) => void,
  ): Disposable {
    listeners.add(listener);
    return { dispose: () => { listeners.delete(listener); } };
  }
}

function fileUri(filePath: string): Uri {
  return {
    fsPath: filePath,
    toString: () => `file://${filePath}`,
  } as Uri;
}
