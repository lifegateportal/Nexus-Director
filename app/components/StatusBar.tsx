import type { ModelState, PipelineStage } from "@/lib/types";

const STAGE_LABELS: Record<PipelineStage, string> = {
  idle: "All agents standing by",
  ingesting: "Analyst scanning content…",
  reasoning: "Engineer architecting schema…",
  generating: "Designer rendering interface…",
  producing: "Curator packaging academy…",
  done: "Build complete — ready to deploy",
  error: "Pipeline error"
};

const STAGE_COLORS: Record<PipelineStage, string> = {
  idle: "text-slate-400",
  ingesting: "text-cyan-400",
  reasoning: "text-violet-400",
  generating: "text-amber-400",
  producing: "text-orange-400",
  done: "text-emerald-400",
  error: "text-red-400"
};

type DotStyle = { bg: string; glow?: string };

const MODEL_DOT: Record<string, DotStyle> = {
  active: { bg: "bg-cyan-400", glow: "0 0 10px rgba(6,182,212,0.95)" },
  standby: { bg: "bg-slate-700" },
  error: { bg: "bg-red-500", glow: "0 0 10px rgba(239,68,68,0.90)" }
};

type StatusBarProps = {
  stage: PipelineStage;
  models: ModelState[];
  onAssistant?: () => void;
  assistantActive?: boolean;
};

export function StatusBar({ stage, models, onAssistant, assistantActive }: StatusBarProps) {
  return (
    <div className="flex h-12 flex-shrink-0 items-center justify-between border-b border-cyan-500/15 px-4 glass-light">
      {/* Brand */}
      <span className="hidden text-[10px] font-bold uppercase tracking-[0.22em] text-gradient sm:block">
        Nexus Director
      </span>

      {/* Agent routing pills — hidden on mobile, visible sm+ */}
      <div className="hidden items-center gap-2 sm:flex sm:gap-3">
        {models.map((m) => {
          const dot = MODEL_DOT[m.status] ?? MODEL_DOT.standby;
          const isActive = m.status === "active";
          return (
            <div key={m.handle} className="flex items-center gap-1.5">
              <span
                className={`h-2 w-2 flex-shrink-0 rounded-full transition-all ${dot.bg}`}
                style={dot.glow ? { boxShadow: dot.glow } : undefined}
              />
              <span className={`text-[10px] font-medium sm:text-[11px] ${isActive ? "text-cyan-300" : "text-slate-500"}`}>
                {m.name}
              </span>
            </div>
          );
        })}
      </div>

      {/* Right: pipeline stage + Director AI button */}
      <div className="flex items-center gap-3">
        <span className={`hidden text-[11px] font-semibold sm:block sm:text-xs ${STAGE_COLORS[stage]}`}>
          {STAGE_LABELS[stage]}
        </span>
        {onAssistant && (
          <button
            type="button"
            onClick={onAssistant}
            aria-label="Director AI assistant"
            className={`flex min-h-8 min-w-8 items-center justify-center rounded-lg border transition ${
              assistantActive
                ? "border-cyan-400/60 bg-cyan-500/20 text-cyan-300"
                : "border-slate-600 text-slate-400 hover:border-cyan-500/40 hover:text-cyan-300"
            }`}
            style={assistantActive ? { boxShadow: "0 0 10px rgba(6,182,212,0.25)" } : undefined}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-4 w-4">
              <path d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
