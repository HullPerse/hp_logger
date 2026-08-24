const cell = (value: unknown): string => String(value ?? "");

/**
 * Render an array of objects as a simple aligned plain-text table with a
 * header row. Column order follows the order of first appearance.
 */
export const renderTable = (rows: readonly Record<string, unknown>[]): string => {
  if (rows.length === 0) return "";
  const keys: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!keys.includes(key)) keys.push(key);
    }
  }
  const widths = new Map(
    keys.map((key) => [
      key,
      Math.max(key.length, ...rows.map((row) => cell(row[key]).length)),
    ]),
  );
  const renderRow = (values: string[], alignRight: boolean): string =>
    keys
      .map((key, index) => {
        const width = widths.get(key) ?? 0;
        const text = values[index] ?? "";
        return alignRight ? text.padStart(width) : text.padEnd(width);
      })
      .join("  ")
      .trimEnd();
  const header = keys.map((key) => key.padEnd(widths.get(key) ?? 0));
  const lines = [header.join("  ").trimEnd()];
  for (const row of rows) {
    lines.push(renderRow(keys.map((key) => cell(row[key])), true));
  }
  return lines.join("\n");
};