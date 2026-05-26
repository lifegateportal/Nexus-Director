"use client";

import { useRef, useState, useEffect } from "react";
import type { EbookProject } from "@/lib/ebook-project-store";
import type { EbookJobState, EbookManifest } from "@/lib/schemas/ebook";
import { EbookManifestSchema, EbookJobStateSchema } from "@/lib/schemas/ebook";

type EbookProjectsPanelProps = {
  projects: EbookProject[];
  suggestedName: string;
  canSave: boolean;
  onSave: (name: string) => void;
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
  onImport: (project: EbookProject) => void;
  /** Called with the parsed job state so the page can build a manifest from it */
  onImportManifestJson?: (job: EbookJobState) => EbookManifest | null;
  /** Called when a manifest/job JSON is successfully parsed from a device file */
  onManifestLoaded?: (manifest: EbookManifest) => void;
};

function exportProject(p: EbookProject) {
  const json = JSON.stringify(p, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `${p.name.replace(/[^a-z0-9]/gi, "_").toLowerCase()}_ebook.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function EbookProjectsPanel({
  projects,
  suggestedName,
  canSave,
  onSave,
  onLoad,
  onDelete,
  onImport,
  onImportManifestJson,
  onManifestLoaded,
}: EbookProjectsPanelProps) {
  const [name, setName] = useState(suggestedName);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const projectFileRef = useRef<HTMLInputElement>(null);
  const manifestFileRef = useRef<HTMLInputElement>(null);

  // Keep the name input in sync when the pipeline produces a title
  useEffect(() => {
    if (suggestedName && !name) setName(suggestedName);
  }, [suggestedName, name]);

  function handleProjectFileImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string) as EbookProject;
        if (!parsed.id || !parsed.name || !parsed.jobState) throw new Error("Invalid ebook project file.");
        onImport({
          ...parsed,
          id: `ebook-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          updatedAt: new Date().toISOString(),
        });
        setImportSuccess(`"${parsed.name}" imported into saved projects.`);
        setImportError(null);
      } catch {
        setImportError("Could not read file — make sure it's a valid Nexus ebook project export.");
        setImportSuccess(null);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  function handleManifestFileImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const raw = JSON.parse((ev.target?.result as string) ?? "") as unknown;
        const wrapped = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;

        // Try: direct manifest, wrapped manifest, or wrapped job state
        const candidateManifest = wrapped?.manifest ?? wrapped?.ebookManifest ?? raw;
        const candidateJob      = wrapped?.job ?? wrapped?.jobState ?? raw;

        const manifestParse = EbookManifestSchema.safeParse(candidateManifest);
        if (manifestParse.success) {
          onManifestLoaded?.(manifestParse.data);
          setImportSuccess(`"${manifestParse.data.bookTitle}" loaded into pipeline.`);
          setImportError(null);
          return;
        }

        const jobParse = EbookJobStateSchema.safeParse(candidateJob);
        if (jobParse.success && onImportManifestJson) {
          const manifest = onImportManifestJson(jobParse.data);
          if (!manifest) throw new Error("Job file is valid but book is not yet complete.");
          onManifestLoaded?.(manifest);
          setImportSuccess(`"${manifest.bookTitle}" loaded into pipeline.`);
          setImportError(null);
          return;
        }

        throw new Error("Unsupported file format — import a Nexus ebook manifest or saved project JSON.");
      } catch (err) {
        setImportError(err instanceof Error ? err.message : "Could not import file.");
        setImportSuccess(null);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  return (
    <div className="flex flex-col gap-5 rounded-2xl border border-slate-700/60 bg-slate-900/80 backdrop-blur-sm p-5">

      {/* ── Status messages ─────────────────────────────────────────────── */}
      {importError && (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">{importError}</p>
      )}
      {importSuccess && (
        <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-400">{importSuccess}</p>
      )}

      {/* ── Save current book ────────────────────────────────────────────── */}
      <div>
        <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">Save Current Book</p>
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter a name for this book project…"
            className="min-h-12 flex-1 rounded-xl border border-slate-600 bg-slate-800/60 px-4 text-base text-slate-100 placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
          />
          <button
            onClick={() => { if (name.trim()) onSave(name.trim()); }}
            disabled={!name.trim()}
            className="min-h-12 rounded-xl bg-cyan-600 px-6 text-sm font-semibold text-white transition hover:bg-cyan-500 disabled:opacity-40"
          >
            Save
          </button>
        </div>
        <p className="mt-1.5 text-[11px] text-slate-600">Saves your pipeline progress to this device. Resume any time.</p>
      </div>

      {/* ── Import from device ───────────────────────────────────────────── */}
      <div>
        <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">Import from Device</p>
        <div className="flex gap-2">
          <button
            onClick={() => projectFileRef.current?.click()}
            className="flex flex-1 min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-600 bg-slate-800/40 text-sm font-semibold text-slate-300 transition hover:border-cyan-500/50 hover:text-cyan-300 active:scale-[0.97]"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-4 w-4 shrink-0">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" strokeLinecap="round" strokeLinejoin="round" />
              <polyline points="17 8 12 3 7 8" strokeLinecap="round" strokeLinejoin="round" />
              <line x1="12" y1="3" x2="12" y2="15" strokeLinecap="round" />
            </svg>
            Import Project File
          </button>
          {onManifestLoaded && (
            <button
              onClick={() => manifestFileRef.current?.click()}
              className="flex flex-1 min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-600 bg-slate-800/40 text-sm font-semibold text-slate-300 transition hover:border-cyan-500/50 hover:text-cyan-300 active:scale-[0.97]"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-4 w-4 shrink-0">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Load Manifest JSON
            </button>
          )}
        </div>
        <p className="mt-1.5 text-[11px] text-slate-600">
          Import Project File — restores a full project (all pipeline stages).
          {onManifestLoaded && " Load Manifest JSON — loads a completed ebook export into the pipeline."}
        </p>
        <input ref={projectFileRef}  type="file" accept=".json,application/json" className="hidden" onChange={handleProjectFileImport} />
        <input ref={manifestFileRef} type="file" accept=".json,application/json" className="hidden" onChange={handleManifestFileImport} />
      </div>

      {/* ── Saved project list ───────────────────────────────────────────── */}
      <div>
        <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">
          Saved Books {projects.length > 0 && `· ${projects.length}`}
        </p>
        {projects.length === 0 ? (
          <div className="rounded-xl border border-slate-700/40 bg-slate-800/20 p-6 text-center">
            <p className="text-sm text-slate-400">No saved books yet.</p>
            <p className="mt-1 text-xs text-slate-600">Complete some pipeline stages, then hit Save above.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {projects.map((p) => (
              <div key={p.id} className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-4">
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-100">{p.name}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {p.chapterCount > 0
                        ? `${p.chapterCount} chapter${p.chapterCount !== 1 ? "s" : ""}`
                        : p.status === "complete" ? "Complete" : p.status}
                      {p.totalWordCount > 0 && ` · ${p.totalWordCount.toLocaleString()} words`}
                      {" · "}
                      {new Date(p.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                    </p>
                  </div>

                  {confirmDelete === p.id ? (
                    <div className="flex shrink-0 gap-1">
                      <button
                        onClick={() => { onDelete(p.id); setConfirmDelete(null); }}
                        className="min-h-8 rounded-lg bg-red-500/20 px-3 text-xs font-semibold text-red-400 transition hover:bg-red-500/30"
                      >
                        Delete
                      </button>
                      <button
                        onClick={() => setConfirmDelete(null)}
                        className="min-h-8 rounded-lg bg-slate-700/50 px-3 text-xs text-slate-400 transition hover:bg-slate-700"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDelete(p.id)}
                      aria-label="Delete project"
                      className="shrink-0 min-h-8 min-w-8 flex items-center justify-center rounded-lg bg-slate-700/30 text-slate-500 transition hover:text-red-400"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-4 w-4">
                        <polyline points="3 6 5 6 21 6" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M10 11v6M14 11v6" strokeLinecap="round" />
                        <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" strokeLinecap="round" />
                      </svg>
                    </button>
                  )}
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => onLoad(p.id)}
                    className="flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg border border-slate-600 text-sm font-semibold text-slate-300 transition hover:border-cyan-500/50 hover:text-cyan-400"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-4 w-4">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" strokeLinecap="round" strokeLinejoin="round" />
                      <polyline points="7 10 12 15 17 10" strokeLinecap="round" strokeLinejoin="round" />
                      <line x1="12" y1="15" x2="12" y2="3" strokeLinecap="round" />
                    </svg>
                    Load
                  </button>
                  <button
                    onClick={() => exportProject(p)}
                    title="Download as JSON file"
                    className="flex min-h-10 min-w-[2.75rem] items-center justify-center rounded-lg border border-slate-600 text-slate-400 transition hover:border-cyan-500/50 hover:text-cyan-300"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-4 w-4">
                      <path d="M12 3v12" strokeLinecap="round" />
                      <polyline points="17 12 12 17 7 12" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M3 17v2a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

