import type { JsonValue } from "../../shared/protocol";

export function formatCellValue(value: JsonValue): string {
  if (value === null) {
    return "NULL";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return JSON.stringify(value);
}
