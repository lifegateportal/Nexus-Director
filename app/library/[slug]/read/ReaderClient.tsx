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
import { AudioReader } from "./AudioReader";
import { AnnotationsPanel, saveAnnotation, loadAnnotations, ANNO_COLOR_MAP } from "./AnnotationsPanel";
import type { AnnotationColor, Annotation } from "./AnnotationsPanel";

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

// ── Annotation highlight renderer ───────────────────────────────────────────
// Matches annotation selectedText (plain) inside a raw markdown line,
// wraps matched spans in <mark> with the annotation colour.

function HighlightedLine({
  text,
  annotations,
}: {
  text: string;
  annotations: { selectedText: string; color: AnnotationColor }[];
}) {
  // Derive plain text by stripping inline markdown
  const plain = text
    .replace(/\*\*\*([^*]+)\*\*\*/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1");

  type Range = { start: number; end: number; color: AnnotationColor };
  const ranges: Range[] = [];
  for (const anno of annotations) {
    if (!anno.selectedText || anno.selectedText.length < 3) continue;
    let idx = plain.indexOf(anno.selectedText);
    while (idx !== -1) {
      ranges.push({ start: idx, end: idx + anno.selectedText.length, color: anno.color });
      idx = plain.indexOf(anno.selectedText, idx + anno.selectedText.length);
    }
  }

  if (ranges.length === 0) return <InlineText text={text} />;

  // Sort and remove overlaps (keep first match's colour)
  ranges.sort((a, b) => a.start - b.start);
  const merged: Range[] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r.start < last.end) {
      last.end = Math.max(last.end, r.end);
    } else {
      merged.push({ ...r });
    }
  }

  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  for (const range of merged) {
    if (range.start > cursor) {
      nodes.push(<InlineText key={`t-${cursor}`} text={plain.slice(cursor, range.start)} />);
    }
    nodes.push(
      <mark
        key={`h-${range.start}`}
        style={{
          background: ANNO_COLOR_MAP[range.color].bg,
          color: "inherit",
          borderRadius: "0.15em",
          padding: "0.1em 0",
          boxDecorationBreak: "clone",
          WebkitBoxDecorationBreak: "clone",
        } as React.CSSProperties}
      >
        <InlineText text={plain.slice(range.start, range.end)} />
      </mark>,
    );
    cursor = range.end;
  }
  if (cursor < plain.length) {
    nodes.push(<InlineText key={`t-${cursor}`} text={plain.slice(cursor)} />);
  }
  return <>{nodes}</>;
}

function renderBody(
  text: string,
  theme: Theme,
  isFirstSection: boolean,
  annotations: { selectedText: string; color: AnnotationColor }[] = [],
): React.ReactNode[] {
  const lines = text.split("\n");
  const nodes: React.ReactNode[] = [];
  let i         = 0;
  let paraCount = 0;

  while (i < lines.length) {
    const raw  = lines[i];
    const line = raw.trim();
    if (!line) { i++; continue; }

    // H1 / H2 / H3 — breakInside/breakAfter prevent orphaned headings at column boundary
    if (/^### /.test(line)) {
      nodes.push(
        <h3 key={i} style={{ color: theme.muted, fontSize: "0.68em", letterSpacing: "0.16em", textTransform: "uppercase" as const, marginTop: "2.5em", marginBottom: "0.5em", fontWeight: 700, breakInside: "avoid", breakAfter: "avoid" } as React.CSSProperties}>
          <InlineText text={line.slice(4)} />
        </h3>,
      );
      i++; continue;
    }
    if (/^## /.test(line)) {
      nodes.push(
        <h2 key={i} style={{ color: theme.heading, fontSize: "1.15em", fontWeight: 700, marginTop: "2.5em", marginBottom: "0.85em", letterSpacing: "-0.01em", breakInside: "avoid", breakAfter: "avoid" } as React.CSSProperties}>
          <InlineText text={line.slice(3)} />
        </h2>,
      );
      i++; continue;
    }
    if (/^# /.test(line)) {
      nodes.push(
        <h2 key={i} style={{ color: theme.heading, fontSize: "1.25em", fontWeight: 700, marginTop: "2.5em", marginBottom: "0.85em", breakInside: "avoid", breakAfter: "avoid" } as React.CSSProperties}>
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
            breakInside:   "avoid",  // prevent quote from splitting across pages
          } as React.CSSProperties}
        >
          {qLines.map((ql, qi) => (
            <p key={qi} style={{ marginBottom: qi < qLines.length - 1 ? "0.4em" : 0 }}>
              <HighlightedLine text={ql} annotations={annotations} />
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
              <HighlightedLine text={item} annotations={annotations} />
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
              <HighlightedLine text={item} annotations={annotations} />
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
            <HighlightedLine text={line.slice(1)} annotations={annotations} />
          </>
        ) : (
          <HighlightedLine text={line} annotations={annotations} />
        )}
      </p>,
    );
    i++;
  }

  return nodes;
}

// ── Chapter content component ─────────────────────────────────────────────────

function ChapterView({
  chapter, theme, fontFamily, fontSize, lineHeight, annotations,
}: {
  chapter:     ChapterDraft;
  theme:       Theme;
  fontFamily:  string;
  fontSize:    number;
  lineHeight:  number;
  annotations: { selectedText: string; color: AnnotationColor }[];
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
          <div>{renderBody(section.body, theme, idx === 0, annotations)}</div>
        </section>
      ))}

      {/* Conclusion */}
      {chapter.conclusion && (
        <section style={{ marginTop: "3em" }}>
          <div style={{ textAlign: "center", margin: "2.5em 0", color: theme.accent, letterSpacing: "0.5em", fontSize: "0.85em" }}>
            ✦ ✦ ✦
          </div>
          {renderBody(chapter.conclusion, theme, false, annotations)}
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

// ── Selection popup — appears when user selects text in annotation mode ────────

const ANNO_SWATCHES: { key: AnnotationColor; dot: string }[] = [
  { key: "amber",   dot: "#f59e0b" },
  { key: "rose",    dot: "#f43f5e" },
  { key: "sky",     dot: "#0ea5e9" },
  { key: "emerald", dot: "#10b981" },
];

function SelectionPopup({
  selection, color, note, onColorChange, onNoteChange, onSave, onCancel, t, fontFamily,
}: {
  selection:     { text: string; rect: DOMRect };
  color:         AnnotationColor;
  note:          string;
  onColorChange: (c: AnnotationColor) => void;
  onNoteChange:  (n: string) => void;
  onSave:        () => void;
  onCancel:      () => void;
  t:             Theme;
  fontFamily:    string;
}) {
  // Position popup above selection if there's space, otherwise below it
  const POPUP_H = 166;
  const top  = selection.rect.top > POPUP_H + 12
    ? selection.rect.top  - POPUP_H - 8
    : selection.rect.bottom + 8;
  const left = Math.max(8, Math.min(
    selection.rect.left + selection.rect.width / 2 - 150,
    (typeof window !== "undefined" ? window.innerWidth : 400) - 308,
  ));

  return (
    <div
      onPointerDown={(e) => e.stopPropagation()} // prevent clearing selection
      style={{
        position: "fixed", top, left, width: 300, zIndex: 60,
        background: t.chrome,
        border: `1px solid ${t.chromeBorder}`,
        borderRadius: "0.85rem",
        backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
        padding: "0.95rem",
        boxShadow: "0 12px 40px rgba(0,0,0,0.4)",
      }}
    >
      {/* Preview */}
      <p style={{
        fontSize: "0.78rem", fontFamily: "Georgia, serif", fontStyle: "italic",
        color: t.muted, lineHeight: 1.5, marginBottom: "0.75rem",
        overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box",
        WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
      } as React.CSSProperties}>
        "{selection.text.slice(0, 90)}{selection.text.length > 90 ? "…" : ""}"
      </p>

      {/* Color swatches */}
      <div style={{ display: "flex", gap: "0.55rem", marginBottom: "0.7rem" }}>
        {ANNO_SWATCHES.map(({ key, dot }) => (
          <button
            key={key}
            onClick={() => onColorChange(key)}
            aria-label={key}
            style={{
              width: "1.65rem", height: "1.65rem", borderRadius: "50%",
              background: dot, cursor: "pointer",
              border: color === key ? `2.5px solid ${t.text}` : "2.5px solid transparent",
              transition: "border-color 0.15s",
            }}
          />
        ))}
      </div>

      {/* Note input */}
      <input
        type="text"
        placeholder="Add a note (optional)…"
        value={note}
        onChange={(e) => onNoteChange(e.target.value)}
        style={{
          width: "100%", fontSize: "1rem", fontFamily,
          background: "transparent",
          border: `1px solid ${t.border}`, borderRadius: "0.4rem",
          padding: "0.4rem 0.6rem", color: t.text,
          marginBottom: "0.7rem", outline: "none",
          boxSizing: "border-box",
        } as React.CSSProperties}
      />

      {/* Actions */}
      <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
        <button
          onClick={onCancel}
          style={{
            fontSize: "0.78rem", fontFamily, color: t.muted,
            background: "none", border: "none", cursor: "pointer",
            minHeight: "2.25rem", padding: "0 0.75rem",
          }}
        >Cancel</button>
        <button
          onClick={onSave}
          style={{
            fontSize: "0.78rem", fontFamily, color: "#fff",
            background: t.accent, border: "none", borderRadius: "0.4rem",
            cursor: "pointer", minHeight: "2.25rem", padding: "0 1rem",
          }}
        >Save highlight</button>
      </div>
    </div>
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

  // ── Page-flip state ──────────────────────────────────────────────────────
  const [pageIndex,     setPageIndex]     = useState(0);
  const [totalPages,    setTotalPages]    = useState(1);
  const [containerW,    setContainerW]    = useState(0);
  const [containerH,    setContainerH]    = useState(0);
  const [isFlipping,    setIsFlipping]    = useState(false);

  // ── Annotation + audio state ────────────────────────────────────────────────────
  const [annotationMode, setAnnotationMode] = useState(false);
  const [audioOpen,      setAudioOpen]      = useState(false);
  const [annoPanelOpen,  setAnnoPanelOpen]  = useState(false);
  const [selection,      setSelection]      = useState<{ text: string; rect: DOMRect } | null>(null);
  const [annoColor,      setAnnoColor]      = useState<AnnotationColor>("amber");
  const [annoNote,       setAnnoNote]       = useState("");
  // Inline highlights — reloaded whenever chapter or slug changes
  const [annotations,    setAnnotations]    = useState<Pick<Annotation, "selectedText" | "color">[]>([]);

  const containerRef    = useRef<HTMLDivElement>(null);
  const columnTrackRef  = useRef<HTMLDivElement>(null);
  const sentinelRef     = useRef<HTMLDivElement>(null);
  const inactivityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flipTimer       = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Touch / swipe tracking
  const touchStartX     = useRef(0);
  const touchStartY     = useRef(0);
  const touchStartTime  = useRef(0);

  // Refs so stable callbacks can read latest panel state
  const tocOpenRef      = useRef(tocOpen);
  const settingsOpenRef = useRef(settingsOpen);
  useEffect(() => { tocOpenRef.current      = tocOpen;      }, [tocOpen]);
  useEffect(() => { settingsOpenRef.current = settingsOpen; }, [settingsOpen]);

  // ── Reload annotation highlights when chapter / slug changes ─────────────
  const reloadAnnotations = useCallback(() => {
    setAnnotations(
      loadAnnotations(slug)
        .filter((a) => a.chapterIndex === chapterIndex)
        .map(({ selectedText, color }) => ({ selectedText, color })),
    );
  }, [slug, chapterIndex]);
  useEffect(() => { reloadAnnotations(); }, [reloadAnnotations]);

  // ── Lock page scroll while reader is mounted (prevents iOS rubber-band pan) ─
  useEffect(() => {
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow              = "hidden";
    return () => {
      document.documentElement.style.overflow = prev;
      document.body.style.overflow             = "";
    };
  }, []);

  // ── Block native touchmove scroll — only when NOT in annotation mode ────────
  useEffect(() => {
    if (annotationMode) return; // browser handles touches for text selection
    const el = containerRef.current;
    if (!el) return;
    const block = (e: TouchEvent) => e.preventDefault();
    el.addEventListener("touchmove", block, { passive: false });
    return () => el.removeEventListener("touchmove", block);
  }, [annotationMode]);
  // ── Measure container dimensions via ResizeObserver ────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setContainerW(el.clientWidth);
      setContainerH(el.clientHeight);
    });
    ro.observe(el);
    setContainerW(el.clientWidth);
    setContainerH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  // ── Count pages after render / chapter / settings change ────────────────
  // Sentinel div is placed after all chapter content. Its getBoundingClientRect()
  // left offset relative to the track tells us how many CSS columns were created.
  // Math.ceil handles the case where sentinel lands exactly at a column boundary.
  useEffect(() => {
    if (!containerW || !containerH) return;
    let raf1: number, raf2: number;
    const measure = () => {
      const track    = columnTrackRef.current;
      const sentinel = sentinelRef.current;
      if (!track || !sentinel) return;
      const trackLeft    = track.getBoundingClientRect().left;
      const sentinelLeft = sentinel.getBoundingClientRect().left;
      const pages = Math.max(1, Math.ceil((sentinelLeft - trackLeft) / containerW));
      setTotalPages(pages);
      setPageIndex(0);
    };
    raf1 = requestAnimationFrame(() => { raf2 = requestAnimationFrame(measure); });
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); };
  }, [chapterIndex, containerW, containerH, settings]);

  // ── Restore settings + position ──────────────────────────────────────────
  useEffect(() => {
    const saved = getReaderSettings();
    setSettings(saved);
    if (initialChapter === undefined) {
      const pos = getReadingPosition(slug);
      if (pos) setChapterIndex(Math.min(pos.chapterIndex, manifest.chapters.length - 1));
    }
  }, [slug, manifest.chapters.length, initialChapter]);

  // Persist position whenever chapter or page changes
  useEffect(() => {
    saveReadingPosition(slug, { chapterIndex, scrollPercentage: pageIndex / Math.max(1, totalPages - 1) });
  }, [slug, chapterIndex, pageIndex, totalPages]);

  // ── Chrome auto-hide ──────────────────────────────────────────────────────
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

  useEffect(() => {
    if (tocOpen || settingsOpen) {
      setShowChrome(true);
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
    }
  }, [tocOpen, settingsOpen]);

  // ── Annotation text-selection detection ─────────────────────────────────────
  useEffect(() => {
    if (!annotationMode) { setSelection(null); return; }
    const detect = () => {
      const sel  = window.getSelection();
      const text = sel?.toString().trim() ?? "";
      if (text.length < 3) { setSelection(null); return; }
      const rect = sel!.getRangeAt(0).getBoundingClientRect();
      setSelection({ text, rect });
    };
    document.addEventListener("pointerup", detect);
    document.addEventListener("mouseup",   detect);
    return () => {
      document.removeEventListener("pointerup", detect);
      document.removeEventListener("mouseup",   detect);
    };
  }, [annotationMode]);

  // ── Page navigation — crossfade (no sliding body) ─────────────────────────
  // Phase 1: fade content out (160ms)
  // Phase 2: jump to new page instantly, fade back in
  const triggerFlip = useCallback((dir: "prev" | "next") => {
    if (isFlipping) return; // prevent double-tap during animation
    setIsFlipping(true);
    if (flipTimer.current) clearTimeout(flipTimer.current);
    flipTimer.current = setTimeout(() => {
      // Update page/chapter at the invisible midpoint
      if (dir === "prev") {
        setPageIndex((p) => {
          if (p > 0) return p - 1;
          setChapterIndex((ci) => Math.max(0, ci - 1));
          return 0;
        });
      } else {
        setPageIndex((p) => {
          if (p < totalPages - 1) return p + 1;
          setChapterIndex((ci) => Math.min(manifest.chapters.length - 1, ci + 1));
          return 0;
        });
      }
      setIsFlipping(false); // fade back in
    }, 160);
  }, [isFlipping, totalPages, manifest.chapters.length]);

  // Chapter-level navigation (from ToC)
  const goToChapter = useCallback((i: number) => {
    setChapterIndex(i);
    setPageIndex(0);
  }, []);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowLeft"  || e.key === "ArrowUp")    triggerFlip("prev");
      if (e.key === "ArrowRight" || e.key === "ArrowDown")  triggerFlip("next");
      if (e.key === "t" || e.key === "T") setTocOpen((v) => !v);
      if (e.key === "Escape") { setTocOpen(false); setSettingsOpen(false); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [triggerFlip]);

  // ── Touch / swipe gestures ────────────────────────────────────────────────
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  }, []);

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    // Only horizontal swipes wider than 40px and not mostly vertical
    if (Math.abs(dx) < 40 || Math.abs(dy) > Math.abs(dx) * 0.9) return;
    if (dx > 0) triggerFlip("prev"); else triggerFlip("next");
  }, [triggerFlip]);

  // ── Tap-zone page turn (left 30% = prev, right 30% = next) ───────────────
  const onAreaClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // Ignore clicks on interactive elements
    if ((e.target as HTMLElement).closest("button,a,select,input,textarea")) return;
    if (tocOpen || settingsOpen) { setTocOpen(false); setSettingsOpen(false); return; }
    const x = e.clientX;
    const w = e.currentTarget.clientWidth;
    if (x < w * 0.30) triggerFlip("prev");
    else if (x > w * 0.70) triggerFlip("next");
    else resetInactivity();
  }, [tocOpen, settingsOpen, triggerFlip, resetInactivity]);

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

  // Global progress across all pages of all chapters
  const totalChapters = manifest.chapters.length;
  const globalProgress = totalChapters === 0 ? 0 :
    ((chapterIndex + (pageIndex + 1) / Math.max(1, totalPages)) / totalChapters) * 100;

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

  // Horizontal offset — each "page" is exactly one CSS column (containerW wide)
  const translateX = containerW > 0 ? -(pageIndex * containerW) : 0;

  return (
    <div
      style={{
        height: "100dvh", display: "flex", flexDirection: "column",
        overflow: "hidden", background: theme.bg, color: theme.text,
        position: "relative",
      }}
    >
      {/* Fine global progress line at very top */}
      <ProgressBar current={globalProgress} total={100} accent={theme.accent} />

      {/* ── Top chrome ── */}
      <header
        style={{
          flexShrink: 0, height: CHROME_H, display: "flex",
          alignItems: "center", justifyContent: "space-between",
          padding: "0 1rem", background: theme.chrome,
          borderBottom: `1px solid ${theme.chromeBorder}`,
          backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
          opacity, transition: "opacity 0.6s ease",
          position: "relative", zIndex: 10,
        }}
      >
        <Link
          href={`/library/${slug}`}
          style={{
            display: "flex", alignItems: "center", gap: "0.4rem",
            color: theme.muted, fontSize: "0.78rem", fontFamily,
            textDecoration: "none", minHeight: "2.75rem", padding: "0 0.25rem",
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} style={{ width: "0.95rem", height: "0.95rem" }}>
            <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Library
        </Link>

        <p style={{
          flex: 1, textAlign: "center", overflow: "hidden",
          textOverflow: "ellipsis", whiteSpace: "nowrap",
          padding: "0 0.75rem", color: theme.muted,
          fontSize: "0.78rem", fontFamily: "Georgia, serif",
        }}>
          {chapter ? `Ch ${chapter.number} · ${chapter.title}` : manifest.bookTitle}
        </p>

        <div style={{ display: "flex", alignItems: "center" }}>
          {/* Annotations panel */}
          {iconBtn("Annotations", () => { setAnnoPanelOpen((v) => !v); setTocOpen(false); setSettingsOpen(false); },
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} style={{ width: "1rem", height: "1rem" }}>
              <path d="M19 3H5a2 2 0 0 0-2 2v14l4-4h12a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>,
          )}
          {/* Annotate mode toggle */}
          <button
            onClick={() => { setAnnotationMode((v) => !v); setTocOpen(false); setSettingsOpen(false); }}
            aria-label={annotationMode ? "Exit annotate mode" : "Annotate"}
            style={{
              minHeight: "2.75rem", minWidth: "2.75rem", display: "flex",
              alignItems: "center", justifyContent: "center",
              color:      annotationMode ? theme.accent : theme.muted,
              background: annotationMode ? `${theme.accent}1a` : "none",
              border: "none", cursor: "pointer", borderRadius: "0.5rem",
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} style={{ width: "1rem", height: "1rem" }}>
              <path d="M12 20h9" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {/* Audio reader */}
          <button
            onClick={() => setAudioOpen((v) => !v)}
            aria-label={audioOpen ? "Close audio reader" : "Read aloud"}
            style={{
              minHeight: "2.75rem", minWidth: "2.75rem", display: "flex",
              alignItems: "center", justifyContent: "center",
              color:      audioOpen ? theme.accent : theme.muted,
              background: audioOpen ? `${theme.accent}1a` : "none",
              border: "none", cursor: "pointer", borderRadius: "0.5rem",
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} style={{ width: "1rem", height: "1rem" }}>
              <path d="M3 18v-6a9 9 0 0 1 18 0v6" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
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

      {/* ── Page viewport — clips to one page at a time ── */}
      <div
        ref={containerRef}
        style={{
          flex: 1, overflow: "hidden", position: "relative",
          // Annotation mode: allow text selection; reading mode: fully locked
          userSelect:  annotationMode ? "text" : "none",
          touchAction: annotationMode ? "auto" : "none",
        }}
        onClick={onAreaClick}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {/* Invisible tap-zone hints */}
        <div style={{ position: "absolute", inset: 0, display: "flex", pointerEvents: "none", zIndex: 2 }}>
          <div style={{ width: "30%", height: "100%" }} />
          <div style={{ flex: 1, height: "100%" }} />
          <div style={{ width: "30%", height: "100%" }} />
        </div>

        {/* Column track — CSS multi-column, one column = one page              */}
        {/* position:absolute breaks it free of containerW width constraint      */}
        {/* overflow:hidden on the column track keeps extra empty cols clipped   */}
        {/* translateX jumps INSTANTLY (no transition) — body never moves        */}
        {/* Fade on opacity gives the clean Kindle page-cut feel                 */}
        <div
          ref={columnTrackRef}
          style={{
            position:    "absolute",
            top:         0,
            left:        0,
            // Large fixed width so CSS can create up to ~200 columns
            width:       containerW > 0 ? `${containerW * 200}px` : "100%",
            height:      containerH > 0 ? `${containerH}px` : "100%",
            // CSS multi-column: each column = containerW × containerH = one page
            columnWidth: containerW > 0 ? `${containerW}px` : "auto",
            columnGap:   0,
            columnFill:  "auto",
            overflow:    "hidden",
            // Instant jump — no slide, body stays completely still
            transform:   `translateX(${translateX}px)`,
            // Crossfade: fade out on flip start, fade in on flip end
            opacity:     isFlipping ? 0 : 1,
            transition:  isFlipping
              ? "opacity 0.14s ease-out"
              : "opacity 0.22s ease-in",
            willChange:  "opacity",
          }}
        >
          {/* Padding wrapper with box-decoration-break:clone so EVERY page      */}
          {/* fragment (column) gets its own top/bottom/left/right padding        */}
          <div
            style={{
              padding:                  "2.5rem max(1.5rem, 6vw) 2rem",
              boxDecorationBreak:       "clone",
              WebkitBoxDecorationBreak: "clone",
              // Text cursor in annotation mode signals to the user they can select
              userSelect: annotationMode ? "text" : "none",
              cursor:     annotationMode ? "text" : "default",
            } as React.CSSProperties}
          >
            {chapter && (
              <ChapterView
                chapter={chapter}
                theme={theme}
                fontFamily={fontFamily}
                fontSize={fontSize}
                lineHeight={lineHeight}
                annotations={annotations}
              />
            )}
            {/* Sentinel: measures how many columns content spans */}
            <div ref={sentinelRef} style={{ height: "1px", width: "1px", display: "block" }} />
          </div>
        </div>

        {/* Right-edge shadow — subtle visual page boundary */}
        <div style={{
          position:   "absolute", top: 0, right: 0, bottom: 0, width: "3px",
          background: `linear-gradient(to left, ${theme.border}88, transparent)`,
          pointerEvents: "none", zIndex: 1,
        }} />
      </div>

      {/* ── Bottom chrome ── */}
      <footer
        style={{
          flexShrink: 0, minHeight: CHROME_H,
          paddingBottom: "env(safe-area-inset-bottom)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 1.25rem", background: theme.chrome,
          borderTop: `1px solid ${theme.chromeBorder}`,
          backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
          opacity, transition: "opacity 0.6s ease",
        }}
      >
        {/* Prev page */}
        <button
          onClick={() => triggerFlip("prev")}
          disabled={chapterIndex === 0 && pageIndex === 0}
          aria-label="Previous page"
          style={{
            minHeight: "2.75rem", minWidth: "2.75rem", display: "flex",
            alignItems: "center", justifyContent: "center",
            color: (chapterIndex === 0 && pageIndex === 0) ? theme.border : theme.muted,
            background: "none", border: "none",
            cursor: (chapterIndex === 0 && pageIndex === 0) ? "default" : "pointer",
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} style={{ width: "1.1rem", height: "1.1rem" }}>
            <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {/* Page indicator */}
        <div style={{ flex: 1, margin: "0 1rem", display: "flex", flexDirection: "column", alignItems: "center", gap: "0.3rem" }}>
          <div style={{ width: "100%", height: "2px", background: theme.border, borderRadius: "1px" }}>
            <div style={{
              height: "100%", background: theme.accent, borderRadius: "1px",
              width: `${globalProgress}%`, transition: "width 0.45s ease",
            }} />
          </div>
          <p style={{ fontSize: "0.67rem", color: theme.muted, fontFamily }}>
            {totalPages > 1
              ? `Page ${pageIndex + 1} of ${totalPages} · Ch ${chapterIndex + 1}/${totalChapters}`
              : `Ch ${chapterIndex + 1} of ${totalChapters}`}
            {chapter?.totalWordCount ? ` · ~${Math.ceil(chapter.totalWordCount / 200)} min` : ""}
          </p>
        </div>

        {/* Next page */}
        <button
          onClick={() => triggerFlip("next")}
          disabled={chapterIndex >= totalChapters - 1 && pageIndex >= totalPages - 1}
          aria-label="Next page"
          style={{
            minHeight: "2.75rem", minWidth: "2.75rem", display: "flex",
            alignItems: "center", justifyContent: "center",
            color: (chapterIndex >= totalChapters - 1 && pageIndex >= totalPages - 1) ? theme.border : theme.muted,
            background: "none", border: "none",
            cursor: (chapterIndex >= totalChapters - 1 && pageIndex >= totalPages - 1) ? "default" : "pointer",
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} style={{ width: "1.1rem", height: "1.1rem" }}>
            <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </footer>

      {/* ── Annotation mode banner (thin strip below header) ── */}
      {annotationMode && (
        <div
          style={{
            position: "absolute",
            top: CHROME_H, left: 0, right: 0,
            zIndex: 15, pointerEvents: "none",
            display: "flex", alignItems: "center", justifyContent: "center",
            gap: "0.5rem", padding: "0.35rem 1rem",
            background: `${theme.accent}18`,
            borderBottom: `1px solid ${theme.accent}30`,
          }}
        >
          <span style={{ fontSize: "0.67rem", letterSpacing: "0.12em", textTransform: "uppercase", color: theme.accent, fontFamily }}>
            Annotate mode — select text to highlight
          </span>
        </div>
      )}

      {/* ── Selection popup ── */}
      {annotationMode && selection && (
        <SelectionPopup
          selection={selection}
          color={annoColor}
          note={annoNote}
          onColorChange={setAnnoColor}
          onNoteChange={setAnnoNote}
          onSave={() => {
            saveAnnotation({
              id:           crypto.randomUUID(),
              slug,
              chapterIndex,
              chapterTitle: chapter?.title ?? "",
              selectedText: selection.text,
              note:         annoNote,
              color:        annoColor,
              createdAt:    Date.now(),
            });
            reloadAnnotations(); // refresh inline highlights immediately
            setSelection(null);
            setAnnoNote("");
            window.getSelection()?.removeAllRanges();
          }}
          onCancel={() => {
            setSelection(null);
            setAnnoNote("");
            window.getSelection()?.removeAllRanges();
          }}
          t={theme}
          fontFamily={fontFamily}
        />
      )}

      {/* ── Audio reader bar (sits between viewport and footer in flex column) ── */}
      {audioOpen && chapter && (
        <AudioReader
          chapter={chapter}
          theme={theme}
          fontFamily={fontFamily}
          onClose={() => setAudioOpen(false)}
        />
      )}

      {/* ── Overlays ── */}
      <ChapterDrawer
        chapters={manifest.chapters}
        currentIndex={chapterIndex}
        open={tocOpen}
        onClose={() => setTocOpen(false)}
        onSelect={(i) => { goToChapter(i); setTocOpen(false); }}
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
      <AnnotationsPanel
        slug={slug}
        open={annoPanelOpen}
        onClose={() => setAnnoPanelOpen(false)}
        t={theme}
        fontFamily={fontFamily}
      />
    </div>
  );
}
