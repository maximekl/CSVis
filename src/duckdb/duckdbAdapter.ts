import {
  DuckDBConnection,
  DuckDBInstance,
  type DuckDBResultReader,
} from "@duckdb/node-api";

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
