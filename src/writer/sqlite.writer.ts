import type { Database } from "bun:sqlite";

import { DEFAULT_TABLE_NAME } from "../config/writer.config";
import type { LogEntry } from "../types/logger";
import type { DatabaseAdapter, LogRow, SqliteAdapterOptions } from "../types/transport";

export const createSqliteAdapter = (
  database: Database,
  options: SqliteAdapterOptions = {},
): DatabaseAdapter => {
  const table = options.table ?? DEFAULT_TABLE_NAME;

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
