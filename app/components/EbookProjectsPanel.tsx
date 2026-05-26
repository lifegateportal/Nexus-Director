"use client";

import { useRef, useState } from "react";
import type { EbookProject } from "@/lib/ebook-project-store";

type EbookProjectsPanelProps = {
  projects: EbookProject[];
  suggestedName: string;
  canSave: boolean;
  onSave: (name: string) => void;
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
  onImport: (project: EbookProject) => void;
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
}: EbookProjectsPanelProps) {
  const [name, setName] = useState(suggestedName);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFileImport(e: React.ChangeEvent<HTMLInputElement>) {
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
        setImportError(null);
      } catch {
        setImportError("Could not read file — make sure it's a valid Nexus ebook project export.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto rounded-2xl border border-slate-700/60 bg-slate-900/80 backdrop-blur-sm p-5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Ebook Projects</p>
          <h2 className="text-lg font-bold text-slate-100">Saved Books</h2>
        </div>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex min-h-10 items-center gap-1.5 rounded-xl border border-slate-600 px-3 text-xs font-semibold text-slate-400 transition hover:border-cyan-500/50 hover:text-cyan-300"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-4 w-4">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" strokeLinecap="round" strokeLinejoin="round" />
            <polyline points="17 8 12 3 7 8" strokeLinecap="round" strokeLinejoin="round" />
            <line x1="12" y1="3" x2="12" y2="15" strokeLinecap="round" />
          </svg>
          Import
        </button>
        <input ref={fileInputRef} type="file" accept=".json,application/json" className="hidden" onChange={handleFileImport} />
      </div>

      {importError && (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">{importError}</p>
      )}

      {/* Save current book */}
      {canSave && (
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Book project name…"
            className="min-h-12 flex-1 rounded-xl border border-slate-600 bg-slate-800/60 px-4 text-base text-slate-100 placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
          />
          <button
            onClick={() => { if (name.trim()) { onSave(name.trim()); } }}
            disabled={!name.trim()}
            className="min-h-12 rounded-xl bg-cyan-600 px-5 text-sm font-semibold text-white transition hover:bg-cyan-500 disabled:opacity-40"
          >
            Save
          </button>
        </div>
      )}

      {/* Project list */}
      {projects.length === 0 ? (
        <div className="rounded-xl border border-slate-700/40 bg-slate-800/20 p-6 text-center">
          <p className="text-sm text-slate-400">No saved books yet.</p>
          <p className="mt-1 text-xs text-slate-600">Start the pipeline, then save your progress here to resume later.</p>
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
                    {new Date(p.updatedAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
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
                  title="Export as JSON"
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
  );
}
