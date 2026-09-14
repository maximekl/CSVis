import type { Uri } from "vscode";

import { CsvSource } from "../csv/csvSource";
import { DuckDBAdapter } from "../duckdb/duckdbAdapter";
import { QueryExecutor } from "../query/queryExecutor";
import { serializeQueryPage } from "../query/resultSerializer";
import type {
  ColumnMetadata,
  CsvOptions,
  QueryRequest,
  QueryResult,
} from "../shared/protocol";

export class CsvSession {
  private disposed = false;

  private constructor(
    public readonly uri: Uri,
    private readonly database: DuckDBAdapter,
    private readonly source: CsvSource,
    private readonly executor: QueryExecutor,
  ) {}

  public static async create(uri: Uri): Promise<CsvSession> {
    const database = await DuckDBAdapter.createInMemory();

    try {
      const source = new CsvSource(database);
      await source.replace(uri.fsPath);

      return new CsvSession(
        uri,
        database,
        source,
        new QueryExecutor(database),
      );
    } catch (error: unknown) {
      database.dispose();
      throw error;
    }
  }

  public async executeQuery(request: QueryRequest): Promise<QueryResult> {
    this.assertOpen();
    return serializeQueryPage(await this.executor.execute(request));
  }

  public async updateOptions(
    options: CsvOptions,
  ): Promise<readonly ColumnMetadata[]> {
    this.assertOpen();
    return this.source.replace(this.uri.fsPath, options);
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.database.dispose();
  }

  private assertOpen(): void {
    if (this.disposed) {
      throw new Error("CSV session has been disposed");
    }
  }
}
