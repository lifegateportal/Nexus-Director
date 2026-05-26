"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { EbookPipeline } from "@/app/components/EbookPipeline";
import { EbookProjectsPanel } from "@/app/components/EbookProjectsPanel";
import { AssistantPanel } from "@/app/components/AssistantPanel";
import { SiteConfigSchema } from "@/lib/schemas/site-config";
import { EbookManifestSchema, EbookJobStateSchema } from "@/lib/schemas/ebook";
import type { EbookManifest, EbookJobState } from "@/lib/schemas/ebook";
import type { SiteConfig } from "@/lib/schemas/site-config";
import type { EbookPipelineSnapshot } from "@/app/components/EbookPipeline";
import {
  listEbookProjects,
  saveEbookProject,
  deleteEbookProject,
  generateEbookProjectId,
} from "@/lib/ebook-project-store";
import type { EbookProject } from "@/lib/ebook-project-store";

const JOB_STATE_KEY = "nexus_ebook_job_state";

export default function EbookPage() {
  const [ebookManifest, setEbookManifest] = useState<EbookManifest | null>(null);
  const [ebookPipelineSnapshot, setEbookPipelineSnapshot] = useState<EbookPipelineSnapshot | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [projectsPanelOpen, setProjectsPanelOpen] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const [siteConfig] = useState<SiteConfig>(() => SiteConfigSchema.parse({}));
  const importInputRef = useRef<HTMLInputElement>(null);

  // Project persistence
  const [projects, setProjects] = useState<EbookProject[]>([]);
  const [currentProjectId, setCurrentProjectId] = useState<string>("");
  // Incrementing this key remounts <EbookPipeline> so it re-reads localStorage on load
  const [pipelineKey, setPipelineKey] = useState(0);

  useEffect(() => {
    void listEbookProjects().then(setProjects).catch(() => {});
  }, []);

  const suggestedName = ebookPipelineSnapshot?.bookTitle ?? ebookManifest?.bookTitle ?? "";
  const canSave = ebookPipelineSnapshot !== null || ebookManifest !== null;

  const handleSaveProject = useCallback(async (name: string) => {
    try {
      const raw = localStorage.getItem(JOB_STATE_KEY);
      if (!raw) return;
      const jobState = EbookJobStateSchema.parse(JSON.parse(raw) as unknown);
      const id = currentProjectId || generateEbookProjectId();
      const project: EbookProject = {
        id,
        name,
        createdAt: currentProjectId
          ? (projects.find((p) => p.id === id)?.createdAt ?? new Date().toISOString())
          : new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        bookTitle: jobState.architecture?.bookTitle ?? name,
        chapterCount: jobState.chapters?.length ?? 0,
        totalWordCount: (jobState.chapters ?? []).reduce((s, c) => s + (c.totalWordCount ?? 0), 0),
        status: jobState.status,
        jobState,
      };
      await saveEbookProject(project);
      setCurrentProjectId(id);
      setProjects(await listEbookProjects());
      setImportSuccess(`"${name}" saved.`);
      setImportError(null);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Save failed.");
      setImportSuccess(null);
    }
  }, [currentProjectId, projects]);

  const handleLoadProject = useCallback((id: string) => {
    const p = projects.find((proj) => proj.id === id);
    if (!p) return;
    try {
      localStorage.setItem(JOB_STATE_KEY, JSON.stringify(p.jobState));
      setCurrentProjectId(p.id);
      setEbookManifest(null);
      setProjectsPanelOpen(false);
      setImportSuccess(`"${p.name}" loaded — resuming pipeline.`);
      setImportError(null);
      // Remount pipeline so it picks up the restored localStorage state
      setPipelineKey((k) => k + 1);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Load failed.");
    }
  }, [projects]);

  const handleDeleteProject = useCallback(async (id: string) => {
    await deleteEbookProject(id);
    setProjects(await listEbookProjects());
    if (currentProjectId === id) setCurrentProjectId("");
  }, [currentProjectId]);

  const handleImportProject = useCallback(async (project: EbookProject) => {
    await saveEbookProject(project);
    setProjects(await listEbookProjects());
    setImportSuccess(`"${project.name}" imported.`);
    setImportError(null);
  }, []);

  const buildManifestFromJob = useCallback((job: EbookJobState): EbookManifest | null => {
    if (!job.architecture || !job.frontMatter || !job.contentMap) return null;
    return {
      jobId: job.jobId,
      bookTitle: job.architecture.bookTitle,
      subtitle: job.architecture.subtitle,
      authorName: job.architecture.authorName,
      frontMatter: job.frontMatter,
      chapters: job.chapters ?? [],
      totalWordCount: (job.chapters ?? []).reduce((sum, chapter) => sum + (chapter.totalWordCount ?? 0), 0),
      allQuotes: job.contentMap.allQuotes ?? [],
      generatedAt: new Date().toISOString(),
    };
  }, []);

  const handleManifestReady = useCallback((manifest: EbookManifest) => {
    setEbookManifest(manifest);
  }, []);

  const handleEbookUpdate = useCallback((manifest: EbookManifest) => {
    setEbookManifest(manifest);
  }, []);

  const handlePipelineSnapshotChange = useCallback((snapshot: EbookPipelineSnapshot | null) => {
    setEbookPipelineSnapshot(snapshot);
  }, []);

  const handleExportJson = useCallback(() => {
    if (!ebookManifest) return;
    const blob = new Blob([JSON.stringify({ ebookManifest }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${ebookManifest.bookTitle.replace(/[^a-z0-9]/gi, "_").toLowerCase()}_ebook_manifest.json`;
    link.click();
    URL.revokeObjectURL(url);
  }, [ebookManifest]);

  const handleImportJson = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const raw = JSON.parse((ev.target?.result as string) ?? "") as unknown;
        const wrapped = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
        const candidateManifest = wrapped?.manifest ?? wrapped?.ebookManifest ?? raw;
        const candidateJobState = wrapped?.job ?? wrapped?.jobState ?? raw;

        const directManifest = EbookManifestSchema.safeParse(candidateManifest);
        if (directManifest.success) {
          setEbookManifest(directManifest.data);
          setImportError(null);
          setImportSuccess(`Imported "${directManifest.data.bookTitle}".`);
          setAssistantOpen(true);
          return;
        }

        const jobState = EbookJobStateSchema.safeParse(candidateJobState);
        if (jobState.success) {
          const manifest = buildManifestFromJob(jobState.data);
          if (!manifest) throw new Error("Job JSON is valid but missing completed book data.");
          setEbookManifest(manifest);
          setImportError(null);
          setImportSuccess(`Imported completed job "${manifest.bookTitle}".`);
          setAssistantOpen(true);
          return;
        }

        throw new Error("Unsupported JSON format. Import a Nexus ebook manifest or completed ebook job export.");
      } catch (err) {
        setImportSuccess(null);
        setImportError(err instanceof Error ? err.message : "Could not import JSON.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }, [buildManifestFromJob]);

  return (
    <main className="min-h-dvh bg-slate-950 text-slate-100">
      {/* Page header */}
      <div className="sticky top-0 z-10 border-b border-slate-800/80 bg-slate-950/90 backdrop-blur-md px-4 py-3 lg:px-8">
        <div className="mx-auto max-w-3xl flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-cyan-500/15 ring-1 ring-cyan-400/30"
              style={{ boxShadow: "0 0 14px rgba(6,182,212,0.20)" }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-5 w-5 text-cyan-400">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M9 7h7M9 11h5" strokeLinecap="round" />
              </svg>
            </div>
            <div>
              <h1 className="text-sm font-bold text-slate-100 leading-none">Ebook Production Studio</h1>
              <p className="text-[11px] text-slate-400 mt-0.5">Audio → Voice DNA → Chapters → PDF + EPUB</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Projects toggle */}
            <button
              type="button"
              onClick={() => setProjectsPanelOpen((o) => !o)}
              className={`flex items-center gap-2 min-h-[44px] rounded-xl border px-3.5 py-2 text-xs font-semibold transition active:scale-[0.97] ${projectsPanelOpen ? "border-cyan-500/50 bg-cyan-500/10 text-cyan-300" : "border-slate-700 bg-slate-900/70 text-slate-300 hover:border-cyan-500/50 hover:text-cyan-300"}`}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-4 w-4">
                <rect x="2" y="7" width="20" height="14" rx="2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="hidden sm:inline">Projects</span>
              {projects.length > 0 && (
                <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-cyan-500/25 px-1 text-[10px] font-bold text-cyan-300">
                  {projects.length}
                </span>
              )}
            </button>

            {/* Nexus Director AI button — appears once production completes */}
            {ebookManifest && (
              <>
                <button
                  type="button"
                  onClick={() => setAssistantOpen(true)}
                  className="flex items-center gap-2 min-h-[44px] rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3.5 py-2 text-xs font-semibold text-cyan-300 transition hover:border-cyan-400/60 hover:bg-cyan-500/15 active:scale-[0.97]"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-4 w-4">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
                    <path d="M9 12h6M12 9v6" strokeLinecap="round" />
                  </svg>
                  <span className="hidden sm:inline">Director AI</span>
                </button>
                <button
                  type="button"
                  onClick={handleExportJson}
                  className="flex items-center gap-2 min-h-[44px] rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2 text-xs font-semibold text-emerald-300 transition hover:border-emerald-400/60 hover:bg-emerald-500/15 active:scale-[0.97]"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-4 w-4">
                    <path d="M12 3v12" strokeLinecap="round" />
                    <polyline points="17 12 12 17 7 12" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M3 17v2a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2" strokeLinecap="round" />
                  </svg>
                  <span className="hidden sm:inline">Export</span>
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => importInputRef.current?.click()}
              className="flex items-center gap-2 min-h-[44px] rounded-xl border border-slate-700 bg-slate-900/70 px-3.5 py-2 text-xs font-semibold text-slate-300 transition hover:border-cyan-500/50 hover:text-cyan-300 active:scale-[0.97]"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-4 w-4">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" strokeLinecap="round" strokeLinejoin="round" />
                <polyline points="17 8 12 3 7 8" strokeLinecap="round" strokeLinejoin="round" />
                <line x1="12" y1="3" x2="12" y2="15" strokeLinecap="round" />
              </svg>
              <span className="hidden sm:inline">Import</span>
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={handleImportJson}
            />
          </div>
        </div>
      </div>

      {(importError || importSuccess) && (
        <div className="mx-auto mt-3 max-w-3xl px-4 lg:px-8">
          {importError && (
            <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{importError}</p>
          )}
          {importSuccess && (
            <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">{importSuccess}</p>
          )}
        </div>
      )}

      {/* Projects panel — slides in below header */}
      {projectsPanelOpen && (
        <div className="mx-auto mt-4 max-w-3xl px-4 lg:px-8">
          <EbookProjectsPanel
            projects={projects}
            suggestedName={suggestedName}
            canSave={canSave}
            onSave={handleSaveProject}
            onLoad={handleLoadProject}
            onDelete={handleDeleteProject}
            onImport={handleImportProject}
          />
        </div>
      )}

      {/* Pipeline */}
      <div className="mx-auto max-w-3xl px-4 pt-5 pb-[max(env(safe-area-inset-bottom),1.5rem)] lg:px-8 lg:pt-6">
        <EbookPipeline
          key={pipelineKey}
          ebookManifest={ebookManifest}
          onManifestReady={handleManifestReady}
          onPipelineSnapshotChange={handlePipelineSnapshotChange}
        />
      </div>

      {/* Nexus Director AI — ebook post-production assistant */}
      <AssistantPanel
        isOpen={assistantOpen}
        onClose={() => setAssistantOpen(false)}
        academy={null}
        onUpdate={() => {}}
        siteConfig={siteConfig}
        onSiteUpdate={() => {}}
        ebookManifest={ebookManifest}
        onEbookUpdate={handleEbookUpdate}
        ebookPipelineSnapshot={ebookPipelineSnapshot}
      />
    </main>
  );
}

