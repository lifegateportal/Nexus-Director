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
  return (
    <nav
      className="flex h-full w-[72px] flex-shrink-0 flex-col items-center gap-1 border-r border-slate-700/50 py-4 glass"
      aria-label="Nexus Director navigation"
    >
      {/* Logo mark */}
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-accent-500/15 ring-1 ring-accent-500/40">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-6 w-6 text-accent-400">
          <path d="M12 2 21 6.5V17L12 21.5 3 17V6.5L12 2z" strokeLinejoin="round" />
          <path d="M12 2v19.5M3 6.5l9 5 9-5" strokeLinejoin="round" />
        </svg>
      </div>

      {/* Nav items */}
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
                "focus-ring relative flex min-h-12 w-12 items-center justify-center rounded-xl transition-colors",
                isActive
                  ? "bg-accent-500/15 text-accent-400 ring-1 ring-accent-500/40"
                  : "text-slate-500 hover:bg-slate-700/30 hover:text-slate-300 active:bg-slate-700/50"
              ].join(" ")}
            >
              {isActive && (
                <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r-full bg-accent-400" />
              )}
              <Icon />
            </button>
          );
        })}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* System health indicator */}
      <div
        className="mb-2 h-2 w-2 rounded-full bg-emerald-400"
        style={{ boxShadow: "0 0 8px rgba(52,211,153,0.7)" }}
        title="System healthy"
      />
    </nav>
  );
}
