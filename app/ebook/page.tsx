"use client";

import { useState, useCallback } from "react";
import { EbookPipeline } from "@/app/components/EbookPipeline";
import { AssistantPanel } from "@/app/components/AssistantPanel";
import { SiteConfigSchema } from "@/lib/schemas/site-config";
import type { EbookManifest } from "@/lib/schemas/ebook";
import type { SiteConfig } from "@/lib/schemas/site-config";

export default function EbookPage() {
  const [ebookManifest, setEbookManifest] = useState<EbookManifest | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [siteConfig] = useState<SiteConfig>(() => SiteConfigSchema.parse({}));

  const handleManifestReady = useCallback((manifest: EbookManifest) => {
    setEbookManifest(manifest);
  }, []);

  const handleEbookUpdate = useCallback((manifest: EbookManifest) => {
    setEbookManifest(manifest);
  }, []);

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

          {/* Nexus Director AI button — appears once production completes */}
          {ebookManifest && (
            <button
              type="button"
              onClick={() => setAssistantOpen(true)}
              className="flex items-center gap-2 min-h-[44px] rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3.5 py-2 text-xs font-semibold text-cyan-300 transition hover:border-cyan-400/60 hover:bg-cyan-500/15 active:scale-[0.97]"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-4 w-4">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
                <path d="M9 12h6M12 9v6" strokeLinecap="round" />
              </svg>
              Director AI
            </button>
          )}
        </div>
      </div>

      {/* Pipeline */}
      <div className="mx-auto max-w-3xl px-4 pt-5 pb-[max(env(safe-area-inset-bottom),1.5rem)] lg:px-8 lg:pt-6">
        <EbookPipeline onManifestReady={handleManifestReady} />
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
      />
    </main>
  );
}
