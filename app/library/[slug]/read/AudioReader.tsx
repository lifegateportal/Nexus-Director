"use client";

import { useEffect, useRef } from "react";
import type { ChapterDraft } from "@/lib/schemas/ebook";
import {
  useAudioPlayer,
  RATES,
  type Segment,
  type SegmentType,
  type AudioChapterMeta,
} from "@/lib/audio-player-context";

// Re-export types so existing imports in ReaderClient don't break
export type { Segment, SegmentType };

// AudioState is used by the UI render below
type AudioState = "idle" | "playing" | "paused";

// ── 1. Text pre-processing — clean abbreviations, punctuation, noise ──────────

function sanitizeForSpeech(text: string): string {
  return text
    // common abbreviations → full words (prevents "e dot g dot" robot reading)
    .replace(/\be\.g\./gi,   "for example")
    .replace(/\bi\.e\./gi,   "that is")
    .replace(/\betc\./gi,    "and so on")
    .replace(/\bvs\./gi,     "versus")
    .replace(/\bDr\./g,      "Doctor")
    .replace(/\bMr\./g,      "Mister")
    .replace(/\bMrs\./g,     "Missus")
    .replace(/\bMs\./g,      "Miss")
    .replace(/\bProf\./g,    "Professor")
    .replace(/\bSt\./g,      "Saint")
    // em-dash → comma pause (natural breathing)
    .replace(/\s*—\s*/g,     ", ")
    // ellipsis → sentence pause
    .replace(/…/g,           ". ")
    .replace(/\.\.\./g,      ". ")
    // backtick code → plain text
    .replace(/`([^`]+)`/g,   "$1")
    // URLs → silence
    .replace(/https?:\/\/\S+/g, "")
    // numeric citations [1], [2], footnote refs
    .replace(/\[\d+\]/g,     "")
    .replace(/\[citation[^\]]*\]/gi, "")
    // page refs like (pg. 12) or (p. 3)
    .replace(/\(p(?:g)?\.?\s*\d+\)/gi, "")
    // strip remaining markdown bold/italic
    .replace(/\*\*\*([^*]+)\*\*\*/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g,     "$1")
    .replace(/\*([^*]+)\*/g,          "$1")
    .trim();
}

// ── 2. Sentence-level splitting — each sentence = one utterance ───────────────
//    Resets charIndex per sentence → more accurate word-boundary tracking.

function splitSentences(text: string): string[] {
  // Split after . ! ? when followed by whitespace + capital letter or quote
  const parts = text.split(/(?<=[.!?])\s+(?=[A-Z"'\u201C\u2018])/);
  return parts.map(s => s.trim()).filter(Boolean);
}

// ── Parse chapter into typed segments ─────────────────────────────────────────
// Also exported so ReaderClient can build a paraKey→segIdx map for click-to-start.

export function parseChapter(chapter: ChapterDraft): Segment[] {
  const segs: Segment[] = [];

  const stripMd = (s: string) =>
    s.replace(/\*\*\*([^*]+)\*\*\*/g, "$1")
     .replace(/\*\*([^*]+)\*\*/g, "$1")
     .replace(/\*([^*]+)\*/g, "$1")
     .trim();

  const pushSentences = (type: SegmentType, raw: string, paraKey: string) => {
    const clean = sanitizeForSpeech(stripMd(raw));
    if (!clean) return;
    if (type === "heading" || type === "chapter-title") {
      segs.push({ type, text: clean, paraKey });
    } else {
      for (const sentence of splitSentences(clean)) {
        if (sentence.trim()) segs.push({ type, text: sentence.trim(), paraKey });
      }
    }
  };

  // Mirrors the block-grouping logic in renderBody so paraKeys align between
  // AudioReader segments and data-pkey attributes on rendered DOM elements.
  const processBody = (text: string, prefix: string) => {
    const lines = text.split("\n");
    let blockIdx = 0;
    let i = 0;
    while (i < lines.length) {
      const line = lines[i].trim();
      if (!line || /^---+$/.test(line)) { i++; continue; }
      const key = `${prefix}_b${blockIdx}`;
      if (/^#{1,3} /.test(line)) {
        pushSentences("heading", line.replace(/^#{1,3} /, ""), key);
        blockIdx++; i++; continue;
      }
      if (/^> /.test(line)) {
        // Group consecutive quote lines — same key, matching renderBody's <blockquote>
        while (i < lines.length && /^> /.test(lines[i].trim())) {
          pushSentences("quote", lines[i].trim().slice(2), key);
          i++;
        }
        blockIdx++; continue;
      }
      if (/^[*-] /.test(line)) {
        while (i < lines.length && /^[*-] /.test(lines[i].trim())) {
          pushSentences("body", lines[i].trim().slice(2), key);
          i++;
        }
        blockIdx++; continue;
      }
      if (/^\d+\. /.test(line)) {
        while (i < lines.length && /^\d+\. /.test(lines[i].trim())) {
          pushSentences("body", lines[i].trim().replace(/^\d+\. /, ""), key);
          i++;
        }
        blockIdx++; continue;
      }
      pushSentences("body", line, key);
      blockIdx++; i++;
    }
  };

  pushSentences("chapter-title", `Chapter ${chapter.number}. ${chapter.title}.`, "title");
  if (chapter.epigraph)      pushSentences("quote", chapter.epigraph, "epigraph");
  if (chapter.intro)         pushSentences("body",  chapter.intro,    "intro");

  for (let si = 0; si < chapter.sections.length; si++) {
    const section = chapter.sections[si];
    if (section.heading) pushSentences("heading", section.heading, `s${si}_h`);
    processBody(section.body, `s${si}`);
  }
  if (chapter.forwardQuestion) pushSentences("body", chapter.forwardQuestion, "fwd");

  return segs.filter(s => s.text.length > 0);
}

// ── 5. Voice selection — prefers enhanced/neural voices ──────────────────────

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  chapter:    ChapterDraft;
  /** Book-level metadata forwarded to the global audio context. */
  bookTitle:  string;
  /** Absolute pathname back to this reader, e.g. /library/my-book/read */
  readerHref: string;
  theme: {
    muted:        string;
    accent:       string;
    chrome:       string;
    chromeBorder: string;
    text:         string;
    border:       string;
    bg:           string;
  };
  fontFamily: string;
  onClose:     () => void;
  /** Called each time a new segment starts speaking. Used for in-page highlighting. */
  onProgress?: (segIdx: number, paraKey: string) => void;
  /** Jump to this segment index (e.g. from a tap-to-start paragraph click). */
  startFrom?:  number;
}

export function AudioReader({
  chapter, bookTitle, readerHref, theme, fontFamily,
  onClose, onProgress, startFrom,
}: Props) {
  const {
    state, currentSeg, currentWord, segIdx, segTotal,
    rateIdx, setChapter, play, pause, resume, stop, cycleRate, seekTo,
  } = useAudioPlayer();

  const prevStartFrom = useRef<number | undefined>(undefined);

  // Register chapter with the global engine when chapter changes
  useEffect(() => {
    const segs: Segment[] = parseChapter(chapter);
    const meta: AudioChapterMeta = {
      chapterKey: `ch-${chapter.number}`,
      title:      chapter.title,
      number:     chapter.number,
      bookTitle,
      readerHref,
    };
    setChapter(segs, meta, onProgress);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapter, bookTitle, readerHref]);

  // Keep onProgress callback fresh without triggering a chapter reset
  const onProgressRef = useRef(onProgress);
  useEffect(() => { onProgressRef.current = onProgress; }, [onProgress]);

  // Jump to a specific segment when startFrom prop changes
  useEffect(() => {
    if (startFrom === undefined) return;
    if (startFrom === prevStartFrom.current) return;
    prevStartFrom.current = startFrom;
    seekTo(startFrom);
  }, [startFrom, seekTo]);

  const togglePlay = () => {
    if (!window.speechSynthesis) return;
    if      (state === "idle")    play();
    else if (state === "playing") pause();
    else if (state === "paused")  resume();
  };

  const wordTokens = currentSeg
    ? currentSeg.text.split(/(\s+)/).filter(t => !/^\s+$/.test(t))
    : [];

  const segBadge: Record<SegmentType, { label: string; color: string }> = {
    "chapter-title": { label: "Chapter",   color: theme.accent },
    "heading":       { label: "Section",   color: theme.accent },
    "quote":         { label: "Quote",     color: "#0ea5e9"    },
    "body":          { label: "Narration", color: theme.muted  },
  };

  return (
    <div style={{ flexShrink: 0 }}>
      {/* ── CSS keyframes for equalizer bars ── */}
      <style>{`
        @keyframes nxEqA { 0%,100%{height:3px} 50%{height:11px} }
        @keyframes nxEqB { 0%,100%{height:8px} 40%{height:3px} 80%{height:13px} }
        @keyframes nxEqC { 0%,100%{height:5px} 60%{height:12px} }
      `}</style>

      {/* ── Chapter progress bar ── */}
      <div style={{ height: "2px", background: `${theme.accent}18`, overflow: "hidden" }}>
        <div style={{
          height: "100%",
          width: segTotal > 0
            ? `${Math.round((segIdx / segTotal) * 100)}%`
            : "0%",
          background: `linear-gradient(to right, ${theme.accent}bb, ${theme.accent})`,
          transition: "width 0.5s ease",
        }} />
      </div>

      {/* ── Now-reading strip ── */}
      {currentSeg && state !== "idle" && (
        <div style={{
          padding: "0.7rem 1.25rem 0.75rem",
          background: `${theme.chrome}f8`,
          borderTop: `1px solid ${theme.chromeBorder}`,
          backdropFilter: "blur(28px)",
          WebkitBackdropFilter: "blur(28px)",
        }}>

          {/* Meta row: EQ bars + segment label + position counter */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.55rem", marginBottom: "0.4rem" }}>

            {/* Animated equalizer */}
            <div style={{ display: "flex", alignItems: "flex-end", gap: "2px", height: "13px", flexShrink: 0 }}>
              {[
                { anim: "nxEqA", dur: "0.75s", delay: "0ms",   h: 4 },
                { anim: "nxEqB", dur: "0.9s",  delay: "130ms", h: 8 },
                { anim: "nxEqC", dur: "0.65s", delay: "260ms", h: 5 },
              ].map((bar, i) => (
                <div key={i} style={{
                  width: "3px", height: `${bar.h}px`, borderRadius: "2px",
                  background: segBadge[currentSeg.type].color,
                  opacity: state === "playing" ? 1 : 0.4,
                  animation: state === "playing"
                    ? `${bar.anim} ${bar.dur} ease-in-out infinite`
                    : "none",
                  animationDelay: bar.delay,
                }} />
              ))}
            </div>

            {/* Segment type label */}
            <span style={{
              fontSize: "0.575rem", letterSpacing: "0.13em",
              textTransform: "uppercase", fontFamily, fontWeight: 600,
              color: segBadge[currentSeg.type].color,
            }}>
              {segBadge[currentSeg.type].label}
            </span>

            <span style={{ flex: 1 }} />

            {/* Position counter */}
            <span style={{ fontSize: "0.575rem", letterSpacing: "0.04em", fontFamily, color: theme.muted }}>
              {segIdx + 1}{" "}
              <span style={{ opacity: 0.4 }}>/</span>{" "}
              {segTotal}
            </span>
          </div>

          {/* Word-highlighted sentence */}
          <p style={{
            margin: 0, lineHeight: 1.6,
            fontSize: currentSeg.type === "heading" || currentSeg.type === "chapter-title" ? "0.91rem" : "0.83rem",
            fontFamily: currentSeg.type === "quote" ? "Georgia, serif" : fontFamily,
            fontStyle:  currentSeg.type === "quote" ? "italic" : "normal",
            fontWeight: currentSeg.type === "heading" || currentSeg.type === "chapter-title" ? 700 : 400,
            color: theme.text,
          }}>
            {wordTokens.map((word, i) => (
              <span key={i} style={{
                background:   i === currentWord ? `${theme.accent}32` : "transparent",
                color:        i === currentWord ? theme.accent : "inherit",
                fontWeight:   i === currentWord ? 600 : "inherit",
                borderRadius: "0.2rem",
                padding:      i === currentWord ? "0.05rem 0.12rem" : "0",
                transition:   "background 0.09s ease, color 0.09s ease",
              }}>
                {word}{" "}
              </span>
            ))}
          </p>
        </div>
      )}

      {/* ── Controls bar ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: "0.35rem",
        padding: "0 0.85rem 0 1.25rem",
        height: "3.5rem",
        background: theme.chrome,
        borderTop: `1px solid ${theme.chromeBorder}`,
        backdropFilter: "blur(28px)", WebkitBackdropFilter: "blur(28px)",
      }}>

        {/* Track info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{
            margin: 0, lineHeight: 1.25,
            fontSize: "0.72rem", fontFamily, fontWeight: 500,
            color: theme.text,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            Chapter {chapter.number}
          </p>
          <p style={{ margin: "0.12rem 0 0", lineHeight: 1.25, fontSize: "0.62rem", fontFamily, color: theme.muted }}>
            {state === "playing" ? "Now reading…"
              : state === "paused" ? "Paused"
              : chapter.title}
          </p>
        </div>

        {/* Speed pill */}
        <button onClick={cycleRate} aria-label="Change speed" style={{
          fontSize: "0.68rem", fontFamily, fontWeight: 700,
          color: theme.accent,
          background: `${theme.accent}14`,
          border: `1px solid ${theme.accent}3a`,
          borderRadius: "999px", padding: "0.22rem 0.7rem",
          cursor: "pointer", minHeight: "2rem",
          transition: "background 0.15s ease",
          flexShrink: 0,
        }}>
          {RATES[rateIdx]}×
        </button>

        {/* Stop */}
        {state !== "idle" && (
          <button onClick={stop} aria-label="Stop" style={{
            width: "2.25rem", height: "2.25rem",
            background: "none",
            border: `1px solid ${theme.border}`,
            borderRadius: "50%", cursor: "pointer",
            color: theme.muted,
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
            transition: "border-color 0.15s ease",
          }}>
            <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: "0.75rem", height: "0.75rem" }}>
              <rect x="5" y="5" width="14" height="14" rx="3" />
            </svg>
          </button>
        )}

        {/* Play / Pause */}
        <button onClick={togglePlay} aria-label={state === "playing" ? "Pause" : "Play"} style={{
          width: "2.5rem", height: "2.5rem", borderRadius: "50%",
          background: theme.accent,
          boxShadow: state === "playing"
            ? `0 0 0 4px ${theme.accent}28, 0 2px 10px ${theme.accent}50`
            : `0 2px 8px ${theme.accent}3a`,
          border: "none", cursor: "pointer",
          color: "#fff",
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0,
          transition: "box-shadow 0.25s ease",
        }}>
          {state === "playing" ? (
            <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: "0.85rem", height: "0.85rem" }}>
              <rect x="6" y="5" width="4" height="14" rx="1.5" />
              <rect x="14" y="5" width="4" height="14" rx="1.5" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: "0.85rem", height: "0.85rem" }}>
              <path d="M8 5.14v14l11-7-11-7z" />
            </svg>
          )}
        </button>

        {/* Close */}
        <button onClick={() => { stop(); onClose(); }} aria-label="Close audio" style={{
          width: "2.25rem", height: "2.25rem",
          background: "none", border: "none",
          borderRadius: "50%", cursor: "pointer",
          color: theme.muted,
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0,
        }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25}
            style={{ width: "0.85rem", height: "0.85rem" }}>
            <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
