import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import type { Uri } from "vscode";

import {
  executeQueryRequest,
  isRunQueryMessage,
} from "../src/editor/queryMessageHandler";
import { CsvSession } from "../src/editor/csvSession";
import type {
  HostToWebviewMessage,
  QueryResult,
} from "../src/shared/protocol";
import { App } from "../src/webview/App";
import { SqlConsole, type QueryConsoleActions } from "../src/webview/SqlConsole";
import {
  applyHostMessage,
  beginQuery,
  INITIAL_WEBVIEW_STATE,
  updateQueryText,
  type QueryAction,
  type WebviewState,
} from "../src/webview/state";

const DEFAULT_OPTIONS = {
  delimiter: { mode: "auto" as const },
  header: "auto" as const,
  encoding: "utf-8" as const,
};

test("executes selection, filter, aggregate and two result pages", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "csvis-console-"));
  const filePath = path.join(directory, "many.csv");
  const content =
    "id,name\n" +
    Array.from({ length: 205 }, (_, index) => `${index + 1},name-${index + 1}`)
      .join("\n") +
    "\n";
  await writeFile(filePath, content, "utf8");
  const session = await CsvSession.create(fileUri(filePath));

  try {
    let state = initializedState();
    assert.equal(state.status, "ready");
    if (state.status !== "ready") {
      throw new Error("Webview did not initialize");
    }
    assert.equal(state.queryText, "SELECT * FROM csv");

    state = updateQueryText(state, "SELECT id, name FROM csv ORDER BY id");
    const firstPage = await submit(session, state, "run", "selection");
    state = firstPage.state;
    assert.equal(firstPage.result?.rows.length, 200);
    assert.equal(firstPage.result?.hasNextPage, true);
    assert.deepEqual(firstPage.result?.rows[0], ["1", "name-1"]);

    state = updateQueryText(state, "SELECT name FROM csv WHERE id = 42");
    const nextRequest = beginQuery(state, "next", "preview-next");
    assert.ok(nextRequest);
    assert.equal(nextRequest.request.sql, "SELECT id, name FROM csv ORDER BY id");

    const secondPage = await submit(session, state, "next", "next-page");
    state = secondPage.state;
    assert.equal(secondPage.result?.page, 1);
    assert.equal(secondPage.result?.rows.length, 5);
    assert.equal(secondPage.result?.hasNextPage, false);
    assert.deepEqual(secondPage.result?.rows[4], ["205", "name-205"]);
    assert.equal(beginQuery(state, "next", "blocked-next"), null);

    const previousPage = await submit(session, state, "previous", "previous-page");
    state = previousPage.state;
    assert.equal(previousPage.result?.page, 0);
    assert.equal(previousPage.result?.rows.length, 200);

    state = updateQueryText(
      state,
      "SELECT name FROM csv WHERE id = 42",
    );
    const filtered = await submit(session, state, "run", "filter");
    state = filtered.state;
    assert.deepEqual(filtered.result?.rows, [["name-42"]]);
    assert.equal(filtered.result?.page, 0);

    state = updateQueryText(state, "SELECT count(*) AS total FROM csv");
    const aggregated = await submit(session, state, "run", "aggregate");
    assert.deepEqual(aggregated.result?.rows, [["205"]]);
  } finally {
    session.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("keeps SQL errors in the webview and ignores stale responses", async () => {
  const fixture = path.resolve(__dirname, "../../test/fixtures/comma.csv");
  const session = await CsvSession.create(fileUri(fixture));

  try {
    const state = updateQueryText(
      initializedState(),
      "SELECT * FROM missing_table",
    );
    const attempt = beginQuery(state, "run", "bad-query");
    assert.ok(attempt);

    const staleResult: QueryResult = {
      requestId: "older-query",
      columns: [],
      rows: [],
      page: 0,
      pageSize: 200,
      hasNextPage: false,
    };
    assert.equal(
      applyHostMessage(attempt.state, {
        type: "queryResult",
        result: staleResult,
      }),
      attempt.state,
    );
    const unsolicitedState = initializedState();
    assert.equal(
      applyHostMessage(unsolicitedState, {
        type: "queryResult",
        result: staleResult,
      }),
      unsolicitedState,
    );

    const response = await executeQueryRequest(session, attempt.request);
    assert.equal(response.type, "queryError");
    const errorState = applyHostMessage(attempt.state, response);
    assert.equal(errorState.status, "ready");

    if (errorState.status !== "ready") {
      throw new Error("Webview closed after SQL error");
    }

    assert.match(errorState.error ?? "", /Query is not valid DuckDB SQL/);
    assert.equal(errorState.result, undefined);
    const markup = renderToStaticMarkup(createElement(App, { state: errorState }));
    assert.match(markup, /role="alert"/);
    assert.match(markup, /SQL query console/);
    assert.match(markup, /Run query/);

    const recovered = await submit(
      session,
      updateQueryText(errorState, "SELECT * FROM csv"),
      "run",
      "recovered",
    );
    assert.equal(recovered.result?.rows.length, 2);
    assert.equal(recovered.state.status, "ready");
  } finally {
    session.dispose();
  }
});

test("rejects malformed messages before they reach DuckDB", () => {
  assert.equal(
    isRunQueryMessage({
      type: "runQuery",
      request: {
        requestId: "valid",
        sql: "SELECT 1",
        page: 0,
        pageSize: 200,
      },
    }),
    true,
  );
  assert.equal(isRunQueryMessage({ type: "runQuery", request: null }), false);
  assert.equal(
    isRunQueryMessage({
      type: "runQuery",
      request: { requestId: "bad", sql: "SELECT 1", page: "0" },
    }),
    false,
  );
  assert.equal(isRunQueryMessage({ type: "updateCsvOptions" }), false);
});

test("serializes concurrent requests from split editors", async () => {
  const fixture = path.resolve(__dirname, "../../test/fixtures/comma.csv");
  const session = await CsvSession.create(fileUri(fixture));

  try {
    const responses = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        executeQueryRequest(session, {
          requestId: `split-${index}`,
          sql: `SELECT ${index} AS tab, count(*) AS total FROM csv`,
          page: 0,
          pageSize: 200,
        }),
      ),
    );

    for (const [index, response] of responses.entries()) {
      assert.equal(response.type, "queryResult");

      if (response.type === "queryResult") {
        assert.deepEqual(response.result.rows, [[index, "2"]]);
      }
    }
  } finally {
    session.dispose();
  }
});

test("supports Run, Cmd/Ctrl+Enter and pagination controls", async () => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", {
    pretendToBeVisual: true,
  });
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const previousActEnvironment = Object.getOwnPropertyDescriptor(
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
  let state = initializedState();
  if (state.status !== "ready") {
    throw new Error("Webview did not initialize");
  }
  const counts = { run: 0, previous: 0, next: 0 };
  let editedQuery = "";
  const actions: QueryConsoleActions = {
    onQueryTextChange: (value) => {
      editedQuery = value;
      state = updateQueryText(state, value);
      render();
    },
    onRunQuery: () => {
      counts.run += 1;
    },
    onPreviousPage: () => {
      counts.previous += 1;
    },
    onNextPage: () => {
      counts.next += 1;
    },
  };

  const render = (): void => {
    if (state.status === "ready") {
      root.render(createElement(SqlConsole, { state, actions }));
    }
  };

  try {
    await act(async () => render());

    const textarea = container.querySelector<HTMLTextAreaElement>("textarea");
    assert.ok(textarea);
    assert.equal(textarea.value, "SELECT * FROM csv");

    const runButton = findButton(container, "Run query");
    const previousButton = findButton(container, "Previous");
    const nextButton = findButton(container, "Next");
    assert.equal(previousButton.disabled, true);
    assert.equal(nextButton.disabled, true);

    await act(async () => {
      runButton.click();
      textarea.focus();
      textarea.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", {
          key: "Enter",
          metaKey: true,
          bubbles: true,
        }),
      );
      textarea.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", {
          key: "Enter",
          ctrlKey: true,
          bubbles: true,
        }),
      );
    });
    assert.equal(counts.run, 3);

    const valueSetter = Object.getOwnPropertyDescriptor(
      dom.window.HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    assert.ok(valueSetter);

    await act(async () => {
      valueSetter.call(textarea, "SELECT name FROM csv");
      textarea.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    assert.equal(editedQuery, "SELECT name FROM csv");

    const attempt = beginQuery(state, "run", "page-controls");
    assert.ok(attempt);
    state = applyHostMessage(attempt.state, {
      type: "queryResult",
      result: {
        requestId: "page-controls",
        columns: [{ name: "name", type: "VARCHAR" }],
        rows: [["Alice"]],
        page: 0,
        pageSize: 200,
        hasNextPage: true,
      },
    });
    await act(async () => render());
    assert.equal(findButton(container, "Next").disabled, false);

    await act(async () => {
      findButton(container, "Next").click();
    });
    assert.equal(counts.next, 1);

    const pending = beginQuery(state, "next", "pending-page");
    assert.ok(pending);
    state = pending.state;
    await act(async () => render());
    assert.equal(findButton(container, "Running…").disabled, true);
    assert.equal(findButton(container, "Next").disabled, true);
    assert.equal(findButton(container, "Previous").disabled, true);

    state = applyHostMessage(state, {
      type: "queryResult",
      result: {
        requestId: "pending-page",
        columns: [{ name: "name", type: "VARCHAR" }],
        rows: [["Bob"]],
        page: 1,
        pageSize: 200,
        hasNextPage: false,
      },
    });
    await act(async () => render());
    assert.match(container.textContent ?? "", /Page 2/);
    assert.equal(findButton(container, "Previous").disabled, false);
    assert.equal(findButton(container, "Next").disabled, true);

    await act(async () => {
      findButton(container, "Previous").click();
    });
    assert.equal(counts.previous, 1);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    restoreGlobal("window", previousWindow);
    restoreGlobal("document", previousDocument);
    restoreGlobal("IS_REACT_ACT_ENVIRONMENT", previousActEnvironment);
  }
});

async function submit(
  session: CsvSession,
  state: WebviewState,
  action: QueryAction,
  requestId: string,
): Promise<{ readonly state: WebviewState; readonly result?: QueryResult }> {
  const attempt = beginQuery(state, action, requestId);
  assert.ok(attempt);
  const response: HostToWebviewMessage = await executeQueryRequest(
    session,
    attempt.request,
  );
  assert.equal(response.type, "queryResult");

  return {
    state: applyHostMessage(attempt.state, response),
    result: response.type === "queryResult" ? response.result : undefined,
  };
}

function initializedState(): WebviewState {
  return applyHostMessage(INITIAL_WEBVIEW_STATE, {
    type: "initialize",
    fileName: "many.csv",
    options: DEFAULT_OPTIONS,
    initialQuery: "SELECT * FROM csv",
  });
}

function fileUri(filePath: string): Uri {
  return {
    fsPath: filePath,
    toString: () => `file://${filePath}`,
  } as Uri;
}

function findButton(container: Element, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === text,
  );

  if (button === undefined) {
    throw new Error(`Missing ${text} button`);
  }

  return button;
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
