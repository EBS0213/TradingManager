"use client";
import { Input } from "@/components/ui/input";
import { RefreshCw, Send, X } from "lucide-react";
import { BloombergButton } from "../core/bloomberg-button";
import { useTerminalChat } from "../hooks/useTerminalChat";
import { bloombergColors } from "../lib/theme-config";
type Props = { marketData: unknown; colors: Pick<typeof bloombergColors.dark, "background" | "surface" | "text" | "border" | "accent" | "positive" | "negative">; prompt: string; overviewLabel?: string };
export function TerminalAnalysisPanel({ marketData, colors, prompt, overviewLabel = "MARKET OVERVIEW" }: Props) {
  const chat = useTerminalChat(marketData);
  return <section className="p-4 border rounded-none mt-4" style={{ borderColor: colors.border, backgroundColor: colors.surface }}>
    <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
      <h3 className="text-sm font-bold">AI Market Analysis <span className="text-xs font-normal" style={{ color: colors.accent }}>{chat.mode === "ai" ? "AI" : "LOCAL ANALYSIS"}</span></h3>
      <div className="flex flex-wrap gap-2"><select aria-label="분석 방식" value={chat.requestMode} disabled={chat.isLoading} onChange={(event) => { chat.clear(); chat.setRequestMode(event.target.value as "local" | "ai"); }} className="text-xs border px-1" style={{ backgroundColor: colors.background, borderColor: colors.border, color: colors.text }}><option value="local">LOCAL · 무료 계산</option><option value="ai">AI · 로그인/키 필요</option></select><BloombergButton color="accent" onClick={() => chat.ask(prompt, true)} disabled={chat.isLoading}><RefreshCw className="h-3 w-3 mr-1" />{overviewLabel}</BloombergButton>
        {chat.messages.length > 0 && <BloombergButton color="red" onClick={chat.clear}><X className="h-3 w-3 mr-1" />CLEAR</BloombergButton>}</div>
    </div>
    <div className="p-3 mb-3 border text-xs min-h-[80px] max-h-80 overflow-y-auto" role="log" aria-live="polite" style={{ borderColor: colors.border, backgroundColor: colors.background }}>
      {!chat.messages.length && null}
      {chat.messages.map((message, index) => <div key={index} className="mb-3 whitespace-pre-wrap"><span className="font-bold" style={{ color: colors.accent }}>{message.role === "user" ? "YOU" : "ANALYSIS"} &gt; </span>{message.content}</div>)}
      {chat.isLoading && <p>분석 중…</p>}
      {chat.error && <p role="alert" style={{ color: colors.negative }}>{chat.error}</p>}
    </div>
    <form onSubmit={chat.handleSubmit} className="flex gap-2">
      <Input aria-label="시장 분석 질문" value={chat.input} onChange={(event) => chat.setInput(event.target.value)} placeholder="시장, 강세 종목, 비교 분석 질문…" className="flex-1 h-8 text-xs rounded-none" style={{ backgroundColor: colors.background, borderColor: colors.border, color: colors.text }} disabled={chat.isLoading} />
      <BloombergButton type="submit" color="accent" disabled={chat.isLoading || !chat.input.trim()}><Send className="h-3 w-3 mr-1" />ASK</BloombergButton>
    </form>
  </section>;
}
