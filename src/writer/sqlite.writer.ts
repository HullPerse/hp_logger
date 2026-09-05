import type { Database } from "bun:sqlite";

import { DEFAULT_TABLE_NAME, LOG_SCHEMA_VERSION } from "../config/writer.config.js";
import type { LogEntry } from "../types/logger.js";
import type { DatabaseAdapter, LogRow, SqliteAdapterOptions } from "../types/transport.js";

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

// With schemaVersion the row carries a version column; existing tables
// without it fail validation with a migration hint instead of silently
// writing unversioned rows.
const VERSION_COLUMN = "version";

const SQL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/u;

/** Fail early when an existing table has a different schema than the logger. */
const assertSchema = (database: Database, table: string, schemaVersion: boolean): void => {
  const columns = database.query(`PRAGMA table_info(${table})`).all() as {
    name: string;
    type: string;
  }[];
  const found = new Map(columns.map((column) => [column.name, column.type.toUpperCase()]));
  const expected: Record<string, string> = schemaVersion
    ? { ...EXPECTED_COLUMNS, [VERSION_COLUMN]: "INTEGER" }
    : EXPECTED_COLUMNS;
  const missing: string[] = [];
  const mismatched: string[] = [];
  for (const [name, expectedType] of Object.entries(expected)) {
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
    const hint =
      schemaVersion && missing.includes(VERSION_COLUMN)
        ? " - add it with ALTER TABLE or drop the schemaVersion option"
        : "";
    throw new Error(`sqlite table ${table} has an unexpected schema (${parts.join("; ")})${hint}`);
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
  const schemaVersion = options.schemaVersion === true;

  database.run(`
    CREATE TABLE IF NOT EXISTS ${table} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      level TEXT NOT NULL,
      author TEXT NOT NULL,
      message TEXT NOT NULL,
      context TEXT NOT NULL DEFAULT '{}'${schemaVersion ? `,\n      ${VERSION_COLUMN} INTEGER NOT NULL DEFAULT ${LOG_SCHEMA_VERSION}` : ""}
    )
  `);

  assertSchema(database, table, schemaVersion);

  const insert = database.prepare(
    schemaVersion
      ? `INSERT INTO ${table} (timestamp, level, author, message, context, ${VERSION_COLUMN}) VALUES (?, ?, ?, ?, ?, ?)`
      : `INSERT INTO ${table} (timestamp, level, author, message, context) VALUES (?, ?, ?, ?, ?)`,
  );

  const insertMany = database.transaction((rows: LogRow[]) => {
    if (schemaVersion) {
      for (const row of rows)
        insert.run(
          row.timestamp,
          row.level,
          row.author,
          row.message,
          row.context,
          LOG_SCHEMA_VERSION,
        );
    } else {
      for (const row of rows)
        insert.run(row.timestamp, row.level, row.author, row.message, row.context);
    }
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
