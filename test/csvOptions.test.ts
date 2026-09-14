import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_CSV_OPTIONS,
  parseCsvOptions,
} from "../src/csv/csvOptions";

test("validates and normalizes supported CSV options", () => {
  assert.deepEqual(parseCsvOptions(DEFAULT_CSV_OPTIONS), DEFAULT_CSV_OPTIONS);
  assert.deepEqual(
    parseCsvOptions({
      delimiter: { mode: "manual", value: "🦆" },
      header: "present",
      encoding: "latin-1",
    }),
    {
      delimiter: { mode: "manual", value: "🦆" },
      header: "present",
      encoding: "latin-1",
    },
  );
});

test("rejects invalid CSV options", () => {
  const invalidOptions: readonly unknown[] = [
    null,
    {},
    {
      delimiter: { mode: "manual", value: "" },
      header: "auto",
      encoding: "utf-8",
    },
    {
      delimiter: { mode: "manual", value: "too-long" },
      header: "auto",
      encoding: "utf-8",
    },
    {
      delimiter: { mode: "manual", value: "\n" },
      header: "auto",
      encoding: "utf-8",
    },
    {
      delimiter: { mode: "auto" },
      header: "sometimes",
      encoding: "utf-8",
    },
    {
      delimiter: { mode: "auto" },
      header: "auto",
      encoding: "windows-1252",
    },
  ];

  for (const options of invalidOptions) {
    assert.throws(() => parseCsvOptions(options));
  }
});
