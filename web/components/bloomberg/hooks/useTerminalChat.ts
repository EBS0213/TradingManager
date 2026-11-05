"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
type Message = { role: "user" | "assistant"; content: string };
export function useTerminalChat(marketData: unknown) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestMode, setRequestMode] = useState<"local" | "ai">("local");
  const [mode, setMode] = useState("local");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const ask = async (question: string, reset = false) => {
    if (!question.trim() || isLoading) return;
    const next: Message[] = [...(reset ? [] : messages), { role: "user", content: question.trim().slice(0, 2000) }];
    setMessages(next); setInput(""); setError(null); setIsLoading(true);
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    try {
      const response = await fetch("/api/terminal/ai", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next.slice(-11), mode: requestMode }), signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || data.response || `분석 요청 실패 (${response.status})`);
      setMessages([...next, { role: "assistant", content: data.response || "분석 결과가 없습니다." }]);
      setMode(data.mode || "local");
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "분석을 불러오지 못했습니다.");
    } finally { if (!controller.signal.aborted) setIsLoading(false); }
  };
  const handleSubmit = (event: FormEvent) => { event.preventDefault(); void ask(input); };
  return { messages, input, setInput, isLoading, error, mode, requestMode, setRequestMode, ask, handleSubmit,
    clear: () => { request.current?.abort(); setIsLoading(false); setMessages([]); setError(null); } };
}
