"use client";

import { useState, useRef, useCallback, useId, useEffect } from "react";
import { EbookProgressRing } from "@/app/components/EbookProgressRing";
import {
  saveEbookJob,
  getEbookJob,
  newJobId,
} from "@/lib/ebook-job-store";
import type {
  VoiceDNA,
  ContentMap,
  BookArchitecture,
  SectionAssignment,
  SectionDraft,
  ChapterDraft,
  FrontBackMatter,
  EbookJobState,
  EbookManifest,
} from "@/lib/schemas/ebook";

// ─── Types ────────────────────────────────────────────────────────────────────

type PipelineStage =
  | "idle"
  | "transcribing"
  | "filtering"
  | "analyzing"
  | "mapping"
  | "architecting"
  | "assigning"
  | "writing"
  | "polishing"
  | "frontmatter"
  | "exporting"
  | "complete"
  | "failed";

const STAGE_LABELS: Record<PipelineStage, string> = {
  idle: "Ready",
  transcribing: "Transcribing audio…",
  filtering: "Filtering signal…",
  analyzing: "Extracting voice DNA…",
  mapping: "Mapping content…",
  architecting: "Designing chapters…",
  assigning: "Assigning segments…",
  writing: "Writing sections…",
  polishing: "Polishing chapters…",
  frontmatter: "Writing front matter…",
  exporting: "Generating PDF & EPUB…",
  complete: "Complete",
  failed: "Failed",
};

const STAGE_ORDER: PipelineStage[] = [
  "idle", "transcribing", "filtering", "analyzing", "mapping", "architecting",
  "assigning", "writing", "polishing", "frontmatter", "exporting", "complete",
];
type SignalFilterState = "idle" | "applied" | "skipped";

function routeLabel(url: string): string {
  return url.split("/").filter(Boolean).slice(-2).join("/");
}

function parseSignalFilterLog(logEntries: string[]): { state: SignalFilterState; detail: string | null } {
  const relevant = [...logEntries].reverse().find(
    (entry) => entry.includes("Signal filter unavailable") || entry.includes("Signal filtered") || entry.includes("Signal filter complete")
  );
  if (!relevant) return { state: "idle", detail: null };
  const message = relevant.replace(/^\[[^\]]+\]\s*/, "");
  if (message.includes("Signal filter unavailable")) {
    return { state: "skipped", detail: message };
  }
  return { state: "applied", detail: message };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function postJson<T>(url: string, body: unknown, retries = 1): Promise<T> {
  const route = routeLabel(url);
  for (let attempt = 0; attempt <= retries; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (err) {
      const cause = err instanceof Error ? err.message : "Unknown network failure";
      throw new Error([`Request failed: ${route}`, `Cause: ${cause}`].join("\n"));
    }
    if (!res.ok) {
      const rawText = await res.text();
      let err: { error?: string; details?: string; route?: string } = {};
      try {
        err = rawText ? JSON.parse(rawText) as { error?: string; details?: string; route?: string } : {};
      } catch {
        err = rawText ? { details: rawText } : {};
      }
      const msg = err.error || `HTTP ${res.status} error from ${route}`;
      // Retry once on transient gateway/auth errors (Codespaces proxy warm-up or LLM timeout)
      if (attempt < retries && (res.status === 401 || res.status === 502 || res.status === 503 || res.status === 504)) {
        await new Promise<void>((r) => setTimeout(r, 3000));
        continue;
      }
      // Surface a helpful message for persistent 401s
      if (res.status === 401) {
        throw new Error("Session expired or API key invalid — please refresh the page and try again");
      }
      throw new Error([
        `Request failed: ${err.route || route}`,
        `Status: ${res.status} ${res.statusText}`,
        `Error: ${msg}`,
        err.details ? `Details: ${err.details}` : "",
      ].filter(Boolean).join("\n"));
    }
    return res.json() as Promise<T>;
  }
  throw new Error(`Request failed after retries: ${route}`);
}

async function streamSection(assignment: SectionAssignment): Promise<string> {
  const result = await postJson<{ body: string }>("/api/ebook/write-section", { assignment });
  return (result.body ?? "").trim();
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// ─── Audio Upload Card ────────────────────────────────────────────────────────

function AudioCard({
  index,
  file,
  onFile,
  transcriptFile,
  onTranscriptFile,
  disabled,
}: {
  index: number;
  file: File | null;
  onFile: (f: File | null) => void;
  transcriptFile: File | null;
  onTranscriptFile: (f: File | null) => void;
  disabled: boolean;
}) {
  const audioInputId = useId();
  const txInputId = useId();

  const onAudioDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const f = e.dataTransfer.files[0];
      // Accept audio and video containers (MP4/MOV/M4A often carry sermon audio on iOS)
      if (f) onFile(f);
    },
    [onFile]
  );

  const onTxDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const f = e.dataTransfer.files[0];
      if (f) onTranscriptFile(f);
    },
    [onTranscriptFile]
  );

  const hasContent = file || transcriptFile;

  return (
    <div
      className={[
        "flex flex-col rounded-xl border-2 border-dashed overflow-hidden transition-all",
        hasContent
          ? "border-cyan-400/50 bg-cyan-500/6"
          : "border-slate-600/50 bg-slate-800/30",
        disabled ? "opacity-50 pointer-events-none" : "",
      ].join(" ")}
    >
      {/* Slot label */}
      <div className="flex items-center justify-between px-3 pt-2.5 pb-1">
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
          Slot {index + 1}
        </span>
        {hasContent && (
          <span className="text-[9px] text-emerald-400 font-semibold">✓ Ready</span>
        )}
      </div>

      {/* ── Audio upload ── */}
      <label
        htmlFor={audioInputId}
        onDrop={onAudioDrop}
        onDragOver={(e) => e.preventDefault()}
        className={[
          "relative flex items-center gap-2.5 px-3 py-2.5 cursor-pointer transition-colors group",
          file ? "bg-cyan-500/10" : "hover:bg-slate-700/30",
        ].join(" ")}
      >
        <input
          id={audioInputId}
          type="file"
          accept="audio/*,video/*,.mp3,.mp4,.m4a,.m4v,.mov,.wav,.aac,.ogg,.flac,.webm"
          className="sr-only"
          disabled={disabled}
          onChange={(e) => onFile(e.target.files?.[0] ?? null)}
        />
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}
          className={`h-5 w-5 flex-shrink-0 ${file ? "text-cyan-400" : "text-slate-500 group-hover:text-slate-300"}`}>
          <path d="M9 19V6l12-3v13M9 19c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2zM21 16c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2zM9 10l12-3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div className="flex-1 min-w-0">
          {file ? (
            <span className="text-xs font-medium text-cyan-300 block truncate">{file.name}</span>
          ) : (
            <span className="text-xs text-slate-500 group-hover:text-slate-300">
              Audio file <span className="text-[10px] text-slate-600">(tap or drop)</span>
            </span>
          )}
        </div>
        {file && (
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); onFile(null); }}
            className="flex-shrink-0 h-6 w-6 rounded-full bg-slate-700/80 flex items-center justify-center text-slate-400 hover:text-red-400 text-sm leading-none"
            aria-label="Remove audio"
          >×</button>
        )}
      </label>

      {/* ── Divider ── */}
      <div className="flex items-center gap-2 px-3">
        <div className="flex-1 h-px bg-slate-700/60" />
        <span className="text-[9px] text-slate-600 font-medium">OR</span>
        <div className="flex-1 h-px bg-slate-700/60" />
      </div>

      {/* ── Transcript upload ── */}
      <label
        htmlFor={txInputId}
        onDrop={onTxDrop}
        onDragOver={(e) => e.preventDefault()}
        className={[
          "relative flex items-center gap-2.5 px-3 py-2.5 pb-3 cursor-pointer transition-colors group",
          transcriptFile ? "bg-violet-500/10" : "hover:bg-slate-700/30",
        ].join(" ")}
      >
        <input
          id={txInputId}
          type="file"
          accept=".txt,.md,.text"
          className="sr-only"
          disabled={disabled}
          onChange={(e) => onTranscriptFile(e.target.files?.[0] ?? null)}
        />
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}
          className={`h-5 w-5 flex-shrink-0 ${transcriptFile ? "text-violet-400" : "text-slate-500 group-hover:text-slate-300"}`}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div className="flex-1 min-w-0">
          {transcriptFile ? (
            <span className="text-xs font-medium text-violet-300 block truncate">{transcriptFile.name}</span>
          ) : (
            <span className="text-xs text-slate-500 group-hover:text-slate-300">
              Transcript <span className="text-[10px] text-slate-600">(.txt — tap or drop)</span>
            </span>
          )}
        </div>
        {transcriptFile && (
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); onTranscriptFile(null); }}
            className="flex-shrink-0 h-6 w-6 rounded-full bg-slate-700/80 flex items-center justify-center text-slate-400 hover:text-red-400 text-sm leading-none"
            aria-label="Remove transcript"
          >×</button>
        )}
      </label>
    </div>
  );
}

// ─── Stage Tracker ───────────────────────────────────────────────────────────

const STAGE_STEPS: { key: PipelineStage; label: string; description: string }[] = [
  { key: "transcribing", label: "Transcribe",   description: "Converting audio to text via Deepgram nova-2" },
  { key: "filtering",    label: "Signal Filter", description: "Stripping prayers, announcements, and non-teaching content from transcript" },
  { key: "analyzing",    label: "Voice DNA",    description: "Extracting author's signature phrases, tone, and teaching style" },
  { key: "mapping",      label: "Content Map",  description: "Inventorying every teaching segment, scripture, and quote" },
  { key: "architecting", label: "Chapters",     description: "Designing chapter and section structure from the content" },
  { key: "writing",      label: "Writing",      description: "Drafting each section strictly from transcript source material" },
  { key: "polishing",    label: "Polish",       description: "Adding chapter intros, conclusions, and key takeaways" },
  { key: "frontmatter",  label: "Front Matter", description: "Writing preface, introduction, and closing from your words" },
  { key: "exporting",    label: "Export",       description: "Generating PDF and EPUB files for download" },
];

// Collapse adjacent stages so assigning/polishing/frontmatter light up their parent step
function resolveActiveStep(current: PipelineStage): PipelineStage {
  if (current === "assigning") return "architecting";
  if (current === "polishing") return "polishing";
  return current;
}

function EbookStageTracker({
  current,
  progress,
  signalFilterState,
  signalFilterDetail,
}: {
  current: PipelineStage;
  progress: { total: number; completed: number };
  signalFilterState: SignalFilterState;
  signalFilterDetail: string | null;
}) {
  const currentIdx = STAGE_ORDER.indexOf(current);
  const activeKey = resolveActiveStep(current);
  const activeStep = STAGE_STEPS.find((s) => s.key === activeKey);

  return (
    <div className="rounded-2xl border border-cyan-500/15 bg-slate-900/60 overflow-hidden shadow-panel">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-cyan-500/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              current === "complete" ? "bg-emerald-400" :
              current === "failed"   ? "bg-red-500" :
              "bg-cyan-400 animate-pulse"
            }`}
            style={{
              boxShadow: current === "complete" ? "0 0 10px rgba(52,211,153,0.80)" :
                         current === "failed"   ? "0 0 10px rgba(239,68,68,0.90)" :
                         "0 0 10px rgba(6,182,212,0.95)"
            }}
          />
          <span className="text-sm font-semibold uppercase tracking-widest text-slate-200">
            {current === "complete" ? "Production Complete" : current === "failed" ? "Production Failed" : "Pipeline Active"}
          </span>
        </div>
        {current === "writing" && progress.total > 0 && (
          <span className="text-xs tabular-nums text-slate-400">
            Section {progress.completed} / {progress.total}
          </span>
        )}
      </div>

      {/* Agent step pills */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-slate-800/60">
        {STAGE_STEPS.map((step) => {
          const idx = STAGE_ORDER.indexOf(step.key);
          const done   = idx < currentIdx || current === "complete";
          const active = step.key === activeKey && current !== "complete" && current !== "failed" && current !== "idle";
          const skipped = step.key === "filtering" && signalFilterState === "skipped";
          return (
            <div key={step.key} className="flex items-center gap-1.5">
              <span
                className={`h-2 w-2 flex-shrink-0 rounded-full transition-all ${
                  skipped ? "bg-amber-400" :
                  done   ? "bg-emerald-400" :
                  active ? "bg-cyan-400 animate-pulse" :
                           "bg-slate-700"
                }`}
                style={skipped ? { boxShadow: "0 0 6px rgba(251,191,36,0.7)" } :
                       done ? { boxShadow: "0 0 6px rgba(52,211,153,0.6)" } :
                       active ? { boxShadow: "0 0 8px rgba(6,182,212,0.9)" } : undefined}
              />
              <span className={`text-[11px] font-medium transition-colors ${
                skipped ? "text-amber-300" : active ? "text-cyan-300" : done ? "text-emerald-400" : "text-slate-600"
              }`}>
                {step.label}
              </span>
            </div>
          );
        })}
      </div>

      {signalFilterState === "skipped" && signalFilterDetail && current !== "failed" && (
        <div className="border-b border-amber-500/10 bg-amber-500/5 px-4 py-2.5">
          <p className="text-xs text-amber-300/90 leading-relaxed">
            Signal filter was skipped. Downstream steps are running on the raw transcript.
          </p>
          <p className="mt-1 text-[11px] text-amber-200/70 leading-relaxed break-words">{signalFilterDetail}</p>
        </div>
      )}

      {/* Active step description */}
      {activeStep && current !== "complete" && current !== "failed" && (
        <div className="px-4 py-2.5">
          <p className="text-xs text-slate-400 leading-relaxed">{activeStep.description}</p>
        </div>
      )}
    </div>
  );
}

// ─── Chapter Preview Card ─────────────────────────────────────────────────────

function ChapterCard({ chapter }: { chapter: ChapterDraft }) {
  const [open, setOpen] = useState(false);
  const done = chapter.status === "complete";
  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-800/40 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left min-h-[48px]"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className={`flex-shrink-0 h-2 w-2 rounded-full ${done ? "bg-emerald-400" : "bg-cyan-400 animate-pulse"}`} />
          <span className="text-xs text-slate-400 flex-shrink-0">Ch {chapter.number}</span>
          <span className="text-sm font-medium text-slate-200 truncate">{chapter.title}</span>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {done && (
            <span className="text-[10px] text-slate-500 tabular-nums">{chapter.totalWordCount.toLocaleString()} wds</span>
          )}
          <svg
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
            className={`h-4 w-4 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`}
          >
            <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </button>

      {open && (
        <div className="border-t border-slate-700/40 px-4 pb-4 pt-3 space-y-3">
          {chapter.sections.map((s) => (
            <div key={s.sectionNumber}>
              <p className="text-xs font-semibold text-cyan-400/80 mb-1">{s.heading}</p>
              <p className="text-xs text-slate-400 leading-relaxed line-clamp-3">
                {(s.body ?? "").slice(0, 220)}{(s.body ?? "").length > 220 ? "…" : ""}
              </p>
            </div>
          ))}
          {chapter.keyTakeaways.length > 0 && (
            <div className="mt-2 rounded-lg bg-cyan-500/8 border border-cyan-500/20 p-3">
              <p className="text-[10px] font-bold text-cyan-400 uppercase tracking-widest mb-2">Key Takeaways</p>
              {chapter.keyTakeaways.map((t, i) => (
                <p key={i} className="text-xs text-slate-300 leading-relaxed">• {t}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Agent Activity Log ───────────────────────────────────────────────────────

type LogTag = "INIT" | "INFO" | "DONE" | "ERR" | "STRM";

interface LogCfg { tag: LogTag; tagCls: string; msgCls: string }

const LOG_LEVELS: Record<LogTag, LogCfg> = {
  INIT: { tag: "INIT", tagCls: "border-cyan-400/30    bg-cyan-400/10    text-cyan-400",    msgCls: "text-slate-200" },
  INFO: { tag: "INFO", tagCls: "border-slate-500/30   bg-slate-500/10   text-slate-400",   msgCls: "text-slate-300" },
  DONE: { tag: "DONE", tagCls: "border-emerald-400/30 bg-emerald-400/10 text-emerald-400", msgCls: "text-slate-100" },
  ERR:  { tag: "ERR",  tagCls: "border-red-400/30     bg-red-400/10     text-red-400",     msgCls: "text-red-100"  },
  STRM: { tag: "STRM", tagCls: "border-violet-400/30  bg-violet-400/10  text-violet-400",  msgCls: "text-slate-200" },
};

function classifyLog(msg: string): LogTag {
  const m = msg.replace(/^\[[^\]]+\]\s*/, ""); // strip timestamp
  if (m.startsWith("✓") || m.startsWith("🎉")) return "DONE";
  if (m.startsWith("✗") || /error|failed/i.test(m)) return "ERR";
  if (m.includes("…") || /ing\b/.test(m)) return "STRM";
  if (/assembled|loaded|captured|ready|complete/i.test(m)) return "DONE";
  return "INFO";
}

function AgentActivityLog({ entries, isRunning }: { entries: string[]; isRunning: boolean }) {
  const endRef = useRef<HTMLDivElement>(null);
  useState(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); });

  return (
    <section className="flex flex-col overflow-hidden rounded-2xl border border-cyan-500/15 bg-slate-900/60 shadow-panel">
      <header className="flex flex-shrink-0 items-center justify-between border-b border-cyan-500/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            className={`h-2.5 w-2.5 rounded-full ${isRunning ? "animate-pulse bg-cyan-400" : "bg-emerald-400"}`}
            style={{ boxShadow: isRunning ? "0 0 10px rgba(6,182,212,0.95)" : "0 0 10px rgba(52,211,153,0.80)" }}
          />
          <h2 className="text-sm font-semibold uppercase tracking-widest text-slate-200">Agent Activity</h2>
        </div>
        <span className="rounded-full border border-slate-600/60 bg-slate-800/60 px-2.5 py-1 text-xs tabular-nums text-slate-300">
          {entries.length} events
        </span>
      </header>

      <div className="max-h-64 overflow-y-auto overscroll-contain p-3 lg:max-h-80">
        <ul className="space-y-1.5">
          {entries.map((line, i) => {
            const tag = classifyLog(line);
            const cfg = LOG_LEVELS[tag];
            // Extract HH:MM:SS from "[H:MM:SS AM]" prefix
            const timeMatch = line.match(/\[(\d+:\d+:\d+(?:\s*[AP]M)?)\]/i);
            const time = timeMatch ? timeMatch[1] : "";
            const message = line.replace(/^\[[^\]]+\]\s*/, "");
            return (
              <li
                key={i}
                className="flex items-start gap-2.5 rounded-xl border border-slate-700/50 bg-slate-900/70 px-3 py-2.5"
              >
                <span className={`mt-px inline-flex flex-shrink-0 items-center rounded-md border px-1.5 py-0.5 text-[10px] font-bold tracking-widest ${cfg.tagCls}`}>
                  {cfg.tag}
                </span>
                <span className={`flex-1 text-xs leading-relaxed font-mono ${cfg.msgCls}`}>{message}</span>
                <span className="flex-shrink-0 text-[11px] tabular-nums text-slate-600">{time}</span>
              </li>
            );
          })}
          {isRunning && (
            <li className="flex items-center gap-2.5 rounded-xl border border-violet-500/30 bg-violet-500/5 px-3 py-2.5">
              <span className="inline-flex flex-shrink-0 items-center rounded-md border border-violet-400/30 bg-violet-400/10 px-1.5 py-0.5 text-[10px] font-bold tracking-widest text-violet-400">
                STRM
              </span>
              <span className="text-xs font-mono text-slate-400">Processing<span className="animate-pulse">…</span></span>
            </li>
          )}
        </ul>
        <div ref={endRef} />
      </div>
    </section>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

function readTextFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read transcript file"));
    reader.readAsText(file);
  });
}

const JOB_STORAGE_KEY = "nexus_ebook_current_job"; // stores jobId (for IndexedDB)
const JOB_STATE_KEY = "nexus_ebook_job_state";    // stores full state as JSON (primary)

export function EbookPipeline({ onManifestReady }: { onManifestReady?: (manifest: EbookManifest) => void } = {}) {
  const [audioFiles, setAudioFiles] = useState<(File | null)[]>([null, null, null, null, null, null]);
  const [transcriptFiles, setTranscriptFiles] = useState<(File | null)[]>([null, null, null, null, null, null]);
  const [stage, setStage] = useState<PipelineStage>("idle");
  const [log, setLog] = useState<string[]>([]);
  const [progress, setProgress] = useState({ total: 0, completed: 0 });
  const [chapters, setChapters] = useState<ChapterDraft[]>([]);
  const [exportUrls, setExportUrls] = useState<{ pdfUrl?: string; epubUrl?: string } | null>(null);
  const [completedManifest, setCompletedManifest] = useState<EbookManifest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signalFilterState, setSignalFilterState] = useState<SignalFilterState>("idle");
  const [signalFilterDetail, setSignalFilterDetail] = useState<string | null>(null);
  const [totalWords, setTotalWords] = useState(0);
  const jobIdRef = useRef<string>(newJobId());
  // Mirror of log in a ref so runPipeline (async) can read the current value for checkpoints
  const logRef = useRef<string[]>([]);
  // Full saved job (loaded on mount) — enables resume-from-failure
  const savedJobRef = useRef<EbookJobState | null>(null);
  // Prevent double-triggering the auto-download across re-renders
  const autoDownloadedRef = useRef(false);

  const addLog = useCallback((msg: string) => {
    const entry = `[${new Date().toLocaleTimeString()}] ${msg}`;
    logRef.current = [...logRef.current.slice(-80), entry];
    setLog([...logRef.current]);
  }, []);

  // ── Auto-download PDF when export completes ──────────────────────────────
  useEffect(() => {
    if (exportUrls?.pdfUrl && !autoDownloadedRef.current) {
      autoDownloadedRef.current = true;
      try {
        const a = document.createElement("a");
        a.href = exportUrls.pdfUrl;
        a.download = "";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } catch {
        // auto-download blocked — user can still click the button manually
      }
    }
  }, [exportUrls]);

  // ── Hydrate from localStorage (primary) or IndexedDB (fallback) on mount ──

  // Sanitize raw localStorage data — applies missing defaults that Zod can't fill
  // because data is loaded with JSON.parse (not Zod.parse), so .default() never runs.
  function normalizeJob(raw: EbookJobState): EbookJobState {
    const fixArrays = <T,>(v: unknown): T[] => (Array.isArray(v) ? v as T[] : []);
    const fixStr = (v: unknown, fb = ""): string => (typeof v === "string" ? v : fb);
    const transcripts = fixArrays<Record<string, unknown>>(raw.transcripts as unknown)
      .map((t) => ({
        label: fixStr(t.label),
        text: fixStr(t.text),
      }))
      .filter((t) => t.text);
    const rebuiltMasterTranscript = transcripts
      .map((t) => `[${t.label}]\n${t.text}`)
      .join("\n\n═══════════════════════════════════════\n\n");

    const vdna = raw.voiceDNA as Record<string, unknown> | null;
    const voiceDNA = vdna ? {
      ...vdna,
      signaturePhrases:      fixArrays(vdna.signaturePhrases),
      preferredTerminology:  fixArrays(vdna.preferredTerminology),
      rhetoricalPatterns:    fixArrays(vdna.rhetoricalPatterns),
      avoidWords:            fixArrays(vdna.avoidWords),
      toneProfile:           fixStr(vdna.toneProfile),
      teachingStyle:         fixStr(vdna.teachingStyle),
      sentencePattern:       (vdna.sentencePattern as string) ?? "mixed",
    } : null;

    const cm = raw.contentMap as Record<string, unknown> | null;
    const contentMap = cm ? {
      ...cm,
      overarchingThemes: fixArrays(cm.overarchingThemes),
      teachingArc:       fixStr(cm.teachingArc),
      allQuotes: fixArrays(cm.allQuotes),
      segments: fixArrays<Record<string, unknown>>(cm.segments).map((s) => ({
        ...s,
        keyPoints: fixArrays(s.keyPoints),
        quotes:    fixArrays(s.quotes),
        rawText:   fixStr(s.rawText),
      })),
    } : null;

    const arch = raw.architecture as Record<string, unknown> | null;
    const architecture = arch ? {
      ...arch,
      chapters: fixArrays<Record<string, unknown>>(arch.chapters).map((c) => ({
        ...c,
        quotesInChapter: fixArrays(c.quotesInChapter),
        sections: fixArrays<Record<string, unknown>>(c.sections).map((s) => ({
          ...s,
          keyPoints:       fixArrays(s.keyPoints),
          quotesInSection: fixArrays(s.quotesInSection),
          sourceSegmentIds: fixArrays(s.sourceSegmentIds),
        })),
      })),
    } : null;

    const sections = fixArrays<Record<string, unknown>>(raw.sections as unknown).map((s) => ({
      ...s,
      body:    fixStr(s.body),
      heading: fixStr(s.heading),
    }));

    const sectionAssignments = fixArrays<Record<string, unknown>>(raw.sectionAssignments as unknown).map((a) => {
      const avdna = a.voiceDNA as Record<string, unknown> | null | undefined;
      return {
        ...a,
        keyPoints:          fixArrays(a.keyPoints),
        transcriptExcerpts: fixArrays(a.transcriptExcerpts),
        quotes:             fixArrays(a.quotes),
        voiceDNA: avdna ? {
          ...avdna,
          signaturePhrases:     fixArrays(avdna.signaturePhrases),
          preferredTerminology: fixArrays(avdna.preferredTerminology),
          rhetoricalPatterns:   fixArrays(avdna.rhetoricalPatterns),
          avoidWords:           fixArrays(avdna.avoidWords),
          toneProfile:          fixStr(avdna.toneProfile),
          teachingStyle:        fixStr(avdna.teachingStyle),
          sentencePattern:      (avdna.sentencePattern as string) ?? "mixed",
        } : a.voiceDNA,
      };
    });

    const chapters = fixArrays<Record<string, unknown>>(raw.chapters as unknown).map((c) => ({
      ...c,
      intro:               fixStr(c.intro),
      conclusion:          fixStr(c.conclusion),
      keyTakeaways:        fixArrays(c.keyTakeaways),
      reflectionQuestions: fixArrays(c.reflectionQuestions),
      sections: fixArrays<Record<string, unknown>>(c.sections).map((s) => ({
        ...s,
        body:    fixStr(s.body),
        heading: fixStr(s.heading),
      })),
    }));

    return {
      ...raw,
      audioFileNames: fixArrays(raw.audioFileNames),
      transcripts,
      masterTranscript: fixStr(raw.masterTranscript, rebuiltMasterTranscript),
      filteredTranscript: fixStr((raw as EbookJobState & { filteredTranscript?: unknown }).filteredTranscript),
      voiceDNA,
      contentMap,
      architecture,
      sections,
      sectionAssignments,
      chapters,
    } as EbookJobState;
  }

  useEffect(() => {
    // Try localStorage first — it's synchronous and reliably available in Safari
    const tryLocalStorage = () => {
      try {
        const raw = localStorage.getItem(JOB_STATE_KEY);
        if (!raw) return null;
        return normalizeJob(JSON.parse(raw) as EbookJobState);
      } catch { return null; }
    };

    const restore = (job: EbookJobState) => {
      savedJobRef.current = job;
      const filterInfo = parseSignalFilterLog(job.errorLog ?? []);
      setSignalFilterState(filterInfo.state);
      setSignalFilterDetail(filterInfo.detail);
      if (job.chapters.length === 0 && job.status !== "complete" && job.status !== "failed") return;
      jobIdRef.current = job.jobId;
      setStage(job.status as PipelineStage);
      logRef.current = job.errorLog ?? [];
      setLog(job.errorLog ?? []);
      setProgress(job.progress ?? { total: 0, completed: 0 });
      setChapters(job.chapters ?? []);
      // Restore error so the Resume button is visible after refresh
      if (job.status === "failed") {
        const lastErr = (job.errorLog ?? []).findLast?.((e) => e.includes("✗"));
        setError(lastErr ? lastErr.replace(/.*✗ Error:\s*/, "") || "Pipeline failed" : "Pipeline failed — tap Resume to retry");
      }
      if (job.exportUrls?.pdfUrl || job.exportUrls?.epubUrl) {
        setExportUrls({
          pdfUrl: job.exportUrls.pdfUrl || undefined,
          epubUrl: job.exportUrls.epubUrl || undefined,
        });
      }
      const words = (job.chapters ?? []).reduce((a, c) => a + (c.totalWordCount ?? 0), 0);
      if (words > 0) setTotalWords(words);
    };

    const fromLocal = tryLocalStorage();
    if (fromLocal) { restore(fromLocal); return; }

    // IndexedDB fallback
    const savedId = localStorage.getItem(JOB_STORAGE_KEY);
    if (!savedId) return;
    void getEbookJob(savedId).then((job) => {
      if (!job) return;
      restore(normalizeJob(job));
    }).catch(() => { /* IndexedDB unavailable — ignore */ });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setAudio = useCallback((i: number, f: File | null) => {
    setAudioFiles((prev) => { const next = [...prev]; next[i] = f; return next; });
  }, []);

  const setTranscript = useCallback((i: number, f: File | null) => {
    setTranscriptFiles((prev) => { const next = [...prev]; next[i] = f; return next; });
  }, []);

  // A slot is active if it has audio OR a pre-existing transcript
  const activeSlotCount = [0, 1, 2, 3, 4, 5].filter(
    (i) => audioFiles[i] || transcriptFiles[i]
  ).length;
  const canStart = activeSlotCount >= 1 && stage === "idle";

  // ── Resolve one slot: use pre-existing transcript or call Deepgram ─────────

  async function resolveSlot(
    audioFile: File | null,
    transcriptFile: File | null,
    label: string
  ): Promise<string> {
    // Pre-existing transcript takes priority — skip the API call entirely
    if (transcriptFile) {
      addLog(`Reading transcript file for ${label}…`);
      const text = await readTextFile(transcriptFile);
      addLog(`✓ ${label} transcript loaded — ${countWords(text).toLocaleString()} words`);
      return text;
    }
    // Fall back to Deepgram transcription — send directly from browser to
    // avoid the Next.js / Codespaces proxy 413 body-size limit on large files.
    if (audioFile) {
      addLog(`Transcribing ${label} via Deepgram…`);

      const tokenRes = await fetch("/api/transcribe-token");
      if (!tokenRes.ok) throw new Error(`Could not get Deepgram token (HTTP ${tokenRes.status})`);
      const { apiKey } = await tokenRes.json() as { apiKey: string };

      // Map video containers to their audio MIME equivalent for Deepgram
      const VIDEO_TO_AUDIO: Record<string, string> = {
        "video/mp4": "audio/mp4",
        "video/quicktime": "audio/mp4",
        "video/x-m4v": "audio/mp4",
        "video/webm": "audio/webm",
        "video/ogg": "audio/ogg",
        "video/x-matroska": "audio/webm",
      };
      const rawMime = audioFile.type || "";
      const mimeType = VIDEO_TO_AUDIO[rawMime] ?? (rawMime || "audio/mpeg");

      const params = new URLSearchParams({
        model: "nova-2",
        smart_format: "true",
        punctuate: "true",
        paragraphs: "true",
        language: "en",
      });

      const buffer = await audioFile.arrayBuffer();
      const dgRes = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
        method: "POST",
        headers: { Authorization: `Token ${apiKey}`, "Content-Type": mimeType },
        body: buffer,
      });

      if (!dgRes.ok) {
        const dgErr = await dgRes.json().catch(() => ({})) as { err_msg?: string };
        throw new Error(`Transcription failed for ${label}: ${dgErr.err_msg || dgRes.statusText || `HTTP ${dgRes.status}`}`);
      }

      type DgResponse = { results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string }> }> } };
      const data = await dgRes.json() as DgResponse;
      const transcript = data.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";
      if (!transcript.trim()) throw new Error(`Deepgram returned an empty transcript for ${label}`);

      addLog(`✓ ${label} transcribed — ${countWords(transcript).toLocaleString()} words`);
      return transcript;
    }
    throw new Error(`${label} has neither an audio file nor a transcript file.`);
  }

  // ── Main pipeline run ─────────────────────────────────────────────────────

  async function runPipeline(resume?: EbookJobState) {
    setStage("transcribing");
    setError(null);
    // Restore existing log when resuming so the user sees full history
    if (!resume) {
      logRef.current = [];
      setLog([]);
      setChapters([]);
      setSignalFilterState("idle");
      setSignalFilterDetail(null);
      setExportUrls(null);
      setCompletedManifest(null);
      setTotalWords(0);
      autoDownloadedRef.current = false;
    }
    const jobId = resume?.jobId ?? jobIdRef.current;
    jobIdRef.current = jobId;
    localStorage.setItem(JOB_STORAGE_KEY, jobId);

    const now = new Date().toISOString();
    const acc: EbookJobState = resume
      ? {
          ...resume,
          status: "transcribing",
          updatedAt: now,
          // Guard against old persisted jobs that may be missing array fields
          chapters: resume.chapters ?? [],
          sections: resume.sections ?? [],
          sectionAssignments: resume.sectionAssignments ?? [],
          transcripts: resume.transcripts ?? [],
          errorLog: resume.errorLog ?? [],
        }
      : {
          jobId,
          status: "transcribing",
          audioFileNames: audioFiles.filter(Boolean).map((f) => f!.name),
          transcripts: [],
          masterTranscript: "",
          voiceDNA: null,
          contentMap: null,
          architecture: null,
          sectionAssignments: [],
          sections: [],
          chapters: [],
          frontMatter: null,
          exportUrls: null,
          currentStage: "transcribing",
          progress: { total: 0, completed: 0 },
          errorLog: [],
          createdAt: now,
          updatedAt: now,
        };
    const checkpoint = async (s: PipelineStage) => {
      acc.status = s;
      acc.currentStage = s;
      acc.errorLog = logRef.current;
      acc.updatedAt = new Date().toISOString();
      // Primary: localStorage (synchronous, always available)
      try { localStorage.setItem(JOB_STATE_KEY, JSON.stringify(acc)); } catch { /* quota */ }
      // Secondary: IndexedDB
      try { await saveEbookJob({ ...acc }); } catch { /* silently fail */ }
    };

    try {
      // ── Stage 1: Transcribe (skip if resuming with existing transcript) ────
      let masterTranscript = acc.masterTranscript;
      if (!masterTranscript) {
        const transcriptResults: { label: string; text: string }[] = [];
        for (let i = 0; i < 6; i++) {
          if (!audioFiles[i] && !transcriptFiles[i]) continue;
          const label = `Slot-${i + 1}`;
          const text = await resolveSlot(audioFiles[i], transcriptFiles[i], label);
          transcriptResults.push({ label, text });
        }
        masterTranscript = transcriptResults
          .map((t) => `[${t.label}]\n${t.text}`)
          .join("\n\n═══════════════════════════════════════\n\n");
        addLog(`Master transcript assembled — ${countWords(masterTranscript).toLocaleString()} raw words`);
        acc.masterTranscript = masterTranscript;
        acc.transcripts = transcriptResults;
        await checkpoint("filtering");
      } else {
        addLog(`↩ Resuming — transcript available (${countWords(masterTranscript).toLocaleString()} words)`);
      }

      // ── Stage 2: Signal Filter — strip prayers, announcements, housekeeping ─
      let filteredTranscript = (acc as EbookJobState & { filteredTranscript?: string }).filteredTranscript ?? "";
      if (!filteredTranscript) {
        setStage("filtering");
        addLog("Filtering signal — removing non-teaching content…");
        try {
          type FilterResult = { cleanedTranscript: string; removedSegments: { reason: string; excerpt: string }[]; summary: string };
          const filterResult = await postJson<FilterResult>("/api/ebook/filter-signal", { masterTranscript });
          filteredTranscript = filterResult.cleanedTranscript || masterTranscript;
          const removedCount = filterResult.removedSegments.length;
          if (removedCount > 0) {
            addLog(`✓ Signal filtered — removed ${removedCount} non-teaching block${removedCount !== 1 ? "s" : ""}: ${filterResult.summary}`);
          } else {
            addLog("✓ Signal filter complete — no non-teaching content found");
          }
          setSignalFilterState("applied");
          setSignalFilterDetail(filterResult.summary || null);
          (acc as EbookJobState & { filteredTranscript: string; filterRemovedCount: number }).filteredTranscript = filteredTranscript;
          (acc as EbookJobState & { filteredTranscript: string; filterRemovedCount: number }).filterRemovedCount = removedCount;
        } catch (filterErr) {
          // Non-fatal: if filtering fails, proceed with the raw transcript
          filteredTranscript = masterTranscript;
          const detail = filterErr instanceof Error ? filterErr.message : "unknown error";
          setSignalFilterState("skipped");
          setSignalFilterDetail(detail);
          addLog(`⚠ Signal filter unavailable — using raw transcript (${detail})`);
        }
        await checkpoint("analyzing");
      } else {
        setSignalFilterState("applied");
        setSignalFilterDetail(null);
        addLog(`↩ Resuming — filtered transcript available (${countWords(filteredTranscript).toLocaleString()} teaching words)`);
      }

      // Use filtered transcript for all downstream steps
      const teachingTranscript = filteredTranscript || masterTranscript;

      // ── Stage 3: Voice DNA ───────────────────────────────────────────
      let voiceDNA = acc.voiceDNA;
      if (!voiceDNA) {
        setStage("analyzing");
        addLog("Extracting Voice DNA…");
        voiceDNA = await postJson<VoiceDNA>("/api/ebook/voice-dna", { masterTranscript: teachingTranscript });
        addLog(`✓ Voice DNA captured — tone: ${voiceDNA.toneProfile}`);
        acc.voiceDNA = voiceDNA;
        await checkpoint("mapping");
      } else {
        addLog(`↩ Resuming — voice DNA available`);
      }

      // ── Stage 4: Content Map ─────────────────────────────────────────────
      let contentMap = acc.contentMap;
      if (!contentMap) {
        setStage("mapping");
        addLog("Mapping content segments…");
        contentMap = await postJson<ContentMap>("/api/ebook/content-map", { masterTranscript: teachingTranscript, voiceDNA });
        addLog(`✓ Content mapped — ${contentMap.segments.length} segments, ${contentMap.allQuotes.length} scriptures/quotes`);
        acc.contentMap = contentMap;
        await checkpoint("architecting");
      } else {
        addLog(`↩ Resuming — content map available (${contentMap.segments.length} segments)`);
      }

      // ── Stage 5: Architect ───────────────────────────────────────────────
      let architecture = acc.architecture;
      if (!architecture) {
        setStage("architecting");
        addLog("Designing chapter structure…");
        architecture = await postJson<BookArchitecture>("/api/ebook/architect", { contentMap, voiceDNA });
        const totalSections = architecture.chapters.reduce((a, c) => a + c.sections.length, 0);
        addLog(`✓ Architecture: "${architecture.bookTitle}" — ${architecture.chapters.length} chapters, ${totalSections} sections`);
        acc.architecture = architecture;
      } else {
        const totalSections = architecture.chapters.reduce((a, c) => a + c.sections.length, 0);
        addLog(`↩ Resuming — architecture available (${architecture.chapters.length} chapters, ${totalSections} sections)`);
      }

      // Seed chapters for UI display (always re-seed from architecture)
      const totalSections = architecture.chapters.reduce((a, c) => a + c.sections.length, 0);
      if (acc.chapters.length === 0) {
        const seedChapters: ChapterDraft[] = architecture.chapters.map((c) => ({
          number: c.number,
          title: c.title,
          intro: "",
          sections: c.sections.map((s) => ({
            chapterNumber: c.number,
            sectionNumber: s.sectionNumber,
            heading: s.heading,
            body: "",
            wordCount: 0,
            status: "pending" as const,
          })),
          conclusion: "",
          keyTakeaways: [],
          reflectionQuestions: [],
          totalWordCount: 0,
          status: "pending" as const,
        }));
        setChapters(seedChapters);
        setProgress({ total: totalSections, completed: 0 });
        acc.chapters = seedChapters;
      } else {
        // Restore previously written chapters to UI
        setChapters(acc.chapters);
        setProgress(acc.progress);
      }
      await checkpoint("assigning");

      // ── Stage 5: Assign Segments ─────────────────────────────────────────
      let assignments = acc.sectionAssignments;
      if (assignments.length === 0) {
        setStage("assigning");
        addLog("Assigning transcript segments to sections…");
        const result = await postJson<{ assignments: SectionAssignment[] }>(
          "/api/ebook/assign-segments",
          { architecture, contentMap, voiceDNA }
        );
        assignments = result.assignments;
        addLog(`✓ ${assignments.length} section assignments ready`);
        acc.sectionAssignments = assignments;
        await checkpoint("writing");
      } else {
        addLog(`↩ Resuming — ${assignments.length} section assignments available`);
      }

      // ── Stage 6: Write Sections (sequential with continuity) ─────────────
      setStage("writing");
      // Sections already written in a previous run are kept; only write remaining ones
      const completedSectionKeys = new Set(
        acc.sections.map((s) => `${s.chapterNumber}-${s.sectionNumber}`)
      );
      const allSections: SectionDraft[] = [...acc.sections];
      let completedCount = allSections.length;
      let previousEnding = allSections.length > 0
        ? (allSections[allSections.length - 1].body ?? "").split("\n\n").slice(-2).join("\n\n")
        : "";
      if (completedCount > 0) {
        addLog(`↩ Resuming — ${completedCount} sections already written, continuing from section ${completedCount + 1}`);
        setProgress({ total: totalSections, completed: completedCount });
      }

      for (const assignment of assignments) {
        const key = `${assignment.chapterNumber}-${assignment.sectionNumber}`;
        if (completedSectionKeys.has(key)) continue; // already done

        const augmented: SectionAssignment = { ...assignment, previousSectionEnding: previousEnding };
        addLog(`Writing Ch ${assignment.chapterNumber} § ${assignment.sectionNumber}: ${assignment.heading}…`);

        // Update section status to "writing"
        setChapters((prev) =>
          prev.map((ch) =>
            ch.number === assignment.chapterNumber
              ? {
                  ...ch,
                  sections: ch.sections.map((s) =>
                    s.sectionNumber === assignment.sectionNumber ? { ...s, status: "writing" as const } : s
                  ),
                }
              : ch
          )
        );

        let body = await streamSection(augmented);

        // Quality gate: retry once if too short
        const wc = countWords(body);
        if (wc < 300 && assignment.transcriptExcerpts.join(" ").length > 500) {
          addLog(`  ↺ Section too short (${wc} words) — retrying with expansion prompt…`);
          const expanded = { ...augmented, targetWordCount: Math.max(assignment.targetWordCount, 600) };
          body = await streamSection(expanded);
        }

        const finalWc = countWords(body);
        const draft: SectionDraft = {
          chapterNumber: assignment.chapterNumber,
          sectionNumber: assignment.sectionNumber,
          heading: assignment.heading,
          body,
          wordCount: finalWc,
          status: "complete",
        };
        allSections.push(draft);
        completedCount++;
        previousEnding = (body ?? "").split("\n\n").slice(-2).join("\n\n");

        // Update UI
        setChapters((prev) =>
          prev.map((ch) =>
            ch.number === assignment.chapterNumber
              ? {
                  ...ch,
                  sections: ch.sections.map((s) =>
                    s.sectionNumber === assignment.sectionNumber ? draft : s
                  ),
                }
              : ch
          )
        );
        setProgress({ total: totalSections, completed: completedCount });
        addLog(`  ✓ ${finalWc.toLocaleString()} words written`);
        // Save after every section so a refresh never loses completed work
        acc.sections = [...allSections];
        acc.progress = { total: totalSections, completed: completedCount };
        await checkpoint("writing");
      }

      // ── Stage 7: Polish chapters ─────────────────────────────────────────
      setStage("polishing");
      const completedChapterNums = new Set(
        acc.chapters.filter((c) => c.status === "complete").map((c) => c.number)
      );
      const polishedChapters: ChapterDraft[] = acc.chapters.filter((c) => c.status === "complete");
      if (polishedChapters.length > 0) {
        addLog(`↩ Resuming — ${polishedChapters.length} chapters already polished`);
      }

      for (const chapterBlueprint of architecture.chapters) {
        if (completedChapterNums.has(chapterBlueprint.number)) continue; // already done

        addLog(`Polishing Chapter ${chapterBlueprint.number}: ${chapterBlueprint.title}…`);
        const chapterSections = allSections.filter((s) => s.chapterNumber === chapterBlueprint.number);

        // Send slim sections — the route only uses the first ~300 chars per body for the summary.
        // Full bodies are re-merged client-side after the response to avoid a large payload.
        const slimSections = chapterSections.map((s) => ({
          ...s,
          body: (s.body ?? "").slice(0, 400),
        }));

        const polished = await postJson<ChapterDraft>("/api/ebook/polish", {
          input: {
            number: chapterBlueprint.number,
            title: chapterBlueprint.title,
            sections: slimSections,
            chapterSegmentTexts: [], // not used by the route; omit to reduce payload
            voiceDNA,
            quotesInChapter: (chapterBlueprint.quotesInChapter ?? []).slice(0, 8),
          },
        });

        // Restore full section bodies that were stripped for the request
        const fullPolished: ChapterDraft = {
          ...polished,
          sections: polished.sections.map((s) => {
            const full = chapterSections.find((cs) => cs.sectionNumber === s.sectionNumber);
            return full ? { ...s, body: full.body, wordCount: full.wordCount } : s;
          }),
        };

        polishedChapters.push(fullPolished);
        setChapters((prev) =>
          prev.map((ch) => (ch.number === chapterBlueprint.number ? fullPolished : ch))
        );
        addLog(`  ✓ Chapter ${chapterBlueprint.number} polished`);
        acc.chapters = [...polishedChapters];
        await checkpoint("polishing");
      }

      // ── Stage 8: Front / Back Matter ────────────────────────────────────
      let frontMatter = acc.frontMatter;
      if (!frontMatter) {
        setStage("frontmatter");
        addLog("Writing preface, introduction, and conclusion…");
        const frontMatterTranscript = typeof masterTranscript === "string" && masterTranscript
          ? masterTranscript
          : acc.transcripts
              .map((t) => `[${t.label}]\n${t.text}`)
              .join("\n\n═══════════════════════════════════════\n\n");
        if (countWords(frontMatterTranscript) < 100) {
          throw new Error("Saved job is missing transcript text required for front matter");
        }
        frontMatter = await postJson<FrontBackMatter>("/api/ebook/frontmatter", {
          masterTranscript: frontMatterTranscript.slice(0, 14000),
          architecture,
          voiceDNA,
        });
        addLog("✓ Front and back matter complete");
        acc.frontMatter = frontMatter;
        await checkpoint("exporting");
      } else {
        addLog("↩ Resuming — front matter available");
      }

      // ── Assemble manifest ────────────────────────────────────────────────
      const runningTotal = polishedChapters.reduce((a, c) => a + c.totalWordCount, 0);
      setTotalWords(runningTotal);

      const manifest: EbookManifest = {
        jobId,
        bookTitle: architecture.bookTitle,
        subtitle: architecture.subtitle,
        authorName: architecture.authorName,
        frontMatter,
        chapters: polishedChapters,
        totalWordCount: runningTotal,
        allQuotes: contentMap.allQuotes,
        generatedAt: new Date().toISOString(),
      };

      // ── Stage 9: Export ──────────────────────────────────────────────────
      setStage("exporting");
      addLog("Generating PDF and EPUB files…");
      const urls = await postJson<{ pdfUrl?: string; epubUrl?: string }>(
        "/api/ebook/export",
        { manifest, formats: { pdf: true, epub: true } }
      );
      setExportUrls(urls);
      addLog(`✓ PDF ready: ${urls.pdfUrl ? "yes" : "no"} | EPUB ready: ${urls.epubUrl ? "yes" : "no"}`);
      addLog(`🎉 Ebook complete — ${runningTotal.toLocaleString()} words across ${polishedChapters.length} chapters`);
      acc.exportUrls = { pdfUrl: urls.pdfUrl ?? "", epubUrl: urls.epubUrl ?? "" };
      acc.chapters = polishedChapters;
      await checkpoint("complete");
      setStage("complete");
      setCompletedManifest(manifest);
      // Notify parent so the Nexus Assistant can take over for post-production edits
      onManifestReady?.(manifest);

    } catch (err) {
      const msg = err instanceof Error && err.message.trim() ? err.message : "Pipeline failed";
      const failedStage = acc.currentStage || stage || "transcribing";
      // Log full stack to browser console for debugging
      console.error("[EbookPipeline] runPipeline crash:", err);
      const stackHint = err instanceof Error && err.stack
        ? ` [at: ${err.stack.split("\n").slice(1, 3).join(" → ").replace(/\s+/g, " ").slice(0, 120)}]`
        : "";
      setError(msg + stackHint);
      acc.status = "failed";
      acc.currentStage = failedStage;
      acc.errorLog = logRef.current;
      acc.updatedAt = new Date().toISOString();
      try { localStorage.setItem(JOB_STATE_KEY, JSON.stringify(acc)); } catch { /* ignore */ }
      try { await saveEbookJob({ ...acc }); } catch { /* ignore */ }
      // Update savedJobRef so the Resume button has the partial state
      savedJobRef.current = { ...acc };
      setStage("failed");
      addLog(`✗ Error: ${msg}`);
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  const isRunning = stage !== "idle" && stage !== "complete" && stage !== "failed";
  const hasResumableState = Boolean(
    savedJobRef.current && (
      savedJobRef.current.masterTranscript ||
      savedJobRef.current.transcripts.length > 0 ||
      savedJobRef.current.voiceDNA ||
      savedJobRef.current.contentMap ||
      savedJobRef.current.architecture ||
      savedJobRef.current.sectionAssignments.length > 0 ||
      savedJobRef.current.sections.length > 0 ||
      savedJobRef.current.chapters.length > 0 ||
      savedJobRef.current.frontMatter
    )
  );

  return (
    <div className="flex flex-col gap-5 pb-[max(env(safe-area-inset-bottom),3.75rem)] lg:pb-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-100">Ebook Production</h2>
          <p className="text-xs text-slate-400 mt-0.5 leading-snug max-w-sm">
            Upload up to 4 hours of audio. Your voice and content — no additions, no fabrication.
          </p>
        </div>
      </div>

      {/* Audio + Transcript Upload Grid */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <AudioCard
            key={i}
            index={i}
            file={audioFiles[i]}
            onFile={(f) => setAudio(i, f)}
            transcriptFile={transcriptFiles[i]}
            onTranscriptFile={(f) => setTranscript(i, f)}
            disabled={isRunning}
          />
        ))}
      </div>

      {/* Start Button OR Start-fresh banner when a run is restored */}
      {stage === "idle" && (
        <button
          type="button"
          disabled={!canStart}
          onClick={runPipeline}
          className={[
            "w-full min-h-[52px] rounded-xl font-semibold text-base transition-all",
            canStart
              ? "bg-gradient-to-r from-cyan-500 to-violet-500 text-white hover:opacity-90 active:scale-[0.98]"
              : "bg-slate-700/50 text-slate-500 cursor-not-allowed",
          ].join(" ")}
        >
          {canStart
            ? `Begin Ebook Production (${activeSlotCount} slot${activeSlotCount > 1 ? "s" : ""})`
            : "Add at least one audio or transcript to begin"}
        </button>
      )}

      {/* Stage Tracker */}
      {stage !== "idle" && (
        <EbookStageTracker
          current={stage}
          progress={progress}
          signalFilterState={signalFilterState}
          signalFilterDetail={signalFilterDetail}
        />
      )}

      {/* Writing progress ring + word count (shown separately below tracker) */}
      {stage === "writing" && progress.total > 0 && (
        <div className="flex items-center gap-4 px-1">
          <EbookProgressRing total={progress.total} completed={progress.completed} label="Sections" size={72} />
          <div>
            <p className="text-sm font-medium text-slate-200">Writing sections…</p>
            <p className="text-xs text-slate-500 tabular-nums mt-0.5">{progress.completed} of {progress.total} complete</p>
          </div>
        </div>
      )}
      {stage === "complete" && totalWords > 0 && (
        <div className="flex items-center justify-between gap-3 px-1">
          <div className="flex items-center gap-3">
            <span className="text-2xl font-bold text-cyan-400 tabular-nums">{totalWords.toLocaleString()}</span>
            <span className="text-sm text-slate-400">words — ready to download</span>
          </div>
          <button
            type="button"
            onClick={() => {
              setStage("idle");
              setChapters([]);
              setLog([]);
              logRef.current = [];
              setExportUrls(null);
              setCompletedManifest(null);
              setTotalWords(0);
              setProgress({ total: 0, completed: 0 });
              jobIdRef.current = newJobId();
              autoDownloadedRef.current = false;
              localStorage.removeItem(JOB_STORAGE_KEY);
              localStorage.removeItem(JOB_STATE_KEY);
            }}
            className="text-xs text-slate-500 underline min-h-[44px] px-2"
          >
            Start new project
          </button>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/8 px-4 py-3 space-y-3">
          <div>
            <p className="text-xs font-semibold text-red-400 mb-1">Pipeline Error</p>
            <pre className="whitespace-pre-wrap break-words font-sans text-xs text-red-300/80 leading-relaxed">{error}</pre>
          </div>
          {/* Resume button — only show when we have partial data to resume from */}
          {hasResumableState && (
            <button
              type="button"
              onClick={() => {
                const saved = savedJobRef.current!;
                setError(null);
                setSignalFilterState(parseSignalFilterLog(saved.errorLog ?? []).state);
                setSignalFilterDetail(parseSignalFilterLog(saved.errorLog ?? []).detail);
                // Determine which stage to label the resume from
                const resumeStage = saved.currentStage || (saved.contentMap
                  ? saved.architecture ? "writing" : "architecting"
                  : saved.voiceDNA ? "content mapping" : "voice DNA");
                addLog(`↩ Resuming from ${resumeStage}…`);
                void runPipeline(saved);
              }}
              className="w-full min-h-[48px] rounded-xl bg-gradient-to-r from-amber-500/80 to-orange-500/80 text-white font-semibold text-sm active:scale-[0.98] transition-all"
            >
              {(() => {
                const saved = savedJobRef.current!;
                if (saved.currentStage === "writing") return `Resume — continue writing (${saved.sections.length} / ${saved.sectionAssignments.length} sections done)`;
                if (saved.currentStage === "frontmatter") return "Resume — retry from Front Matter";
                if (saved.currentStage === "polishing") return "Resume — retry from Polish";
                if (saved.currentStage === "assigning") return "Resume — retry from Assign Segments";
                if (saved.currentStage === "architecting") return "Resume — retry from Chapter Design";
                if (saved.currentStage === "mapping") return "Resume — retry from Content Map";
                if (saved.currentStage === "analyzing") return "Resume — retry from Voice DNA";
                if (!saved.voiceDNA) return "Resume — retry from Voice DNA";
                if (!saved.contentMap) return "Resume — retry from Content Map";
                if (!saved.architecture) return "Resume — retry from Chapter Design";
                if (saved.sectionAssignments.length === 0) return "Resume — retry from Assign Segments";
                if (saved.sections.length < (saved.sectionAssignments.length || 1)) return `Resume — continue writing (${saved.sections.length} / ${saved.sectionAssignments.length} sections done)`;
                if (!saved.frontMatter) return "Resume — retry from Front Matter";
                return "Resume pipeline";
              })()}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setStage("idle");
              setError(null);
              setSignalFilterState("idle");
              setSignalFilterDetail(null);
              setChapters([]);
              setLog([]);
              logRef.current = [];
              setExportUrls(null);
              setCompletedManifest(null);
              setTotalWords(0);
              setProgress({ total: 0, completed: 0 });
              savedJobRef.current = null;
              jobIdRef.current = newJobId();
              autoDownloadedRef.current = false;
              localStorage.removeItem(JOB_STORAGE_KEY);
              localStorage.removeItem(JOB_STATE_KEY);
            }}
            className="text-xs text-slate-500 underline min-h-[44px] flex items-center"
          >
            Start over (discard progress)
          </button>
        </div>
      )}

      {/* Download Buttons */}
      {exportUrls && (
        <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/6 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-bold text-emerald-400 uppercase tracking-widest">
              Your Ebook Is Ready
            </p>
            <span className="text-[10px] text-slate-500">PDF auto-downloaded</span>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            {exportUrls.pdfUrl && (
              <a
                href={exportUrls.pdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                download
                className="flex-1 min-h-[52px] flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-cyan-600 text-white font-semibold text-sm hover:opacity-90 active:scale-[0.98] transition-all"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
                  <path d="M12 17V3M5 10l7 7 7-7M3 20h18" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Download PDF
              </a>
            )}
            {exportUrls.epubUrl && (
              <a
                href={exportUrls.epubUrl}
                target="_blank"
                rel="noopener noreferrer"
                download
                className="flex-1 min-h-[52px] flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-violet-600 text-white font-semibold text-sm hover:opacity-90 active:scale-[0.98] transition-all"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
                  <path d="M12 17V3M5 10l7 7 7-7M3 20h18" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Download EPUB
              </a>
            )}
          </div>
          {/* Project File backup — lets user save full structured manifest locally */}
          {completedManifest && (
            <button
              type="button"
              onClick={() => {
                const slug = completedManifest.bookTitle.replace(/\s+/g, "-").toLowerCase().slice(0, 60);
                const blob = new Blob([JSON.stringify(completedManifest, null, 2)], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `${slug}-project.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                setTimeout(() => URL.revokeObjectURL(url), 2000);
              }}
              className="w-full min-h-[48px] flex items-center justify-center gap-2 rounded-xl border border-slate-600/50 bg-slate-800/60 text-slate-300 text-sm font-medium hover:border-slate-500 hover:text-slate-100 active:scale-[0.98] transition-all"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-4 w-4 flex-shrink-0">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" strokeLinecap="round" strokeLinejoin="round" />
                <polyline points="14,2 14,8 20,8" />
                <line x1="12" y1="18" x2="12" y2="12" strokeLinecap="round" />
                <polyline points="9,15 12,18 15,15" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Save Project File (.json)
            </button>
          )}
        </div>
      )}

      {/* Chapter Cards */}
      {chapters.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest px-1">
            Chapters ({chapters.length})
          </p>
          {chapters.map((ch) => (
            <ChapterCard key={ch.number} chapter={ch} />
          ))}
        </div>
      )}

      {/* Agent Activity Log */}
      {log.length > 0 && (
        <AgentActivityLog entries={log} isRunning={isRunning} />
      )}
    </div>
  );
}
