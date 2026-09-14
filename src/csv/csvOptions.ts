import type {
  CsvDelimiter,
  CsvEncoding,
  CsvHeaderMode,
  CsvOptions,
} from "../shared/protocol";

export const DEFAULT_CSV_OPTIONS: CsvOptions = Object.freeze({
  delimiter: Object.freeze({ mode: "auto" }),
  header: "auto",
  encoding: "utf-8",
});

export function parseCsvOptions(value: unknown): CsvOptions {
  if (!isRecord(value)) {
    throw new Error("CSV options must be an object");
  }

  return {
    delimiter: parseDelimiter(value.delimiter),
    header: parseHeaderMode(value.header),
    encoding: parseEncoding(value.encoding),
  };
}

function parseDelimiter(value: unknown): CsvDelimiter {
  if (!isRecord(value)) {
    throw new Error("CSV delimiter must be an object");
  }

  if (value.mode === "auto") {
    return { mode: "auto" };
  }

  if (value.mode !== "manual" || typeof value.value !== "string") {
    throw new Error("CSV delimiter mode must be auto or manual");
  }

  const byteLength = Buffer.byteLength(value.value, "utf8");

  if (
    byteLength < 1 ||
    byteLength > 4 ||
    value.value.includes("\0") ||
    value.value.includes("\r") ||
    value.value.includes("\n")
  ) {
    throw new Error(
      "Manual CSV delimiter must contain 1 to 4 bytes and no line break or NUL",
    );
  }

  return { mode: "manual", value: value.value };
}

function parseHeaderMode(value: unknown): CsvHeaderMode {
  if (value === "auto" || value === "present" || value === "absent") {
    return value;
  }

  throw new Error("CSV header mode must be auto, present, or absent");
}

function parseEncoding(value: unknown): CsvEncoding {
  if (value === "utf-8" || value === "utf-16" || value === "latin-1") {
    return value;
  }

  throw new Error("CSV encoding must be utf-8, utf-16, or latin-1");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
