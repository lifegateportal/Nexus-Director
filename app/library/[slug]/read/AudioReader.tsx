"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { ChapterDraft } from "@/lib/schemas/ebook";

// ── Content segment types ─────────────────────────────────────────────────────

type SegmentType = "chapter-title" | "heading" | "quote" | "body";

export interface Segment {
  type: SegmentType;
  text: string;
  paraKey: string;
}

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

function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  // Exact-match priority: Enhanced/neural macOS voices first, then Online (Windows neural)
  const preferredNames = [
    "Samantha (Enhanced)", "Samantha",
    "Karen (Enhanced)",    "Karen",
    "Alex",
    "Victoria",
    "Fiona",
    "Moira",
    "Daniel",
    "Microsoft Aria Online (Natural)", "Microsoft Aria Online",
    "Microsoft Jenny Online (Natural)", "Microsoft Jenny Online",
    "Microsoft Aria",  "Microsoft Jenny",
    "Google US English",
  ];
  for (const name of preferredNames) {
    const v = voices.find(v => v.name === name && v.lang.startsWith("en"));
    if (v) return v;
  }
  // Fallback: any "Online" voice (Windows neural) → any en-US
  const online = voices.find(v => v.name.includes("Online") && v.lang.startsWith("en"));
  if (online) return online;
  return voices.find(v => v.lang === "en-US" || v.lang === "en_US") ?? voices[0] ?? null;
}

// ── 3 & 4. Voice treatment — volume, pitch, rate, lead-in + post pause ───────

const VOICE_TREATMENT: Record<SegmentType, {
  pitch:        number;
  rate:         number;
  volume:       number;
  pauseBeforeMs: number;
  pauseAfterMs:  number;
}> = {
  "chapter-title": { pitch: 1.10, rate: 0.78, volume: 1.00, pauseBeforeMs: 600, pauseAfterMs: 700 },
  "heading":       { pitch: 1.06, rate: 0.82, volume: 0.95, pauseBeforeMs:   0, pauseAfterMs: 500 },
  "quote":         { pitch: 0.91, rate: 0.76, volume: 0.82, pauseBeforeMs:   0, pauseAfterMs: 300 },
  "body":          { pitch: 1.00, rate: 1.00, volume: 0.95, pauseBeforeMs:   0, pauseAfterMs:  80 },
};

const RATES = [0.75, 1.0, 1.25, 1.5, 2.0] as const;
type AudioState = "idle" | "playing" | "paused";

interface Props {
  chapter:    ChapterDraft;
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

export function AudioReader({ chapter, theme, fontFamily, onClose, onProgress, startFrom }: Props) {
  const [state,        setState]       = useState<AudioState>("idle");
  const [rateIdx,      setRateIdx]     = useState(1);
  const [voices,       setVoices]      = useState<SpeechSynthesisVoice[]>([]);
  const [currentSeg,   setCurrentSeg]  = useState<Segment | null>(null);
  const [currentWord,  setCurrentWord] = useState(-1);
  const [segIdx,       setSegIdx]       = useState(0);

  const segsRef         = useRef<Segment[]>([]);
  const segIdxRef       = useRef(0);
  const rateIdxRef      = useRef(1);
  const voicesRef       = useRef<SpeechSynthesisVoice[]>([]);
  const stoppedRef      = useRef(false);
  const onProgressRef   = useRef(onProgress);
  const prevStartFrom   = useRef<number | undefined>(undefined);

  useEffect(() => { rateIdxRef.current   = rateIdx;     }, [rateIdx]);
  useEffect(() => { voicesRef.current    = voices;      }, [voices]);
  useEffect(() => { onProgressRef.current = onProgress; }, [onProgress]);

  useEffect(() => {
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.onvoiceschanged = load;
    return () => { window.speechSynthesis.onvoiceschanged = null; };
  }, []);

  useEffect(() => {
    window.speechSynthesis?.cancel();
    stoppedRef.current = true;
    segsRef.current    = parseChapter(chapter);
    segIdxRef.current  = 0;
    setState("idle");
    setCurrentSeg(null);
    setCurrentWord(-1);
    setSegIdx(0);
  }, [chapter]);

  useEffect(() => () => { window.speechSynthesis?.cancel(); }, []);

  const speakSegment = useCallback((idx: number) => {
    const segs = segsRef.current;
    if (stoppedRef.current || idx >= segs.length) {
      setState("idle"); setCurrentSeg(null); setCurrentWord(-1);
      return;
    }
    const seg       = segs[idx];
    const treatment = VOICE_TREATMENT[seg.type];

    const doSpeak = () => {
      if (stoppedRef.current) return;
      const userRate = RATES[rateIdxRef.current];
      const voice    = pickVoice(voicesRef.current);

      segIdxRef.current = idx;
      setCurrentSeg(seg);
      setCurrentWord(-1);
      setSegIdx(idx);
      onProgressRef.current?.(idx, seg.paraKey);

      const utt    = new SpeechSynthesisUtterance(seg.text);
      utt.rate     = treatment.rate * userRate;
      utt.pitch    = treatment.pitch;
      utt.volume   = treatment.volume;   // 3. volume variation per type
      utt.lang     = "en-US";
      if (voice) utt.voice = voice;

      utt.onboundary = (e) => {
        if (e.name !== "word") return;
        // sentence-level split keeps charIndex small → more accurate highlight
        const wordIdx = (seg.text.slice(0, e.charIndex).match(/\S+/g) ?? []).length;
        setCurrentWord(wordIdx);
      };
      utt.onend = () => {
        if (stoppedRef.current) return;
        setTimeout(() => speakSegment(idx + 1), treatment.pauseAfterMs);
      };
      utt.onerror = (e) => {
        if (e.error === "interrupted" || e.error === "canceled") return;
        setTimeout(() => speakSegment(idx + 1), 50);
      };

      window.speechSynthesis.speak(utt);
    };

    // 4. Lead-in silence (chapter title gets a 600ms breath before speaking)
    if (treatment.pauseBeforeMs > 0) {
      setTimeout(doSpeak, treatment.pauseBeforeMs);
    } else {
      doSpeak();
    }
  }, []);

  const play = useCallback((fromIdx = 0) => {
    stoppedRef.current = false;
    setState("playing");
    speakSegment(fromIdx);
  }, [speakSegment]);

  // Jump to a specific segment when startFrom prop changes
  useEffect(() => {
    if (startFrom === undefined) return;
    if (startFrom === prevStartFrom.current) return;
    prevStartFrom.current = startFrom;
    stoppedRef.current = true;
    window.speechSynthesis?.cancel();
    setTimeout(() => {
      stoppedRef.current = false;
      setState("playing");
      speakSegment(startFrom);
    }, 80);
  }, [startFrom, speakSegment]);

  const stop = useCallback(() => {
    stoppedRef.current = true;
    window.speechSynthesis?.cancel();
    segIdxRef.current = 0;
    setState("idle"); setCurrentSeg(null); setCurrentWord(-1);
  }, []);

  const togglePlay = () => {
    if (!window.speechSynthesis) return;
    if      (state === "idle")    play(segIdxRef.current);
    else if (state === "playing") { window.speechSynthesis.pause();  setState("paused");  }
    else if (state === "paused")  { window.speechSynthesis.resume(); setState("playing"); }
  };

  const cycleRate = () => {
    const next = (rateIdx + 1) % RATES.length;
    setRateIdx(next);
    rateIdxRef.current = next;
    if (state === "playing") {
      stoppedRef.current = false;
      window.speechSynthesis.cancel();
      setTimeout(() => speakSegment(segIdxRef.current), 60);
    }
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
          width: segsRef.current.length
            ? `${Math.round((segIdx / segsRef.current.length) * 100)}%`
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
              {segsRef.current.length}
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
