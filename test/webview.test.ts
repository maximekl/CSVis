import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { renderWebviewHtml } from "../src/editor/webviewHtml";
import type { QueryResult } from "../src/shared/protocol";
import { App } from "../src/webview/App";
import {
  applyHostMessage,
  INITIAL_WEBVIEW_STATE,
} from "../src/webview/state";

const webviewAssets = path.resolve(__dirname, "../../dist/webview");

test("renders loading and then a simulated query result", () => {
  const loadingHtml = renderToStaticMarkup(
    createElement(App, { state: INITIAL_WEBVIEW_STATE }),
  );

  assert.match(loadingHtml, /Loading CSV preview/);

  const initializedState = applyHostMessage(INITIAL_WEBVIEW_STATE, {
    type: "initialize",
    fileName: "sample.csv",
    options: {
      delimiter: { mode: "auto" },
      header: "auto",
      encoding: "utf-8",
    },
    initialQuery: "SELECT * FROM csv",
  });
  const result: QueryResult = {
    requestId: "simulated",
    columns: [
      { name: "id", type: "BIGINT" },
      { name: "name", type: "VARCHAR" },
    ],
    rows: [["1", "Alice"], ["2", "Bob"]],
    page: 0,
    pageSize: 200,
    hasNextPage: false,
  };
  const readyState = applyHostMessage(initializedState, {
    type: "queryResult",
    result,
  });
  const readyHtml = renderToStaticMarkup(
    createElement(App, { state: readyState }),
  );

  assert.match(readyHtml, /sample\.csv/);
  assert.match(readyHtml, /Preview ready/);
  assert.match(readyHtml, /2 rows/);
  assert.match(readyHtml, /2 columns/);
  assert.match(readyHtml, /id, name/);
  assert.doesNotMatch(readyHtml, /Loading CSV preview/);
});

test("renders only local assets with a restrictive CSP", () => {
  const html = renderWebviewHtml({
    fileName: '<unsafe "file">.csv',
    scriptUri: "vscode-resource:/extension/dist/webview/main.js",
    styleUri: "vscode-resource:/extension/dist/webview/main.css",
    cspSource: "vscode-resource:",
  });

  assert.match(html, /default-src 'none'/);
  assert.match(html, /script-src vscode-resource:/);
  assert.match(html, /style-src vscode-resource:/);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /src="vscode-resource:.*main\.js"/);
  assert.match(html, /href="vscode-resource:.*main\.css"/);
  assert.match(html, /&lt;unsafe &quot;file&quot;&gt;\.csv/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/);
  assert.doesNotMatch(html, /<style\b/);
  assert.doesNotMatch(html, /https?:\/\//);
});

test("bundles browser JavaScript and CSS into local files", async () => {
  const script = await readFile(path.join(webviewAssets, "main.js"), "utf8");
  const stylesheet = await readFile(
    path.join(webviewAssets, "main.css"),
    "utf8",
  );

  assert.ok(script.length > 1_000);
  assert.match(stylesheet, /--vscode-editor-background/);
  assert.doesNotMatch(script, /from ["']https?:\/\//);
});
