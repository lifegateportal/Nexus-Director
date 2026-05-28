"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import type { EbookManifest, ChapterDraft } from "@/lib/schemas/ebook";
import {
  getReadingPosition,
  saveReadingPosition,
  getReaderSettings,
  saveReaderSettings,
} from "@/lib/reader-store";
import type { ReaderSettings } from "@/lib/reader-store";
import { ChapterDrawer } from "./ChapterDrawer";
import { ReaderSettingsPanel } from "./ReaderSettings";
import { ProgressBar } from "./ProgressBar";

// ── Reader theme palette ──────────────────────────────────────────────────────

const THEMES = {
  night: {
    bg:           "#1c1510",
    text:         "#e8dcc8",
    heading:      "#f5efe4",
    muted:        "#8a7d6e",
    accent:       "#c4933a",
    border:       "#2e2620",
    scriptureBar: "#c4933a",
    chrome:       "rgba(20,15,10,0.94)",
    chromeBorder: "rgba(255,255,255,0.07)",
  },
  parchment: {
    bg:           "#f4e9d0",
    text:         "#2c1a0e",
    heading:      "#160c04",
    muted:        "#7a5c3a",
    accent:       "#8b5e1a",
    border:       "#d9c8a8",
    scriptureBar: "#8b5e1a",
    chrome:       "rgba(239,228,204,0.96)",
    chromeBorder: "rgba(0,0,0,0.09)",
  },
  paper: {
    bg:           "#fafafa",
    text:         "#1a1a1a",
    heading:      "#0d0d0d",
    muted:        "#6b6b6b",
    accent:       "#333333",
    border:       "#e0e0e0",
    scriptureBar: "#555555",
    chrome:       "rgba(250,250,250,0.96)",
    chromeBorder: "rgba(0,0,0,0.09)",
  },
} as const;

type Theme = typeof THEMES[keyof typeof THEMES];

const FONT_SIZES   = [15, 16, 18, 20, 22] as const;
const LINE_HEIGHTS = [1.65, 1.85, 2.05] as const;
const FONT_FAMILIES = {
  serif: "Georgia, 'Times New Roman', Times, serif",
  sans:  "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
} as const;

const CHROME_H = "3.25rem";

// ── Inline markdown renderer ──────────────────────────────────────────────────

function InlineText({ text }: { text: string }) {
  const parts: { t: "text" | "bold" | "italic" | "bolditalic"; v: string }[] = [];
  const re = /(\*\*\*([^*\n]+?)\*\*\*|\*\*([^*\n]+?)\*\*|\*([^*\n]+?)\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push({ t: "text", v: text.slice(last, m.index) });
    if      (m[0].startsWith("***")) parts.push({ t: "bolditalic", v: m[2] });
    else if (m[0].startsWith("**"))  parts.push({ t: "bold",       v: m[3] });
    else                              parts.push({ t: "italic",     v: m[4] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ t: "text", v: text.slice(last) });

  return (
    <>
      {parts.map((p, i) =>
        p.t === "bolditalic" ? <strong key={i}><em>{p.v}</em></strong> :
        p.t === "bold"       ? <strong key={i}>{p.v}</strong> :
        p.t === "italic"     ? <em key={i}>{p.v}</em> :
                               <span key={i}>{p.v}</span>
      )}
    </>
  );
}

function renderBody(
  text: string,
  theme: Theme,
  isFirstSection: boolean,
): React.ReactNode[] {
  const lines = text.split("\n");
  const nodes: React.ReactNode[] = [];
  let i         = 0;
  let paraCount = 0;

  while (i < lines.length) {
    const raw  = lines[i];
    const line = raw.trim();
    if (!line) { i++; continue; }

    // H1 / H2 / H3
    if (/^### /.test(line)) {
      nodes.push(
        <h3 key={i} style={{ color: theme.muted, fontSize: "0.68em", letterSpacing: "0.16em", textTransform: "uppercase" as const, marginTop: "2.5em", marginBottom: "0.5em", fontWeight: 700 }}>
          <InlineText text={line.slice(4)} />
        </h3>,
      );
      i++; continue;
    }
    if (/^## /.test(line)) {
      nodes.push(
        <h2 key={i} style={{ color: theme.heading, fontSize: "1.15em", fontWeight: 700, marginTop: "2.5em", marginBottom: "0.85em", letterSpacing: "-0.01em" }}>
          <InlineText text={line.slice(3)} />
        </h2>,
      );
      i++; continue;
    }
    if (/^# /.test(line)) {
      nodes.push(
        <h2 key={i} style={{ color: theme.heading, fontSize: "1.25em", fontWeight: 700, marginTop: "2.5em", marginBottom: "0.85em" }}>
          <InlineText text={line.slice(2)} />
        </h2>,
      );
      i++; continue;
    }

    // Ornamental divider
    if (/^---+$/.test(line)) {
      nodes.push(
        <div key={i} style={{ textAlign: "center", margin: "2.75em 0", color: theme.scriptureBar, letterSpacing: "0.5em", fontSize: "0.85em" }}>
          ✦ ✦ ✦
        </div>,
      );
      i++; continue;
    }

    // Blockquote (scripture / pull quote)
    if (/^> /.test(line)) {
      const qLines: string[] = [];
      while (i < lines.length && /^> /.test(lines[i].trim())) {
        qLines.push(lines[i].trim().slice(2));
        i++;
      }
      nodes.push(
        <blockquote
          key={`bq-${i}`}
          style={{
            borderLeft:    `3px solid ${theme.scriptureBar}`,
            paddingLeft:   "1.25em",
            margin:        "2em 0",
            fontStyle:     "italic",
            color:         theme.muted,
            fontSize:      "0.97em",
            lineHeight:    1.75,
          }}
        >
          {qLines.map((ql, qi) => (
            <p key={qi} style={{ marginBottom: qi < qLines.length - 1 ? "0.4em" : 0 }}>
              <InlineText text={ql} />
            </p>
          ))}
        </blockquote>,
      );
      continue;
    }

    // Unordered list
    if (/^[*-] /.test(line)) {
      const items: string[] = [];
      const s = i;
      while (i < lines.length && /^[*-] /.test(lines[i].trim())) {
        items.push(lines[i].trim().slice(2));
        i++;
      }
      nodes.push(
        <ul key={`ul-${s}`} style={{ paddingLeft: "1.5em", margin: "1em 0", color: theme.text }}>
          {items.map((item, ii) => (
            <li key={ii} style={{ marginBottom: "0.4em", lineHeight: 1.7 }}>
              <InlineText text={item} />
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    // Ordered list
    if (/^\d+\. /.test(line)) {
      const items: string[] = [];
      const s = i;
      while (i < lines.length && /^\d+\. /.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\. /, ""));
        i++;
      }
      nodes.push(
        <ol key={`ol-${s}`} style={{ paddingLeft: "1.5em", margin: "1em 0", color: theme.text }}>
          {items.map((item, ii) => (
            <li key={ii} style={{ marginBottom: "0.4em", lineHeight: 1.7 }}>
              <InlineText text={item} />
            </li>
          ))}
        </ol>,
      );
      continue;
    }

    // Paragraph
    paraCount++;
    const isDropCap = isFirstSection && paraCount === 1 && line.length > 1;

    nodes.push(
      <p
        key={i}
        style={{
          marginBottom: "1.4em",
          color:        theme.text,
          textIndent:   isDropCap ? undefined : "1.6em",
          textAlign:    "justify" as const,
        }}
      >
        {isDropCap ? (
          <>
            <span
              style={{
                float:       "left",
                fontSize:    "3.5em",
                lineHeight:  0.8,
                paddingRight: "0.08em",
                paddingTop:  "0.06em",
                fontWeight:  700,
                color:       theme.heading,
                fontFamily:  "Georgia, serif",
              }}
            >
              {line.charAt(0)}
            </span>
            <InlineText text={line.slice(1)} />
          </>
        ) : (
          <InlineText text={line} />
        )}
      </p>,
    );
    i++;
  }

  return nodes;
}

// ── Chapter content component ─────────────────────────────────────────────────

function ChapterView({
  chapter, theme, fontFamily, fontSize, lineHeight,
}: {
  chapter: ChapterDraft;
  theme: Theme;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
}) {
  const [showExtras, setShowExtras] = useState(false);

  const baseStyle: React.CSSProperties = { fontFamily, fontSize: `${fontSize}px`, lineHeight, color: theme.text };

  return (
    <article style={baseStyle}>
      {/* Chapter header */}
      <header style={{ textAlign: "center", marginBottom: "3.5em" }}>
        <p style={{ fontSize: "0.65em", letterSpacing: "0.3em", textTransform: "uppercase", color: theme.muted, marginBottom: "0.6em", fontFamily }}>
          Chapter {chapter.number}
        </p>
        <h1
          style={{
            fontSize: "1.9em", fontWeight: 700, color: theme.heading,
            lineHeight: 1.2, letterSpacing: "-0.02em", marginBottom: "0.5em",
            fontFamily: "Georgia, serif",
          }}
        >
          {chapter.title}
        </h1>
        <div style={{ width: "2.5em", height: "2px", background: theme.accent, margin: "1em auto 0", borderRadius: "1px" }} />
      </header>

      {/* Epigraph */}
      {chapter.epigraph && (
        <blockquote
          style={{
            textAlign:  "center",
            fontStyle:  "italic",
            color:      theme.muted,
            fontSize:   "0.93em",
            lineHeight: 1.75,
            margin:     "0 auto 3.5em",
            maxWidth:   "32em",
            padding:    "0 1em",
          }}
        >
          {chapter.epigraph.split("\n").map((line, i, arr) => (
            <p key={i} style={{ marginBottom: i < arr.length - 1 ? "0.35em" : 0 }}>{line}</p>
          ))}
        </blockquote>
      )}

      {/* Premise line */}
      {chapter.premiseLine && (
        <p
          style={{
            textAlign:   "center",
            fontStyle:   "italic",
            fontWeight:  600,
            color:       theme.heading,
            fontSize:    "1.06em",
            marginBottom: "3em",
          }}
        >
          {chapter.premiseLine}
        </p>
      )}

      {/* Sections */}
      {chapter.sections.map((section, idx) => (
        <section key={section.sectionNumber} style={{ marginBottom: "0.5em" }}>
          {section.heading && (
            <h2
              style={{
                fontSize:      "0.65em",
                fontWeight:    700,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color:         theme.muted,
                marginTop:     idx > 0 ? "3.25em" : 0,
                marginBottom:  "1.75em",
                paddingBottom: "0.65em",
                borderBottom:  `1px solid ${theme.border}`,
                fontFamily,
              }}
            >
              {section.heading}
            </h2>
          )}
          <div>{renderBody(section.body, theme, idx === 0)}</div>
        </section>
      ))}

      {/* Conclusion */}
      {chapter.conclusion && (
        <section style={{ marginTop: "3em" }}>
          <div style={{ textAlign: "center", margin: "2.5em 0", color: theme.accent, letterSpacing: "0.5em", fontSize: "0.85em" }}>
            ✦ ✦ ✦
          </div>
          {renderBody(chapter.conclusion, theme, false)}
        </section>
      )}

      {/* Reflection & takeaways (collapsible) */}
      {(chapter.reflectionQuestions.length > 0 || chapter.keyTakeaways.length > 0) && (
        <div style={{ marginTop: "3.5em", borderTop: `1px solid ${theme.border}`, paddingTop: "2em" }}>
          <button
            onClick={() => setShowExtras((v) => !v)}
            style={{
              display:      "flex",
              alignItems:   "center",
              gap:          "0.5em",
              fontSize:     "0.65em",
              fontFamily,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color:        theme.muted,
              background:   "none",
              border:       "none",
              cursor:       "pointer",
              padding:      0,
              marginBottom: "1.5em",
              minHeight:    "2.75rem",
            }}
          >
            <span style={{ display: "inline-block", transform: showExtras ? "rotate(90deg)" : "none", transition: "transform 0.2s" }}>▶</span>
            {showExtras ? "Hide" : "Show"} Reflection &amp; Takeaways
          </button>

          {showExtras && (
            <div>
              {chapter.keyTakeaways.length > 0 && (
                <div style={{ marginBottom: "2.25em" }}>
                  <p style={{ fontSize: "0.65em", fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: theme.muted, marginBottom: "1em", fontFamily }}>
                    Key Takeaways
                  </p>
                  <ul style={{ paddingLeft: "1.25em", color: theme.text }}>
                    {chapter.keyTakeaways.map((item, idx2) => (
                      <li key={idx2} style={{ marginBottom: "0.65em", lineHeight: 1.7 }}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
              {chapter.reflectionQuestions.length > 0 && (
                <div>
                  <p style={{ fontSize: "0.65em", fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: theme.muted, marginBottom: "1em", fontFamily }}>
                    Reflection Questions
                  </p>
                  <ol style={{ paddingLeft: "1.25em", color: theme.text }}>
                    {chapter.reflectionQuestions.map((q, qi) => (
                      <li key={qi} style={{ marginBottom: "0.65em", lineHeight: 1.7 }}>{q}</li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

// ── Main reader component ─────────────────────────────────────────────────────

type Props = { manifest: EbookManifest; slug: string; initialChapter?: number };

export function ReaderClient({ manifest, slug, initialChapter }: Props) {
  const [settings, setSettings] = useState<ReaderSettings>({
    theme: "night", fontSize: 3, lineHeight: 2, fontFamily: "serif",
  });
  const [chapterIndex, setChapterIndex] = useState(initialChapter ?? 0);
  const [showChrome,   setShowChrome]   = useState(true);
  const [tocOpen,      setTocOpen]      = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const contentRef      = useRef<HTMLDivElement>(null);
  const inactivityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Refs so stable callbacks can read latest state
  const tocOpenRef      = useRef(tocOpen);
  const settingsOpenRef = useRef(settingsOpen);
  useEffect(() => { tocOpenRef.current      = tocOpen;      }, [tocOpen]);
  useEffect(() => { settingsOpenRef.current = settingsOpen; }, [settingsOpen]);

  // Restore settings + position
  useEffect(() => {
    const saved = getReaderSettings();
    setSettings(saved);
    if (initialChapter === undefined) {
      const pos = getReadingPosition(slug);
      if (pos) setChapterIndex(Math.min(pos.chapterIndex, manifest.chapters.length - 1));
    }
  }, [slug, manifest.chapters.length, initialChapter]);

  // Persist position on chapter change
  useEffect(() => {
    saveReadingPosition(slug, { chapterIndex, scrollPercentage: 0 });
  }, [slug, chapterIndex]);

  // Scroll content to top on chapter change
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [chapterIndex]);

  // Chrome auto-hide on inactivity (stable callback)
  const resetInactivity = useCallback(() => {
    setShowChrome(true);
    if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
    inactivityTimer.current = setTimeout(() => {
      if (!tocOpenRef.current && !settingsOpenRef.current) setShowChrome(false);
    }, 3500);
  }, []);

  useEffect(() => {
    resetInactivity();
    window.addEventListener("mousemove",  resetInactivity);
    window.addEventListener("touchstart", resetInactivity, { passive: true });
    window.addEventListener("keydown",    resetInactivity);
    return () => {
      window.removeEventListener("mousemove",  resetInactivity);
      window.removeEventListener("touchstart", resetInactivity);
      window.removeEventListener("keydown",    resetInactivity);
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
    };
  }, [resetInactivity]);

  // Keep chrome visible when a panel is open
  useEffect(() => {
    if (tocOpen || settingsOpen) {
      setShowChrome(true);
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
    }
  }, [tocOpen, settingsOpen]);

  const goToPrev = useCallback(() => setChapterIndex((i) => Math.max(0, i - 1)), []);
  const goToNext = useCallback(() => {
    setChapterIndex((i) => Math.min(manifest.chapters.length - 1, i + 1));
  }, [manifest.chapters.length]);

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowLeft"  || e.key === "ArrowUp")    goToPrev();
      if (e.key === "ArrowRight" || e.key === "ArrowDown")  goToNext();
      if (e.key === "t" || e.key === "T")                   setTocOpen((v) => !v);
      if (e.key === "Escape") { setTocOpen(false); setSettingsOpen(false); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goToPrev, goToNext]);

  const updateSettings = (patch: Partial<ReaderSettings>) => {
    const next = { ...settings, ...patch } as ReaderSettings;
    setSettings(next);
    saveReaderSettings(next);
  };

  const theme      = THEMES[settings.theme];
  const fontSize   = FONT_SIZES[settings.fontSize - 1];
  const lineHeight = LINE_HEIGHTS[settings.lineHeight - 1];
  const fontFamily = FONT_FAMILIES[settings.fontFamily];
  const chapter    = manifest.chapters[chapterIndex];
  const opacity    = showChrome ? 1 : 0.06;
  const atStart    = chapterIndex === 0;
  const atEnd      = chapterIndex >= manifest.chapters.length - 1;

  const iconBtn = (label: string, onClick: () => void, children: React.ReactNode) => (
    <button
      onClick={onClick}
      aria-label={label}
      style={{
        minHeight: "2.75rem", minWidth: "2.75rem", display: "flex",
        alignItems: "center", justifyContent: "center",
        color: theme.muted, background: "none", border: "none",
        cursor: "pointer", borderRadius: "0.5rem",
      }}
    >
      {children}
    </button>
  );

  return (
    <div
      style={{
        height:   "100dvh",
        display:  "flex",
        flexDirection: "column",
        overflow: "hidden",
        background: theme.bg,
        color: theme.text,
        position: "relative",
      }}
    >
      {/* Thin reading progress line */}
      <ProgressBar
        current={chapterIndex + 1}
        total={manifest.chapters.length}
        accent={theme.accent}
      />

      {/* ── Top chrome ── */}
      <header
        style={{
          flexShrink: 0,
          height:     CHROME_H,
          display:    "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding:    "0 1rem",
          background: theme.chrome,
          borderBottom: `1px solid ${theme.chromeBorder}`,
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          opacity,
          transition: "opacity 0.6s ease",
          position:   "relative",
          zIndex:     10,
        }}
      >
        <Link
          href={`/library/${slug}`}
          style={{
            display:    "flex", alignItems: "center", gap: "0.4rem",
            color:      theme.muted, fontSize: "0.78rem", fontFamily,
            textDecoration: "none", minHeight: "2.75rem", padding: "0 0.25rem",
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} style={{ width: "0.95rem", height: "0.95rem" }}>
            <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Library
        </Link>

        <p
          style={{
            flex: 1, textAlign: "center", overflow: "hidden",
            textOverflow: "ellipsis", whiteSpace: "nowrap",
            padding: "0 0.75rem", color: theme.muted,
            fontSize: "0.78rem", fontFamily: "Georgia, serif",
          }}
        >
          {manifest.bookTitle}
        </p>

        <div style={{ display: "flex", alignItems: "center" }}>
          {iconBtn("Settings", () => { setSettingsOpen((v) => !v); setTocOpen(false); },
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} style={{ width: "1rem", height: "1rem" }}>
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>,
          )}
          {iconBtn("Contents", () => { setTocOpen((v) => !v); setSettingsOpen(false); },
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} style={{ width: "1rem", height: "1rem" }}>
              <line x1="8" y1="6"  x2="21" y2="6"  strokeLinecap="round" />
              <line x1="8" y1="12" x2="21" y2="12" strokeLinecap="round" />
              <line x1="8" y1="18" x2="21" y2="18" strokeLinecap="round" />
              <line x1="3" y1="6"  x2="3.01" y2="6"  strokeLinecap="round" strokeWidth={2} />
              <line x1="3" y1="12" x2="3.01" y2="12" strokeLinecap="round" strokeWidth={2} />
              <line x1="3" y1="18" x2="3.01" y2="18" strokeLinecap="round" strokeWidth={2} />
            </svg>,
          )}
        </div>
      </header>

      {/* ── Scrollable reading area ── */}
      <div
        ref={contentRef}
        style={{ flex: 1, overflowY: "auto" }}
        onClick={resetInactivity}
      >
        <div
          style={{
            maxWidth: "68ch",
            margin:   "0 auto",
            padding:  "3rem 1.5rem 2.5rem",
          }}
        >
          {chapter && (
            <ChapterView
              chapter={chapter}
              theme={theme}
              fontFamily={fontFamily}
              fontSize={fontSize}
              lineHeight={lineHeight}
            />
          )}

          {/* In-content chapter nav */}
          <div
            style={{
              display:        "flex",
              justifyContent: "space-between",
              alignItems:     "center",
              marginTop:      "4rem",
              paddingTop:     "2rem",
              borderTop:      `1px solid ${theme.border}`,
            }}
          >
            <button
              onClick={goToPrev}
              disabled={atStart}
              style={{
                display: "flex", alignItems: "center", gap: "0.4rem",
                color:   atStart ? theme.border : theme.muted,
                background: "none", border: "none",
                cursor:  atStart ? "default" : "pointer",
                fontFamily, fontSize: "0.78rem", minHeight: "2.75rem",
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} style={{ width: "0.9rem", height: "0.9rem" }}>
                <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {!atStart ? `Ch ${chapterIndex}` : ""}
            </button>
            <span style={{ color: theme.muted, fontSize: "0.72rem", fontFamily }}>
              {chapterIndex + 1} / {manifest.chapters.length}
            </span>
            <button
              onClick={goToNext}
              disabled={atEnd}
              style={{
                display: "flex", alignItems: "center", gap: "0.4rem",
                color:   atEnd ? theme.border : theme.muted,
                background: "none", border: "none",
                cursor:  atEnd ? "default" : "pointer",
                fontFamily, fontSize: "0.78rem", minHeight: "2.75rem",
              }}
            >
              {!atEnd ? `Ch ${chapterIndex + 2}` : ""}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} style={{ width: "0.9rem", height: "0.9rem" }}>
                <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* ── Bottom chrome ── */}
      <footer
        style={{
          flexShrink: 0,
          minHeight:  CHROME_H,
          paddingBottom: "env(safe-area-inset-bottom)",
          display:    "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding:    "0 1.25rem",
          background: theme.chrome,
          borderTop:  `1px solid ${theme.chromeBorder}`,
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          opacity,
          transition: "opacity 0.6s ease",
        }}
      >
        <button
          onClick={goToPrev}
          disabled={atStart}
          aria-label="Previous chapter"
          style={{
            minHeight: "2.75rem", minWidth: "2.75rem", display: "flex",
            alignItems: "center", justifyContent: "center",
            color:   atStart ? theme.border : theme.muted,
            background: "none", border: "none",
            cursor:  atStart ? "default" : "pointer",
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} style={{ width: "1.1rem", height: "1.1rem" }}>
            <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {/* Progress strip + label */}
        <div style={{ flex: 1, margin: "0 1rem", display: "flex", flexDirection: "column", alignItems: "center", gap: "0.3rem" }}>
          <div style={{ width: "100%", height: "2px", background: theme.border, borderRadius: "1px" }}>
            <div
              style={{
                height:     "100%",
                background: theme.accent,
                borderRadius: "1px",
                width:      `${((chapterIndex + 1) / manifest.chapters.length) * 100}%`,
                transition: "width 0.45s ease",
              }}
            />
          </div>
          <p style={{ fontSize: "0.67rem", color: theme.muted, fontFamily }}>
            Ch {chapterIndex + 1} of {manifest.chapters.length}
            {chapter?.totalWordCount
              ? ` · ~${Math.ceil(chapter.totalWordCount / 200)} min`
              : ""}
          </p>
        </div>

        <button
          onClick={goToNext}
          disabled={atEnd}
          aria-label="Next chapter"
          style={{
            minHeight: "2.75rem", minWidth: "2.75rem", display: "flex",
            alignItems: "center", justifyContent: "center",
            color:   atEnd ? theme.border : theme.muted,
            background: "none", border: "none",
            cursor:  atEnd ? "default" : "pointer",
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} style={{ width: "1.1rem", height: "1.1rem" }}>
            <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </footer>

      {/* ── Overlays ── */}
      <ChapterDrawer
        chapters={manifest.chapters}
        currentIndex={chapterIndex}
        open={tocOpen}
        onClose={() => setTocOpen(false)}
        onSelect={(i) => { setChapterIndex(i); setTocOpen(false); }}
        t={theme}
        fontFamily={fontFamily}
      />
      <ReaderSettingsPanel
        settings={settings}
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onChange={updateSettings}
        t={theme}
        fontFamily={fontFamily}
      />
    </div>
  );
}
