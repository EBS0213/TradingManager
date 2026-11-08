"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Provider } from "jotai";
import TerminalDesk from "@/components/fincept/TerminalDesk";
import { searchKey } from "@/components/fincept/data";
import { Search, Terminal, LayoutGrid } from "lucide-react";
import { QueryClientProvider } from "@/components/bloomberg/providers/query-client-provider";
import { selectionFromHash, selectionForPage, selectionHash, acceptFramePage, isNativePage } from "@/lib/workspace-routing.mjs";

const loadingPanel = () => <div className="fc-empty" role="status">도구를 불러오고 있습니다…</div>;
const EconomyHub = dynamic(() => import("@/components/economy/EconomyHub"), {loading: loadingPanel});
const EquityResearch = dynamic(() => import("@/components/fincept/EquityResearch"), {loading: loadingPanel});
const PortfolioDesk = dynamic(() => import("@/components/fincept/PortfolioDesk"), {loading: loadingPanel});
const ResearchWorkspace = dynamic(() => import("@/components/fincept/ResearchWorkspace"), {loading: loadingPanel});
const TradingWorkspace = dynamic(() => import("@/components/fincept/trading/TradingWorkspace"), {loading: loadingPanel});
const ConferenceWorkspace = dynamic(() => import("@/components/fincept/ConferenceWorkspace"), {loading: loadingPanel});
const AviationDesk = dynamic(() => import("@/components/fincept/AviationDesk"), {loading: loadingPanel});
const MaritimeDesk = dynamic(() => import("@/components/fincept/MaritimeDesk"), {loading: loadingPanel});
const DataSourcesDesk = dynamic(() => import("@/components/fincept/DataSourcesDesk"), {loading: loadingPanel});
const AdminDesk = dynamic(() => import("@/components/fincept/AccountDesk").then(module => module.AdminDesk), {loading: loadingPanel});

const trading = [
  ["dash", "01", "스크리닝"], ["setup", "02", "셋업"],
  ["ryan", "03", "라이언 가이드"], ["log", "04", "기록"],
  ["watch", "05", "워치리스트"], ["training", "06", "차트게임"],
] as const;
const resources = [
  ["overview", "지수", "DASHBOARD"],
  ["equities", "주식 모니터", "EQUITIES"], ["portfolio", "포트폴리오", "PORTFOLIO"], ["etfs", "ETF", "ETF MONITOR"], ["sectors", "섹터 ETF", "SECTORS"],
  ["news", "뉴스", "NEWS"], ["data", "경제 데이터", "ECONOMICS"],
  ["countries", "국가 비교", "COUNTRIES"], ["research", "리서치", "RESEARCH"],
  ["calls", "컨퍼런스콜", "EARNINGS"], ["maritime", "해상·운임", "MARITIME"], ["aviation", "항공", "AVIATION"],
  ["watchlist", "관심 자산", "WATCHLIST"],
  ["sources", "데이터 소스", "SOURCES"],
] as const;
const resourceLabels: Record<string,string> = {overview:"Dashboard",market:"Global Markets",equities:"Equities",portfolio:"Portfolio",etfs:"ETF Monitor",sectors:"Sector ETFs",crypto:"Crypto",fx:"FX",commodities:"Commodities",rates:"Treasury",data:"Economics",countries:"Countries",analytics:"Analytics",sources:"Data Sources",watchlist:"Watchlist",aviation:"항공",maritime:"해상·운임"};
const resourceGroups = [
  ["indices", "지수", "overview", ["overview"]],
  ["stocks", "주식", "equities", ["equities", "etfs", "sectors"]],
  ["data", "데이터", "data", ["data", "countries", "sources", "aviation", "maritime"]],
  ["news", "뉴스", "news", ["news"]],
  ["research", "리서치", "research", ["research"]],
  ["conference", "컨퍼런스", "calls", ["calls"]],
  ["portfolio", "포트폴리오", "portfolio", ["portfolio", "watchlist"]],
] as const;
type Selection = { area: "terminal" | "trading"; page: string };

function WorkspaceClock() {
  const [clock,setClock] = useState('SEOUL · KST');
  useEffect(() => {
    const tick = () => setClock(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date())+' KST');
    tick(); const timer=setInterval(tick,1000); return () => clearInterval(timer);
  },[]);
  return <time>{clock}</time>;
}

export default function TerminalWorkspace({ initialArea = "terminal", initialPage = "overview" }: { initialArea?: Selection["area"]; initialPage?: string }) {
  const initial = (selectionForPage(initialPage) as Selection | null) || { area: initialArea, page: initialPage };
  const [selection, setSelection] = useState<Selection>(initial);
  const [frameStarted, setFrameStarted] = useState(!isNativePage(initial.page));
  const [initialFramePage, setInitialFramePage] = useState(isNativePage(initial.page) ? "dash" : initial.page);
  const [command, setCommand] = useState("");
  const [dataSearch, setDataSearch] = useState<Record<string,string>>({});
  const frame = useRef<HTMLIFrameElement>(null);
  const current = useRef(selection);
  const frameRequest = useRef(0);
  const syncFrame = useCallback(() => {
    const next = current.current;
    const visible = !isNativePage(next.page);
    frame.current?.contentWindow?.postMessage({ type: "tm-workspace-visibility", visible, requestId: frameRequest.current }, location.origin);
    if (visible) frame.current?.contentWindow?.postMessage({ type: "tm-workspace-navigate", page: next.page, requestId: frameRequest.current }, location.origin);
  }, []);

  const choose = useCallback((requested: Selection, push = true, notifyFrame = true) => {
    const next = selectionForPage(requested.page) as Selection;
    if (!next) return;
    // Update the ref before postMessage so an earlier frame response cannot win a render race.
    current.current = next;
    setSelection(next);
    if (!isNativePage(next.page)) {
      setInitialFramePage(old => frame.current ? old : next.page);
      setFrameStarted(true);
    }
    const hash = selectionHash(next);
    if (location.hash !== hash) {
      history[push ? "pushState" : "replaceState"](null, "", location.pathname + location.search + hash);
    }
    if (notifyFrame) { frameRequest.current += 1; syncFrame(); }
  }, [syncFrame]);

  useEffect(() => {
    choose(selectionFromHash(location.hash, { area: initialArea, page: initialPage }) as Selection, false);
    const onHistory = () => {
      const next = selectionFromHash(location.hash, { area: initialArea, page: initialPage }) as Selection;
      if (next.page !== current.current.page || next.area !== current.current.area || location.hash !== selectionHash(next)) choose(next, false);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow) return;
      const next = acceptFramePage(event.data, current.current, frameRequest.current) as Selection | null;
      if (next && current.current.page !== next.page) choose(next, true, false);
    };
    const onAuthChange = () => frame.current?.contentWindow?.postMessage({ type: "tm-workspace-auth-changed", requestId: frameRequest.current }, location.origin);
    window.addEventListener("tm-auth-changed", onAuthChange);
    window.addEventListener("popstate", onHistory);
    window.addEventListener("hashchange", onHistory);
    window.addEventListener("message", onMessage);
    return () => { window.removeEventListener("tm-auth-changed", onAuthChange); window.removeEventListener("popstate", onHistory); window.removeEventListener("hashchange", onHistory); window.removeEventListener("message", onMessage); };
  }, [choose, initialArea, initialPage]);

  const native = isNativePage(selection.page);
  const navigate = (page: string) => { setDataSearch(old=>({...old,[page]:''})); choose({area:"terminal",page}); };
  const submitCommand = (event: React.FormEvent) => {
    event.preventDefault(); const term=command.trim().toLocaleLowerCase(); if(!term)return;
    const tool=resources.find(([id,label,code]) => [id,label,code.toLocaleLowerCase()].includes(term));
    if(tool)navigate(tool[0]);
    else { const isIndex=/kospi|kosdaq|nasdaq|sp500|dow|nikkei|dax|ftse/.test(searchKey(term)); const page=isIndex?'overview':'equities'; choose({area:"terminal",page}); setDataSearch(old=>({...old,[page]:command.trim()})); }
    setCommand("");
  };
  const selectedGroup = resourceGroups.find(([, , , pages]) => (pages as readonly string[]).includes(selection.page.split('/')[0])) || resourceGroups[0];
  const settingsPage = selection.page === "admin";
  const sectionPages = selectedGroup[3] as readonly string[];
  const sectionResources = resources.filter(([id]) => sectionPages.includes(id)).sort(([a], [b]) => sectionPages.indexOf(a) - sectionPages.indexOf(b));
  return <Provider><QueryClientProvider>
    <div className={`tm-workspace fc-workspace${selection.page === 'calls' ? ' fc-conference-workspace' : ''}`}>
      <header className="tm-workspace-header">
        <a className="tm-workspace-brand" href="/#terminal/overview" onClick={e => { e.preventDefault(); navigate("overview"); }} aria-label="TradingManager 홈"><strong>Trading<span>Manager</span></strong></a>
        <form className="fc-command" onSubmit={submitCommand}><Search size={13}/><input aria-label="종목 또는 기능 검색" placeholder="종목 / 기능 검색…" value={command} onChange={event => setCommand(event.target.value)}/><kbd>↵</kbd></form>
        <nav className="tm-areas" aria-label="작업 영역">
          <button className={selection.area === "terminal" ? "active" : ""} aria-pressed={selection.area === "terminal"} onClick={() => navigate("overview")}><Terminal size={14}/> 터미널 <small>TERMINAL</small></button>
          <button className={selection.area === "trading" ? "active" : ""} aria-pressed={selection.area === "trading"} onClick={() => choose({ area: "trading", page: "dash" })}><LayoutGrid size={14}/> 트레이딩 <small>TRADING</small></button>
        </nav>
        <div className="tm-workspace-meta"><button type="button" className="fc-button" aria-pressed={selection.page === "admin"} onClick={() => navigate("admin")}>설정</button></div>
      </header>
      {selection.area === "terminal" ? <>
        <nav className="tm-section-nav fc-primary-nav" aria-label="터미널 주요 메뉴">
          {resourceGroups.map(([id, label, home]) => <button key={id} className={!settingsPage && selectedGroup[0] === id ? "active" : ""} aria-pressed={!settingsPage && selectedGroup[0] === id} onClick={() => navigate(home)}>{label}</button>)}
        </nav>
        {!settingsPage && sectionResources.length > 1 ? <nav className="tm-section-nav fc-module-nav fc-subnav" aria-label={`${selectedGroup[1]} 세부 메뉴`}>
          {sectionResources.map(([id, label, code]) => <button key={id} title={resourceLabels[id]||code} className={selection.page.split("/")[0] === id ? "active" : ""} aria-pressed={selection.page.split("/")[0] === id} onClick={() => navigate(id)}>{resourceLabels[id]||code}</button>)}
        </nav> : null}
      </> : <nav className="tm-section-nav fc-module-nav" aria-label="트레이딩 기능">
        {trading.map(([id, number, label]) => <button key={id} aria-pressed={selection.page === id} className={selection.page === id ? "active" : ""} onClick={() => choose({ area: "trading", page: id })}><span>{number}</span> {label}</button>)}
      </nav>}
      {native && <main className="tm-terminal-content fc-content" aria-label="금융 리서치 터미널">
        {selection.page === 'admin' ? <AdminDesk onNavigate={navigate}/> : selection.area === 'trading' ? <TradingWorkspace key={selection.page} page={selection.page} onStock={symbol=>{setDataSearch(old=>({...old,equities:symbol}));choose({area:'terminal',page:'equities'});}}/> : selection.page.split('/')[0] === 'research' ? <ResearchWorkspace key={selection.page} postId={Number(selection.page.split('/')[1]) || undefined} onNavigate={navigate}/> : selection.page === 'calls' ? <ConferenceWorkspace onNavigate={navigate}/> : ['equities','etfs','sectors'].includes(selection.page) ? <EquityResearch key={`${selection.page}:${dataSearch[selection.page] || ''}`} assetClass={selection.page === 'equities' ? 'all' : 'etf'} sectorMode={selection.page === 'sectors'} initialSearch={dataSearch[selection.page] || ''} onNavigate={navigate}/> : selection.page === 'portfolio' ? <PortfolioDesk onNavigate={navigate}/> : selection.page === 'aviation' ? <AviationDesk/> : selection.page === 'maritime' ? <MaritimeDesk/> : selection.page === 'sources' ? <DataSourcesDesk/> : ['data','countries'].includes(selection.page) ? <EconomyHub key={selection.page} initialTab={selection.page === 'countries' ? 'country' : 'overview'}/> : <TerminalDesk key={`${selection.page}:${dataSearch[selection.page] || ''}`} page={selection.page} initialSearch={dataSearch[selection.page] || ''} onNavigate={navigate}/>}
      </main>}
      {frameStarted && <div className="tm-legacy-content" hidden={native}><iframe ref={frame} src={`/screener/view?workspace=1#${initialFramePage}`} title="TradingManager 트레이딩 및 리서치" onLoad={syncFrame} /></div>}
      <footer className="fc-statusbar"><span><i/> TradingManager</span><span>EQ · FX · FI · CM · CR</span><WorkspaceClock/></footer>
    </div>
  </QueryClientProvider></Provider>;
}
