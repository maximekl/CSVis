import { stat } from "node:fs/promises";
import type { Uri } from "vscode";

import { DEFAULT_CSV_OPTIONS } from "../csv/csvOptions";
import { CsvSource } from "../csv/csvSource";
import { DuckDBAdapter } from "../duckdb/duckdbAdapter";
import { QueryExecutor } from "../query/queryExecutor";
import { serializeQueryPage } from "../query/resultSerializer";
import type {
  ColumnMetadata,
  CsvFileStatus,
  CsvOptions,
  QueryRequest,
  QueryResult,
} from "../shared/protocol";

export interface CsvFileReloadOutcome {
  readonly revision: number;
  readonly status: Extract<CsvFileStatus, "ready" | "missing" | "error">;
  readonly message?: string;
}

export class CsvSession {
  private disposed = false;
  private pendingOperations = 0;
  private operationTail: Promise<void> = Promise.resolve();
  private fileRevision = 0;
  private fileStatus: CsvFileStatus = "ready";
  private fileMessage: string | undefined;

  public get currentFileRevision(): number {
    return this.fileRevision;
  }

  public get currentFileStatus(): CsvFileStatus {
    return this.fileStatus;
  }

  public get currentFileMessage(): string | undefined {
    return this.fileMessage;
  }

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
    const revision = this.fileRevision;
    this.assertFileReady(revision);

    return this.enqueue(async () => {
      this.assertFileReady(revision);
      const result = serializeQueryPage(await this.executor.execute(request));
      this.assertFileReady(revision);
      return result;
    });
  }

  public invalidateFile(status: "reloading" | "missing"): number {
    this.assertOpen();
    this.fileRevision += 1;
    this.fileStatus = status;
    this.fileMessage =
      status === "missing"
        ? "CSV file was deleted. Waiting for it to be recreated."
        : undefined;
    return this.fileRevision;
  }

  public async reloadFile(
    options: CsvOptions,
    revision: number,
  ): Promise<CsvFileReloadOutcome | undefined> {
    this.assertOpen();

    return this.enqueue(async () => {
      if (revision !== this.fileRevision || this.fileStatus !== "reloading") {
        return undefined;
      }

      try {
        await stat(this.uri.fsPath);
        await this.source.replace(this.uri.fsPath, options);

        if (revision !== this.fileRevision) {
          return undefined;
        }

        this.fileStatus = "ready";
        this.fileMessage = undefined;
        return { revision, status: "ready" };
      } catch (error: unknown) {
        if (revision !== this.fileRevision) {
          return undefined;
        }

        const missing = await isMissingFile(this.uri.fsPath, error);
        this.fileStatus = missing ? "missing" : "error";
        this.fileMessage = missing
          ? "CSV file was deleted. Waiting for it to be recreated."
          : error instanceof Error
            ? error.message
            : String(error);
        return {
          revision,
          status: this.fileStatus,
          message: this.fileMessage,
        };
      }
    });
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

  private assertFileReady(revision: number): void {
    if (revision !== this.fileRevision || this.fileStatus !== "ready") {
      throw new Error("CSV file changed or is unavailable; wait for reload");
    }
  }
}

async function isMissingFile(
  filePath: string,
  error: unknown,
): Promise<boolean> {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  ) {
    return true;
  }

  try {
    await stat(filePath);
    return false;
  } catch (statError: unknown) {
    return (
      typeof statError === "object" &&
      statError !== null &&
      "code" in statError &&
      statError.code === "ENOENT"
    );
  }
}
