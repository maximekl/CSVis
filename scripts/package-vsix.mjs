import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = require(path.join(extensionRoot, "package.json"));
const supportedTargets = new Set([
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-x64",
  "win32-x64",
]);
const target = `${process.platform}-${process.arch}`;

if (!supportedTargets.has(target)) {
  throw new Error(`Unsupported packaging platform: ${target}`);
}

const nativeBinding = path.join(
  extensionRoot,
  "node_modules",
  "@duckdb",
  `node-bindings-${target}`,
  "duckdb.node",
);

if (!existsSync(nativeBinding)) {
  throw new Error(
    `Missing DuckDB native binding for ${target}; install dependencies on the target platform`,
  );
}

const output = path.join(
  extensionRoot,
  "dist",
  `${manifest.name}-${manifest.version}-${target}.vsix`,
);
const vsceCli = require.resolve("@vscode/vsce/vsce");
const result = spawnSync(
  process.execPath,
  [
    vsceCli,
    "package",
    "--target", target,
    "--ignore-other-target-folders",
    "--out", output,
    "--dependencies",
    "--skip-license",
    "--allow-missing-repository",
  ],
  { cwd: extensionRoot, stdio: "inherit" },
);

if (result.error !== undefined) {
  throw result.error;
}

if (result.status !== 0) {
  throw new Error(`vsce package failed with status ${result.status}`);
}

console.log(`Platform VSIX: ${output}`);
