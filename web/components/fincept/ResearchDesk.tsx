"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import styles from "./ResearchDesk.module.css";

type CallItem = {
  code: string; name: string; market: string; quarter: string; date: string;
  sector: string; headline: string; summary: string; call: string;
  industry: string; outlook: string; madeAt: string;
  numbers: { k: string; v: string; note: string }[];
  sources: { label: string; url: string }[];
};
type CallsResponse = { ingestion?: {code:string;stage:string;completed:number;total:number;totalCalls?:number;completedCalls?:number;failedCalls?:number;updatedAt:string}|null; items: CallItem[]; updated_at: string | null; page: number; pages: number; total: number };
type PublicPost = { id: number; title: string; created_at: string; author: string };
type PostsResponse = { posts: PublicPost[]; page: number; pages: number; total: number };
type EarningsItem = {
  date: string; symbol: string; name: string; time: string; quarter: string; marketCap: number;
};
type EarningsDay = { date: string; ok: boolean; items: EarningsItem[] };
type CalendarResponse = {
  ok: boolean; days: EarningsDay[]; updatedAt: string | null; timeZone: string; source: string;
};
type ResearchDeskProps = { page: "calls" | "calendar"; embedded?: boolean; onNavigate: (page: string) => void };
type JsonObject = Record<string, unknown>;

const EMPTY_CALLS: CallItem[] = [];
const EMPTY_DAYS: EarningsDay[] = [];
const stringValue = (value: unknown) => typeof value === "string" ? value : "";
const objectValue = (value: unknown): JsonObject => value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
const arrayValue = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

function externalUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : undefined;
  } catch { return undefined; }
}

function timestamp(value: string | null | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return "—";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short",
  }).format(new Date(value));
}

function calendarLabel(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("ko-KR", {
    timeZone: "UTC", month: "numeric", day: "numeric", weekday: "short",
  }).format(date) : value;
}

async function readJson(url: string, signal: AbortSignal, allowCalendarFailure = false): Promise<JsonObject> {
  const response = await fetch(url, { signal, headers: { Accept: "application/json" } });
  let body: JsonObject;
  try { body = objectValue(await response.json()); }
  catch { throw new Error(`자료 응답을 읽지 못했습니다. (HTTP ${response.status})`); }
  // A 503 calendar response can still describe which individual dates failed.
  if (allowCalendarFailure && Array.isArray(body.days)) return body;
  if (!response.ok || body.ok === false) throw new Error(`자료를 불러오지 못했습니다. (HTTP ${response.status})`);
  return body;
}

export async function getCalls(signal: AbortSignal, archive?: { page: number; search: string }): Promise<CallsResponse> {
  const url = archive ? `/api/calls?${new URLSearchParams({archive:"1",page:String(archive.page),q:archive.search})}` : "/api/calls";
  const body = await readJson(url, signal);
  if (!Array.isArray(body.items)) throw new Error("컨퍼런스콜 목록 형식을 확인할 수 없습니다.");
  const items = body.items.map(objectValue).map((item): CallItem => ({
    code: stringValue(item.code), name: stringValue(item.name), market: stringValue(item.market),
    quarter: stringValue(item.quarter), date: stringValue(item.date), sector: stringValue(item.sector),
    headline: stringValue(item.headline), summary: stringValue(item.summary), call: stringValue(item.call),
    industry: stringValue(item.industry), outlook: stringValue(item.outlook), madeAt: stringValue(item.madeAt),
    numbers: arrayValue(item.numbers).map(objectValue).map(number => ({
      k: stringValue(number.k), v: stringValue(number.v), note: stringValue(number.note),
    })),
    sources: arrayValue(item.sources).map(objectValue).map(source => ({
      label: stringValue(source.label), url: stringValue(source.url),
    })),
  })).filter(item => item.code || item.name).sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name, "ko"));
  return { items, ingestion: body.ingestion ? objectValue(body.ingestion) as CallsResponse["ingestion"] : null, updated_at: stringValue(body.updated_at) || null, page: Number(body.page) || 1, pages: Math.max(1, Number(body.pages) || 1), total: Math.max(0, Number(body.total) || items.length) };
}

async function getPosts(page: number, signal: AbortSignal): Promise<PostsResponse> {
  const body = await readJson(`/api/board?cat=calls&page=${page}`, signal);
  if (!Array.isArray(body.posts)) throw new Error("공개 게시글 목록 형식을 확인할 수 없습니다.");
  return {
    posts: body.posts.map(objectValue).filter(item => Number.isSafeInteger(Number(item.id)) && Number(item.id) > 0).map(item => ({
      id: Number(item.id), title: stringValue(item.title), created_at: stringValue(item.created_at), author: stringValue(item.author),
    })),
    page: Number(body.page) || page, pages: Math.max(1, Number(body.pages) || 1), total: Math.max(0, Number(body.total) || 0),
  };
}

async function getCalendar(signal: AbortSignal): Promise<CalendarResponse> {
  const body = await readJson("/api/calls/calendar", signal, true);
  if (!Array.isArray(body.days)) throw new Error("실적 달력 형식을 확인할 수 없습니다.");
  return {
    ok: body.ok === true, updatedAt: stringValue(body.updatedAt) || null,
    timeZone: stringValue(body.timeZone), source: stringValue(body.source),
    days: body.days.map(objectValue).filter(day => /^\d{4}-\d{2}-\d{2}$/.test(stringValue(day.date))).map(day => ({
      date: stringValue(day.date), ok: day.ok === true,
      items: arrayValue(day.items).map(objectValue).map(item => ({
        date: stringValue(item.date) || stringValue(day.date), symbol: stringValue(item.symbol), name: stringValue(item.name),
        time: stringValue(item.time) || "시간 미정", quarter: stringValue(item.quarter),
        marketCap: typeof item.marketCap === "number" && Number.isFinite(item.marketCap) ? item.marketCap : 0,
      })).filter(item => item.symbol),
    })),
  };
}

function ErrorNotice({ message, onRetry, retrying = false }: { message: string; onRetry: () => void; retrying?: boolean }) {
  return <div className={styles.notice} role="alert">
    <span>{message}</span>
    <button className="fc-button" type="button" onClick={onRetry} disabled={retrying}>{retrying ? "조회 중…" : "재조회"}</button>
  </div>;
}

function TextSection({ title, text }: { title: string; text: string }) {
  return <section className={styles.textSection}>
    <h3>{title}</h3>
    {text.trim() ? <div className={styles.prose}>{text}</div> : <p className="fc-muted">저장된 내용이 없습니다.</p>}
  </section>;
}

export function CallDetail({ item }: { item: CallItem }) {
  return <article className={styles.detail} aria-label={`${item.name || item.code} 컨퍼런스콜 상세`}>
    <header className={styles.detailHeader}>
      <div className={styles.metadata}><b>{item.code || "—"}</b><span>{item.market || "시장 미기재"}</span><span>{item.sector || "업종 미기재"}</span></div>
      <h2>{item.name || item.code}</h2>
      <div className={styles.metadata}><span>회계분기 {item.quarter || "—"}</span><span>발표일 {item.date || "—"}</span></div>
      {item.headline ? <p className={styles.headline}>{item.headline}</p> : null}
    </header>
    <TextSection title="요약" text={item.summary} />
    <TextSection title="콜 상세 해설" text={item.call} />
    <section className={styles.textSection}>
      <h3>핵심 수치</h3>
      {item.numbers.length ? <div className="fc-table-wrap"><table className="fc-table">
        <caption className={styles.srOnly}>저장된 핵심 수치</caption>
        <thead><tr><th scope="col">항목</th><th scope="col">값</th><th scope="col">설명</th></tr></thead>
        <tbody>{item.numbers.map((number, index) => <tr key={`${number.k}-${index}`}><th scope="row">{number.k || "—"}</th><td className={styles.numeric}>{number.v || "—"}</td><td>{number.note || "—"}</td></tr>)}</tbody>
      </table></div> : <p className="fc-muted">저장된 수치가 없습니다.</p>}
    </section>
    <TextSection title="산업 전망" text={item.industry} />
    <TextSection title="회사 전망" text={item.outlook} />
    
  </article>;
}

const callKey = (item: CallItem) => `${item.code}|${item.quarter}|${item.date}`;

function CallsDesk({ onNavigate }: Pick<ResearchDeskProps, "onNavigate">) {
  const [search, setSearch] = useState("");
  const [market, setMarket] = useState("전체");
  const [selectedKey, setSelectedKey] = useState("");
  const [postsPage, setPostsPage] = useState(1);
  const calls = useQuery({ queryKey: ["fincept", "calls"], queryFn: ({ signal }) => getCalls(signal), staleTime: 60_000, retry: 1 });
  const posts = useQuery({ queryKey: ["fincept", "calls-posts", postsPage], queryFn: ({ signal }) => getPosts(postsPage, signal), staleTime: 60_000, retry: 1 });
  const allItems = calls.data?.items ?? EMPTY_CALLS;
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return allItems.filter(item => (market === "전체" || item.market === market)
      && (!query || `${item.code} ${item.name} ${item.sector} ${item.quarter} ${item.headline}`.toLocaleLowerCase().includes(query)));
  }, [allItems, search, market]);
  const selected = filtered.find(item => callKey(item) === selectedKey) ?? filtered[0];

  return <div className={`${styles.desk} ${styles.callsDesk}`}>
    <div className={`fc-toolbar ${styles.toolbar}`}>
      <label className={styles.searchLabel}>저장 자료 검색<input type="search" value={search} onChange={event => setSearch(event.target.value)} maxLength={100} placeholder="기업명 · 종목코드 · 분기" /></label>
      <label className={styles.searchLabel}>시장<select value={market} onChange={event => setMarket(event.target.value)}><option>전체</option><option>국내</option><option>해외</option></select></label>
      <span className="fc-muted">{filtered.length} / {allItems.length}건</span>
      <button type="button" className="fc-button" disabled={calls.isFetching || posts.isFetching} onClick={() => { void calls.refetch(); void posts.refetch(); }}>{calls.isFetching || posts.isFetching ? "조회 중…" : "재조회"}</button>
    </div>
    {calls.isError ? <ErrorNotice message={calls.error.message} onRetry={() => { void calls.refetch(); }} retrying={calls.isFetching} /> : null}
    <div className={`fc-split ${styles.callSplit}`}>
      <aside className={`${styles.sidebar} fc-panel`} aria-label="컨퍼런스콜 자료 목록">
        <div className="fc-panel-head"><span>저장 컨퍼런스콜</span><span className="fc-muted">최근 최대 60건</span></div>
        <div className={`fc-scroll ${styles.callList}`} aria-busy={calls.isPending}>
          {calls.isPending ? <p className="fc-empty" role="status">저장 자료를 불러오는 중…</p>
            : filtered.length ? filtered.map(item => <button type="button" key={callKey(item)} className={styles.listItem} aria-pressed={selected === item} onClick={() => setSelectedKey(callKey(item))}>
              <span className={styles.listTitle}><b>{item.name || item.code}</b><span>{item.code}</span></span>
              <span className={styles.listMeta}>{item.quarter || "분기 미기재"} · {item.date || "발표일 미기재"}</span>
              {item.headline ? <span className={styles.listHeadline}>{item.headline}</span> : null}
            </button>)
              : !calls.isError ? <div className="fc-empty"><p>{allItems.length ? "검색·시장 조건에 맞는 자료가 없습니다." : "현재 조회에서 표시할 저장 자료가 없습니다."}</p>
                {allItems.length ? <button className="fc-button" type="button" onClick={() => { setSearch(""); setMarket("전체"); }}>검색 초기화</button>
                  : <button className="fc-button" type="button" disabled={calls.isFetching} onClick={() => { void calls.refetch(); }}>재조회</button>}</div> : null}
        </div>
        <div className={`fc-panel-head ${styles.publicHeading}`}><span>공개 컨퍼런스콜 게시글</span><span className="fc-muted">{posts.data ? `${posts.data.total}건` : "—"}</span></div>
        {posts.isError ? <ErrorNotice message="공개 게시글을 불러오지 못했습니다." onRetry={() => { void posts.refetch(); }} retrying={posts.isFetching} /> : null}
        <div className={`fc-scroll ${styles.postList}`} aria-busy={posts.isPending}>
          {posts.isPending ? <p className="fc-empty" role="status">게시글을 불러오는 중…</p>
            : posts.data?.posts.length ? posts.data.posts.map(post => <button className={styles.listItem} type="button" key={post.id} onClick={() => onNavigate(`research/${post.id}`)}>
                <span className={styles.postTitle}>{post.title || "제목 없음"}<span aria-hidden="true"> ↗</span></span>
                <span className={styles.listMeta}>{post.created_at.slice(0, 10) || "—"}{post.author ? ` · ${post.author}` : ""}</span>
              </button>) : !posts.isError ? <p className="fc-empty">{postsPage > 1 ? "이 페이지에 표시할 게시글이 없습니다. 이전 페이지를 확인해 주세요." : "등록된 공개 게시글이 없습니다."}</p> : null}
        </div>
        {(posts.data?.pages ?? 1) > 1 || postsPage > 1 ? <div className={styles.pagination}>
          <button type="button" className="fc-button" disabled={postsPage <= 1 || posts.isFetching} onClick={() => setPostsPage(page => page - 1)}>이전</button>
          <span>{postsPage}페이지{posts.data && posts.data.pages >= postsPage ? ` / ${posts.data.pages}` : ""}</span>
          <button type="button" className="fc-button" disabled={postsPage >= (posts.data?.pages ?? postsPage) || posts.isFetching} onClick={() => setPostsPage(page => page + 1)}>다음</button>
        </div> : null}
      </aside>
      <section className={`fc-panel ${styles.detailPanel}`} aria-label="선택한 컨퍼런스콜">
        <div className="fc-panel-head"><span>자료 상세</span><span className="fc-muted">{selected?.code || "선택 대기"}</span></div>
        <div key={selected ? callKey(selected) : "empty"} className={`fc-scroll ${styles.detailScroll}`}>
          {selected ? <CallDetail key={callKey(selected)} item={selected} /> : <div className="fc-empty">{calls.isPending ? "자료를 확인하고 있습니다." : "왼쪽 목록에서 자료를 선택하면 상세 해설이 표시됩니다."}</div>}
        </div>
      </section>
    </div>
    <div className={styles.footer}><span>저장 자료 갱신 {timestamp(calls.data?.updated_at)} (한국시간)</span><button type="button" className="fc-button" onClick={() => onNavigate("calendar")}>실적 달력 열기</button></div>
  </div>;
}

function CalendarDesk({ onNavigate, embedded = false }: Pick<ResearchDeskProps, "onNavigate" | "embedded">) {
  const [date, setDate] = useState("");
  const [search, setSearch] = useState("");
  const [symbol, setSymbol] = useState("");
  const calendar = useQuery({ queryKey: ["fincept", "earnings-calendar"], queryFn: ({ signal }) => getCalendar(signal), staleTime: 60_000, retry: 1 });
  const days = calendar.data?.days ?? EMPTY_DAYS;
  const selectedDay = days.find(day => day.date === date) ?? days[0];
  const query = search.trim().toLocaleLowerCase();
  const matches = (item: EarningsItem) => !query || `${item.symbol} ${item.name}`.toLocaleLowerCase().includes(query);
  const rows = selectedDay?.ok ? selectedDay.items.filter(matches) : [];
  const selectedItem = rows.find(item => item.symbol === symbol) ?? rows[0];
  const failedDays = days.filter(day => !day.ok).length;
  const source = externalUrl(calendar.data?.source || "https://www.nasdaq.com/market-activity/earnings");

  return <div className={styles.desk}>
    <div className={`fc-toolbar ${styles.toolbar}`}>
      <label className={styles.searchLabel}>기업 검색<input type="search" value={search} onChange={event => setSearch(event.target.value)} maxLength={100} placeholder="회사명 · 티커" /></label>
      <span className="fc-muted">{days.length ? `${days.length}일 일정` : "실적 발표 일정"} · 미국 동부시간</span>
      <button type="button" className="fc-button" disabled={calendar.isFetching} onClick={() => { void calendar.refetch(); }}>{calendar.isFetching ? "조회 중…" : "재조회"}</button>
    </div>
    
    {calendar.isError ? <ErrorNotice message={calendar.error.message} onRetry={() => { void calendar.refetch(); }} retrying={calendar.isFetching} /> : null}
    {failedDays ? <div className={styles.notice} role="status">{failedDays}일 일정 조회 실패</div> : null}
    <div className={`fc-split ${styles.calendarSplit}`}>
      <aside className={`fc-panel ${styles.sidebar}`} aria-label="발표 예정일 선택">
        <div className="fc-panel-head"><span>발표 예정일</span></div>
        <div className={`fc-scroll ${styles.dateList}`}>
          {calendar.isPending ? <p className="fc-empty" role="status">일정을 불러오는 중…</p>
            : days.length ? days.map(day => <button type="button" className={styles.dateItem} key={day.date} aria-pressed={selectedDay?.date === day.date} onClick={() => { setDate(day.date); setSymbol(""); }}>
              <span>{calendarLabel(day.date)}</span><span className={day.ok ? "fc-muted" : styles.warning}>{day.ok ? `${day.items.filter(matches).length}개 기업` : "조회 실패"}</span>
            </button>) : !calendar.isError ? <div className="fc-empty"><p>표시할 날짜 자료가 없습니다.</p><button type="button" className="fc-button" disabled={calendar.isFetching} onClick={() => { void calendar.refetch(); }}>재조회</button></div> : null}
        </div>
      </aside>
      <section className={`fc-panel ${styles.calendarPanel}`} aria-label="실적 발표 기업">
        <div className="fc-panel-head"><span>{selectedDay?.date || "실적 발표 일정"}</span><span className="fc-muted">{selectedDay?.ok ? `${rows.length} / ${selectedDay.items.length}개 기업` : "자료 미확인"}</span></div>
        {selectedDay && !selectedDay.ok ? <div className="fc-empty"><p>이 날짜의 자료를 받지 못했습니다.</p><button type="button" className="fc-button" disabled={calendar.isFetching} onClick={() => { void calendar.refetch(); }}>재조회</button></div>
          : selectedDay?.ok && !rows.length ? <div className="fc-empty"><p>{query ? "선택한 날짜에 검색 조건과 일치하는 기업이 없습니다." : "이 날짜에 제공된 발표 예정 기업이 없습니다."}</p>{query ? <button type="button" className="fc-button" onClick={() => setSearch("")}>검색 초기화</button> : null}</div>
            : rows.length ? <>
              <div className={`fc-table-wrap fc-scroll ${styles.earningsTable}`}><table className="fc-table">
                <caption className={styles.srOnly}>{selectedDay?.date} 미국 기업 실적 발표 일정. 종목을 선택하면 상세 정보가 표시됩니다.</caption>
                <thead><tr><th scope="col">티커</th><th scope="col">기업명</th><th scope="col">발표 시간</th><th scope="col">회계분기 말</th><th scope="col">시가총액 (USD)</th></tr></thead>
                <tbody>{rows.map(item => <tr key={item.symbol} className={selectedItem === item ? styles.selectedRow : undefined}>
                  <th scope="row"><button type="button" className={styles.symbolButton} aria-pressed={selectedItem === item} onClick={() => setSymbol(item.symbol)}>{item.symbol}</button></th>
                  <td>{item.name || "—"}</td><td>{item.time}</td><td>{item.quarter || "—"}</td><td className={styles.numeric}>{item.marketCap > 0 ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(item.marketCap) : "—"}</td>
                </tr>)}</tbody>
              </table></div>
              {selectedItem ? <section className={styles.earningsDetail} aria-label={`${selectedItem.symbol} 발표 상세`}>
                <h3>{selectedItem.symbol} <span>{selectedItem.name}</span></h3>
                <dl><div><dt>발표 예정일</dt><dd>{selectedItem.date}</dd></div><div><dt>미국 정규장 기준</dt><dd>{selectedItem.time}</dd></div><div><dt>회계분기 말</dt><dd>{selectedItem.quarter || "—"}</dd></div></dl>
              </section> : null}
            </> : <p className="fc-empty">{calendar.isPending ? "일정을 확인하고 있습니다." : "왼쪽에서 날짜를 선택해 주세요."}</p>}
      </section>
    </div>
    <div className={styles.footer}>{!embedded ? <button type="button" className="fc-button" onClick={() => onNavigate("calls")}>컨퍼런스콜 자료 열기</button> : null}</div>
  </div>;
}

export default function ResearchDesk({ page, embedded, onNavigate }: ResearchDeskProps) {
  return <div className={styles.root}>{page === "calendar" ? <CalendarDesk onNavigate={onNavigate} embedded={embedded} /> : <CallsDesk onNavigate={onNavigate} />}</div>;
}
