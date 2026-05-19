"use client";

import { useEffect, useRef } from "react";
import type { LogEntry, LogLevel } from "@/lib/types";

const LEVEL_CFG: Record<
  LogLevel,
  { tag: string; tagCls: string; msgCls: string }
> = {
  init:    { tag: "INIT", tagCls: "border-cyan-400/30    bg-cyan-400/10    text-cyan-400",    msgCls: "text-slate-200" },
  info:    { tag: "INFO", tagCls: "border-slate-500/30   bg-slate-500/10   text-slate-400",   msgCls: "text-slate-300" },
  success: { tag: "DONE", tagCls: "border-emerald-400/30 bg-emerald-400/10 text-emerald-400", msgCls: "text-slate-100" },
  warn:    { tag: "WARN", tagCls: "border-amber-400/30   bg-amber-400/10   text-amber-400",   msgCls: "text-amber-100" },
  error:   { tag: "ERR",  tagCls: "border-red-400/30     bg-red-400/10     text-red-400",     msgCls: "text-red-100"  },
  stream:  { tag: "STRM", tagCls: "border-violet-400/30  bg-violet-400/10  text-violet-400",  msgCls: "text-slate-200" }
};

type TerminalLogProps = {
  entries: LogEntry[];
  isStreaming?: boolean;
};

export function TerminalLog({ entries, isStreaming = false }: TerminalLogProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries]);

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-700/60 glass shadow-panel">
      <header className="flex flex-shrink-0 items-center justify-between border-b border-slate-700/50 px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full ${
              isStreaming ? "animate-pulse bg-cyan-400" : "bg-emerald-400"
            }`}
            style={{
              boxShadow: isStreaming
                ? "0 0 8px rgba(0,184,217,0.8)"
                : "0 0 8px rgba(52,211,153,0.65)"
            }}
          />
          <h2 className="text-sm font-semibold uppercase tracking-widest text-slate-300">
            Agent Activity
          </h2>
        </div>
        <span className="rounded-full bg-slate-700/50 px-2.5 py-1 text-xs tabular-nums text-slate-400">
          {entries.length} events
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
        <ul className="space-y-1.5">
          {entries.map((entry) => {
            const cfg = LEVEL_CFG[entry.level];
            // Slice UTC ISO string to "HH:MM:SS" — timezone-stable, no locale divergence.
            const time = entry.timestamp
              ? new Date(entry.timestamp).toISOString().slice(11, 19)
              : "";
            return (
              <li
                key={entry.id}
                className="animate-fade-up flex items-start gap-2.5 rounded-xl border border-slate-700/40 bg-shell-800/50 px-3 py-2.5"
              >
                <span
                  className={`mt-px inline-flex flex-shrink-0 items-center rounded-md border px-1.5 py-0.5 text-[10px] font-bold tracking-widest ${cfg.tagCls}`}
                >
                  {cfg.tag}
                </span>
                <span className={`flex-1 text-mono ${cfg.msgCls}`}>
                  {entry.message}
                </span>
                <span suppressHydrationWarning className="flex-shrink-0 text-[11px] tabular-nums text-slate-600">
                  {time}
                </span>
              </li>
            );
          })}
          {isStreaming && (
            <li className="flex items-center gap-2.5 rounded-xl border border-violet-500/30 bg-violet-500/5 px-3 py-2.5">
              <span className="inline-flex flex-shrink-0 items-center rounded-md border border-violet-400/30 bg-violet-400/10 px-1.5 py-0.5 text-[10px] font-bold tracking-widest text-violet-400">
                STRM
              </span>
              <span className="text-mono text-slate-400">
                Processing<span className="animate-pulse">...</span>
              </span>
            </li>
          )}
        </ul>
        <div ref={endRef} />
      </div>
    </section>
  );
}
