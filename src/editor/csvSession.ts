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
import { DEFAULT_CSV_OPTIONS } from "../csv/csvOptions";

export class CsvSession {
  private disposed = false;
  private pendingOperations = 0;
  private operationTail: Promise<void> = Promise.resolve();

  private constructor(
    public readonly uri: Uri,
    private readonly database: DuckDBAdapter,
    private readonly source: CsvSource,
    private readonly executor: QueryExecutor,
  ) {}

  public static async create(
    uri: Uri,
    options: CsvOptions = DEFAULT_CSV_OPTIONS,
  ): Promise<CsvSession> {
    const database = await DuckDBAdapter.createInMemory();

    try {
      const source = new CsvSource(database);
      await source.replace(uri.fsPath, options);

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
    return this.enqueue(async () =>
      serializeQueryPage(await this.executor.execute(request)),
    );
  }

  public async updateOptions(
    options: CsvOptions,
  ): Promise<readonly ColumnMetadata[]> {
    this.assertOpen();
    return this.enqueue(() => this.source.replace(this.uri.fsPath, options));
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;

    if (this.pendingOperations === 0) {
      this.database.dispose();
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    this.pendingOperations += 1;

    const result = this.operationTail.then(() => {
      this.assertOpen();
      return operation();
    });
    this.operationTail = result.then(() => undefined, () => undefined);
    void this.operationTail.then(() => {
      this.pendingOperations -= 1;

      if (this.disposed && this.pendingOperations === 0) {
        this.database.dispose();
      }
    });

    return result;
  }

  private assertOpen(): void {
    if (this.disposed) {
      throw new Error("CSV session has been disposed");
    }
  }
}
