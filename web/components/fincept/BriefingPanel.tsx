"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

type Brief = { day: string; slot: string; at?: string; title?: string; text: string; writer?: string };
type Response = { ok: boolean; items: Brief[] };
const slots: Record<string, string> = { am: "장전", mid: "장중", close: "장마감", pm: "해외" };
const key = (item: Brief) => `${item.day}:${item.slot}`;
function plainText(value: string) {
  return value.replace(/<br\s*\/?\s*>/gi, "\n").replace(/<\/?b>/gi, "").replace(/<[^>]*>/g, "").replace(/&nbsp;/gi, " ").trim();
}

export default function BriefingPanel() {
  const [selectedKey, setSelectedKey] = useState("");
  const briefings = useQuery({
    queryKey: ["fincept", "dashboard-briefings"],
    queryFn: async ({ signal }): Promise<Brief[]> => {
      const response = await fetch("/api/brief?view=dashboard", { signal });
      if (!response.ok) throw new Error(`브리핑 조회 실패 (${response.status})`);
      const data = await response.json() as Response;
      if (!Array.isArray(data.items)) throw new Error("브리핑 목록 형식이 올바르지 않습니다.");
      return data.items.filter(item => item.day && item.slot && item.text);
    },
    staleTime: 60_000, retry: 1, refetchOnWindowFocus: false,
  });
  const items = briefings.data || [];
  const selected = items.find(item => key(item) === selectedKey) || items[0];
  return <section className={`fc-panel fc-dash-briefing ${items.length ? "has-content" : "is-empty"}`} aria-label="시장 브리핑">
    <div className="fc-panel-head"><h2>브리핑</h2><span>한국 · 해외</span></div>
    {items.length ? <>
      <div className="fc-brief-controls"><select aria-label="브리핑 선택" value={key(selected)} onChange={event => setSelectedKey(event.target.value)}>
        {items.map(item => <option key={key(item)} value={key(item)}>{item.day} · {item.title || slots[item.slot] || item.slot} {item.at || ""}</option>)}
      </select><button className="fc-button" type="button" disabled={briefings.isFetching} onClick={() => { void briefings.refetch(); }}>새로고침</button></div>
      <div className="fc-brief-body">{plainText(selected.text)}</div>
      <div className="fc-brief-meta">{selected.day} {selected.at || ""} · {selected.title || slots[selected.slot] || selected.slot}</div>
    </> : <div className="fc-empty" role="status">{briefings.isPending ? "브리핑을 불러오는 중…" : briefings.isError ? <span>{briefings.error.message} <button className="fc-button" type="button" onClick={() => { void briefings.refetch(); }}>다시 조회</button></span> : "저장된 브리핑이 없습니다."}</div>}
  </section>;
}
