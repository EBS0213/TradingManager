export function formatNumber(value: unknown, digits = 2): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits }) : "—";
}
export function formatMarketTime(value: string | undefined): string {
  if (!value || value === "N/A") return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}
export function formatPercent(value: unknown, signed = false): string {
  return typeof value === "number" && Number.isFinite(value) ? `${signed && value > 0 ? "+" : ""}${value.toFixed(2)}%` : "—";
}
