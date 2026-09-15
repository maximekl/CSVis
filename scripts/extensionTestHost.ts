import path from "node:path";

import { runTests } from "@vscode/test-electron";

export async function runExtensionHostTests(
  testFile: string,
  extensionTestsEnv: Record<string, string> = {},
): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, "..", "..");
  const executablePath = process.env.CSVIS_VSCODE_EXECUTABLE_PATH;

  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath: path.join(
      extensionDevelopmentPath,
      "dist",
      "test",
      testFile,
    ),
    cachePath: path.join(extensionDevelopmentPath, ".vscode-test"),
    ...(executablePath === undefined
      ? { version: process.env.CSVIS_VSCODE_VERSION ?? "stable" }
      : { vscodeExecutablePath: executablePath }),
    extensionTestsEnv: {
      CSVIS_INTEGRATION_TEST: "1",
      ...extensionTestsEnv,
    },
    launchArgs: [
      "--disable-extensions",
      "--skip-welcome",
      "--skip-release-notes",
      "--new-window",
    ],
  });
}
