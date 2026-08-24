export const levelForStatus = (status: number): "error" | "info" | "warn" => {
  if (status >= 500) return "error";
  if (status >= 400) return "warn";
  return "info";
};

export const resolveCorrelationId = (header: string | string[] | undefined): string =>
  (Array.isArray(header) ? header[0] : header)?.trim() ?? crypto.randomUUID();

export const pathFromUrl = (url: string): string => new URL(url, "http://localhost").pathname;
