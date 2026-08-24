import type { Database } from "bun:sqlite";

import { DEFAULT_TABLE_NAME } from "../config/writer.config";
import type { LogEntry } from "../types/logger";
import type { DatabaseAdapter, LogRow, SqliteAdapterOptions } from "../types/transport";

// The logger relies on these columns; an existing table must provide them.
// id is INTEGER, the rest TEXT. `context` defaults to '{}' on new tables.
const EXPECTED_COLUMNS: Record<string, string> = {
  author: "TEXT",
  context: "TEXT",
  id: "INTEGER",
  level: "TEXT",
  message: "TEXT",
  timestamp: "TEXT",
};

const SQL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/u;

/** Fail early when an existing table has a different schema than the logger. */
const assertSchema = (database: Database, table: string): void => {
  const columns = database.query(`PRAGMA table_info(${table})`).all() as {
    name: string;
    type: string;
  }[];
  const found = new Map(columns.map((column) => [column.name, column.type.toUpperCase()]));
  const missing: string[] = [];
  const mismatched: string[] = [];
  for (const [name, expectedType] of Object.entries(EXPECTED_COLUMNS)) {
    const actualType = found.get(name);
    if (actualType === undefined) {
      missing.push(name);
    } else if (!actualType.startsWith(expectedType)) {
      mismatched.push(`${name} (${actualType})`);
    }
  }
  if (missing.length > 0 || mismatched.length > 0) {
    const parts = [
      missing.length > 0 ? `missing columns: ${missing.join(", ")}` : "",
      mismatched.length > 0 ? `unexpected column types: ${mismatched.join(", ")}` : "",
    ].filter(Boolean);
    throw new Error(`sqlite table ${table} has an unexpected schema (${parts.join("; ")})`);
  }
};

export const createSqliteAdapter = (
  database: Database,
  options: SqliteAdapterOptions = {},
): DatabaseAdapter => {
  const table = options.table ?? DEFAULT_TABLE_NAME;
  if (!SQL_IDENTIFIER.test(table)) {
    throw new Error(`Invalid sqlite table name: ${table}`);
  }

  database.run(`
    CREATE TABLE IF NOT EXISTS ${table} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      level TEXT NOT NULL,
      author TEXT NOT NULL,
      message TEXT NOT NULL,
      context TEXT NOT NULL DEFAULT '{}'
    )
  `);

  assertSchema(database, table);

  const insert = database.prepare(
    `INSERT INTO ${table} (timestamp, level, author, message, context) VALUES (?, ?, ?, ?, ?)`,
  );

  const insertMany = database.transaction((rows: LogRow[]) => {
    for (const row of rows)
      insert.run(row.timestamp, row.level, row.author, row.message, row.context);
  });

  return {
    write(entries: LogEntry[]): void {
      const rows: LogRow[] = entries.map((entry) => ({
        author: entry.author,
        context: JSON.stringify(entry.context),
        level: entry.level,
        message: entry.message,
        timestamp: entry.timestamp,
      }));
      insertMany(rows);
    },
    // The caller owns the Database instance, so close() does not close it.
  };
};
