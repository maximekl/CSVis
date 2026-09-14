import type { DuckDBAdapter } from "../duckdb/duckdbAdapter";

export class QueryValidationError extends Error {
  public override readonly name = "QueryValidationError";
}

export async function validateQuery(
  database: DuckDBAdapter,
  sql: string,
): Promise<string> {
  const normalizedSql = removeTrailingStatementTerminator(sql.trim());

  if (normalizedSql.length === 0) {
    throw new QueryValidationError("Query cannot be empty");
  }

  const firstKeyword = getFirstKeyword(normalizedSql);

  if (firstKeyword !== "SELECT" && firstKeyword !== "WITH") {
    throw new QueryValidationError("Query must begin with SELECT or WITH");
  }

  let statementKinds: readonly ("select" | "other")[];

  try {
    statementKinds = await database.getStatementKinds(normalizedSql);
  } catch (error: unknown) {
    throw new QueryValidationError("Query is not valid DuckDB SQL", {
      cause: error,
    });
  }

  if (statementKinds.length !== 1) {
    throw new QueryValidationError("Query must contain exactly one statement");
  }

  if (statementKinds[0] !== "select") {
    throw new QueryValidationError("Only SELECT queries are allowed");
  }

  return normalizedSql;
}

function removeTrailingStatementTerminator(sql: string): string {
  let quote: "'" | '"' | undefined;
  let inLineComment = false;
  let blockCommentDepth = 0;
  let lastSignificantIndex = -1;

  for (let index = 0; index < sql.length; index += 1) {
    if (inLineComment) {
      if (sql[index] === "\n") {
        inLineComment = false;
      }
      continue;
    }

    if (blockCommentDepth > 0) {
      if (sql.startsWith("/*", index)) {
        blockCommentDepth += 1;
        index += 1;
      } else if (sql.startsWith("*/", index)) {
        blockCommentDepth -= 1;
        index += 1;
      }
      continue;
    }

    if (quote !== undefined) {
      lastSignificantIndex = index;

      if (sql[index] === quote) {
        if (sql[index + 1] === quote) {
          index += 1;
          lastSignificantIndex = index;
        } else {
          quote = undefined;
        }
      }
      continue;
    }

    if (sql.startsWith("--", index)) {
      inLineComment = true;
      index += 1;
      continue;
    }

    if (sql.startsWith("/*", index)) {
      blockCommentDepth = 1;
      index += 1;
      continue;
    }

    const character = sql[index];

    if (character === "'" || character === '"') {
      quote = character;
      lastSignificantIndex = index;
    } else if (!/\s/u.test(character ?? "")) {
      lastSignificantIndex = index;
    }
  }

  if (sql[lastSignificantIndex] !== ";") {
    return sql;
  }

  return `${sql.slice(0, lastSignificantIndex)}${sql.slice(lastSignificantIndex + 1)}`.trim();
}

function getFirstKeyword(sql: string): string | undefined {
  let index = 0;

  while (index < sql.length) {
    if (/\s/u.test(sql[index] ?? "")) {
      index += 1;
      continue;
    }

    if (sql.startsWith("--", index)) {
      const lineEnd = sql.indexOf("\n", index + 2);
      index = lineEnd === -1 ? sql.length : lineEnd + 1;
      continue;
    }

    if (sql.startsWith("/*", index)) {
      const commentEnd = sql.indexOf("*/", index + 2);

      if (commentEnd === -1) {
        return undefined;
      }

      index = commentEnd + 2;
      continue;
    }

    break;
  }

  return /^[a-z]+/iu.exec(sql.slice(index))?.[0]?.toUpperCase();
}
