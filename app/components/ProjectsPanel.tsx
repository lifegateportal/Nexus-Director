"use client";

import { useState } from "react";
import type { ProjectSnapshot } from "@/lib/project-store";

type ProjectsPanelProps = {
  projects: ProjectSnapshot[];
  suggestedName: string;
  canSave: boolean;
  onSave: (name: string) => void;
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
};

export function ProjectsPanel({
  projects,
  suggestedName,
  canSave,
  onSave,
  onLoad,
  onDelete,
}: ProjectsPanelProps) {
  const [name, setName] = useState(suggestedName);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto rounded-2xl border border-slate-700/60 glass p-5">
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Projects</p>
      <h2 className="text-lg font-bold text-slate-100">Saved Workspaces</h2>

      {/* Save current project */}
      {canSave && (
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Project name…"
            className="min-h-12 flex-1 rounded-xl border border-slate-600 bg-slate-800/60 px-4 text-base text-slate-100 placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
          />
          <button
            onClick={() => { if (name.trim()) onSave(name.trim()); }}
            disabled={!name.trim()}
            className="min-h-12 rounded-xl bg-accent-500 px-5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
          >
            Save
          </button>
        </div>
      )}

      {/* Project list */}
      {projects.length === 0 ? (
        <div className="rounded-xl border border-slate-700/40 bg-slate-800/20 p-6 text-center">
          <p className="text-sm text-slate-400">No saved projects yet.</p>
          <p className="mt-1 text-xs text-slate-600">Run the pipeline, then save your work here to come back to it later.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {projects.map((p) => (
            <div key={p.id} className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-4">
              <div className="mb-3 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-100">{p.name}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {p.academy
                      ? `${p.academy.curriculum.length} module${p.academy.curriculum.length !== 1 ? "s" : ""} · ${p.academy.curriculum.flatMap((m) => m.lessons).length} lessons`
                      : "No academy"}
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

              <button
                onClick={() => onLoad(p.id)}
                className="flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-slate-600 text-sm font-semibold text-slate-300 transition hover:border-cyan-500/50 hover:text-cyan-400"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-4 w-4">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" strokeLinecap="round" strokeLinejoin="round" />
                  <polyline points="7 10 12 15 17 10" strokeLinecap="round" strokeLinejoin="round" />
                  <line x1="12" y1="15" x2="12" y2="3" strokeLinecap="round" />
                </svg>
                Load Project
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
