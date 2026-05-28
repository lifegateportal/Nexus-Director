"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { ChapterDraft } from "@/lib/schemas/ebook";

// ── Content segment types ─────────────────────────────────────────────────────

type SegmentType = "chapter-title" | "heading" | "quote" | "body";

interface Segment {
  type: SegmentType;
  text: string;
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

function parseChapter(chapter: ChapterDraft): Segment[] {
  const segs: Segment[] = [];

  const stripMd = (s: string) =>
    s.replace(/\*\*\*([^*]+)\*\*\*/g, "$1")
     .replace(/\*\*([^*]+)\*\*/g, "$1")
     .replace(/\*([^*]+)\*/g, "$1")
     .trim();

  const pushSentences = (type: SegmentType, raw: string) => {
    const clean = sanitizeForSpeech(stripMd(raw));
    if (!clean) return;
    // headings and chapter-titles are already short — no sentence split needed
    if (type === "heading" || type === "chapter-title") {
      segs.push({ type, text: clean });
    } else {
      for (const sentence of splitSentences(clean)) {
        if (sentence.trim()) segs.push({ type, text: sentence.trim() });
      }
    }
  };

  const processBody = (text: string) => {
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (!line || /^---+$/.test(line)) continue;
      if (/^#{1,3} /.test(line)) {
        pushSentences("heading", line.replace(/^#{1,3} /, ""));
      } else if (/^> /.test(line)) {
        pushSentences("quote", line.slice(2));
      } else if (/^[*-] /.test(line)) {
        pushSentences("body", line.slice(2));
      } else if (/^\d+\. /.test(line)) {
        pushSentences("body", line.replace(/^\d+\. /, ""));
      } else {
        pushSentences("body", line);
      }
    }
  };

  // Chapter title gets a lead-in breath (pauseBeforeMs handled in speakSegment)
  pushSentences("chapter-title", `Chapter ${chapter.number}. ${chapter.title}.`);
  if (chapter.epigraph)    pushSentences("quote", chapter.epigraph);
  if (chapter.premiseLine) pushSentences("body",  chapter.premiseLine);

  for (const section of chapter.sections) {
    if (section.heading) pushSentences("heading", section.heading);
    processBody(section.body);
  }
  if (chapter.conclusion) processBody(chapter.conclusion);

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
  onClose:    () => void;
}

export function AudioReader({ chapter, theme, fontFamily, onClose }: Props) {
  const [state,        setState]       = useState<AudioState>("idle");
  const [rateIdx,      setRateIdx]     = useState(1);
  const [voices,       setVoices]      = useState<SpeechSynthesisVoice[]>([]);
  const [currentSeg,   setCurrentSeg]  = useState<Segment | null>(null);
  const [currentWord,  setCurrentWord] = useState(-1);

  const segsRef     = useRef<Segment[]>([]);
  const segIdxRef   = useRef(0);
  const rateIdxRef  = useRef(1);
  const voicesRef   = useRef<SpeechSynthesisVoice[]>([]);
  const stoppedRef  = useRef(false);

  useEffect(() => { rateIdxRef.current = rateIdx; }, [rateIdx]);
  useEffect(() => { voicesRef.current  = voices;  }, [voices]);

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
      {/* ── Now-reading strip with word highlighting ── */}
      {currentSeg && state !== "idle" && (
        <div style={{
          padding:      "0.65rem 1.25rem 0.7rem",
          background:   theme.chrome,
          borderTop:    `1px solid ${theme.chromeBorder}`,
        }}>
          <span style={{
            display: "inline-block", marginBottom: "0.35rem",
            fontSize: "0.57rem", letterSpacing: "0.14em",
            textTransform: "uppercase", fontFamily,
            color: segBadge[currentSeg.type].color,
            border: `1px solid ${segBadge[currentSeg.type].color}40`,
            borderRadius: "0.25rem", padding: "0.08rem 0.45rem",
          }}>
            {segBadge[currentSeg.type].label}
          </span>

          <p style={{
            fontSize:   currentSeg.type === "heading" || currentSeg.type === "chapter-title" ? "0.91rem" : "0.82rem",
            fontFamily: currentSeg.type === "quote" ? "Georgia, serif" : fontFamily,
            fontStyle:  currentSeg.type === "quote" ? "italic" : "normal",
            fontWeight: currentSeg.type === "heading" || currentSeg.type === "chapter-title" ? 700 : 400,
            color: theme.text, lineHeight: 1.55, margin: 0,
          }}>
            {wordTokens.map((word, i) => (
              <span key={i} style={{
                background:   i === currentWord ? `${theme.accent}38` : "transparent",
                color:        i === currentWord ? theme.accent : "inherit",
                fontWeight:   i === currentWord ? 600 : "inherit",
                borderRadius: "0.2rem",
                padding:      i === currentWord ? "0 0.1rem" : "0",
                transition:   "background 0.08s ease, color 0.08s ease",
              }}>
                {word}{" "}
              </span>
            ))}
          </p>
        </div>
      )}

      {/* ── Controls ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: "0.5rem",
        padding: "0 1.25rem", height: "3.25rem",
        background: theme.chrome,
        borderTop: `1px solid ${theme.chromeBorder}`,
        backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
      }}>
        <p style={{
          flex: 1, fontSize: "0.72rem", fontFamily, color: theme.muted,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {state === "playing" ? `Reading · Ch ${chapter.number}`
            : state === "paused" ? `Paused · Ch ${chapter.number}`
            : `Ch ${chapter.number} · ${chapter.title}`}
        </p>

        <button onClick={cycleRate} aria-label="Change speed" style={{
          fontSize: "0.72rem", fontFamily, color: theme.muted,
          background: "none", border: `1px solid ${theme.border}`,
          borderRadius: "0.3rem", padding: "0.2rem 0.55rem",
          cursor: "pointer", minHeight: "2rem", minWidth: "3.25rem",
        }}>
          {RATES[rateIdx]}×
        </button>

        {state !== "idle" && (
          <button onClick={stop} aria-label="Stop" style={{
            background: "none", border: "none", cursor: "pointer",
            color: theme.muted, display: "flex", alignItems: "center",
            justifyContent: "center", minHeight: "2.75rem", minWidth: "2.75rem",
          }}>
            <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: "0.95rem", height: "0.95rem" }}>
              <rect x="5" y="5" width="14" height="14" rx="2" />
            </svg>
          </button>
        )}

        <button onClick={togglePlay} aria-label={state === "playing" ? "Pause" : "Play"} style={{
          width: "2.25rem", height: "2.25rem", borderRadius: "50%",
          background: theme.accent, border: "none", cursor: "pointer",
          color: "#fff", display: "flex", alignItems: "center",
          justifyContent: "center", flexShrink: 0,
        }}>
          {state === "playing" ? (
            <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: "0.85rem", height: "0.85rem" }}>
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: "0.85rem", height: "0.85rem" }}>
              <path d="M8 5.14v14l11-7-11-7z" />
            </svg>
          )}
        </button>

        <button onClick={() => { stop(); onClose(); }} aria-label="Close audio" style={{
          background: "none", border: "none", cursor: "pointer",
          color: theme.muted, display: "flex", alignItems: "center",
          justifyContent: "center", minHeight: "2.75rem", minWidth: "2.75rem",
        }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
            style={{ width: "0.85rem", height: "0.85rem" }}>
            <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
