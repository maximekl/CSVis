export const ROW_HEIGHT = 32;
export const HEADER_HEIGHT = 54;
export const ROW_NUMBER_WIDTH = 56;
export const DEFAULT_COLUMN_WIDTH = 180;
export const MIN_COLUMN_WIDTH = 80;
export const MAX_COLUMN_WIDTH = 800;

export interface GridViewport {
  readonly scrollTop: number;
  readonly scrollLeft: number;
  readonly width: number;
  readonly height: number;
}

export interface VisibleRange {
  readonly start: number;
  readonly end: number;
}

export interface ColumnPosition {
  readonly left: number;
  readonly width: number;
  readonly right: number;
}

export function getVisibleRows(
  rowCount: number,
  scrollTop: number,
  viewportHeight: number,
  overscan = 4,
): VisibleRange {
  const firstVisible = Math.floor(
    Math.max(0, scrollTop - HEADER_HEIGHT) / ROW_HEIGHT,
  );
  const lastVisible = Math.ceil(
    Math.max(0, scrollTop + viewportHeight - HEADER_HEIGHT) / ROW_HEIGHT,
  );

  return {
    start: Math.min(rowCount, Math.max(0, firstVisible - overscan)),
    end: Math.min(rowCount, Math.max(0, lastVisible + overscan)),
  };
}

export function positionColumns(widths: readonly number[]): {
  readonly columns: readonly ColumnPosition[];
  readonly totalWidth: number;
} {
  let right = ROW_NUMBER_WIDTH;
  const columns = widths.map((width) => {
    const left = right;
    right += width;

    return { left, width, right };
  });

  return { columns, totalWidth: right };
}

export function getVisibleColumns(
  columns: readonly ColumnPosition[],
  scrollLeft: number,
  viewportWidth: number,
  overscan = 2,
): VisibleRange {
  const visibleStart = scrollLeft + ROW_NUMBER_WIDTH;
  const visibleEnd = scrollLeft + viewportWidth;
  const firstVisible = findFirstColumnEndingAfter(columns, visibleStart);
  const lastVisible = findFirstColumnStartingAtOrAfter(columns, visibleEnd);

  return {
    start: Math.max(0, firstVisible - overscan),
    end: Math.min(columns.length, Math.max(firstVisible, lastVisible) + overscan),
  };
}

export function clampColumnWidth(width: number): number {
  if (!Number.isFinite(width)) {
    return DEFAULT_COLUMN_WIDTH;
  }

  return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.round(width)));
}

function findFirstColumnEndingAfter(
  columns: readonly ColumnPosition[],
  value: number,
): number {
  let low = 0;
  let high = columns.length;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const column = columns[middle];

    if (column !== undefined && column.right <= value) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low;
}

function findFirstColumnStartingAtOrAfter(
  columns: readonly ColumnPosition[],
  value: number,
): number {
  let low = 0;
  let high = columns.length;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const column = columns[middle];

    if (column !== undefined && column.left < value) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low;
}
