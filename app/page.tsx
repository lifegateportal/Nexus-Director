"use client";

import { useState, useCallback, useEffect } from "react";
import { NexusNav } from "@/app/components/NexusNav";
import { StatusBar } from "@/app/components/StatusBar";
import { TerminalLog } from "@/app/components/TerminalLog";
import { MediaUpload } from "@/app/components/MediaUpload";
import { ProjectCard } from "@/app/components/ProjectCard";
import { PipelineResults } from "@/app/components/PipelineResults";
import { PromptBar } from "@/app/components/PromptBar";
import { AssistantPanel } from "@/app/components/AssistantPanel";
import { ProjectsPanel } from "@/app/components/ProjectsPanel";
import { EbookPipeline } from "@/app/components/EbookPipeline";
import { LogicTransformResultSchema } from "@/lib/schemas/blueprint";
import { UiManifestResultSchema } from "@/lib/schemas/ui-manifest";
import { AcademyPackageSchema } from "@/lib/schemas/academy";
import type { LogicTransformResult } from "@/lib/schemas/blueprint";
import type { UiManifestResult } from "@/lib/schemas/ui-manifest";
import type { AcademyPackage } from "@/lib/schemas/academy";
import type { IngestResult } from "@/lib/schemas/blueprint";
import type { LogEntry, ModelState, ModelHandle, PipelineStage } from "@/lib/types";
import { SiteConfigSchema } from "@/lib/schemas/site-config";
import type { SiteConfig } from "@/lib/schemas/site-config";
import {
  listProjects,
  saveProject,
  deleteProject,
  generateProjectId,
} from "@/lib/project-store";
import type { ProjectSnapshot, ChatMessage } from "@/lib/project-store";

const INITIAL_MODELS: ModelState[] = [
  { name: "Gemini",   handle: "gemini",   role: "Analyst",           status: "standby" },
  { name: "DeepSeek", handle: "deepseek", role: "Engineer",          status: "standby" },
  { name: "Claude",   handle: "claude",   role: "Designer",          status: "standby" },
  { name: "Curator",  handle: "curator",  role: "Academy Producer",  status: "standby" },
  { name: "Manus",    handle: "manus",    role: "Executive",         status: "standby" }
];

export default function HomePage() {
  const [logs,        setLogs]        = useState<LogEntry[]>([]);
  const [blueprint,   setBlueprint]   = useState<IngestResult | null>(null);
  const [logicResult, setLogicResult] = useState<LogicTransformResult | null>(null);
  const [uiResult,    setUiResult]    = useState<UiManifestResult | null>(null);
  const [academyResult, setAcademyResult] = useState<AcademyPackage | null>(null);
  const [rawTranscript, setRawTranscript] = useState<string>("");
  const [deliveryInstructions, setDeliveryInstructions] = useState<string>("");
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [siteConfig, setSiteConfig] = useState<SiteConfig>(() => SiteConfigSchema.parse({}));
  const [stage,       setStage]       = useState<PipelineStage>("idle");
  const [models,      setModels]      = useState<ModelState[]>(INITIAL_MODELS);
  const [activeNav,   setActiveNav]   = useState("overview");

  // Project persistence
  const [projects,        setProjects]        = useState<ProjectSnapshot[]>([]);
  const [currentProjectId, setCurrentProjectId] = useState<string>("");
  const [chatHistory,     setChatHistory]     = useState<ChatMessage[]>([]);
  const [panelLoadKey,    setPanelLoadKey]    = useState<string>("");

  // Load persisted state client-side only (avoids SSR hydration mismatch)
  useEffect(() => {
    void (async () => {
      try { setProjects(await listProjects()); } catch { /* ignore */ }
      try {
        setDeliveryInstructions(localStorage.getItem("nexus_delivery_instructions") ?? "");
        const raw = localStorage.getItem("nexus_site_config");
        if (raw) setSiteConfig(SiteConfigSchema.parse(JSON.parse(raw) as unknown));
      } catch { /* ignore */ }
    })();
  }, []);

  // Populate boot logs client-side only to avoid server/client timestamp mismatch.
  useEffect(() => {
    const now = new Date().toISOString();
    setLogs([
      { id: "sys-1", level: "init",    message: "Nexus Director shell online",                    timestamp: now },
      { id: "sys-2", level: "init",    message: "5-agent pipeline staged: Analyst → Engineer → Designer → Curator → Executive", timestamp: now },
      { id: "sys-3", level: "success", message: "Dynamic viewport lock enforced (dvh + safe-area)", timestamp: now }
    ]);
  }, []);

  const addLog = useCallback((entry: Omit<LogEntry, "id" | "timestamp">) => {
    const id = `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setLogs((prev) => [...prev, { ...entry, id, timestamp: new Date().toISOString() }]);

    if (entry.model !== undefined) {
      const handle: ModelHandle = entry.model;
      setModels((prev) =>
        prev.map((m) =>
          m.handle === handle
            ? {
                ...m,
                status:
                  entry.level === "error"   ? "error"   :
                  entry.level === "success" ? "standby" : "active"
              }
            : m
        )
      );
    }
  }, []);

  const handleAssistantUpdate = useCallback((updated: AcademyPackage, summary: string) => {
    setAcademyResult(updated);
    localStorage.setItem("nexus_academy_preview", JSON.stringify(updated));
    addLog({ level: "success", message: `Director: ${summary}`, model: "curator" });
  }, [addLog]);

  const handleSiteUpdate = useCallback((config: SiteConfig, summary: string) => {
    setSiteConfig(config);
    localStorage.setItem("nexus_site_config", JSON.stringify(config));
    addLog({ level: "success", message: `Director: ${summary}`, model: "curator" });
  }, [addLog]);

  const handleSaveProject = useCallback(async (name: string) => {
    const id = currentProjectId || generateProjectId();
    const snapshot: ProjectSnapshot = {
      id,
      name,
      createdAt: currentProjectId ? (projects.find((p) => p.id === id)?.createdAt ?? new Date().toISOString()) : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      academy: academyResult,
      siteConfig,
      deliveryInstructions,
      chatHistory,
      blueprint: blueprint ?? null,
      logicResult: logicResult ?? null,
      uiResult: uiResult ?? null,
    };
    try {
      await saveProject(snapshot);
      setCurrentProjectId(id);
      setProjects(await listProjects());
      addLog({ level: "success", message: `Project "${name}" saved.` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Save failed";
      addLog({ level: "error", message: `Could not save project: ${msg}` });
    }
  }, [currentProjectId, projects, academyResult, siteConfig, deliveryInstructions, chatHistory, blueprint, logicResult, uiResult, addLog]);

  const handleLoadProject = useCallback((id: string) => {
    const p = projects.find((proj) => proj.id === id);
    if (!p) return;
    setBlueprint(p.blueprint);
    setLogicResult(p.logicResult);
    setUiResult(p.uiResult);
    setAcademyResult(p.academy);
    setSiteConfig(p.siteConfig);
    setDeliveryInstructions(p.deliveryInstructions);
    setChatHistory(p.chatHistory);
    setPanelLoadKey(p.id);
    setCurrentProjectId(p.id);
    if (p.blueprint) setStage("done");
    setActiveNav("overview");
    // Update the shared localStorage keys so preview pages also see the loaded data
    if (p.academy) localStorage.setItem("nexus_academy_preview", JSON.stringify(p.academy));
    localStorage.setItem("nexus_site_config", JSON.stringify(p.siteConfig));
    localStorage.setItem("nexus_delivery_instructions", p.deliveryInstructions);
    addLog({ level: "success", message: `Project "${p.name}" loaded.` });
  }, [projects, addLog]);

  const handleDeleteProject = useCallback(async (id: string) => {
    await deleteProject(id);
    setProjects(await listProjects());
    if (currentProjectId === id) setCurrentProjectId("");
  }, [currentProjectId]);

  const handleImportProject = useCallback(async (snapshot: ProjectSnapshot) => {
    await saveProject(snapshot);
    setProjects(await listProjects());
    addLog({ level: "success", message: `Project "${snapshot.name}" imported.` });
  }, [addLog]);

  const handleStageChange = useCallback((s: PipelineStage) => {
    setStage(s);
    if (s === "done" || s === "error" || s === "idle") {
      setModels((prev) => prev.map((m) => ({ ...m, status: "standby" })));
    }
  }, []);

  const handleBlueprint = useCallback(async (ingestResult: IngestResult, sourceText = "") => {
    // Reset any previous run's downstream results
    setLogicResult(null);
    setUiResult(null);
    setAcademyResult(null);
    setBlueprint(ingestResult);
    setRawTranscript(sourceText);
    setActiveNav("analyse");

    addLog({
      level: "success",
      message: `Blueprint ready — ${ingestResult.workflow.length} step${ingestResult.workflow.length !== 1 ? "s" : ""}, ${ingestResult.assets.length} asset${ingestResult.assets.length !== 1 ? "s" : ""}`,
    });

    if (ingestResult.assets.length === 0 || ingestResult.workflow.length === 0) {
      addLog({ level: "warn", message: "Blueprint has no assets or workflow — skipping logic + design stages" });
      handleStageChange("done");
      return;
    }

    // ── Stage 2: DeepSeek Engineer → execution logic graph ──────────────
    handleStageChange("reasoning");
    addLog({ level: "info", message: "Blueprint dispatched to Engineer — building execution graph…", model: "deepseek" });

    try {
      const logicRes = await fetch("/api/generate-logic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          objective: `${ingestResult.title}: ${ingestResult.summary}`,
          constraints: [],
          blueprint: { ...ingestResult, createdAtIso: new Date().toISOString() }
        })
      });

      if (!logicRes.ok) {
        const e = await logicRes.json().catch(() => ({ error: `HTTP ${logicRes.status}` })) as { error?: string; detail?: string };
        throw new Error(e.detail ?? e.error ?? `Logic stage: HTTP ${logicRes.status}`);
      }

      const logicData = LogicTransformResultSchema.parse(await logicRes.json() as unknown);
      setLogicResult(logicData);
      setActiveNav("architect");
      addLog({
        level: "success",
        message: `Execution graph ready — ${logicData.executionPlan.length} step${logicData.executionPlan.length !== 1 ? "s" : ""} planned`,
        model: "deepseek"
      });

      // ── Stage 3: Claude Designer → UI manifest ───────────────────────
      handleStageChange("generating");
      addLog({ level: "info", message: "Execution plan dispatched to Designer — synthesising UI manifest…", model: "claude" });

      const uiRes = await fetch("/api/generate-ui", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          objective: `${ingestResult.title}: ${ingestResult.summary}`,
          domain: "Digital Product Academy",
          constraints: [
            "iPad Safari safe — dvh units only",
            "Dark mode only",
            "48px minimum touch targets",
            "No hover-only interactions"
          ]
        })
      });

      if (!uiRes.ok) {
        const e = await uiRes.json().catch(() => ({ error: `HTTP ${uiRes.status}` })) as { error?: string; detail?: string };
        throw new Error(e.detail ?? e.error ?? `UI stage: HTTP ${uiRes.status}`);
      }

      const uiData = UiManifestResultSchema.parse(await uiRes.json() as unknown);
      setUiResult(uiData);
      setActiveNav("design");
      addLog({
        level: "success",
        message: `UI manifest complete — ${uiData.components.length} component${uiData.components.length !== 1 ? "s" : ""}  ·  ${uiData.interactions.length} interaction pattern${uiData.interactions.length !== 1 ? "s" : ""}`,
        model: "claude"
      });

      // ── Stage 4: DeepSeek Curator → academy package ────────────────
      handleStageChange("producing");
      addLog({ level: "info", message: "UI spec dispatched to Curator — packaging full academy…", model: "curator" });

      const produceRes = await fetch("/api/produce", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: ingestResult.title,
          summary: ingestResult.summary,
          assets: ingestResult.assets,
          workflow: ingestResult.workflow,
          executionPlan: logicData.executionPlan,
          entities: logicData.entities,
          visualDirection: uiData.visualDirection,
          rawTranscript: sourceText,
          deliveryInstructions,
        })
      });

      if (!produceRes.ok || !produceRes.body) {
        const e = await produceRes.json().catch(() => ({ error: `HTTP ${produceRes.status}` })) as { error?: string; detail?: string };
        throw new Error(e.detail ?? e.error ?? `Produce stage: HTTP ${produceRes.status}`);
      }

      // Read SSE stream — route sends ": ping" comments to keep the connection
      // alive through reverse-proxy timeouts, then one "data: {...}" with the result.
      const reader = produceRes.body.getReader();
      const decoder = new TextDecoder();
      let academyRaw: unknown = null;
      outer: while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const line of decoder.decode(value).split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const parsed = JSON.parse(line.slice(6)) as { error?: string } & Record<string, unknown>;
          if (parsed.error) throw new Error(parsed.error);
          academyRaw = parsed;
          break outer;
        }
      }

      if (!academyRaw) throw new Error("Produce stage: empty response from server");
      const academyData = AcademyPackageSchema.parse(academyRaw);
      setAcademyResult(academyData);
      setActiveNav("produce");
      addLog({
        level: "success",
        message: `Academy package ready — ${academyData.curriculum.length} module${academyData.curriculum.length !== 1 ? "s" : ""}, ${academyData.pricing.length} pricing tiers`,
        model: "curator"
      });

      handleStageChange("done");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Pipeline error";
      addLog({ level: "error", message: msg });
      handleStageChange("error");
    }
  }, [addLog, handleStageChange]);

  // Map left-nav items to the PipelineResults tab they drive
  const NAV_TAB: Record<string, "blueprint" | "logic" | "ui" | "academy" | null> = {
    overview:  null,
    analyse:   "blueprint",
    architect: "logic",
    design:    "ui",
    produce:   "academy",
    deploy:    null,
    projects:  null,
    ebook:     null,
  };
  const focusedTab = NAV_TAB[activeNav] ?? undefined;
  const isFocused = activeNav !== "overview";

  return (
    <div className="flex min-h-dvh max-h-dvh overflow-hidden bg-shell-950 bg-grid bg-radial-glow safe-area-frame">
      <NexusNav active={activeNav} onSelect={setActiveNav} />

      {/* Content column — reserves bottom space for mobile bottom nav (~60px) */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden pb-[max(env(safe-area-inset-bottom),_3.75rem)] lg:pb-0">
        <StatusBar
          stage={stage}
          models={models}
          onAssistant={() => setAssistantOpen((v) => !v)}
          assistantActive={assistantOpen}
        />

        {/*
          Mobile: flex-col + overflow-y-auto so panels stack and scroll.
          Desktop (lg+): grid 5-cols + overflow-hidden so panels fill height.
        */}
        <main className="flex flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-3 pb-24 lg:grid lg:min-h-0 lg:overflow-hidden lg:pb-3 lg:grid-cols-5">

          {/* ── Focused agent views (non-overview nav) ── */}
          {isFocused ? (
            <>
              {/* Terminal — hidden on mobile in focused mode (nav already shows context), full panel on desktop */}
              <div className="hidden lg:block lg:min-h-0 lg:col-span-2">
                <TerminalLog
                  entries={logs}
                  isStreaming={stage === "ingesting" || stage === "reasoning"}
                />
              </div>

              {/* Primary panel — full width on mobile, 3/5 on desktop */}
              <div className="min-h-[65dvh] lg:min-h-0 lg:col-span-3">
                {activeNav === "projects" ? (
                  <ProjectsPanel
                    projects={projects}
                    suggestedName={blueprint?.title ?? ""}
                    canSave={!!blueprint}
                    onSave={handleSaveProject}
                    onLoad={handleLoadProject}
                    onDelete={handleDeleteProject}
                    onImport={handleImportProject}
                  />
                ) : activeNav === "ebook" ? (
                  <div className="flex h-full flex-col overflow-y-auto rounded-2xl border border-cyan-500/20 glass">
                    <EbookPipeline />
                  </div>
                ) : activeNav === "deploy" ? (
                  <div className="flex h-full flex-col gap-4 overflow-y-auto rounded-2xl border border-cyan-500/20 glass p-5">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-cyan-500">Deploy</p>
                    <h2 className="text-lg font-bold text-white">
                      {blueprint?.title ?? "No project yet"}
                    </h2>
                    {blueprint ? (
                      <div className="flex flex-col gap-3">
                        <a
                          href="/preview"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-cyan-500 px-5 text-sm font-semibold text-slate-950 shadow-glow transition hover:bg-cyan-400"
                        >
                          Launch Landing Page Preview
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" strokeLinecap="round" strokeLinejoin="round" /><path d="M15 3h6v6" strokeLinecap="round" strokeLinejoin="round" /><path d="M10 14 21 3" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        </a>
                        <a
                          href="/preview/learn"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-5 text-sm font-semibold text-cyan-300 transition hover:bg-cyan-500/20 hover:border-cyan-400/50"
                        >
                          Open Course Player
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" strokeLinecap="round" strokeLinejoin="round" /><path d="M15 3h6v6" strokeLinecap="round" strokeLinejoin="round" /><path d="M10 14 21 3" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        </a>
                        <div className="rounded-xl border border-slate-700/60 bg-slate-900/60 p-4 text-sm">
                          <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Pipeline Status</p>
                          <p className={stage === "done" ? "text-emerald-400" : stage === "error" ? "text-red-400" : "text-slate-400"}>
                            {stage === "done" ? "Build complete — ready to deploy" : stage === "error" ? "Pipeline error" : stage === "idle" ? "Standing by" : "Pipeline running…"}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-slate-400">Run the pipeline first to generate a deployable academy.</p>
                    )}
                  </div>
                ) : blueprint ? (
                  <PipelineResults
                    blueprint={blueprint}
                    logic={logicResult}
                    ui={uiResult}
                    academy={academyResult}
                    externalTab={focusedTab}
                  />
                ) : (
                  <div className="flex h-full min-h-[300px] items-center justify-center rounded-2xl border border-cyan-500/15 glass">
                    <p className="text-sm text-slate-400">Run the pipeline to see {activeNav} results</p>
                  </div>
                )}
              </div>
            </>
          ) : (
            /* ── Overview (default) layout ── */
            <>
              {/* Terminal log — full width mobile, 3/5 desktop */}
              <div className="min-h-[280px] lg:min-h-0 lg:col-span-3">
                <TerminalLog
                  entries={logs}
                  isStreaming={stage === "ingesting" || stage === "reasoning"}
                />
              </div>

              {/* Right column — full width mobile (stacked), 2/5 desktop (grid-rows-2) */}
              <div className="flex flex-col gap-3 lg:col-span-2 lg:grid lg:min-h-0 lg:grid-rows-2">
                {blueprint !== null ? (
                  <PipelineResults
                    blueprint={blueprint}
                    logic={logicResult}
                    ui={uiResult}
                    academy={academyResult}
                  />
                ) : (
                  <ProjectCard
                    title="Mission Control"
                    status="Healthy"
                    detail="Upload raw footage, workshop recordings, or podcast archives. One command builds a live paid academy — complete with video ad campaign and deployed SaaS infrastructure."
                    metrics={[
                      { label: "AI Agents", value: "5 staged"       },
                      { label: "Pipeline",  value: "Analyse → Deploy" },
                      { label: "Runtime",   value: "Node.js"         },
                      { label: "Viewport",  value: "iPad-safe"       }
                    ]}
                  />
                )}

                <MediaUpload
                  onLog={addLog}
                  onBlueprint={handleBlueprint}
                  onStageChange={handleStageChange}
                />
              </div>
            </>
          )}
        </main>

        <PromptBar
          stage={stage}
          onLog={addLog}
          onBlueprint={handleBlueprint}
          onStageChange={handleStageChange}
          onDeliveryChange={setDeliveryInstructions}
        />
      </div>

      {/* Director AI drawer — toggled from StatusBar */}
      <AssistantPanel
        isOpen={assistantOpen}
        onClose={() => setAssistantOpen(false)}
        academy={academyResult}
        onUpdate={handleAssistantUpdate}
        siteConfig={siteConfig}
        onSiteUpdate={handleSiteUpdate}
        loadedHistory={chatHistory}
        loadKey={panelLoadKey}
        onChatChange={setChatHistory}
      />
    </div>
  );
}

