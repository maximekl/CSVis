export function toSqlStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
