import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";

import type { QueryResult } from "../src/shared/protocol";
import { formatCellValue } from "../src/webview/grid/cellValue";
import { DataGrid } from "../src/webview/grid/DataGrid";
import {
  clampColumnWidth,
  DEFAULT_COLUMN_WIDTH,
  getVisibleColumns,
  getVisibleRows,
  HEADER_HEIGHT,
  positionColumns,
  ROW_HEIGHT,
} from "../src/webview/grid/virtualization";

test("limits visible rows and columns for large pages", () => {
  const topRows = getVisibleRows(10_000, 0, 360);
  const deepRows = getVisibleRows(
    10_000,
    HEADER_HEIGHT + 5_000 * ROW_HEIGHT,
    160,
  );
  const positions = positionColumns(Array(1_000).fill(DEFAULT_COLUMN_WIDTH));
  const leftColumns = getVisibleColumns(positions.columns, 0, 500);
  const deepColumns = getVisibleColumns(positions.columns, 500 * 180, 500);

  assert.ok(topRows.end - topRows.start < 20);
  assert.equal(topRows.start, 0);
  assert.ok(deepRows.start <= 5_000 && deepRows.end > 5_000);
  assert.ok(deepRows.end - deepRows.start < 20);
  assert.ok(leftColumns.end - leftColumns.start < 10);
  assert.ok(deepColumns.start <= 500 && deepColumns.end > 500);
  assert.ok(deepColumns.end - deepColumns.start < 10);
  assert.equal(positions.totalWidth, 56 + 1_000 * 180);
});

test("renders only current-page cells, numbered rows, types and NULL", () => {
  const result = createLargeResult();
  const markup = renderToStaticMarkup(createElement(DataGrid, { result }));
  const renderedRows = markup.match(/class="data-grid-row"/g) ?? [];
  const renderedCells = markup.match(/role="gridcell"/g) ?? [];

  assert.match(markup, /aria-rowcount="201"/);
  assert.match(markup, /aria-colcount="501"/);
  assert.match(markup, /title="column0 · VARCHAR"/);
  assert.match(markup, /class="data-grid-row-number"[^>]*>401</);
  assert.match(markup, /class="data-grid-null">NULL</);
  assert.match(markup, /title="A{1000}"/);
  assert.doesNotMatch(markup, /last-row-sentinel/);
  assert.ok(renderedRows.length > 0 && renderedRows.length < 20);
  assert.ok(renderedCells.length > 0 && renderedCells.length < 200);
});

test("formats complex cells and clamps resized widths", () => {
  assert.equal(formatCellValue(null), "NULL");
  assert.equal(formatCellValue(""), "");
  assert.equal(formatCellValue("9007199254740993"), "9007199254740993");
  assert.equal(formatCellValue(["one", null]), '["one",null]');
  assert.equal(formatCellValue({ city: "Paris" }), '{"city":"Paris"}');
  assert.equal(clampColumnWidth(10), 80);
  assert.equal(clampColumnWidth(2_000), 800);
  assert.equal(clampColumnWidth(225.6), 226);
  assert.equal(clampColumnWidth(Number.NaN), DEFAULT_COLUMN_WIDTH);
});

test("bundles sticky scrolling styles with VS Code theme tokens", async () => {
  const stylesheet = await readFile(
    path.resolve(__dirname, "../../dist/webview/main.css"),
    "utf8",
  );

  assert.match(stylesheet, /\.data-grid-viewport\{[^}]*overflow:auto/);
  assert.match(stylesheet, /\.data-grid-header\{[^}]*position:sticky;top:0/);
  assert.match(
    stylesheet,
    /\.data-grid-corner,\.data-grid-row-number\{[^}]*position:sticky;left:0/,
  );
  assert.match(stylesheet, /--vscode-editor-background/);
  assert.match(stylesheet, /--vscode-panel-border/);
});

test("scrolls to distant cells and resizes a visible column", async () => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", {
    pretendToBeVisual: true,
  });
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const previousActEnvironment = Object.getOwnPropertyDescriptor(
    globalThis,
    "IS_REACT_ACT_ENVIRONMENT",
  );
  const capturedPointers = new WeakMap<Element, number>();

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
  Object.defineProperty(dom.window.HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => 500,
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => 160,
  });
  Object.defineProperties(dom.window.HTMLElement.prototype, {
    setPointerCapture: {
      configurable: true,
      value(this: Element, pointerId: number): void {
        capturedPointers.set(this, pointerId);
      },
    },
    hasPointerCapture: {
      configurable: true,
      value(this: Element, pointerId: number): boolean {
        return capturedPointers.get(this) === pointerId;
      },
    },
    releasePointerCapture: {
      configurable: true,
      value(this: Element): void {
        capturedPointers.delete(this);
      },
    },
  });

  const container = dom.window.document.getElementById("root");
  assert.ok(container);
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(createElement(DataGrid, { result: createLargeResult() }));
    });

    const viewport = container.querySelector<HTMLElement>("[role='grid']");
    assert.ok(viewport);
    assert.ok(container.querySelectorAll("[role='gridcell']").length < 100);

    await act(async () => {
      viewport.scrollTop = HEADER_HEIGHT + 100 * ROW_HEIGHT;
      viewport.scrollLeft = 20 * DEFAULT_COLUMN_WIDTH;
      viewport.dispatchEvent(new dom.window.Event("scroll", { bubbles: true }));
    });

    assert.match(container.textContent ?? "", /501/);
    assert.equal(container.querySelector("[aria-label='Resize column0 column']"), null);

    const handle = container.querySelector<HTMLElement>(
      "[aria-label='Resize column20 column']",
    );
    assert.ok(handle);
    const header = handle.parentElement;
    assert.ok(header);
    assert.equal(header.style.width, "180px");

    await act(async () => {
      handle.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", {
          key: "ArrowRight",
          bubbles: true,
        }),
      );
    });
    assert.equal(header.style.width, "190px");

    await act(async () => {
      handle.dispatchEvent(
        new dom.window.PointerEvent("pointerdown", {
          pointerId: 1,
          clientX: 100,
          bubbles: true,
        }),
      );
      handle.dispatchEvent(
        new dom.window.PointerEvent("pointermove", {
          pointerId: 1,
          clientX: 140,
          bubbles: true,
        }),
      );
      handle.dispatchEvent(
        new dom.window.PointerEvent("pointerup", {
          pointerId: 1,
          clientX: 140,
          bubbles: true,
        }),
      );
    });
    assert.equal(header.style.width, "230px");
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    restoreGlobal("window", previousWindow);
    restoreGlobal("document", previousDocument);
    restoreGlobal("IS_REACT_ACT_ENVIRONMENT", previousActEnvironment);
  }
});

function createLargeResult(): QueryResult {
  const columns = Array.from({ length: 500 }, (_, index) => ({
    name: `column${index}`,
    type: "VARCHAR",
  }));
  const rows = Array.from({ length: 200 }, (_, rowIndex) =>
    Array.from({ length: 500 }, (_, columnIndex) => {
      if (rowIndex === 0 && columnIndex === 0) {
        return null;
      }

      if (rowIndex === 0 && columnIndex === 1) {
        return "A".repeat(1_000);
      }

      if (rowIndex === 199 && columnIndex === 0) {
        return "last-row-sentinel";
      }

      return `${rowIndex}:${columnIndex}`;
    }),
  );

  return {
    requestId: "large-grid",
    columns,
    rows,
    page: 2,
    pageSize: 200,
    hasNextPage: true,
  };
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
