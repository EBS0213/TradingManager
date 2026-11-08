import { queryOptions } from "@tanstack/react-query";

export type EconomyPoint = { date: string; value: number | null };
export type EconomySeries = {
  id: string;
  name: string;
  category: "macro" | "rates" | "fx" | "commodities" | "country";
  country: string;
  unit: string;
  frequency: string;
  points: EconomyPoint[];
  value: number | null;
  previous: number | null;
  change: number | null;
  asOf: string | null;
  status: "available" | "stale" | "unavailable";
  source: { name: string; url: string; note?: string };
  note?: string;
};
export type EconomyConnector = {
  id: string;
  name: string;
  status: "connected" | "on_request" | "key_required" | "unavailable";
  description: string;
  url: string;
};
export type EconomyResponse = {
  series: EconomySeries[];
  fetchedAt: string;
  errors: string[];
  connectors?: EconomyConnector[];
};

export const ECONOMY_COUNTRIES = [
  ["USA", "미국"], ["KOR", "한국"], ["JPN", "일본"], ["CHN", "중국"],
  ["DEU", "독일"], ["GBR", "영국"], ["IND", "인도"], ["CAN", "캐나다"],
  ["FRA", "프랑스"], ["AUS", "호주"], ["BRA", "브라질"], ["WLD", "세계"],
] as const;

export function economyQueryOptions(view: "overview" | "country", country = "KOR") {
  return queryOptions({
    queryKey: view === "overview" ? ["terminal-economy", "overview"] : ["terminal-economy", "country", country],
    queryFn: async ({ signal }): Promise<EconomyResponse> => {
      const params = new URLSearchParams({ view });
      if (view === "country") params.set("country", country);
      const response = await fetch(`/api/terminal/economy?${params}`, { signal });
      if (!response.ok) throw new Error("경제 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
      const data = await response.json();
      if (!data || !Array.isArray(data.series)) throw new Error("경제 데이터 응답을 확인할 수 없습니다.");
      return { ...data, errors: Array.isArray(data.errors) ? data.errors : [] };
    },
    staleTime: 15 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
}

export function economyNumber(value: number | null | undefined, compact = false): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: Math.abs(value) < 1 && value !== 0 ? 4 : 2,
    notation: compact && Math.abs(value) >= 1_000_000 ? "compact" : "standard",
  }).format(value);
}

export function economyFrequency(frequency: string): string {
  const labels: Record<string, string> = {
    annual: "연간", yearly: "연간", annually: "연간", A: "연간",
    quarterly: "분기", Q: "분기", monthly: "월간", M: "월간",
    unknown: "주기 미제공", weekly: "주간", W: "주간", daily: "일간", D: "일간", intraday: "장중",
  };
  return labels[frequency] || frequency || "주기 미제공";
}

export function economyCountry(country: string): string {
  return ECONOMY_COUNTRIES.find(([code]) => code === country)?.[1] || (country === "GLOBAL" ? "글로벌" : country);
}

export function economySourceUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : undefined;
  } catch { return undefined; }
}

export function selectEconomyHighlights(series: EconomySeries[], limit = 6): EconomySeries[] {
  const unavailable = (item: EconomySeries) => item.status === "unavailable" || typeof item.value !== "number" || !Number.isFinite(item.value);
  const rank = (item: EconomySeries) => unavailable(item) ? 2 : item.status === "stale" ? 1 : 0;
  const candidates = [...series].sort((a, b) => rank(a) - rank(b));
  const priorities = [
    (item: EconomySeries) => /CPI.*YOY|소비자물가.*상승률/i.test(`${item.id} ${item.name}`),
    (item: EconomySeries) => /UNRATE|LNS14000000|미국.*실업률/i.test(`${item.id} ${item.name}`),
    (item: EconomySeries) => item.category === "rates" && /DGS10|10Y|10년/i.test(`${item.id} ${item.name}`),
    (item: EconomySeries) => item.category === "fx" && /USD.?KRW|달러.*원|원.*달러/i.test(`${item.id} ${item.name}`),
    (item: EconomySeries) => item.category === "commodities" && /WTI|서부.*텍사스/i.test(`${item.id} ${item.name}`),
    (item: EconomySeries) => item.category === "commodities" && /GOLD|금\s|금$/i.test(`${item.id} ${item.name}`),
  ];
  const selected: EconomySeries[] = [];
  const seen = new Set<string>();
  const add = (item: EconomySeries) => { const key = `${item.country}:${item.id}`; if (!seen.has(key)) { seen.add(key); selected.push(item); } };
  for (const matches of priorities) {
    const item = candidates.find((candidate) => matches(candidate) && !seen.has(`${candidate.country}:${candidate.id}`));
    if (item) add(item);
  }
  for (const item of candidates) { if (selected.length >= limit) break; add(item); }
  return selected.sort((a, b) => Number(unavailable(a)) - Number(unavailable(b))).slice(0, limit);
}

export function economyCsv(series: EconomySeries[]): string {
  // Text cells are always quoted, and spreadsheet formulas are neutralized.
  const cell = (value: string | number | null) => {
    if (value === null) return "";
    if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
    const safe = /^[\s\u0000-\u001f]*[=+\-@]/u.test(value) ? `'${value}` : value;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const rows: (string | number | null)[][] = [["지표", "국가", "날짜", "값", "단위", "주기", "상태", "출처", "출처 URL"]];
  for (const item of series) {
    for (const point of item.points) {
      rows.push([item.name, item.country, point.date, point.value, item.unit, item.frequency, item.status, item.source.name, item.source.url]);
    }
  }
  return "\uFEFF" + rows.map((row) => row.map(cell).join(",")).join("\r\n");
}
