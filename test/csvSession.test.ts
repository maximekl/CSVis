import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import type { Uri } from "vscode";

import { CsvSessionManager } from "../src/editor/csvSessionManager";

const fixturesDirectory = path.resolve(__dirname, "../../test/fixtures");

test("shares one session per CSV until its last document closes", async (t) => {
  const manager = new CsvSessionManager();
  t.after(() => manager.dispose());
  const commaUri = fileUri(path.join(fixturesDirectory, "comma.csv"));
  const semicolonUri = fileUri(path.join(fixturesDirectory, "semicolon.csv"));

  const firstCommaDocument = await manager.open(commaUri);
  const secondCommaDocument = await manager.open(commaUri);
  const semicolonDocument = await manager.open(semicolonUri);

  assert.equal(firstCommaDocument.session, secondCommaDocument.session);
  assert.notEqual(firstCommaDocument.session, semicolonDocument.session);
  assert.equal(manager.activeSessionCount, 2);

  const result = await secondCommaDocument.session.executeQuery({
    requestId: "duplicate-tab",
    sql: "SELECT name FROM csv ORDER BY id",
    page: 0,
    pageSize: 200,
  });

  assert.deepEqual(result.rows, [["Alice"], ["Bob"]]);

  firstCommaDocument.dispose();
  assert.equal(manager.activeSessionCount, 2);

  await secondCommaDocument.session.executeQuery({
    requestId: "remaining-tab",
    sql: "SELECT * FROM csv",
    page: 0,
    pageSize: 1,
  });

  secondCommaDocument.dispose();
  assert.equal(manager.activeSessionCount, 1);
  await assert.rejects(
    firstCommaDocument.session.executeQuery({
      requestId: "closed-file",
      sql: "SELECT * FROM csv",
      page: 0,
      pageSize: 1,
    }),
    /disposed/,
  );

  semicolonDocument.dispose();
  semicolonDocument.dispose();
  assert.equal(manager.activeSessionCount, 0);
});

test("disposing the manager closes every active CSV session", async (t) => {
  const manager = new CsvSessionManager();
  t.after(() => manager.dispose());
  const firstDocument = await manager.open(
    fileUri(path.join(fixturesDirectory, "comma.csv")),
  );
  const secondDocument = await manager.open(
    fileUri(path.join(fixturesDirectory, "semicolon.csv")),
  );

  manager.dispose();
  manager.dispose();

  assert.equal(manager.activeSessionCount, 0);

  for (const document of [firstDocument, secondDocument]) {
    await assert.rejects(
      document.session.executeQuery({
        requestId: "extension-deactivated",
        sql: "SELECT * FROM csv",
        page: 0,
        pageSize: 1,
      }),
      /disposed/,
    );
  }

  await assert.rejects(
    manager.open(fileUri(path.join(fixturesDirectory, "comma.csv"))),
    /manager has been disposed/,
  );
});

function fileUri(filePath: string): Uri {
  return {
    fsPath: filePath,
    toString: () => `file://${filePath}`,
  } as Uri;
}
