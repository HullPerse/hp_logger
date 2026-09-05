import type { MetricSnapshot } from "../types/metrics.js";
import { renderTable } from "./table.format.js";

const quantileText = (value: number | undefined): string =>
  value === undefined || Number.isNaN(value) ? "-" : String(Math.round(value * 10) / 10);

const rowValue = (
  type: MetricSnapshot["type"],
  row: { count?: number; p50?: number; p95?: number; sum?: number; value?: number },
): string => {
  if (type === "histogram") {
    return `n=${row.count ?? 0} sum=${row.sum ?? 0} p50=${quantileText(row.p50)} p95=${quantileText(row.p95)}`;
  }
  return String(row.value ?? 0);
};

/**
 * Render metric snapshots as an aligned plain-text table: one row per label
 * set, histograms show count, sum and estimated p50/p95. Output is plain
 * ASCII so it survives every transport unchanged.
 */
export const renderMetricsTable = (snapshots: readonly MetricSnapshot[]): string => {
  const rows = snapshots.flatMap((snapshot) =>
    snapshot.rows.map((row) => ({
      labels: row.key === "" ? "-" : row.key,
      metric: `${snapshot.type} ${snapshot.name}`,
      value: rowValue(snapshot.type, row),
    })),
  );
  return renderTable(rows);
};
