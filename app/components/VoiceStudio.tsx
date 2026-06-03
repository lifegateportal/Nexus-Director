"use client";

/**
 * VoiceStudio — XTTS v2 audiobook narration panel.
 *
 * Shown inside EbookPipeline when stage === "complete".
 * Lets the author:
 *   1. Upload a 30s–3min voice sample
 *   2. Upload the sample to R2, clone it via RunPod
 *   3. Narrate any or all chapters — each chapter queues independently
 *   4. Play back finished chapters inline with a native <audio> element
 *
 * Narration state persists to localStorage under the key STORAGE_KEY so the
 * user can close the tab and come back to their audiobook.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import type { EbookManifest, ChapterDraft } from "@/lib/schemas/ebook";

// ── Types ─────────────────────────────────────────────────────────────────────

type NarrateStatus = "idle" | "queued" | "synthesizing" | "done" | "error";

interface ChapterNarration {
  chapterId: string;
  title: string;
  status: NarrateStatus;
  audioUrl: string | null;
  durationSec: number | null;
  error: string | null;
}

interface VoiceStudioState {
  voiceId: string | null;   // R2 URL of the cleaned WAV sample
  voiceDurationSec: number | null;
  chapters: ChapterNarration[];
}

// ── Storage key ───────────────────────────────────────────────────────────────

const STORAGE_KEY_PREFIX = "nexus_voice_studio_";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeChapterId(ch: ChapterDraft): string {
  return `ch-${ch.number}`;
}

function initChapterNarrations(manifest: EbookManifest): ChapterNarration[] {
  return manifest.chapters.map((ch) => ({
    chapterId: makeChapterId(ch),
    title: ch.title || `Chapter ${ch.number}`,
    status: "idle",
    audioUrl: null,
    durationSec: null,
    error: null,
  }));
}

function buildChapterText(ch: ChapterDraft): string {
  const parts: string[] = [];
  if (ch.intro) parts.push(ch.intro);
  for (const section of ch.sections) {
    if (section.heading) parts.push(section.heading);
    if (section.body) parts.push(section.body);
  }
  if (ch.keyTakeaways.length > 0) {
    parts.push("Key Takeaways");
    parts.push(ch.keyTakeaways.join(". "));
  }
  return parts.join("\n\n");
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

interface VoiceStudioProps {
  manifest: EbookManifest;
  slug?: string; // used as a folder name in R2 — defaults to jobId
}

export function VoiceStudio({ manifest, slug }: VoiceStudioProps) {
  const bookSlug = slug ?? manifest.jobId;
  const storageKey = `${STORAGE_KEY_PREFIX}${bookSlug}`;

  // ── State ──────────────────────────────────────────────────────────────────

  const [voiceId, setVoiceId] = useState<string | null>(null);
  const [voiceDurationSec, setVoiceDurationSec] = useState<number | null>(null);
  const [sampleFile, setSampleFile] = useState<File | null>(null);
  const [cloning, setCloning] = useState(false);
  const [cloneError, setCloneError] = useState<string | null>(null);

  const [chapters, setChapters] = useState<ChapterNarration[]>(() =>
    initChapterNarrations(manifest)
  );

  const [uploadingR2, setUploadingR2] = useState(false);
  const [language, setLanguage] = useState("en");
  const [speed, setSpeed] = useState(1.0);
  const [narrating, setNarrating] = useState(false);

  const abortRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Persist state to localStorage ─────────────────────────────────────────

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (!saved) return;
      const state = JSON.parse(saved) as VoiceStudioState;
      if (state.voiceId)         setVoiceId(state.voiceId);
      if (state.voiceDurationSec) setVoiceDurationSec(state.voiceDurationSec);
      if (state.chapters?.length) {
        // Merge saved narration URLs into current chapter list so new chapters are still shown
        setChapters((prev) =>
          prev.map((ch) => {
            const saved_ch = state.chapters.find((c) => c.chapterId === ch.chapterId);
            return saved_ch ? { ...ch, ...saved_ch } : ch;
          })
        );
      }
    } catch {
      // Corrupted localStorage — ignore
    }
  }, [storageKey]);

  const persist = useCallback((nextVoiceId: string | null, nextDur: number | null, nextChapters: ChapterNarration[]) => {
    const state: VoiceStudioState = { voiceId: nextVoiceId, voiceDurationSec: nextDur, chapters: nextChapters };
    try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch { /* storage full */ }
  }, [storageKey]);

  // ── Upload voice sample to R2 via server-side route ──────────────────────
  // Using server-side upload (not presigned PUT) to avoid browser CORS issues.

  async function uploadSampleToR2(file: File): Promise<string> {
    const MAX_MB = 25;
    if (file.size > MAX_MB * 1024 * 1024) {
      throw new Error(`File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Please trim your recording to under ${MAX_MB} MB.`);
    }
    setUploadingR2(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "wav";
      const formData = new FormData();
      formData.append("file", file);
      formData.append("prefix", "voice-samples");
      formData.append("ext", ext);

      const res = await fetch("/api/r2-upload", { method: "POST", body: formData });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error ?? `Upload failed (${res.status})`);
      }
      const { publicUrl, key } = await res.json() as { publicUrl: string | null; key: string };

      // publicUrl is null when R2_PUBLIC_URL env var is not configured.
      // Fall back to the object key so the clone route can fetch via presigned GET.
      if (!publicUrl) {
        throw new Error(
          "R2_PUBLIC_URL is not set — RunPod cannot reach the sample without a public URL. " +
          "Add R2_PUBLIC_URL to your environment variables."
        );
      }

      return publicUrl;
    } finally {
      setUploadingR2(false);
    }
  }

  // ── Clone voice ────────────────────────────────────────────────────────────

  async function handleClone() {
    if (!sampleFile) return;
    setCloning(true);
    setCloneError(null);
    try {
      const sampleUrl = await uploadSampleToR2(sampleFile);
      const ext = sampleFile.name.split(".").pop()?.toLowerCase() ?? "wav";

      // Submit job — returns immediately
      const submitRes = await fetch("/api/voice/clone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sampleUrl, ext }),
      });
      const submitJson = await submitRes.json() as { runpodJobId?: string; error?: string };
      if (!submitRes.ok || submitJson.error) throw new Error(submitJson.error ?? `Clone submit failed (${submitRes.status})`);

      // Poll finalize until done
      const runpodJobId = submitJson.runpodJobId!;
      for (let attempt = 0; attempt < 150; attempt++) {
        await new Promise<void>((r) => setTimeout(r, 4000));
        const pollRes = await fetch("/api/voice/clone/finalize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runpodJobId }),
        });
        const poll = await pollRes.json() as { status: string; voiceId?: string; durationSec?: number; error?: string };
        if (poll.status === "COMPLETED") {
          setVoiceId(poll.voiceId!);
          setVoiceDurationSec(poll.durationSec ?? null);
          persist(poll.voiceId!, poll.durationSec ?? null, chapters);
          return;
        }
        if (poll.status === "FAILED") throw new Error(poll.error ?? "Clone failed");
        // IN_QUEUE / IN_PROGRESS — keep polling
      }
      throw new Error("Voice clone timed out after 10 minutes. The GPU worker may still be cold-starting — try again.");
    } catch (err) {
      setCloneError(err instanceof Error ? err.message : "Clone failed");
    } finally {
      setCloning(false);
    }
  }

  // ── Narrate a single chapter ───────────────────────────────────────────────

  const narrateChapter = useCallback(async (
    ch: ChapterDraft,
    currentVoiceId: string,
    currentChapters: ChapterNarration[],
    setChaptersFn: React.Dispatch<React.SetStateAction<ChapterNarration[]>>,
  ): Promise<ChapterNarration[]> => {
    const id = makeChapterId(ch);
    const updateStatus = (partial: Partial<ChapterNarration>, list: ChapterNarration[]): ChapterNarration[] =>
      list.map((c) => (c.chapterId === id ? { ...c, ...partial } : c));

    let updated = updateStatus({ status: "synthesizing", error: null }, currentChapters);
    setChaptersFn(updated);

    try {
      const text = buildChapterText(ch);

      // Submit job — returns immediately
      const submitRes = await fetch("/api/voice/narrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voiceId: currentVoiceId, chapterId: id, slug: bookSlug, language, speed }),
      });
      const submitJson = await submitRes.json() as { runpodJobId?: string; error?: string };
      if (!submitRes.ok || submitJson.error) throw new Error(submitJson.error ?? `Narrate submit failed (${submitRes.status})`);

      // Poll finalize until done
      const runpodJobId = submitJson.runpodJobId!;
      for (let attempt = 0; attempt < 150; attempt++) {
        await new Promise<void>((r) => setTimeout(r, 4000));
        const pollRes = await fetch("/api/voice/narrate/finalize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runpodJobId, chapterId: id, slug: bookSlug }),
        });
        const poll = await pollRes.json() as { status: string; audioUrl?: string; durationSec?: number; error?: string };
        if (poll.status === "COMPLETED") {
          updated = updateStatus({ status: "done", audioUrl: poll.audioUrl!, durationSec: poll.durationSec ?? null }, updated);
          break;
        }
        if (poll.status === "FAILED") throw new Error(poll.error ?? "Narration failed");
        // IN_QUEUE / IN_PROGRESS — keep polling
        if (attempt === 149) throw new Error("Narration timed out after 10 minutes");
      }
    } catch (err) {
      updated = updateStatus({ status: "error", error: err instanceof Error ? err.message : "Narration failed" }, updated);
    }

    setChaptersFn(updated);
    return updated;
  }, [bookSlug, language, speed]);

  // ── Narrate all pending chapters sequentially ─────────────────────────────

  async function handleNarrateAll() {
    if (!voiceId) return;
    abortRef.current = false;
    setNarrating(true);

    // Queue all non-done chapters
    let currentChapters = chapters.map((c) =>
      c.status === "done" ? c : { ...c, status: "queued" as NarrateStatus }
    );
    setChapters(currentChapters);

    try {
      for (const ch of manifest.chapters) {
        if (abortRef.current) break;
        const chNarration = currentChapters.find((c) => c.chapterId === makeChapterId(ch));
        if (chNarration?.status === "done") continue;

        currentChapters = await narrateChapter(ch, voiceId, currentChapters, setChapters);
        persist(voiceId, voiceDurationSec, currentChapters);
      }
    } finally {
      setNarrating(false);
      abortRef.current = false;
    }
  }

  // ── Narrate single chapter ────────────────────────────────────────────────

  async function handleNarrateOne(ch: ChapterDraft) {
    if (!voiceId) return;
    const updated = await narrateChapter(ch, voiceId, chapters, setChapters);
    persist(voiceId, voiceDurationSec, updated);
  }

  // ── UI ─────────────────────────────────────────────────────────────────────

  const doneCount = chapters.filter((c) => c.status === "done").length;
  const hasAnyDone = doneCount > 0;
  const hasVoice = Boolean(voiceId);

  return (
    <div className="rounded-2xl border border-purple-500/15 bg-slate-900/60 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-purple-500/10">
        <div>
          <div className="flex items-center gap-2">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-4 w-4 text-purple-400">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <h3 className="text-sm font-semibold text-purple-300 uppercase tracking-widest">Voice Studio</h3>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">Clone your voice and narrate the full audiobook.</p>
        </div>
        {hasVoice && (
          <div className="flex items-center gap-1.5 rounded-lg border border-emerald-400/20 bg-emerald-400/8 px-2.5 py-1">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[11px] font-semibold text-emerald-300">
              Voice cloned{voiceDurationSec ? ` · ${formatDuration(voiceDurationSec)} sample` : ""}
            </span>
          </div>
        )}
      </div>

      <div className="p-4 space-y-5">
        {/* ── Step 1: Upload voice sample ── */}
        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
            Step 1 — Upload Your Voice Sample
          </p>
          <p className="text-xs text-slate-400">
            Record yourself reading 30 seconds to 3 minutes of clean, unedited speech in your natural voice.
            No music, minimal background noise. WAV, MP3, M4A, FLAC, or MOV/MP4 (audio track is extracted). Max 25 MB.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,video/*,.mp3,.wav,.m4a,.flac,.aac,.ogg,.mov,.mp4"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setSampleFile(f);
                setCloneError(null);
              }}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={cloning || narrating}
              className="min-h-[48px] flex items-center gap-2 rounded-xl border border-slate-600 bg-slate-800 px-4 text-sm text-slate-200 hover:bg-slate-700 disabled:opacity-50 transition"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-4 w-4">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {sampleFile ? sampleFile.name : "Choose audio file"}
            </button>

            <button
              type="button"
              onClick={() => void handleClone()}
              disabled={!sampleFile || cloning || uploadingR2 || narrating}
              className={[
                "min-h-[48px] rounded-xl px-5 text-sm font-semibold transition-all active:scale-[0.98]",
                sampleFile && !cloning
                  ? "bg-gradient-to-r from-purple-500 to-violet-500 text-white hover:opacity-90"
                  : "bg-slate-700/50 text-slate-500 cursor-not-allowed",
              ].join(" ")}
            >
              {uploadingR2 ? "Uploading…" : cloning ? "Cloning voice…" : hasVoice ? "Re-clone voice" : "Clone Voice"}
            </button>
          </div>
          {cloneError && (
            <p className="text-xs text-red-400 rounded-lg border border-red-400/20 bg-red-400/5 px-3 py-2">{cloneError}</p>
          )}
        </div>

        {/* ── Step 2: Narration settings ── */}
        {hasVoice && (
          <div className="space-y-3 border-t border-slate-700/40 pt-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Step 2 — Narration Settings</p>

            <div className="flex flex-wrap gap-4">
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-slate-500">Language</label>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  disabled={narrating}
                  className="min-h-[48px] rounded-xl border border-slate-600 bg-slate-800 px-3 text-sm text-slate-200 focus:border-purple-500 focus:outline-none disabled:opacity-50"
                >
                  <option value="en">English</option>
                  <option value="es">Spanish</option>
                  <option value="fr">French</option>
                  <option value="de">German</option>
                  <option value="pt">Portuguese</option>
                  <option value="it">Italian</option>
                  <option value="nl">Dutch</option>
                  <option value="pl">Polish</option>
                  <option value="tr">Turkish</option>
                  <option value="ru">Russian</option>
                  <option value="zh-cn">Chinese (Simplified)</option>
                  <option value="ja">Japanese</option>
                  <option value="ko">Korean</option>
                  <option value="ar">Arabic</option>
                  <option value="cs">Czech</option>
                  <option value="hu">Hungarian</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-slate-500">
                  Speed — {speed.toFixed(1)}x
                </label>
                <input
                  type="range"
                  min={0.5}
                  max={1.5}
                  step={0.05}
                  value={speed}
                  onChange={(e) => setSpeed(parseFloat(e.target.value))}
                  disabled={narrating}
                  className="mt-3 w-36 accent-purple-500 disabled:opacity-50"
                />
              </div>
            </div>

            {/* Narrate all button */}
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void handleNarrateAll()}
                disabled={narrating}
                className={[
                  "min-h-[48px] rounded-xl px-5 text-sm font-semibold transition-all active:scale-[0.98]",
                  !narrating
                    ? "bg-gradient-to-r from-purple-500 to-violet-500 text-white hover:opacity-90"
                    : "bg-slate-700/50 text-slate-500 cursor-not-allowed",
                ].join(" ")}
              >
                {narrating
                  ? `Narrating… (${doneCount}/${chapters.length})`
                  : hasAnyDone
                  ? `Re-narrate Missing (${chapters.length - doneCount} remaining)`
                  : `Narrate All ${chapters.length} Chapters`}
              </button>
              {narrating && (
                <button
                  type="button"
                  onClick={() => { abortRef.current = true; }}
                  className="min-h-[48px] rounded-xl border border-red-400/30 bg-red-400/8 px-4 text-sm font-semibold text-red-300 hover:bg-red-400/15 transition"
                >
                  Stop
                </button>
              )}
              {hasAnyDone && (
                <span className="text-xs text-slate-500">{doneCount} of {chapters.length} chapters narrated</span>
              )}
            </div>
          </div>
        )}

        {/* ── Chapter list ── */}
        {hasVoice && chapters.length > 0 && (
          <div className="border-t border-slate-700/40 pt-4 space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Chapters</p>
            {chapters.map((narr, i) => {
              const ch = manifest.chapters[i];
              return (
                <div
                  key={narr.chapterId}
                  className="rounded-xl border border-slate-700/40 bg-slate-950/50 p-3 space-y-2"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <StatusDot status={narr.status} />
                      <span className="text-sm font-medium text-slate-200 truncate">{narr.title}</span>
                      {narr.durationSec && (
                        <span className="text-[10px] text-slate-500 tabular-nums shrink-0">{formatDuration(narr.durationSec)}</span>
                      )}
                    </div>
                    {narr.status !== "synthesizing" && narr.status !== "queued" && (
                      <button
                        type="button"
                        onClick={() => ch && void handleNarrateOne(ch)}
                        disabled={narrating || !ch}
                        className="min-h-[44px] min-w-[44px] flex shrink-0 items-center justify-center rounded-xl border border-purple-500/20 bg-purple-500/8 text-xs text-purple-300 hover:bg-purple-500/15 disabled:opacity-40 transition"
                        title={narr.status === "done" ? "Re-narrate" : "Narrate"}
                      >
                        {narr.status === "done" ? (
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-4 w-4">
                            <path d="M1 4v6h6M23 20v-6h-6" strokeLinecap="round" strokeLinejoin="round" />
                            <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        ) : (
                          <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
                            <path d="M8 5v14l11-7z" />
                          </svg>
                        )}
                      </button>
                    )}
                  </div>

                  {/* Error message */}
                  {narr.error && (
                    <p className="text-[11px] text-red-400 px-1">{narr.error}</p>
                  )}

                  {/* Audio player */}
                  {narr.audioUrl && narr.status === "done" && (
                    <audio
                      src={narr.audioUrl}
                      controls
                      controlsList="nodownload"
                      className="w-full h-10 rounded-lg"
                      style={{ colorScheme: "dark" }}
                    />
                  )}

                  {/* Progress indicator */}
                  {(narr.status === "synthesizing" || narr.status === "queued") && (
                    <div className="flex items-center gap-2 px-1">
                      <div className="h-1.5 flex-1 rounded-full bg-slate-700 overflow-hidden">
                        <div className={[
                          "h-full rounded-full",
                          narr.status === "synthesizing"
                            ? "bg-purple-500 animate-pulse w-full"
                            : "bg-slate-600 w-1/4",
                        ].join(" ")} />
                      </div>
                      <span className="text-[10px] text-slate-500 shrink-0">
                        {narr.status === "synthesizing" ? "Synthesizing…" : "Queued"}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── Download all ── */}
        {hasAnyDone && (
          <div className="border-t border-slate-700/40 pt-3">
            <p className="text-[10px] text-slate-500">
              Audio files are stored in your Cloudflare R2 bucket under{" "}
              <code className="text-purple-300/80">audio/books/{bookSlug}/</code>.
              You can link to them directly or download via the R2 dashboard.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Status dot ─────────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: NarrateStatus }) {
  const cls = {
    idle:        "bg-slate-600",
    queued:      "bg-yellow-500",
    synthesizing:"bg-purple-400 animate-pulse",
    done:        "bg-emerald-400",
    error:       "bg-red-400",
  }[status];
  return <span className={`shrink-0 h-2 w-2 rounded-full ${cls}`} />;
}
