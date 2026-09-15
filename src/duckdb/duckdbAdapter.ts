import {
  DuckDBConnection,
  DuckDBInstance,
  StatementType,
  type DuckDBResultReader,
} from "@duckdb/node-api";
import path from "node:path";

import { toSqlStringLiteral } from "./sqlLiteral";

export type DuckDBStatementKind = "select" | "other";
export const DUCKDB_MEMORY_LIMIT = "512MiB";

const SECURE_STARTUP_OPTIONS: Readonly<Record<string, string>> = {
  memory_limit: DUCKDB_MEMORY_LIMIT,
  // An in-memory instance otherwise grants its .tmp directory implicitly.
  temp_directory: "",
  max_temp_directory_size: "0B",
  autoinstall_known_extensions: "false",
  autoload_known_extensions: "false",
  allow_community_extensions: "false",
  allow_unsigned_extensions: "false",
  allow_persistent_secrets: "false",
};

export class DuckDBAdapter {
  private disposed = false;

  private constructor(
    private readonly instance: DuckDBInstance,
    private readonly connection: DuckDBConnection,
  ) {}

  public static async createInMemory(
    allowedCsvPath?: string,
  ): Promise<DuckDBAdapter> {
    // read_csv expands glob characters even when the caller intends a literal file.
    if (
      allowedCsvPath !== undefined &&
      (
        !path.isAbsolute(allowedCsvPath) ||
        allowedCsvPath.includes("\0") ||
        /[*?\[\]]/u.test(allowedCsvPath)
      )
    ) {
      throw new Error(
        "Allowed CSV path must be absolute and contain no NUL or glob characters",
      );
    }

    const instance = await DuckDBInstance.create(
      ":memory:",
      SECURE_STARTUP_OPTIONS,
    );
    let connection: DuckDBConnection | undefined;

    try {
      connection = await instance.connect();
      const allowedPaths = allowedCsvPath === undefined
        ? "[]"
        : `[${toSqlStringLiteral(path.resolve(allowedCsvPath))}]`;

      // Only the setup connection can run SQL before external access is disabled.
      await connection.runAndReadAll(`SET allowed_paths = ${allowedPaths}`);
      await connection.runAndReadAll("SET allowed_directories = []");
      await connection.runAndReadAll("SET allowed_configs = []");
      await connection.runAndReadAll("SET enable_external_access = false");
      await connection.runAndReadAll("SET lock_configuration = true");
      return new DuckDBAdapter(instance, connection);
    } catch (error: unknown) {
      try {
        connection?.closeSync();
      } finally {
        instance.closeSync();
      }

      throw error;
    }
  }

  public async query(sql: string): Promise<DuckDBResultReader> {
    this.assertOpen();
    return this.connection.runAndReadAll(sql);
  }

  public async getStatementKinds(
    sql: string,
  ): Promise<readonly DuckDBStatementKind[]> {
    this.assertOpen();

    const extractedStatements = await this.connection.extractStatements(sql);
    const statementKinds: DuckDBStatementKind[] = [];

    for (let index = 0; index < extractedStatements.count; index += 1) {
      const statement = await extractedStatements.prepare(index);

      try {
        statementKinds.push(
          statement.statementType === StatementType.SELECT ? "select" : "other",
        );
      } finally {
        statement.destroySync();
      }
    }

    return statementKinds;
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;

    try {
      this.connection.closeSync();
    } finally {
      this.instance.closeSync();
    }
  }

  private assertOpen(): void {
    if (this.disposed) {
      throw new Error("DuckDB adapter has been disposed");
    }
  }
}
