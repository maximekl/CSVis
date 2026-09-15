import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const expected = process.argv[2];
assert.ok(expected, "expected target must be passed as the first argument");
const actual = `${process.platform}-${process.arch}`;
assert.equal(actual, expected, "runner architecture does not match CI target");

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await access(path.join(
  extensionRoot,
  "node_modules",
  "@duckdb",
  `node-bindings-${actual}`,
  "duckdb.node",
));
console.log(`Runner ${actual} has its DuckDB native binding`);
