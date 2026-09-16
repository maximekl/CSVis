import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = require(path.join(extensionRoot, "package.json"));
const lock = require(path.join(extensionRoot, "package-lock.json"));
const bindingVersion = require(path.join(
  extensionRoot,
  "node_modules",
  "@duckdb",
  "node-bindings",
  "package.json",
)).version;
const supportedTargets = new Set([
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-x64",
  "win32-x64",
]);
const releaseTargets = ["darwin-arm64", "linux-x64", "win32-x64"];
const nativeTarget = `${process.platform}-${process.arch}`;
const requestedTarget = process.argv[2] ?? nativeTarget;
const targets = requestedTarget === "all" ? releaseTargets : [requestedTarget];

for (const target of targets) {
  if (!supportedTargets.has(target)) {
    throw new Error(`Unsupported packaging target: ${target}`);
  }
}

function bindingDirectory(target) {
  return path.join(
    extensionRoot,
    "node_modules",
    "@duckdb",
    `node-bindings-${target}`,
  );
}

function validateBinding(directory, target) {
  const packageFile = path.join(directory, "package.json");
  const binaryFile = path.join(directory, "duckdb.node");
  if (!existsSync(packageFile) || !existsSync(binaryFile)) {
    throw new Error(`Incomplete DuckDB native binding for ${target}: ${directory}`);
  }
  const installed = JSON.parse(readFileSync(packageFile, "utf8"));
  if (
    installed.name !== `@duckdb/node-bindings-${target}` ||
    installed.version !== bindingVersion
  ) {
    throw new Error(`Unexpected DuckDB native binding for ${target}: ${directory}`);
  }
}

function ensureBinding(target) {
  const directory = bindingDirectory(target);
  if (existsSync(directory)) {
    validateBinding(directory, target);
    return false;
  }

  const locked = lock.packages[`node_modules/@duckdb/node-bindings-${target}`];
  if (locked?.version !== bindingVersion) {
    throw new Error(`Missing lockfile entry for DuckDB native binding ${target}`);
  }

  const npmCli = process.env.npm_execpath;
  if (npmCli === undefined || !existsSync(npmCli)) {
    throw new Error(`Run this command with npm to install the ${target} binding`);
  }

  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), `csvis-binding-${target}-`));
  try {
    console.log(`Installing locked DuckDB native binding for ${target}...`);
    const install = spawnSync(
      process.execPath,
      [
        npmCli,
        "install",
        "--prefix", temporaryRoot,
        "--no-save",
        "--no-package-lock",
        "--ignore-scripts",
        "--force",
        "--no-audit",
        "--no-fund",
        `@duckdb/node-bindings-${target}@${bindingVersion}`,
      ],
      { cwd: extensionRoot, stdio: "inherit" },
    );
    if (install.error !== undefined) {
      throw install.error;
    }
    if (install.status !== 0) {
      throw new Error(`Installing DuckDB native binding for ${target} failed`);
    }

    const installedDirectory = path.join(
      temporaryRoot,
      "node_modules",
      "@duckdb",
      `node-bindings-${target}`,
    );
    validateBinding(installedDirectory, target);
    cpSync(installedDirectory, directory, {
      recursive: true,
      force: false,
      errorOnExist: true,
    });
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
  return true;
}

function isolateBinding(target) {
  const duckdbRoot = path.join(extensionRoot, "node_modules", "@duckdb");
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "csvis-other-bindings-"));
  const moved = [];

  try {
    for (const entry of readdirSync(duckdbRoot, { withFileTypes: true })) {
      if (
        !entry.isDirectory() ||
        !entry.name.startsWith("node-bindings-") ||
        entry.name === `node-bindings-${target}`
      ) {
        continue;
      }
      const source = path.join(duckdbRoot, entry.name);
      const backup = path.join(temporaryRoot, entry.name);
      renameSync(source, backup);
      moved.push({ source, backup });
    }
  } catch (error) {
    for (const { source, backup } of moved.reverse()) {
      renameSync(backup, source);
    }
    rmSync(temporaryRoot, { recursive: true, force: true });
    throw error;
  }

  return () => {
    for (const { source, backup } of moved) {
      renameSync(backup, source);
    }
    rmSync(temporaryRoot, { recursive: true, force: true });
  };
}

const vsceCli = require.resolve("@vscode/vsce/vsce");
const yauzl = require("yauzl");

function listArchiveFiles(archive) {
  return new Promise((resolve, reject) => {
    yauzl.open(archive, { lazyEntries: true }, (openError, zipFile) => {
      if (openError) {
        reject(openError);
        return;
      }
      const files = [];
      zipFile.on("entry", (entry) => {
        files.push(entry.fileName);
        zipFile.readEntry();
      });
      zipFile.on("end", () => resolve(files));
      zipFile.on("error", reject);
      zipFile.readEntry();
    });
  });
}

async function verifyPackagedBinding(output, target) {
  const prefix = "extension/node_modules/@duckdb/";
  const bindingPattern =
    /^extension\/node_modules\/@duckdb\/node-bindings-([^/]+)\//u;
  const files = await listArchiveFiles(output);
  const packagedBindings = new Set(
    files.flatMap((file) => {
      const match = bindingPattern.exec(file);
      return match === null ? [] : [match[1]];
    }),
  );

  if (packagedBindings.size !== 1 || !packagedBindings.has(target)) {
    throw new Error(
      `VSIX ${path.basename(output)} contains DuckDB bindings for: ${
        [...packagedBindings].join(", ") || "none"
      }; expected only ${target}`,
    );
  }

  const binary = `${prefix}node-bindings-${target}/duckdb.node`;
  if (!files.includes(binary)) {
    throw new Error(`VSIX ${path.basename(output)} is missing ${binary}`);
  }
}

for (const target of targets) {
  const output = path.join(
    extensionRoot,
    "dist",
    `${manifest.name}-${manifest.version}-${target}.vsix`,
  );
  const installedTemporarily = ensureBinding(target);
  let restoreOtherBindings = () => {};
  try {
    restoreOtherBindings = isolateBinding(target);
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

    await verifyPackagedBinding(output, target);
    console.log(`Platform VSIX (DuckDB ${target} only): ${output}`);
  } finally {
    try {
      restoreOtherBindings();
    } finally {
      if (installedTemporarily) {
        rmSync(bindingDirectory(target), { recursive: true, force: true });
      }
    }
  }
}
