import path from "node:path";

import { runTests } from "@vscode/test-electron";

async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, "..", "..");
  const extensionTestsPath = path.join(
    extensionDevelopmentPath,
    "dist",
    "test",
    "integration",
    "index.js",
  );
  const executablePath = process.env.CSVIS_VSCODE_EXECUTABLE_PATH;

  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    cachePath: path.join(extensionDevelopmentPath, ".vscode-test"),
    ...(executablePath === undefined
      ? { version: process.env.CSVIS_VSCODE_VERSION ?? "stable" }
      : { vscodeExecutablePath: executablePath }),
    extensionTestsEnv: { CSVIS_INTEGRATION_TEST: "1" },
    launchArgs: [
      "--disable-extensions",
      "--skip-welcome",
      "--skip-release-notes",
      "--new-window",
    ],
  });
}

void main().catch((error: unknown) => {
  console.error("Extension integration tests failed:", error);
  process.exitCode = 1;
});
