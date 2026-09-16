import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { act, createElement } from "react";
import { JSDOM } from "jsdom";
import type { Memento, Uri } from "vscode";

import { DEFAULT_CSV_OPTIONS } from "../src/csv/csvOptions";
import { CsvSession } from "../src/editor/csvSession";
import { CsvSessionManager } from "../src/editor/csvSessionManager";
import { CsvSettingsStore } from "../src/editor/csvSettingsStore";
import type { CsvOptions, QueryResult } from "../src/shared/protocol";
import { CsvSettingsPanel } from "../src/webview/CsvSettingsPanel";
import {
  applyHostMessage,
  beginQuery,
  beginSettingsUpdate,
  INITIAL_WEBVIEW_STATE,
  updateQueryText,
} from "../src/webview/state";

test("keeps validated CSV settings per URI and tolerates corrupt saved values", async () => {
  const values = new Map<string, unknown>();
  const store = new CsvSettingsStore(fakeMemento(values));
  const first = fileUri("/tmp/first.csv");
  const second = fileUri("/tmp/second.csv");
  const options: CsvOptions = {
    delimiter: { mode: "manual", value: ";" },
    header: "present",
    encoding: "utf-8",
  };

  assert.deepEqual(store.get(first), DEFAULT_CSV_OPTIONS);
  await store.set(first, options);
  assert.deepEqual(store.get(first), options);
  assert.deepEqual(store.get(second), DEFAULT_CSV_OPTIONS);
  await assert.rejects(
    store.set(second, {
      delimiter: { mode: "manual", value: "\n" },
      header: "auto",
      encoding: "utf-8",
    }),
    /Manual CSV delimiter/,
  );
  assert.deepEqual(store.get(second), DEFAULT_CSV_OPTIONS);

  values.set(`csvis.csvOptions:${first.toString()}`, { encoding: "unknown" });
  assert.deepEqual(store.get(first), DEFAULT_CSV_OPTIONS);
});

test("applies settings, discards stale results, restarts page one and restores after reopening", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "csvis-settings-"));
  const filePath = path.join(directory, "many.csv");
  await writeFile(
    filePath,
    "id;name\n" +
      Array.from({ length: 205 }, (_, index) => `${index + 1};name-${index + 1}`)
        .join("\n") +
      "\n",
  );

  const uri = fileUri(filePath);
  const values = new Map<string, unknown>();
  const store = new CsvSettingsStore(fakeMemento(values));
  const manager = new CsvSessionManager((sourceUri) =>
    CsvSession.create(sourceUri, store.get(sourceUri)),
  );
  const options: CsvOptions = {
    delimiter: { mode: "manual", value: ";" },
    header: "present",
    encoding: "utf-8",
  };

  try {
    const document = await manager.open(uri);
    let state = applyHostMessage(INITIAL_WEBVIEW_STATE, {
      type: "initialize",
      fileName: "many.csv",
      options: store.get(uri),
      initialQuery: "SELECT * FROM csv",
    });
    state = updateQueryText(state, "SELECT id, name FROM csv ORDER BY id");
    const initial = beginQuery(state, "run", "initial");
    assert.ok(initial);
    const firstResult = await document.session.executeQuery(initial.request);
    state = applyHostMessage(initial.state, {
      type: "queryResult",
      result: firstResult,
    });
    const second = beginQuery(state, "next", "second-page");
    assert.ok(second);
    const secondResult = await document.session.executeQuery(second.request);
    state = applyHostMessage(second.state, {
      type: "queryResult",
      result: secondResult,
    });
    assert.equal(secondResult.page, 1);
    assert.equal(secondResult.rows.length, 5);

    const pending = beginSettingsUpdate(state, "change-settings");
    assert.ok(pending);
    assert.equal(pending.status, "ready");
    if (pending.status !== "ready") {
      throw new Error("Settings update closed the webview");
    }
    assert.equal(pending.result, secondResult);
    assert.equal(beginQuery(pending, "reload", "blocked"), null);
    const stale: QueryResult = { ...secondResult, requestId: "second-page" };
    assert.equal(
      applyHostMessage(pending, { type: "queryResult", result: stale }),
      pending,
    );

    await document.session.updateOptions(options);
    await store.set(uri, options);
    state = applyHostMessage(pending, {
      type: "csvOptionsUpdated",
      requestId: "change-settings",
      options,
    });
    assert.equal(state.status, "ready");
    if (state.status !== "ready") {
      throw new Error("Settings update closed the webview");
    }
    assert.equal(state.page, 0);
    assert.equal(state.pendingSettingsRequestId, undefined);
    assert.equal(state.result, secondResult);

    const reloaded = beginQuery(state, "reload", "reloaded");
    assert.ok(reloaded);
    assert.equal(reloaded.state.status, "ready");
    if (reloaded.state.status !== "ready") {
      throw new Error("Reload closed the webview");
    }
    assert.equal(reloaded.state.result, secondResult);
    assert.equal(reloaded.request.page, 0);
    assert.equal(reloaded.request.sql, "SELECT id, name FROM csv ORDER BY id");
    const reloadedResult = await document.session.executeQuery(reloaded.request);
    assert.equal(reloadedResult.rows.length, 200);
    assert.deepEqual(reloadedResult.rows[0], ["1", "name-1"]);

    document.dispose();
    assert.equal(manager.activeSessionCount, 0);

    const reopened = await manager.open(uri);
    try {
      assert.deepEqual(store.get(uri), options);
      const restored = await reopened.session.executeQuery({
        requestId: "restored",
        sql: "SELECT id, name FROM csv ORDER BY id",
        page: 0,
        pageSize: 200,
      });
      assert.equal(restored.page, 0);
      assert.equal(restored.rows.length, 200);
      assert.deepEqual(restored.rows[0], ["1", "name-1"]);
    } finally {
      reopened.dispose();
    }
  } finally {
    manager.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("only the matching settings response completes a pending update", () => {
  const state = applyHostMessage(INITIAL_WEBVIEW_STATE, {
    type: "initialize",
    fileName: "split.csv",
    options: DEFAULT_CSV_OPTIONS,
    initialQuery: "SELECT * FROM csv",
  });
  const pending = beginSettingsUpdate(state, "mine");
  assert.ok(pending);

  const otherOptions: CsvOptions = {
    delimiter: { mode: "manual", value: ";" },
    header: "absent",
    encoding: "utf-8",
  };
  const otherTabUpdate = applyHostMessage(pending, {
    type: "csvOptionsUpdated",
    options: otherOptions,
  });
  assert.equal(otherTabUpdate.status, "ready");
  if (otherTabUpdate.status !== "ready") {
    throw new Error("Webview unexpectedly closed");
  }
  assert.equal(otherTabUpdate.pendingSettingsRequestId, "mine");
  assert.deepEqual(otherTabUpdate.options, otherOptions);
  assert.equal(
    applyHostMessage(otherTabUpdate, {
      type: "csvOptionsError",
      requestId: "someone-else",
      message: "ignored",
    }),
    otherTabUpdate,
  );
  const errorState = applyHostMessage(otherTabUpdate, {
    type: "csvOptionsError",
    requestId: "mine",
    message: "Invalid delimiter",
  });
  assert.equal(errorState.status, "ready");
  if (errorState.status === "ready") {
    assert.equal(errorState.pendingSettingsRequestId, undefined);
    assert.equal(errorState.settingsError, "Invalid delimiter");
  }
});

test("offers delimiter, header and encoding controls and submits their draft", async () => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", {
    pretendToBeVisual: true,
  });
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const previousAct = Object.getOwnPropertyDescriptor(
    globalThis,
    "IS_REACT_ACT_ENVIRONMENT",
  );
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: dom.window,
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: dom.window.document,
  });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    value: true,
  });

  const container = dom.window.document.getElementById("root");
  assert.ok(container);
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(container);
  const initialized = applyHostMessage(INITIAL_WEBVIEW_STATE, {
    type: "initialize",
    fileName: "settings.csv",
    options: DEFAULT_CSV_OPTIONS,
    initialQuery: "SELECT * FROM csv",
  });
  assert.equal(initialized.status, "ready");
  if (initialized.status !== "ready") {
    throw new Error("Webview did not initialize");
  }
  let submitted: CsvOptions | undefined;
  const actions = { onApplyCsvOptions: (options: CsvOptions) => { submitted = options; } };

  try {
    await act(async () =>
      root.render(createElement(CsvSettingsPanel, { state: initialized, actions })),
    );
    const details = container.querySelector<HTMLDetailsElement>(
      "details.csv-settings",
    );
    const summary = container.querySelector<HTMLElement>(
      "summary.csv-settings-summary",
    );
    assert.ok(details);
    assert.ok(summary);
    assert.equal(details.open, false);
    assert.equal(summary.textContent?.trim(), "CSV settings");

    await act(async () => summary.click());
    assert.equal(details.open, true);

    const button = container.querySelector<HTMLButtonElement>("button[type=submit]");
    assert.ok(button);
    assert.equal(button.disabled, true);

    await act(async () => {
      changeSelect(dom, container, "csvis-delimiter-mode", "manual");
    });
    const delimiter = container.querySelector<HTMLInputElement>(
      "#csvis-delimiter-value",
    );
    assert.ok(delimiter);
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        dom.window.HTMLInputElement.prototype,
        "value",
      )?.set;
      assert.ok(setter);
      setter.call(delimiter, ";");
      delimiter.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      changeSelect(dom, container, "csvis-header-mode", "present");
      changeSelect(dom, container, "csvis-encoding", "latin-1");
    });
    assert.equal(button.disabled, false);
    await act(async () => button.click());
    assert.deepEqual(submitted, {
      delimiter: { mode: "manual", value: ";" },
      header: "present",
      encoding: "latin-1",
    });

    const pending = beginSettingsUpdate(initialized, "pending");
    assert.ok(pending);
    if (pending.status !== "ready") {
      throw new Error("Webview unexpectedly closed");
    }
    await act(async () =>
      root.render(createElement(CsvSettingsPanel, { state: pending, actions })),
    );
    assert.equal(details.open, true);
    assert.equal(button.disabled, true);
    assert.equal(button.textContent, "Applying…");
    for (const control of container.querySelectorAll<
      HTMLInputElement | HTMLSelectElement
    >("input, select")) {
      assert.equal(control.disabled, true);
    }

    const errorState = applyHostMessage(pending, {
      type: "csvOptionsError",
      requestId: "pending",
      message: "Invalid delimiter",
    });
    assert.equal(errorState.status, "ready");
    if (errorState.status !== "ready") {
      throw new Error("Webview unexpectedly closed");
    }
    await act(async () =>
      root.render(createElement(CsvSettingsPanel, { state: errorState, actions })),
    );
    assert.equal(details.open, true);
    assert.equal(
      container.querySelector<HTMLElement>("[role=alert]")?.textContent,
      "Invalid delimiter",
    );
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    restoreGlobal("window", previousWindow);
    restoreGlobal("document", previousDocument);
    restoreGlobal("IS_REACT_ACT_ENVIRONMENT", previousAct);
  }
});

function changeSelect(
  dom: JSDOM,
  container: HTMLElement,
  id: string,
  value: string,
): void {
  const select = container.querySelector<HTMLSelectElement>(`#${id}`);
  assert.ok(select);
  select.value = value;
  select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
}

function restoreGlobal(
  name: string,
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor === undefined) {
    Reflect.deleteProperty(globalThis, name);
  } else {
    Object.defineProperty(globalThis, name, descriptor);
  }
}

function fakeMemento(values: Map<string, unknown>): Memento {
  return {
    keys: () => [...values.keys()],
    get: <T>(key: string, defaultValue?: T): T | undefined =>
      (values.has(key) ? values.get(key) : defaultValue) as T | undefined,
    update: async (key: string, value: unknown): Promise<void> => {
      values.set(key, value);
    },
  } as Memento;
}

function fileUri(filePath: string): Uri {
  return {
    fsPath: filePath,
    toString: () => `file://${filePath}`,
  } as Uri;
}
