"use client";

import { useState } from "react";
import ResearchWorkspace from "./ResearchWorkspace";
import ResearchDesk from "./ResearchDesk";

type View = "calls" | "archive" | "calendar";

export default function ConferenceWorkspace({ onNavigate }: { onNavigate: (page: string) => void }) {
  const [view, setView] = useState<View>("calls");
  const navigate = (page: string) => {
    if (page === "calendar" || page === "calls" || page === "archive") setView(page);
    else onNavigate(page);
  };
  return <div className="fc-conference">
    <nav className="fc-conference-tabs" aria-label="컨퍼런스콜 보기">
      <button type="button" aria-pressed={view === "calls"} onClick={() => setView("calls")}>컨퍼런스콜</button>
      <button type="button" aria-pressed={view === "calendar"} onClick={() => setView("calendar")}>실적 일정</button>
      <button type="button" aria-pressed={view === "archive"} onClick={() => setView("archive")}>아카이브</button>
    </nav>
    {view === "calendar" ? <div className="fc-calendar-scroll"><ResearchDesk page="calendar" embedded onNavigate={navigate} /></div> : <ResearchWorkspace key={view} initialTab="calls" conferenceOnly archiveOnly={view === "archive"} onNavigate={navigate} />}
  </div>;
}
