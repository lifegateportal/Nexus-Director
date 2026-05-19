"use client";

import { useState, useCallback, useRef } from "react";
import type { LogEntry, PipelineStage } from "@/lib/types";
import { IngestResultSchema, type IngestResult } from "@/lib/schemas/blueprint";
import { storeVideoBlob } from "@/lib/video-store";

type UploadedFile = { name: string; size: number; type: string; content: string; raw?: File };

type MediaUploadProps = {
  onLog: (entry: Omit<LogEntry, "id" | "timestamp">) => void;
  onBlueprint: (data: IngestResult, sourceText: string) => void;
  onStageChange: (stage: PipelineStage) => void;
};

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

const TEXT_EXTS = [".txt", ".json", ".md", ".log", ".csv", ".xml", ".yaml", ".yml", ".ts", ".js"];

function readFile(file: File): Promise<UploadedFile> {
  return new Promise((resolve) => {
    const isText =
      file.type.startsWith("text/") || TEXT_EXTS.some((ext) => file.name.endsWith(ext));

    if (isText && file.size < 5 * 1024 * 1024) {
      const reader = new FileReader();
      reader.onload = (e) =>
        resolve({ name: file.name, size: file.size, type: file.type, content: (e.target?.result as string) ?? "" });
      reader.onerror = () =>
        resolve({ name: file.name, size: file.size, type: file.type, content: `[read error: ${file.name}]` });
      reader.readAsText(file);
    } else if (file.type.startsWith("video/") || file.type.startsWith("audio/")) {
      const url = URL.createObjectURL(file);
      const el = document.createElement(file.type.startsWith("video/") ? "video" : "audio");
      el.src = url;
      el.onloadedmetadata = () => {
        const durationSecs = Math.round(el.duration) || 0;
        URL.revokeObjectURL(url);
        storeVideoBlob(file, durationSecs).catch(console.error);
        const mins = Math.floor(durationSecs / 60);
        const secs = durationSecs % 60;
        resolve({
          name: file.name,
          size: file.size,
          type: file.type,
          raw: file,
          content: `[media: ${file.name} (${file.type}, ${formatBytes(file.size)}, duration: ${mins}m ${secs}s) — awaiting transcription]`
        });
      };
      el.onerror = () => {
        URL.revokeObjectURL(url);
        storeVideoBlob(file, 0).catch(console.error);
        resolve({
          name: file.name,
          size: file.size,
          type: file.type,
          raw: file,
          content: `[media: ${file.name} (${file.type}, ${formatBytes(file.size)}) — awaiting transcription]`
        });
      };
    } else {
      resolve({
        name: file.name,
        size: file.size,
        type: file.type,
        content: `[media: ${file.name} (${file.type || "unknown"}, ${formatBytes(file.size)})]`
      });
    }
  });
}

export function MediaUpload({ onLog, onBlueprint, onStageChange }: MediaUploadProps) {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback(async (raw: FileList | File[]) => {
    const processed = await Promise.all(Array.from(raw).map(readFile));
    setFiles((prev) => {
      const existing = new Set(prev.map((f) => f.name));
      return [...prev, ...processed.filter((f) => !existing.has(f.name))];
    });
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
    },
    [addFiles]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) addFiles(e.target.files);
    },
    [addFiles]
  );

  const removeFile = useCallback((name: string) => {
    setFiles((prev) => prev.filter((f) => f.name !== name));
  }, []);

  const runIngest = useCallback(async () => {
    if (!files.length) return;
    setIsLoading(true);
    setError(null);
    onStageChange("ingesting");

    // Resolve final content for each file — transcribe video/audio via Deepgram
    let resolvedFiles = [...files];
    const mediaFiles = files.filter((f) => f.raw);

    if (mediaFiles.length > 0) {
      onLog({ level: "info", message: `Transcribing ${mediaFiles.length} media file(s) with Deepgram…`, model: "deepseek" });

      // Fetch token first — key never leaves the server
      let deepgramKey: string | null = null;
      try {
        const tokenRes = await fetch("/api/transcribe-token");
        if (tokenRes.ok) {
          const tokenJson = await tokenRes.json() as { apiKey?: string };
          deepgramKey = tokenJson.apiKey ?? null;
        }
      } catch { /* key unavailable */ }

      const transcribed = await Promise.all(
        mediaFiles.map(async (f) => {
          if (!deepgramKey) {
            onLog({ level: "warn", message: `Transcription skipped — DEEPGRAM_API_KEY not configured`, model: "deepseek" });
            return { name: f.name, transcript: null };
          }
          try {
            // Upload directly from browser to Deepgram — bypasses Codespaces proxy size limits
            const res = await fetch(
              "https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&punctuate=true&paragraphs=true&language=en",
              {
                method: "POST",
                headers: {
                  Authorization: `Token ${deepgramKey}`,
                  "Content-Type": f.raw!.type || "audio/mpeg",
                },
                body: f.raw!,
              }
            );
            const json = await res.json() as { results?: { channels?: { alternatives?: { transcript?: string }[] }[] }; err_msg?: string };
            if (!res.ok) throw new Error(json.err_msg ?? `Deepgram ${res.status}`);
            const transcript = json.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";
            if (!transcript.trim()) throw new Error("Empty transcript returned");
            onLog({ level: "success", message: `Transcript ready for "${f.name}" (${transcript.length.toLocaleString()} chars)`, model: "deepseek" });
            return { name: f.name, transcript };
          } catch (err) {
            const msg = err instanceof Error ? err.message : "unknown";
            onLog({ level: "warn", message: `Transcription skipped for "${f.name}": ${msg}`, model: "deepseek" });
            return { name: f.name, transcript: null };
          }
        })
      );
      const tMap = new Map(transcribed.map((t) => [t.name, t.transcript]));
      resolvedFiles = files.map((f) => {
        const tx = tMap.get(f.name);
        return tx ? { ...f, content: `[transcript of ${f.name}]\n\n${tx}` } : f;
      });
    }

    onLog({ level: "info", message: `Sending ${files.length} file(s) to DeepSeek ingest pipeline…`, model: "deepseek" });

    try {
      const sourceText = resolvedFiles
        .map((f) => `--- ${f.name} (${f.type || "unknown"}) ---\n${f.content}`)
        .join("\n\n");

      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceText, locale: "en-US" })
      });

      const json: unknown = await res.json();
      if (!res.ok) {
        const msg = (json as { detail?: string }).detail ?? res.statusText;
        throw new Error(msg);
      }

      const parsed = IngestResultSchema.safeParse(json);
      if (!parsed.success) {
        throw new Error(`Schema validation failed: ${parsed.error.issues[0]?.message}`);
      }

      onLog({ level: "success", message: `Blueprint extracted: "${parsed.data.title}"`, model: "deepseek" });
      onBlueprint(parsed.data, sourceText);
      // Stage management handed to the pipeline orchestrator in page.tsx
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Ingest failed";
      setError(msg);
      onLog({ level: "error", message: `Ingest failed: ${msg}`, model: "gemini" });
      onStageChange("error");
    } finally {
      setIsLoading(false);
    }
  }, [files, onLog, onBlueprint, onStageChange]);

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-700/60 glass shadow-panel">
      <header className="flex flex-shrink-0 items-center gap-2 border-b border-slate-700/50 px-4 py-3">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-4 w-4 text-accent-400">
          <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" strokeLinecap="round" />
          <path d="M12 4v13M8.5 7.5 12 4l3.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <h2 className="text-sm font-semibold uppercase tracking-widest text-slate-300">Feed the Pipeline</h2>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-4">
        {/* Drop zone */}
        <div
          role="button"
          tabIndex={0}
          aria-label="Upload files — drag and drop or tap to browse"
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
          className={[
            "focus-ring flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed transition-colors",
            isDragging
              ? "border-accent-500 bg-accent-500/10"
              : "border-slate-600 bg-shell-800/40 hover:border-slate-500 active:border-accent-500/60"
          ].join(" ")}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="mb-2 h-8 w-8 text-slate-500">
            <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" strokeLinecap="round" />
            <path d="M12 4v13M8.5 7.5 12 4l3.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <p className="text-sm text-slate-400">Drop files or tap to browse</p>
          <p className="mt-0.5 text-xs text-slate-600">Footage · workshops · podcasts</p>
          <input ref={inputRef} id="media-upload-input" type="file" multiple className="sr-only" onChange={handleInputChange} />
        </div>

        {/* File list */}
        {files.length > 0 && (
          <ul className="space-y-1.5">
            {files.map((f) => (
              <li key={f.name} className="flex items-center gap-3 rounded-xl border border-slate-700/50 bg-shell-800/50 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-slate-200">{f.name}</p>
                  <p className="text-xs text-slate-500">{formatBytes(f.size)}</p>
                </div>
                <button
                  type="button"
                  aria-label={`Remove ${f.name}`}
                  onClick={() => removeFile(f.name)}
                  className="focus-ring flex min-h-9 min-w-9 items-center justify-center rounded-lg text-slate-500 transition active:bg-slate-700/50 active:text-red-400"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
                    <path d="M6 6l12 12M6 18L18 6" strokeLinecap="round" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Error banner */}
        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-300">
            {error}
          </div>
        )}
      </div>

      {/* Run button — fixed at bottom */}
      <div className="flex-shrink-0 border-t border-slate-700/50 p-4">
        <button
          type="button"
          disabled={!files.length || isLoading}
          onClick={runIngest}
          className={[
            "focus-ring inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl text-base font-semibold transition active:scale-[0.99]",
            !files.length || isLoading
              ? "cursor-not-allowed bg-slate-700/50 text-slate-500"
              : "bg-accent-500 text-slate-950 shadow-glow"
          ].join(" ")}
        >
          {isLoading ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-400/30 border-t-slate-950" />
              Processing…
            </>
          ) : (
            <>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
                <path d="M5 12h14M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Run Ingest Pipeline
            </>
          )}
        </button>
      </div>
    </section>
  );
}
