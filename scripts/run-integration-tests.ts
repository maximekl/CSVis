import { runExtensionHostTests } from "./extensionTestHost";

async function main(): Promise<void> {
  await runExtensionHostTests("integration/index.js");
}

void main().catch((error: unknown) => {
  console.error("Extension integration tests failed:", error);
  process.exitCode = 1;
});
