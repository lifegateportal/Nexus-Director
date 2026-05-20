"use client";

import { useState } from "react";

type NavItem = { id: string; label: string };

const NAV_ITEMS: NavItem[] = [
  { id: "overview",  label: "Overview"  },
  { id: "analyse",   label: "Analyse"   },
  { id: "architect", label: "Architect" },
  { id: "design",    label: "Design"    },
  { id: "produce",   label: "Produce"   },
  { id: "deploy",    label: "Deploy"    },
  { id: "projects",  label: "Projects"  }
];

/** Overview — mission control hub */
function IconGrid() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-5 w-5">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

/** Analyse — Gemini watches all footage */
function IconEye() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-5 w-5">
      <path d="M2 12s3.64-7 10-7 10 7 10 7-3.64 7-10 7S2 12 2 12z" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/** Architect — DeepSeek builds the backend */
function IconCode() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-5 w-5">
      <path d="m16 18 6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m8 6-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Design — Claude renders the UI */
function IconLayout() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-5 w-5">
      <rect x="3" y="3" width="18" height="18" rx="2.5" />
      <path d="M3 9h18M9 9v12" strokeLinecap="round" />
    </svg>
  );
}

/** Produce — Kling AI cuts promotional clips */
function IconFilm() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-5 w-5">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M7 4v16M17 4v16M2 9h5M17 9h5M2 15h5M17 15h5" strokeLinecap="round" />
    </svg>
  );
}

/** Deploy — Manus ships to live internet */
function IconDeploy() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-5 w-5">
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m16 6-4-4-4 4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 2v13" strokeLinecap="round" />
    </svg>
  );
}

/** Projects — saved workspace archive */
function IconProjects() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-5 w-5">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="12" y1="11" x2="12" y2="17" strokeLinecap="round" />
      <line x1="9" y1="14" x2="15" y2="14" strokeLinecap="round" />
    </svg>
  );
}

const NAV_ICONS = [IconGrid, IconEye, IconCode, IconLayout, IconFilm, IconDeploy, IconProjects];

type NexusNavProps = {
  active: string;
  onSelect: (id: string) => void;
};

export function NexusNav({ active, onSelect }: NexusNavProps) {
  const LogoMark = () => (
    <div
      className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/20 ring-1 ring-cyan-400/50"
      style={{ boxShadow: "0 0 18px rgba(6,182,212,0.30)" }}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5 text-cyan-400">
        <path d="M12 2 21 6.5V17L12 21.5 3 17V6.5L12 2z" strokeLinejoin="round" />
        <path d="M12 2v19.5M3 6.5l9 5 9-5" strokeLinejoin="round" />
      </svg>
    </div>
  );

  return (
    <>
      {/* ── Desktop sidebar (lg+) ─────────────────────────────── */}
      <nav
        className="hidden lg:flex h-full w-[72px] flex-shrink-0 flex-col items-center gap-1 border-r border-cyan-500/15 py-4 glass"
        aria-label="Nexus Director navigation"
      >
        <div className="mb-4"><LogoMark /></div>

        <div className="flex flex-col gap-1">
          {NAV_ITEMS.map((item, i) => {
            const Icon = NAV_ICONS[i];
            const isActive = active === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelect(item.id)}
                aria-label={item.label}
                aria-current={isActive ? "page" : undefined}
                className={[
                  "focus-ring relative flex min-h-12 w-12 items-center justify-center rounded-xl transition-all duration-150",
                  isActive
                    ? "bg-gradient-to-br from-cyan-500/25 to-violet-500/15 text-cyan-300 ring-1 ring-cyan-400/40"
                    : "text-slate-500 hover:bg-slate-700/40 hover:text-slate-200 active:bg-slate-700/60"
                ].join(" ")}
                style={isActive ? { boxShadow: "0 0 12px rgba(6,182,212,0.20)" } : undefined}
              >
                {isActive && (
                  <span
                    className="absolute left-0 top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-r-full bg-cyan-400"
                    style={{ boxShadow: "0 0 6px rgba(6,182,212,0.80)" }}
                  />
                )}
                <Icon />
              </button>
            );
          })}
        </div>

        <div className="flex-1" />
        <div
          className="mb-2 h-2 w-2 rounded-full bg-emerald-400"
          style={{ boxShadow: "0 0 10px rgba(52,211,153,0.85)" }}
          title="System healthy"
        />
      </nav>

      {/* ── Mobile bottom bar (<lg) ───────────────────────────── */}
      <nav
        className="lg:hidden fixed bottom-0 left-0 right-0 z-50 flex items-stretch justify-around border-t border-cyan-500/20 glass-light"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 6px)" }}
        aria-label="Nexus Director navigation"
      >
        {/* Logo tap — goes to overview */}
        <button
          type="button"
          onClick={() => onSelect("overview")}
          aria-label="Overview"
          className="flex flex-col items-center justify-center gap-0.5 px-1 pt-2"
        >
          <LogoMark />
        </button>

        {NAV_ITEMS.filter((item) => item.id !== "overview").map((item, i) => {
          // offset by 1 because we skipped overview (index 0)
          const Icon = NAV_ICONS[i + 1];
          const isActive = active === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item.id)}
              aria-label={item.label}
              aria-current={isActive ? "page" : undefined}
              className="relative flex min-h-[52px] min-w-[44px] flex-col items-center justify-center gap-0.5 px-1 pt-2 transition-colors"
            >
              <span className={isActive ? "text-cyan-400" : "text-slate-500"}>
                <Icon />
              </span>
              <span className={`text-[9px] font-medium ${isActive ? "text-cyan-400" : "text-slate-600"}`}>
                {item.label}
              </span>
              {isActive && (
                <span
                  className="absolute top-0 h-0.5 w-10 rounded-full bg-cyan-400"
                  style={{ boxShadow: "0 0 6px rgba(6,182,212,0.80)" }}
                />
              )}
            </button>
          );
        })}
      </nav>
    </>
  );
}
