"use client";

import { useState, useRef, useEffect } from "react";
import { AcademyPackageSchema } from "@/lib/schemas/academy";
import { SiteConfigSchema } from "@/lib/schemas/site-config";
import type { AcademyPackage } from "@/lib/schemas/academy";
import type { SiteConfig } from "@/lib/schemas/site-config";

type Message = { role: "user" | "assistant" | "system"; content: string };

type AssistantPanelProps = {
  isOpen: boolean;
  onClose: () => void;
  academy: AcademyPackage | null;
  onUpdate: (academy: AcademyPackage, summary: string) => void;
  siteConfig: SiteConfig;
  onSiteUpdate: (config: SiteConfig, summary: string) => void;
};

const IDLE_HINT = "No academy loaded yet. Run the pipeline first, then I can help you make changes.";

export function AssistantPanel({ isOpen, onClose, academy, onUpdate, siteConfig, onSiteUpdate }: AssistantPanelProps) {
  const [messages, setMessages] = useState<Message[]>([
    { role: "system", content: IDLE_HINT },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Update greeting when academy first loads
  useEffect(() => {
    if (academy) {
      const lessonCount = academy.curriculum.flatMap((m) => m.lessons).length;
      setMessages([{
        role: "system",
        content: `"${academy.academyName}" loaded — ${academy.curriculum.length} modules, ${lessonCount} lessons. Tell me what to change.`,
      }]);
    } else {
      setMessages([{ role: "system", content: IDLE_HINT }]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!academy]);

  // Auto-scroll to latest message
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;

    if (!academy) {
      setMessages((prev) => [
        ...prev,
        { role: "user", content: text },
        { role: "assistant", content: "Run the pipeline first so I have an academy to edit." },
      ]);
      setInput("");
      return;
    }

    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ academy, instruction: text, siteConfig }),
      });

      const json = await res.json() as { academy?: unknown; siteConfig?: unknown; summary?: string; error?: string };

      if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);

      let changed = false;

      if (json.academy !== undefined) {
        const parsed = AcademyPackageSchema.safeParse(json.academy);
        if (!parsed.success) throw new Error("Invalid academy returned from assistant");
        onUpdate(parsed.data, json.summary ?? "Changes applied.");
        changed = true;
      }

      if (json.siteConfig !== undefined) {
        const parsed = SiteConfigSchema.safeParse(json.siteConfig);
        if (!parsed.success) throw new Error("Invalid site config returned from assistant");
        onSiteUpdate(parsed.data, json.summary ?? "Site updated.");
        changed = true;
      }

      if (!changed) throw new Error("Assistant returned no changes");
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: json.summary ?? "Done." },
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      setMessages((prev) => [...prev, { role: "assistant", content: `Error: ${msg}` }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-950/60 backdrop-blur-sm"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Drawer */}
      <div
        className={`fixed inset-y-0 right-0 z-40 flex w-full max-w-sm flex-col border-l border-slate-700/60 bg-slate-900 shadow-2xl transition-transform duration-300 ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
        aria-label="Director AI assistant"
      >
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-slate-800 px-4 py-4">
          <div>
            <p className="text-sm font-bold text-slate-100">Nexus Director AI</p>
            <p className="text-[11px] text-slate-500">Edit your academy with natural language</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close assistant"
            className="flex min-h-10 min-w-10 items-center justify-center rounded-xl border border-slate-700 text-slate-400 transition hover:border-slate-500 hover:text-slate-200"
          >
            ✕
          </button>
        </div>

        {/* Suggestion chips */}
        {academy && (
          <div className="flex-shrink-0 overflow-x-auto border-b border-slate-800 px-3 py-2">
            <div className="flex gap-2">
              {[
                "Format notes with proper headings and sections",
                "Add testimonials from students",
                "Add a FAQ section to the landing page",
                "Add an instructor bio",
                "Add an announcement banner",
                "Change the CTA button text",
                "Add action items to every lesson",
              ].map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => { setInput(chip); inputRef.current?.focus(); }}
                  className="flex-shrink-0 rounded-lg border border-slate-700 px-3 py-1.5 text-[11px] text-slate-400 transition hover:border-cyan-500/40 hover:text-cyan-300"
                >
                  {chip}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Message history */}
        <div
          ref={scrollRef}
          className="flex-1 space-y-3 overflow-y-auto overscroll-contain p-4"
        >
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-cyan-500/20 text-cyan-100"
                    : msg.role === "system"
                    ? "bg-slate-800/60 text-slate-400 italic"
                    : "bg-slate-800 text-slate-200"
                }`}
              >
                {msg.content}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="rounded-2xl bg-slate-800 px-4 py-3">
                <span className="flex items-center gap-1">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-500 [animation-delay:0ms]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-500 [animation-delay:150ms]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-500 [animation-delay:300ms]" />
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        <div className="flex-shrink-0 border-t border-slate-800 p-3">
          <div className="flex gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void send();
                }
              }}
              disabled={loading}
              placeholder={
                academy
                  ? 'e.g. "Rename module 2 to Week 2: Practice"'
                  : "Run the pipeline first…"
              }
              rows={2}
              className="flex-1 resize-none rounded-xl border border-slate-700 bg-slate-800/60 px-3 py-2.5 text-base text-slate-100 placeholder:text-slate-600 focus:border-cyan-500/60 focus:outline-none disabled:opacity-40"
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={!input.trim() || loading}
              aria-label="Send"
              className="flex min-h-12 min-w-12 items-center justify-center rounded-xl bg-cyan-500 text-slate-950 transition hover:bg-cyan-400 disabled:bg-slate-700 disabled:text-slate-500"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-4 w-4">
                <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
          <p className="mt-1.5 text-[11px] text-slate-600">⌘ Return to send · changes save to preview automatically</p>
        </div>
      </div>
    </>
  );
}
