"use client";
import { ArrowLeft, ExternalLink, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { BloombergButton } from "../core/bloomberg-button";
import { bloombergColors } from "../lib/theme-config";
interface NewsItem { title: string; summary?: string; url: string; source: string; publishedAt?: string; time_published?: string; }
export default function NewsView({ isDarkMode, onBack }: { isDarkMode: boolean; onBack: () => void }) {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const colors = isDarkMode ? bloombergColors.dark : bloombergColors.light;
  const fetchNews = useCallback(async (query = "") => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setIsLoading(true); setError(null);
    try {
      const response = await fetch(`/api/terminal/news?query=${encodeURIComponent(query)}`, { signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `뉴스 요청 실패 (${response.status})`);
      setNews(data.items || []); setStatus(data.status || "unavailable");
      if (data.errors?.length) setError(data.errors.join(" · "));
    } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "뉴스를 불러오지 못했습니다."); }
    finally { if (!controller.signal.aborted) setIsLoading(false); }
  }, []);
  useEffect(() => { void fetchNews(); return () => request.current?.abort(); }, [fetchNews]);
  const search = (event: FormEvent) => { event.preventDefault(); void fetchNews(searchTerm); };
  return <div className="font-mono" style={{ backgroundColor: colors.background, color: colors.text }}>
    <div className="flex flex-wrap items-center gap-2 px-2 py-1" style={{ backgroundColor: colors.surface }}>
      <BloombergButton onClick={onBack}><ArrowLeft className="h-3 w-3 mr-1" />BACK</BloombergButton>
      <h2 className="text-sm font-bold">NEWS</h2><span className="text-xs" style={{ color: colors.accent }}>{status.toUpperCase()}</span>
      <form onSubmit={search} className="ml-auto flex gap-2"><input aria-label="뉴스 검색" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} className="px-2 py-1 text-xs border rounded-none" style={{ backgroundColor: colors.background, borderColor: colors.border }} placeholder="검색어…" />
      <BloombergButton type="submit" color="accent" disabled={isLoading}>{isLoading ? <RefreshCw className="h-3 w-3 animate-spin" /> : "SEARCH"}</BloombergButton></form>
    </div>
    <div className="p-2">
      {status === "demo" && <p className="p-2 text-xs text-amber-400">DEMO · 예시 뉴스입니다. 실제 보도가 아닙니다.</p>}
      {error && <p role="alert" className="p-2 text-xs text-amber-400">{error}</p>}
      {isLoading && <p className="p-4 text-xs">뉴스 로딩 중…</p>}
      {!isLoading && !news.length && <p className="p-4 text-xs">검색 결과가 없습니다.</p>}
      <div className="space-y-2">{news.map((item, index) => {
        const date = new Date(item.publishedAt || item.time_published || "");
        const safeUrl = /^https?:\/\//i.test(item.url || "") ? item.url : undefined;
        return <article key={`${item.url}-${index}`} className="p-3 border" style={{ borderColor: colors.border, backgroundColor: colors.surface }}>
          <div className="flex justify-between gap-2 mb-2"><h3 className="text-sm font-bold" style={{ color: colors.accent }}>{item.title}</h3>{safeUrl && <a href={safeUrl} target="_blank" rel="noopener noreferrer" aria-label={`${item.title} 원문`}><ExternalLink className="h-4 w-4" /></a>}</div>
          {item.summary && <p className="text-xs mb-2">{item.summary}</p>}
          <div className="flex justify-between text-xs text-gray-400"><span>{item.source}</span><time>{Number.isFinite(date.getTime()) ? date.toLocaleString("ko-KR") : "시각 미제공"}</time></div>
        </article>;
      })}</div>
    </div>
  </div>;
}
