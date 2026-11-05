"use client";

import { type CSSProperties, type ReactNode } from "react";
import { useAtom } from "jotai";
import { errorAtom, isDarkModeAtom } from "../atoms";
import { KeyboardShortcuts } from "../core/keyboard-shortcuts";
import { bloombergColors } from "../lib/theme-config";
import { ShortcutIndicator } from "../core/shortcut-indicator";

type TerminalLayoutProps = {
  children: ReactNode;
  shortcuts: Array<{ key: string; ctrlKey?: boolean; action: () => void; description: string }>;
  shortcutsEnabled?: boolean;
};

export function TerminalLayout({ children, shortcuts, shortcutsEnabled = true }: TerminalLayoutProps) {
  const [isDarkMode] = useAtom(isDarkModeAtom);
  const [error, setError] = useAtom(errorAtom);
  const colors = isDarkMode ? bloombergColors.dark : bloombergColors.light;
  const style = Object.fromEntries(Object.entries(colors).map(([key, value]) => [`--terminal-${key}`, value])) as CSSProperties;
  return (
    <div className={`bloomberg-terminal font-mono ${isDarkMode ? "dark" : "light"}`} data-theme={isDarkMode ? "dark" : "light"}
      style={{ ...style, "--terminal-value": isDarkMode ? "#f5f5b8" : "#8b7500", backgroundColor: colors.background, color: colors.text } as CSSProperties}>
      {children}
      <KeyboardShortcuts shortcuts={shortcuts} isEnabled={shortcutsEnabled} />
      {error && <div role="alert" className="p-2 bg-red-600 text-white text-xs fixed bottom-0 left-0 right-0 z-50">
        {error} <button type="button" className="ml-2 underline" onClick={() => setError(null)}>Dismiss</button>
      </div>}
      <ShortcutIndicator isDarkMode={isDarkMode} />
    </div>
  );
}
