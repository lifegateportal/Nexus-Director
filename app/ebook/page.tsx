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
const VOICE_STUDIO_STORAGE_PREFIX = "nexus_voice_studio_";

type Tab = "pipeline" | "projects";

export default function EbookPage() {
  const [activeTab, setActiveTab] = useState<Tab>("pipeline");
  const [ebookManifest, setEbookManifest] = useState<EbookManifest | null>(null);
  const [ebookPipelineSnapshot, setEbookPipelineSnapshot] = useState<EbookPipelineSnapshot | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [siteConfig] = useState<SiteConfig>(() => SiteConfigSchema.parse({}));

  // Project persistence
  const [projects, setProjects] = useState<EbookProject[]>([]);
  const [currentProjectId, setCurrentProjectId] = useState<string>("");
  // Incrementing this key remounts <EbookPipeline> so it re-reads localStorage on load
  const [pipelineKey, setPipelineKey] = useState(0);

  useEffect(() => {
    void listEbookProjects().then(setProjects).catch(() => {});
  }, []);

  const suggestedName = ebookPipelineSnapshot?.bookTitle ?? ebookManifest?.bookTitle ?? "";

  const readNarrationUrls = useCallback((jobId: string): Record<string, string> | undefined => {
    try {
      const raw = localStorage.getItem(`${VOICE_STUDIO_STORAGE_PREFIX}${jobId}`);
      if (!raw) return undefined;
      const parsed = JSON.parse(raw) as {
        chapters?: Array<{ chapterId?: string; status?: string; audioUrl?: string | null }>;
      };
      const entries = (parsed.chapters ?? [])
        .filter((chapter): chapter is { chapterId: string; status: string; audioUrl: string } => (
          typeof chapter.chapterId === "string" &&
          chapter.chapterId.length > 0 &&
          chapter.status === "done" &&
          typeof chapter.audioUrl === "string" &&
          chapter.audioUrl.length > 0
        ))
        .map((chapter) => [chapter.chapterId, chapter.audioUrl] as const);

      if (entries.length === 0) return undefined;
      return Object.fromEntries(entries);
    } catch {
      return undefined;
    }
  }, []);

  // ── Project handlers ──────────────────────────────────────────────────────

  const handleSaveProject = useCallback(async (name: string) => {
    try {
      const raw = localStorage.getItem(JOB_STATE_KEY);
      if (!raw) {
        setStatusMsg({ type: "error", text: "Nothing to save yet — start the pipeline first." });
        return;
      }
      const jobState = EbookJobStateSchema.parse(JSON.parse(raw) as unknown);
      const id = currentProjectId || generateEbookProjectId();
      const existing = projects.find((p) => p.id === id);
      const project: EbookProject = {
        id,
        name,
        createdAt: existing?.createdAt ?? new Date().toISOString(),
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
      setStatusMsg({ type: "success", text: `"${name}" saved.` });
      // Sync to R2 as a ProjectSnapshot (fire-and-forget)
      fetch("/api/projects", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project: {
            id: project.id,
            name: project.name,
            createdAt: project.createdAt,
            updatedAt: project.updatedAt,
            academy: null,
            siteConfig: {},
            deliveryInstructions: "",
            chatHistory: [],
            blueprint: null,
            logicResult: null,
            uiResult: null,
            ebookManifest: null,
            ebookJobState: project.jobState,
            publishedSlug: project.publishedSlug,
          },
        }),
      }).catch(() => {});
    } catch (err) {
      setStatusMsg({ type: "error", text: err instanceof Error ? err.message : "Save failed." });
    }
  }, [currentProjectId, projects]);

  const handleLoadProject = useCallback((id: string) => {
    const p = projects.find((proj) => proj.id === id);
    if (!p) return;
    try {
      localStorage.setItem(JOB_STATE_KEY, JSON.stringify(p.jobState));
      setCurrentProjectId(p.id);
      setEbookManifest(null);
      setActiveTab("pipeline");
      setStatusMsg({ type: "success", text: `"${p.name}" loaded — resuming pipeline.` });
      setPipelineKey((k) => k + 1);
    } catch (err) {
      setStatusMsg({ type: "error", text: err instanceof Error ? err.message : "Load failed." });
    }
  }, [projects]);

  const handleDeleteProject = useCallback(async (id: string) => {
    await deleteEbookProject(id);
    setProjects(await listEbookProjects());
    if (currentProjectId === id) setCurrentProjectId("");
    // Remove from R2 (fire-and-forget)
    fetch("/api/projects", {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch(() => {});
  }, [currentProjectId]);

  // ── Unpublish handler ─────────────────────────────────────────────────────

  const handleUnpublish = useCallback(async (project: EbookProject): Promise<boolean> => {
    if (!project.publishedSlug) return false;
    try {
      const res = await fetch("/api/ebook/publish", {
        method:  "DELETE",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ slug: project.publishedSlug }),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        setStatusMsg({ type: "error", text: err.error ?? "Remove from library failed." });
        return false;
      }
      // Clear publishedSlug from local project record
      const updated: EbookProject = { ...project, publishedSlug: undefined };
      await saveEbookProject(updated);
      setProjects(await listEbookProjects());
      setStatusMsg({ type: "success", text: `"${project.name}" removed from the library.` });
      // Sync cleared slug to R2
      fetch("/api/projects", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project: {
            id: updated.id, name: updated.name,
            createdAt: updated.createdAt, updatedAt: updated.updatedAt,
            academy: null, siteConfig: {}, deliveryInstructions: "",
            chatHistory: [], blueprint: null, logicResult: null, uiResult: null,
            ebookManifest: null, ebookJobState: updated.jobState, publishedSlug: undefined,
          },
        }),
      }).catch(() => {});
      return true;
    } catch (err) {
      setStatusMsg({ type: "error", text: err instanceof Error ? err.message : "Remove failed." });
      return false;
    }
  }, []);

  const handleImportProject = useCallback(async (project: EbookProject) => {
    await saveEbookProject(project);
    setProjects(await listEbookProjects());
    setStatusMsg({ type: "success", text: `"${project.name}" imported.` });
  }, []);

  // ── Publish handler ───────────────────────────────────────────────────────

  const handlePublish = useCallback(async (project: EbookProject): Promise<string | null> => {
    const job = project.jobState;
    if (!job.architecture || !job.frontMatter || !job.chapters?.length) {
      setStatusMsg({ type: "error", text: "Book must be complete before publishing." });
      return null;
    }
    const manifest: EbookManifest = {
      jobId:         job.jobId,
      bookTitle:     job.architecture.bookTitle,
      subtitle:      job.architecture.subtitle,
      authorName:    job.architecture.authorName,
      frontMatter:   job.frontMatter,
      chapters:      job.chapters,
      totalWordCount: job.chapters.reduce((s, c) => s + (c.totalWordCount ?? 0), 0),
      allQuotes:     job.contentMap?.allQuotes ?? [],
      generatedAt:   job.updatedAt ?? new Date().toISOString(),
      selectedTemplate: "devotional",
      printSpec:     { trimSize: "6x9", runningHeaders: true },
      coverImageUrl:  project.coverImageUrl  ?? null,
      authorImageUrl: project.authorImageUrl ?? null,
      narrationUrls:  readNarrationUrls(job.jobId),
    };
    try {
      const res = await fetch("/api/ebook/publish", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ manifest, coverAccent: "amber" }),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        setStatusMsg({ type: "error", text: err.error ?? "Publish failed." });
        return null;
      }
      const { slug } = await res.json() as { slug: string };
      const updated: EbookProject = { ...project, publishedSlug: slug };
      await saveEbookProject(updated);
      setProjects(await listEbookProjects());
      setStatusMsg({ type: "success", text: `"${project.name}" published to /library/${slug}` });
      return slug;
    } catch (err) {
      setStatusMsg({ type: "error", text: err instanceof Error ? err.message : "Publish failed." });
      return null;
    }
  }, [readNarrationUrls]);

  const handleUpdateImages = useCallback(async (
    id: string,
    coverImageUrl?: string,
    authorImageUrl?: string,
  ) => {
    const p = projects.find((proj) => proj.id === id);
    if (!p) return;
    const updated: EbookProject = {
      ...p,
      ...(coverImageUrl  !== undefined ? { coverImageUrl  } : {}),
      ...(authorImageUrl !== undefined ? { authorImageUrl } : {}),
    };
    await saveEbookProject(updated);
    setProjects(await listEbookProjects());
    // Sync to R2
    fetch("/api/projects", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project: {
          id: updated.id, name: updated.name,
          createdAt: updated.createdAt, updatedAt: updated.updatedAt,
          academy: null, siteConfig: {}, deliveryInstructions: "",
          chatHistory: [], blueprint: null, logicResult: null, uiResult: null,
          ebookManifest: null, ebookJobState: updated.jobState,
          publishedSlug: updated.publishedSlug,
          coverImageUrl: updated.coverImageUrl,
          authorImageUrl: updated.authorImageUrl,
        },
      }),
    }).catch(() => {});
    // If already published, push the new images to the library immediately
    if (updated.publishedSlug) {
      handlePublish(updated).catch(() => {});
    }
  }, [projects, handlePublish]);

  // ── Manifest handlers ─────────────────────────────────────────────────────

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
    // Write the AI-edited manifest back to localStorage so the pipeline display,
    // saves, and reloads all reflect the changes immediately.
    try {
      const raw = localStorage.getItem(JOB_STATE_KEY);
      if (raw) {
        const existing = JSON.parse(raw) as Record<string, unknown>;
        const updatedJobState = {
          ...existing,
          chapters: manifest.chapters,
          frontMatter: manifest.frontMatter,
          ...(existing.architecture
            ? {
                architecture: {
                  ...(existing.architecture as Record<string, unknown>),
                  bookTitle: manifest.bookTitle,
                  subtitle: manifest.subtitle,
                  authorName: manifest.authorName,
                },
              }
            : {}),
        };
        localStorage.setItem(JOB_STATE_KEY, JSON.stringify(updatedJobState));
      }
    } catch {
      // localStorage unavailable — in-memory state still updated correctly
    }
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

  return (
    <main className="min-h-dvh bg-slate-950 text-slate-100">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 border-b border-slate-800/80 bg-slate-950/90 backdrop-blur-md">
        <div className="mx-auto max-w-3xl px-4 lg:px-8">
          {/* Title row */}
          <div className="flex items-center justify-between gap-3 py-3">
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

            {/* Action buttons — right side */}
            <div className="flex items-center gap-2">
              {ebookManifest && (
                <>
                  <button
                    type="button"
                    onClick={() => setAssistantOpen(true)}
                    className="flex items-center gap-2 min-h-[44px] rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3.5 py-2 text-xs font-semibold text-cyan-300 transition hover:border-cyan-400/60 hover:bg-cyan-500/15 active:scale-[0.97]"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-4 w-4">
                      <circle cx="12" cy="12" r="10" />
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
            </div>
          </div>

          {/* Tab bar */}
          <div className="flex gap-1 pb-0">
            <button
              type="button"
              onClick={() => setActiveTab("pipeline")}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
                activeTab === "pipeline"
                  ? "border-cyan-400 text-cyan-300"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-4 w-4">
                <path d="M5 3h14M5 8h14M5 13l4 4 4-4 4 4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Pipeline
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("projects")}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
                activeTab === "projects"
                  ? "border-cyan-400 text-cyan-300"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-4 w-4">
                <rect x="2" y="7" width="20" height="14" rx="2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Projects
              {projects.length > 0 && (
                <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-cyan-500/25 px-1 text-[10px] font-bold text-cyan-300">
                  {projects.length}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Status message */}
      {statusMsg && (
        <div className="mx-auto mt-3 max-w-3xl px-4 lg:px-8">
          <p className={`rounded-xl border px-3 py-2 text-xs ${statusMsg.type === "error" ? "border-red-500/30 bg-red-500/10 text-red-300" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"}`}>
            {statusMsg.text}
          </p>
        </div>
      )}

      {/* ── Pipeline tab (always mounted — pipeline must never lose in-flight state) */}
      <div className={activeTab === "pipeline" ? "block" : "hidden"}>
        <div className="mx-auto max-w-3xl px-4 pt-5 pb-[max(env(safe-area-inset-bottom),1.5rem)] lg:px-8 lg:pt-6">
          <EbookPipeline
            key={pipelineKey}
            ebookManifest={ebookManifest}
            onManifestReady={handleManifestReady}
            onPipelineSnapshotChange={handlePipelineSnapshotChange}
            onSaveProject={(name) => void handleSaveProject(name)}
          />
        </div>
      </div>

      {/* ── Projects tab ──────────────────────────────────────────────────── */}
      <div className={activeTab === "projects" ? "block" : "hidden"}>
        <div className="mx-auto max-w-3xl px-4 pt-5 pb-[max(env(safe-area-inset-bottom),1.5rem)] lg:px-8 lg:pt-6">
          <EbookProjectsPanel
            projects={projects}
            suggestedName={suggestedName}
            canSave
            onSave={handleSaveProject}
            onLoad={handleLoadProject}
            onDelete={handleDeleteProject}
            onImport={handleImportProject}
            onImportManifestJson={buildManifestFromJob}
            onPublish={handlePublish}
            onUnpublish={handleUnpublish}
            onUpdateImages={handleUpdateImages}
            onManifestLoaded={(manifest) => {
              setEbookManifest(manifest);
              setActiveTab("pipeline");
              setStatusMsg({ type: "success", text: `"${manifest.bookTitle}" loaded into pipeline.` });
            }}
          />
        </div>
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
