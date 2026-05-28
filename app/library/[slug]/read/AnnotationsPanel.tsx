"use client";

import { useState, useEffect } from "react";

export type AnnotationColor = "amber" | "rose" | "sky" | "emerald";

export interface Annotation {
  id:            string;
  slug:          string;
  chapterIndex:  number;
  chapterTitle:  string;
  selectedText:  string;
  note:          string;
  color:         AnnotationColor;
  createdAt:     number;
}

export const ANNO_COLOR_MAP: Record<AnnotationColor, { bg: string; border: string; dot: string }> = {
  amber:   { bg: "rgba(251,191,36,0.22)",  border: "#f59e0b", dot: "#f59e0b" },
  rose:    { bg: "rgba(251,113,133,0.18)", border: "#f43f5e", dot: "#f43f5e" },
  sky:     { bg: "rgba(56,189,248,0.18)",  border: "#0ea5e9", dot: "#0ea5e9" },
  emerald: { bg: "rgba(52,211,153,0.18)",  border: "#10b981", dot: "#10b981" },
};

const key = (slug: string) => `nx-ann-${slug}`;

export function loadAnnotations(slug: string): Annotation[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(key(slug)) ?? "[]"); }
  catch { return []; }
}

export function saveAnnotation(ann: Annotation) {
  const all = loadAnnotations(ann.slug);
  localStorage.setItem(key(ann.slug), JSON.stringify([...all, ann]));
}

export function deleteAnnotation(slug: string, id: string) {
  const all = loadAnnotations(slug);
  localStorage.setItem(key(slug), JSON.stringify(all.filter(a => a.id !== id)));
}

// ── Panel component ───────────────────────────────────────────────────────────

interface PanelProps {
  slug:       string;
  open:       boolean;
  onClose:    () => void;
  t: {
    bg:          string;
    text:        string;
    muted:       string;
    border:      string;
    chrome:      string;
    chromeBorder:string;
    accent:      string;
  };
  fontFamily: string;
}

export function AnnotationsPanel({ slug, open, onClose, t, fontFamily }: PanelProps) {
  const [anns, setAnns] = useState<Annotation[]>([]);

  useEffect(() => {
    if (open) setAnns(loadAnnotations(slug));
  }, [open, slug]);

  const del = (id: string) => {
    deleteAnnotation(slug, id);
    setAnns(a => a.filter(x => x.id !== id));
  };

  return (
    <div
      style={{
        position:   "absolute", inset: 0, zIndex: 40,
        background: t.bg,
        transform:  open ? "translateX(0)" : "translateX(100%)",
        transition: "transform 0.28s cubic-bezier(0.4,0,0.2,1)",
        display:    "flex", flexDirection: "column", overflow: "hidden",
      }}
    >
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 1.25rem", height: "3.25rem", flexShrink: 0,
        borderBottom: `1px solid ${t.border}`,
      }}>
        <p style={{
          fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.14em",
          textTransform: "uppercase", color: t.muted, fontFamily,
        }}>
          Annotations
        </p>
        <button
          onClick={onClose}
          aria-label="Close annotations"
          style={{
            background: "none", border: "none", cursor: "pointer",
            color: t.muted, display: "flex", minHeight: "2.75rem",
            minWidth: "2.75rem", alignItems: "center", justifyContent: "center",
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ width: "1rem", height: "1rem" }}>
            <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: "auto", padding: "1rem 1.25rem" }}>
        {anns.length === 0 ? (
          <div style={{ textAlign: "center", padding: "4rem 0", color: t.muted }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.2}
              style={{ width: "2.5rem", height: "2.5rem", margin: "0 auto 1rem", opacity: 0.4 }}>
              <path d="M12 20h9" strokeLinecap="round" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" strokeLinecap="round" />
            </svg>
            <p style={{ fontSize: "0.85rem", fontFamily }}>No annotations yet</p>
            <p style={{ fontSize: "0.73rem", marginTop: "0.4rem", fontFamily, opacity: 0.6 }}>
              Tap the pencil icon to enter Annotate mode,<br />then select any text to highlight it.
            </p>
          </div>
        ) : (
          [...anns].sort((a, b) => a.createdAt - b.createdAt).map(ann => {
            const c = ANNO_COLOR_MAP[ann.color];
            return (
              <div
                key={ann.id}
                style={{
                  marginBottom: "1rem", borderRadius: "0.6rem",
                  background: c.bg, border: `1px solid ${c.border}`,
                  padding: "0.85rem 1rem", position: "relative",
                }}
              >
                <p style={{
                  fontSize: "0.63rem", color: t.muted, fontFamily,
                  marginBottom: "0.45rem", letterSpacing: "0.08em",
                  textTransform: "uppercase",
                }}>
                  Ch {ann.chapterIndex + 1} · {ann.chapterTitle}
                </p>
                <p style={{
                  fontSize: "0.87rem", fontFamily: "Georgia, serif",
                  fontStyle: "italic", color: t.text,
                  lineHeight: 1.6, marginBottom: ann.note ? "0.5rem" : 0,
                }}>
                  "{ann.selectedText}"
                </p>
                {ann.note && (
                  <p style={{ fontSize: "0.78rem", fontFamily, color: t.muted, lineHeight: 1.5 }}>
                    {ann.note}
                  </p>
                )}
                <button
                  onClick={() => del(ann.id)}
                  aria-label="Delete annotation"
                  style={{
                    position: "absolute", top: "0.4rem", right: "0.4rem",
                    background: "none", border: "none", cursor: "pointer",
                    color: t.muted, opacity: 0.55,
                    minHeight: "2rem", minWidth: "2rem",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ width: "0.75rem", height: "0.75rem" }}>
                    <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
