import assert from "node:assert/strict";
import { access, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runTests, runVSCodeCommand } from "@vscode/test-electron";

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  await readFile(path.join(extensionRoot, "package.json"), "utf8"),
);
const target = `${process.platform}-${process.arch}`;
const extensionId = `${manifest.publisher}.${manifest.name}`.toLowerCase();
const vsixPath = path.join(
  extensionRoot,
  "dist",
  `${manifest.name}-${manifest.version}-${target}.vsix`,
);
const cachePath = path.join(extensionRoot, ".vscode-test");
const version = process.env.CSVIS_VSCODE_VERSION ?? "stable";

await access(vsixPath);
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "csvis-vsix-check-"));
const extensionsDir = path.join(temporaryRoot, "extensions");
const userDataDir = path.join(temporaryRoot, "user-data");
const profileArgs = [
  "--extensions-dir", extensionsDir,
  "--user-data-dir", userDataDir,
];

try {
  const install = await runVSCodeCommand(
    ["--install-extension", vsixPath, ...profileArgs],
    { version, cachePath },
  );
  console.log(install.stdout.trim());

  const listed = await runVSCodeCommand(
    ["--list-extensions", ...profileArgs],
    { version, cachePath },
  );
  assert.ok(
    listed.stdout.split(/\r?\n/u).some((id) => id.toLowerCase() === extensionId),
    "the VSIX must appear in the isolated extension list",
  );

  const entries = await readdir(extensionsDir, { withFileTypes: true });
  const installed = entries.filter((entry) =>
    entry.isDirectory() &&
    entry.name.toLowerCase().startsWith(`${extensionId}-`)
  );
  assert.equal(installed.length, 1);
  const installedRoot = path.join(extensionsDir, installed[0].name);
  const installedManifest = JSON.parse(
    await readFile(path.join(installedRoot, "package.json"), "utf8"),
  );
  assert.equal(installedManifest.main, "./dist/extension.js");
  await access(path.join(installedRoot, "dist", "extension.js"));
  await access(path.join(
    installedRoot,
    "node_modules",
    "@duckdb",
    `node-bindings-${target}`,
    "duckdb.node",
  ));

  await runTests({
    version,
    cachePath,
    extensionDevelopmentPath: installedRoot,
    extensionTestsPath: path.join(
      extensionRoot,
      "dist",
      "test",
      "integration",
      "index.js",
    ),
    extensionTestsEnv: { CSVIS_INTEGRATION_TEST: "1" },
    launchArgs: [
      "--disable-extensions",
      "--skip-welcome",
      "--skip-release-notes",
      "--new-window",
    ],
  });
  console.log("Installed VSIX passed the integration scenarios");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
  console.log("Isolated VSIX installation removed");
}
