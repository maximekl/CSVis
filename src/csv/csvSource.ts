import type { DuckDBAdapter } from "../duckdb/duckdbAdapter";
import { toSqlStringLiteral } from "../duckdb/sqlLiteral";
import type { ColumnMetadata, CsvOptions } from "../shared/protocol";
import { DEFAULT_CSV_OPTIONS, parseCsvOptions } from "./csvOptions";

const CSV_VIEW_NAME = "csv";

export class CsvSource {
  public constructor(private readonly database: DuckDBAdapter) {}

  public async replace(
    filePath: string,
    options: CsvOptions = DEFAULT_CSV_OPTIONS,
  ): Promise<readonly ColumnMetadata[]> {
    if (filePath.length === 0) {
      throw new Error("CSV file path cannot be empty");
    }

    const validatedOptions = parseCsvOptions(options);
    const filePathLiteral = toSqlStringLiteral(filePath);
    const readCsvArguments = [
      filePathLiteral,
      "auto_detect = true",
      `encoding = ${toSqlStringLiteral(validatedOptions.encoding)}`,
    ];

    if (validatedOptions.delimiter.mode === "manual") {
      readCsvArguments.push(
        `delim = ${toSqlStringLiteral(validatedOptions.delimiter.value)}`,
      );
    }

    if (validatedOptions.header !== "auto") {
      readCsvArguments.push(
        `header = ${validatedOptions.header === "present" ? "true" : "false"}`,
      );
    }

    await this.database.query(
      `CREATE OR REPLACE VIEW ${CSV_VIEW_NAME} AS ` +
        `SELECT * FROM read_csv(${readCsvArguments.join(", ")})`,
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
