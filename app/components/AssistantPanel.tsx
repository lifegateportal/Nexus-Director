"use client";

import { useState, useRef, useEffect } from "react";
import { AcademyPackageSchema } from "@/lib/schemas/academy";
import { SiteConfigSchema } from "@/lib/schemas/site-config";
import { EbookManifestSchema } from "@/lib/schemas/ebook";
import type { AcademyPackage } from "@/lib/schemas/academy";
import type { SiteConfig } from "@/lib/schemas/site-config";
import type { EbookManifest } from "@/lib/schemas/ebook";
import type { ChatMessage } from "@/lib/project-store";

type Message = ChatMessage;

type AssistantPanelProps = {
  isOpen: boolean;
  onClose: () => void;
  academy: AcademyPackage | null;
  onUpdate: (academy: AcademyPackage, summary: string) => void;
  siteConfig: SiteConfig;
  onSiteUpdate: (config: SiteConfig, summary: string) => void;
  /** Ebook manifest — when present, enables book production control */
  ebookManifest?: EbookManifest | null;
  onEbookUpdate?: (manifest: EbookManifest, summary: string) => void;
  /** When a project is loaded, pass its saved messages + a new loadKey to restore chat */
  loadedHistory?: Message[];
  loadKey?: string;
  onChatChange?: (msgs: Message[]) => void;
};

const IDLE_HINT = "No content loaded yet. Run the pipeline first, then I can help you make changes.";

export function AssistantPanel({ isOpen, onClose, academy, onUpdate, siteConfig, onSiteUpdate, ebookManifest, onEbookUpdate, loadedHistory, loadKey, onChatChange }: AssistantPanelProps) {
  const [messages, setMessages] = useState<Message[]>([
    { role: "system", content: IDLE_HINT },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Restore chat history when a project is loaded
  useEffect(() => {
    if (loadKey && loadedHistory && loadedHistory.length > 0) {
      setMessages(loadedHistory);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadKey]);

  // Update greeting when academy or ebook first loads (only if no project history was restored)
  useEffect(() => {
    if (loadKey) return; // project load handles its own history
    if (ebookManifest) {
      setMessages([{
        role: "system",
        content: `Book loaded: "${ebookManifest.bookTitle}" by ${ebookManifest.authorName} — ${ebookManifest.chapters.length} chapters, ${ebookManifest.totalWordCount.toLocaleString()} words.\n\nYou can ask me to change the title, rename chapters, edit section headings, update takeaways, revise the preface, and more.`,
      }]);
    } else if (academy) {
      const lessonCount = academy.curriculum.flatMap((m) => m.lessons).length;
      setMessages([{
        role: "system",
        content: `"${academy.academyName}" loaded — ${academy.curriculum.length} modules, ${lessonCount} lessons. Tell me what to change.`,
      }]);
    } else {
      setMessages([{ role: "system", content: IDLE_HINT }]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!academy, !!ebookManifest]);

  // Notify parent whenever messages change so it can persist them
  useEffect(() => {
    onChatChange?.(messages);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

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

    const hasContent = academy || ebookManifest;
    if (!hasContent) {
      setMessages((prev) => [
        ...prev,
        { role: "user", content: text },
        { role: "assistant", content: "Run the pipeline first so I have content to edit." },
      ]);
      setInput("");
      return;
    }

    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setInput("");
    setLoading(true);

    try {
      // ── Route to ebook assistant when a book manifest is loaded ────────────
      if (ebookManifest && onEbookUpdate) {
        const res = await fetch("/api/ebook/assistant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ manifest: ebookManifest, instruction: text }),
        });
        const json = await res.json() as { manifest?: unknown; summary?: string; error?: string };
        if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
        const parsed = EbookManifestSchema.safeParse(json.manifest);
        if (!parsed.success) throw new Error("Invalid ebook manifest returned from assistant");
        onEbookUpdate(parsed.data, json.summary ?? "Book updated.");
        setMessages((prev) => [...prev, { role: "assistant", content: json.summary ?? "Done." }]);
        return;
      }

      // ── Academy assistant (existing path) ──────────────────────────────────
      if (!academy) {
        setMessages((prev) => [...prev, { role: "assistant", content: "No academy loaded." }]);
        return;
      }

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

      {/* Drawer — full-width on mobile, max-w-sm on tablet/desktop */}
      <div
        className={`fixed inset-y-0 right-0 z-[60] flex w-full max-w-full flex-col border-l border-slate-700/60 bg-slate-900 shadow-2xl transition-transform duration-300 sm:max-w-sm ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
        aria-label="Director AI assistant"
      >
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-slate-800 px-4 py-4">
          <div>
            <p className="text-sm font-bold text-slate-100">Nexus Director AI</p>
            <p className="text-[11px] text-slate-500">
              {ebookManifest
                ? "Edit your book with natural language"
                : "Edit your academy with natural language"}
            </p>
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

        {/* Suggestion chips — ebook mode */}
        {ebookManifest && (
          <div className="flex-shrink-0 border-b border-slate-800 px-3 py-2.5">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-600">Book Metadata</p>
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {[
                "Change the book title",
                "Update the subtitle",
                "Revise the preface",
                "Rewrite the introduction",
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
            <p className="mb-2 mt-3 text-[10px] font-semibold uppercase tracking-widest text-slate-600">Chapters</p>
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {[
                "Rename chapter 1",
                "Add a key takeaway to chapter 1",
                "Replace the reflection questions in chapter 1",
                "Edit the intro of chapter 1",
                "Edit the conclusion of chapter 1",
              ].map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => { setInput(chip); inputRef.current?.focus(); }}
                  className="flex-shrink-0 rounded-lg border border-slate-700 px-3 py-1.5 text-[11px] text-slate-400 transition hover:border-violet-500/40 hover:text-violet-300"
                >
                  {chip}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Suggestion chips — academy mode */}
        {academy && !ebookManifest && (
          <div className="flex-shrink-0 border-b border-slate-800 px-3 py-2.5">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-600">Content</p>
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {[
                "Add key takeaways to all lessons",
                "Add action items to every lesson",
                "Rewrite notes with proper headings",
                "Add quiz questions to all lessons",
                "Add learning objectives to all modules",
                "Expand the glossary for all modules",
                "Make the notes more detailed and analytical",
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
            <p className="mb-2 mt-3 text-[10px] font-semibold uppercase tracking-widest text-slate-600">Visual &amp; Theme</p>
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {[
                "Change theme to amber",
                "Change theme to emerald",
                "Change theme to violet",
                "Change theme to rose",
                "Change theme to solar (light mode)",
                "Use a split hero layout",
                "Use a minimal layout",
                "Use a centered layout",
              ].map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => { setInput(chip); inputRef.current?.focus(); }}
                  className="flex-shrink-0 rounded-lg border border-slate-700 px-3 py-1.5 text-[11px] text-slate-400 transition hover:border-violet-500/40 hover:text-violet-300"
                >
                  {chip}
                </button>
              ))}
            </div>
            <p className="mb-2 mt-3 text-[10px] font-semibold uppercase tracking-widest text-slate-600">Landing Page</p>
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {[
                "Add testimonials from students",
                "Add a FAQ section",
                "Add an instructor bio",
                "Add an announcement banner",
                "Change the CTA button text",
                "Add social media links",
              ].map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => { setInput(chip); inputRef.current?.focus(); }}
                  className="flex-shrink-0 rounded-lg border border-slate-700 px-3 py-1.5 text-[11px] text-slate-400 transition hover:border-sky-500/40 hover:text-sky-300"
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

        {/* Input — bottom padding accounts for mobile bottom nav */}
        <div
          className="flex-shrink-0 border-t border-slate-800 p-3"
          style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.75rem)" }}
        >
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
