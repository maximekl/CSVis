import type { DuckDBAdapter } from "../duckdb/duckdbAdapter";
import type { ColumnMetadata } from "../shared/protocol";

const CSV_VIEW_NAME = "csv";

export class CsvSource {
  public constructor(private readonly database: DuckDBAdapter) {}

  public async replace(filePath: string): Promise<readonly ColumnMetadata[]> {
    if (filePath.length === 0) {
      throw new Error("CSV file path cannot be empty");
    }

    const filePathLiteral = toSqlStringLiteral(filePath);

    await this.database.query(
      `CREATE OR REPLACE VIEW ${CSV_VIEW_NAME} AS ` +
        `SELECT * FROM read_csv(${filePathLiteral}, auto_detect = true)`,
    );

    return this.getSchema();
  }

  public async getSchema(): Promise<readonly ColumnMetadata[]> {
    const result = await this.database.query(`DESCRIBE ${CSV_VIEW_NAME}`);

    return result.getRows().map((row) => {
      const [name, type] = row;

      if (typeof name !== "string" || typeof type !== "string") {
        throw new Error("DuckDB returned an invalid CSV schema");
      }

      return { name, type };
    });
  }
}

function toSqlStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
