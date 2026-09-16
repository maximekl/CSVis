import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent, UIEvent } from "react";

import type { QueryResult, QuerySort } from "../../shared/protocol";
import { formatCellValue } from "./cellValue";
import {
  DEFAULT_COLUMN_WIDTH,
  getVisibleColumns,
  getVisibleRows,
  HEADER_HEIGHT,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  positionColumns,
  ROW_HEIGHT,
  ROW_NUMBER_WIDTH,
  clampColumnWidth,
  type GridViewport,
} from "./virtualization";

const DEFAULT_VIEWPORT: GridViewport = {
  scrollTop: 0,
  scrollLeft: 0,
  width: 800,
  height: 360,
};

interface ResizeStart {
  readonly columnKey: string;
  readonly startX: number;
  readonly startWidth: number;
}

export interface DataGridProps {
  readonly result: QueryResult;
  readonly sort?: QuerySort;
  readonly actions?: DataGridActions;
  readonly initialViewport?: GridViewport;
}

export interface DataGridActions {
  readonly onSortColumn: (columnIndex: number) => void;
}

const NOOP_ACTIONS: DataGridActions = {
  onSortColumn: () => undefined,
};

export function DataGrid({
  result,
  sort,
  actions = NOOP_ACTIONS,
  initialViewport = DEFAULT_VIEWPORT,
}: DataGridProps): React.JSX.Element {
  const viewportRef = useRef<HTMLDivElement>(null);
  const resizeStart = useRef<ResizeStart | null>(null);
  const [viewport, setViewport] = useState(initialViewport);
  const [widthOverrides, setWidthOverrides] = useState<Record<string, number>>(
    {},
  );
  const columnKeys = useMemo(
    () => result.columns.map((column, index) => `${index}:${column.name}`),
    [result.columns],
  );
  const widths = useMemo(
    () =>
      columnKeys.map((key) => widthOverrides[key] ?? DEFAULT_COLUMN_WIDTH),
    [columnKeys, widthOverrides],
  );
  const positions = useMemo(() => positionColumns(widths), [widths]);
  const visibleRows = getVisibleRows(
    result.rows.length,
    viewport.scrollTop,
    viewport.height,
  );
  const visibleColumns = getVisibleColumns(
    positions.columns,
    viewport.scrollLeft,
    viewport.width,
  );
  const columnIndices = Array.from(
    { length: visibleColumns.end - visibleColumns.start },
    (_, offset) => visibleColumns.start + offset,
  );

  useEffect(() => {
    const element = viewportRef.current;

    if (element === null) {
      return;
    }

    const measure = (): void => {
      setViewport({
        scrollTop: element.scrollTop,
        scrollLeft: element.scrollLeft,
        width: element.clientWidth,
        height: element.clientHeight,
      });
    };

    measure();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(measure);
      observer.observe(element);
      return () => observer.disconnect();
    }

    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  useEffect(() => {
    const element = viewportRef.current;

    if (element !== null) {
      element.scrollTop = 0;
      setViewport((current) => ({ ...current, scrollTop: 0 }));
    }
  }, [result]);

  const onScroll = (event: UIEvent<HTMLDivElement>): void => {
    const element = event.currentTarget;
    setViewport((current) => ({
      ...current,
      scrollTop: element.scrollTop,
      scrollLeft: element.scrollLeft,
    }));
  };

  const setColumnWidth = (columnKey: string, width: number): void => {
    setWidthOverrides((current) => ({
      ...current,
      [columnKey]: clampColumnWidth(width),
    }));
  };

  const onPointerDown = (
    event: PointerEvent<HTMLDivElement>,
    columnKey: string,
    width: number,
  ): void => {
    resizeStart.current = {
      columnKey,
      startX: event.clientX,
      startWidth: width,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const start = resizeStart.current;

    if (start !== null) {
      setColumnWidth(
        start.columnKey,
        start.startWidth + event.clientX - start.startX,
      );
    }
  };

  const onPointerEnd = (event: PointerEvent<HTMLDivElement>): void => {
    resizeStart.current = null;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const onResizeKeyDown = (
    event: KeyboardEvent<HTMLDivElement>,
    columnKey: string,
    width: number,
  ): void => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      setColumnWidth(columnKey, width + (event.key === "ArrowRight" ? 10 : -10));
    }
  };

  return (
    <div
      ref={viewportRef}
      className="data-grid-viewport"
      role="grid"
      aria-label="CSV results"
      aria-rowcount={result.rows.length + 1}
      aria-colcount={result.columns.length + 1}
      tabIndex={0}
      onScroll={onScroll}
    >
      <div
        className="data-grid-content"
        style={{
          width: positions.totalWidth,
          height: HEADER_HEIGHT + result.rows.length * ROW_HEIGHT,
        }}
      >
        <div
          className="data-grid-header"
          role="row"
          aria-rowindex={1}
          style={{ width: positions.totalWidth, height: HEADER_HEIGHT }}
        >
          <div
            className="data-grid-corner"
            role="columnheader"
            aria-colindex={1}
            style={{ width: ROW_NUMBER_WIDTH }}
          >
            #
          </div>
          {columnIndices.map((index) => {
            const column = result.columns[index];
            const position = positions.columns[index];
            const columnKey = columnKeys[index];
            const sortDirection = sort?.columnIndex === index
              ? sort.direction
              : undefined;

            if (
              column === undefined ||
              position === undefined ||
              columnKey === undefined
            ) {
              return null;
            }

            return (
              <div
                key={columnKey}
                className="data-grid-header-cell"
                role="columnheader"
                aria-colindex={index + 2}
                aria-sort={sortDirection ?? "none"}
                style={{ left: position.left, width: position.width }}
                title={`${column.name} · ${column.type}`}
              >
                <button
                  type="button"
                  className="data-grid-sort-button"
                  aria-label={`Sort by ${column.name}`}
                  onClick={() => actions.onSortColumn(index)}
                >
                  <span className="data-grid-column-name">
                    {column.name}
                    {sortDirection !== undefined && (
                      <span
                        className="data-grid-sort-indicator"
                        aria-hidden="true"
                      >
                        {sortDirection === "ascending" ? "▲" : "▼"}
                      </span>
                    )}
                  </span>
                  <span className="data-grid-column-type">{column.type}</span>
                </button>
                <div
                  className="data-grid-resize-handle"
                  role="separator"
                  aria-label={`Resize ${column.name} column`}
                  aria-orientation="vertical"
                  aria-valuenow={position.width}
                  aria-valuemin={MIN_COLUMN_WIDTH}
                  aria-valuemax={MAX_COLUMN_WIDTH}
                  tabIndex={0}
                  onPointerDown={(event) =>
                    onPointerDown(event, columnKey, position.width)
                  }
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerEnd}
                  onPointerCancel={onPointerEnd}
                  onKeyDown={(event) =>
                    onResizeKeyDown(event, columnKey, position.width)
                  }
                />
              </div>
            );
          })}
        </div>
        {Array.from(
          { length: visibleRows.end - visibleRows.start },
          (_, offset) => visibleRows.start + offset,
        ).map((rowIndex) => {
          const row = result.rows[rowIndex];

          if (row === undefined) {
            return null;
          }

          const rowNumber = result.page * result.pageSize + rowIndex + 1;

          return (
            <div
              key={rowIndex}
              className={
                rowIndex % 2 === 0
                  ? "data-grid-row"
                  : "data-grid-row data-grid-row-alt"
              }
              role="row"
              aria-rowindex={rowIndex + 2}
              style={{
                top: HEADER_HEIGHT + rowIndex * ROW_HEIGHT,
                width: positions.totalWidth,
                height: ROW_HEIGHT,
              }}
            >
              <div
                className="data-grid-row-number"
                role="rowheader"
                aria-colindex={1}
                style={{ width: ROW_NUMBER_WIDTH }}
              >
                {rowNumber}
              </div>
              {columnIndices.map((columnIndex) => {
                const position = positions.columns[columnIndex];
                const value = row[columnIndex];

                if (position === undefined || value === undefined) {
                  return null;
                }

                const text = formatCellValue(value);

                return (
                  <div
                    key={columnIndex}
                    className="data-grid-cell"
                    role="gridcell"
                    aria-colindex={columnIndex + 2}
                    style={{ left: position.left, width: position.width }}
                    title={text}
                  >
                    {value === null ? (
                      <span className="data-grid-null">NULL</span>
                    ) : (
                      text
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
