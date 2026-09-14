import {
  DuckDBConnection,
  DuckDBInstance,
  StatementType,
  type DuckDBResultReader,
} from "@duckdb/node-api";

export type DuckDBStatementKind = "select" | "other";

export class DuckDBAdapter {
  private disposed = false;

  private constructor(
    private readonly instance: DuckDBInstance,
    private readonly connection: DuckDBConnection,
  ) {}

  public static async createInMemory(): Promise<DuckDBAdapter> {
    const instance = await DuckDBInstance.create(":memory:");

    try {
      const connection = await instance.connect();
      return new DuckDBAdapter(instance, connection);
    } catch (error: unknown) {
      instance.closeSync();
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
