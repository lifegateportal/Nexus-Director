"use client";

/**
 * Global Audio Player Context
 *
 * Upgrades over per-component synthesis:
 * 1. AudioContext keep-alive   — silent ConstantSourceNode signals the browser the
 *    tab has active audio, preventing Chrome/Safari from suspending synthesis in
 *    background tabs or when the screen locks.
 * 2. Chrome 15-second stall watchdog — Chrome silently pauses speechSynthesis
 *    after ~15 s in background tabs.  A 14-second interval kicks it awake and
 *    fully restarts it if it has died.
 * 3. Page-visibility recovery — on tab-visible, any paused/dead synthesis is
 *    resumed automatically so the user doesn't have to re-press Play.
 * 4. Media Session API — registers lock-screen / notification-shade controls
 *    (play, pause, seek ±10 segments) and sets Now-Playing metadata.
 * 5. Voice-loading polling retry — on Firefox & slow Android browsers
 *    getVoices() returns [] on first call; we retry at 100 ms / 500 ms / 1.5 s /
 *    3 s / 5 s so a voice is always selected before playback starts.
 * 6. Network-error retry — onerror fires "network" on flaky mobile connections;
 *    we wait 1.2 s before advancing instead of skipping immediately.
 * 7. Provider survives route changes — lives in the root layout so navigating
 *    between pages inside the SPA never kills the synthesis engine.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

export type SegmentType = "chapter-title" | "heading" | "quote" | "body";
export type AudioState  = "idle" | "playing" | "paused";

export interface Segment {
  type:    SegmentType;
  text:    string;
  paraKey: string;
}

export interface AudioChapterMeta {
  /** Unique key — change triggers a full reset.  e.g. "ch-3" or slug+chNum. */
  chapterKey: string;
  title:      string;
  number:     number;
  bookTitle:  string;
  /** Absolute pathname back to the reader page, e.g. /library/my-book/read */
  readerHref: string;
}

// ── Voice treatment ───────────────────────────────────────────────────────────

export const RATES = [0.75, 1.0, 1.25, 1.5, 2.0] as const;

const VOICE_TREATMENT: Record<
  SegmentType,
  { pitch: number; rate: number; volume: number; pauseBeforeMs: number; pauseAfterMs: number }
> = {
  "chapter-title": { pitch: 1.10, rate: 0.78, volume: 1.00, pauseBeforeMs: 600, pauseAfterMs: 700 },
  "heading":       { pitch: 1.06, rate: 0.82, volume: 0.95, pauseBeforeMs:   0, pauseAfterMs: 500 },
  "quote":         { pitch: 0.91, rate: 0.76, volume: 0.82, pauseBeforeMs:   0, pauseAfterMs: 300 },
  "body":          { pitch: 1.00, rate: 1.00, volume: 0.95, pauseBeforeMs:   0, pauseAfterMs:  80 },
};

// ── Voice selection ───────────────────────────────────────────────────────────

export function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const preferred = [
    "Samantha (Enhanced)", "Samantha",
    "Karen (Enhanced)",    "Karen",
    "Alex", "Victoria", "Fiona", "Moira", "Daniel",
    "Microsoft Aria Online (Natural)", "Microsoft Aria Online",
    "Microsoft Jenny Online (Natural)", "Microsoft Jenny Online",
    "Microsoft Aria", "Microsoft Jenny",
    "Google US English",
  ];
  for (const name of preferred) {
    const v = voices.find((v) => v.name === name && v.lang.startsWith("en"));
    if (v) return v;
  }
  const online = voices.find((v) => v.name.includes("Online") && v.lang.startsWith("en"));
  if (online) return online;
  return voices.find((v) => v.lang === "en-US" || v.lang === "en_US") ?? voices[0] ?? null;
}

// ── Context shape ─────────────────────────────────────────────────────────────

interface AudioPlayerContextValue {
  state:       AudioState;
  currentSeg:  Segment | null;
  currentWord: number;
  segIdx:      number;
  segTotal:    number;
  rateIdx:     number;
  chapterMeta: AudioChapterMeta | null;
  setChapter:  (segs: Segment[], meta: AudioChapterMeta, onProgress?: (idx: number, key: string) => void) => void;
  play:        (fromIdx?: number) => void;
  pause:       () => void;
  resume:      () => void;
  stop:        () => void;
  cycleRate:   () => void;
  seekTo:      (idx: number) => void;
}

const AudioPlayerContext = createContext<AudioPlayerContextValue | null>(null);

export function useAudioPlayer(): AudioPlayerContextValue {
  const ctx = useContext(AudioPlayerContext);
  if (!ctx) throw new Error("useAudioPlayer must be used inside AudioPlayerProvider");
  return ctx;
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function AudioPlayerProvider({ children }: { children: React.ReactNode }) {
  const [state,       setState]      = useState<AudioState>("idle");
  const [currentSeg,  setCurrentSeg] = useState<Segment | null>(null);
  const [currentWord, setCurrentWord]= useState(-1);
  const [segIdx,      setSegIdx]     = useState(0);
  const [segTotal,    setSegTotal]   = useState(0);
  const [rateIdx,     setRateIdx]    = useState(1);
  const [chapterMeta, setChapterMeta]= useState<AudioChapterMeta | null>(null);

  // ── Stable refs (safe inside setInterval / setTimeout closures) ──────────
  const segsRef        = useRef<Segment[]>([]);
  const segIdxRef      = useRef(0);
  const rateIdxRef     = useRef(1);
  const voicesRef      = useRef<SpeechSynthesisVoice[]>([]);
  const stoppedRef     = useRef(true);
  const stateRef       = useRef<AudioState>("idle");
  const onProgressRef  = useRef<((idx: number, key: string) => void) | undefined>(undefined);
  const chapterMetaRef = useRef<AudioChapterMeta | null>(null);

  // Indirection so stall watchdog / media-session handlers always call the
  // latest speakSegment closure without stale captures.
  const speakRef       = useRef<(idx: number) => void>(() => {});

  // AudioContext keep-alive node
  const audioCtxRef    = useRef<AudioContext | null>(null);
  // Chrome 15 s stall watchdog interval handle
  const watchdogRef    = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Sync state refs ──────────────────────────────────────────────────────
  useEffect(() => { stateRef.current      = state;       }, [state]);
  useEffect(() => { rateIdxRef.current    = rateIdx;     }, [rateIdx]);
  useEffect(() => { chapterMetaRef.current = chapterMeta; }, [chapterMeta]);

  // ── Voice loading — polling retry ────────────────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    const load = () => {
      const v = window.speechSynthesis.getVoices();
      if (v.length > 0) { voicesRef.current = v; return true; }
      return false;
    };
    if (load()) {
      window.speechSynthesis.onvoiceschanged = load;
      return () => { window.speechSynthesis.onvoiceschanged = null; };
    }
    // Retry at increasing delays for Firefox / slow Android
    const ids = [100, 500, 1500, 3000, 5000].map((d) =>
      setTimeout(() => { const v = window.speechSynthesis.getVoices(); if (v.length) voicesRef.current = v; }, d),
    );
    window.speechSynthesis.onvoiceschanged = load;
    return () => {
      ids.forEach(clearTimeout);
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  // ── AudioContext keep-alive ──────────────────────────────────────────────
  const startAudioCtx = useCallback(() => {
    if (typeof window === "undefined" || audioCtxRef.current) return;
    try {
      type ACtxCtor = typeof AudioContext;
      const Ctor = (window.AudioContext ??
        (window as unknown as { webkitAudioContext?: ACtxCtor }).webkitAudioContext);
      if (!Ctor) return;
      const ctx  = new Ctor();
      const src  = ctx.createConstantSource();
      const gain = ctx.createGain();
      gain.gain.value = 0.001; // near-silent — no audible hum, but tab is "active"
      src.connect(gain);
      gain.connect(ctx.destination);
      src.start();
      audioCtxRef.current = ctx;
    } catch { /* AudioContext not available */ }
  }, []);

  const stopAudioCtx = useCallback(() => {
    if (!audioCtxRef.current) return;
    try { audioCtxRef.current.close(); } catch { /* ignore */ }
    audioCtxRef.current = null;
  }, []);

  // ── Chrome 15-second stall watchdog ─────────────────────────────────────
  const stopWatchdog = useCallback(() => {
    if (watchdogRef.current) { clearInterval(watchdogRef.current); watchdogRef.current = null; }
  }, []);

  const startWatchdog = useCallback(() => {
    stopWatchdog();
    watchdogRef.current = setInterval(() => {
      if (stoppedRef.current || typeof window === "undefined") return;
      const ss = window.speechSynthesis;
      if (!ss) return;
      if (ss.paused) {
        ss.resume(); // Chrome silently paused it
      } else if (!ss.speaking && stateRef.current === "playing") {
        // Synthesis died completely — restart from last known segment
        speakRef.current(segIdxRef.current);
      }
    }, 14_000);
  }, [stopWatchdog]);

  // ── Media Session helpers ────────────────────────────────────────────────
  const updateMediaSession = useCallback((s: AudioState) => {
    if (typeof window === "undefined" || !("mediaSession" in navigator)) return;
    const meta = chapterMetaRef.current;
    if (meta && s !== "idle") {
      navigator.mediaSession.metadata = new MediaMetadata({
        title:  meta.title,
        artist: "Nexus Reader",
        album:  meta.bookTitle,
      });
    }
    navigator.mediaSession.playbackState =
      s === "playing" ? "playing" : s === "paused" ? "paused" : "none";
  }, []);

  // ── Core synthesis engine ────────────────────────────────────────────────
  const speakSegment = useCallback((idx: number) => {
    const segs = segsRef.current;
    if (stoppedRef.current || idx >= segs.length) {
      stoppedRef.current = true;
      setState("idle"); stateRef.current = "idle";
      setCurrentSeg(null); setCurrentWord(-1);
      stopWatchdog(); stopAudioCtx();
      updateMediaSession("idle");
      return;
    }
    const seg       = segs[idx];
    const treatment = VOICE_TREATMENT[seg.type];

    const doSpeak = () => {
      if (stoppedRef.current) return;
      const voice    = pickVoice(voicesRef.current);
      const userRate = RATES[rateIdxRef.current];
      segIdxRef.current = idx;
      setCurrentSeg(seg);
      setCurrentWord(-1);
      setSegIdx(idx);
      onProgressRef.current?.(idx, seg.paraKey);

      const utt    = new SpeechSynthesisUtterance(seg.text);
      utt.rate     = treatment.rate * userRate;
      utt.pitch    = treatment.pitch;
      utt.volume   = treatment.volume;
      utt.lang     = "en-US";
      if (voice) utt.voice = voice;

      utt.onboundary = (e) => {
        if (e.name !== "word") return;
        setCurrentWord((seg.text.slice(0, e.charIndex).match(/\S+/g) ?? []).length);
      };

      utt.onend = () => {
        if (stoppedRef.current) return;
        setTimeout(() => speakRef.current(idx + 1), treatment.pauseAfterMs);
      };

      utt.onerror = (e) => {
        if (e.error === "interrupted" || e.error === "canceled") return;
        // Retry after 1.2 s for network errors; 80 ms skip for all others
        const delay = e.error === "network" ? 1200 : 80;
        setTimeout(() => { if (!stoppedRef.current) speakRef.current(idx + 1); }, delay);
      };

      window.speechSynthesis.speak(utt);
    };

    if (treatment.pauseBeforeMs > 0) {
      setTimeout(doSpeak, treatment.pauseBeforeMs);
    } else {
      doSpeak();
    }
  }, [stopWatchdog, stopAudioCtx, updateMediaSession]);

  // Always keep speakRef pointing to the latest closure
  useEffect(() => { speakRef.current = speakSegment; }, [speakSegment]);

  // ── Page-visibility recovery ─────────────────────────────────────────────
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden || !window.speechSynthesis) return;
      if (stateRef.current !== "playing") return;
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      } else if (!window.speechSynthesis.speaking && !stoppedRef.current) {
        speakRef.current(segIdxRef.current);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // ── Media Session action handlers ────────────────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined" || !("mediaSession" in navigator)) return;

    navigator.mediaSession.setActionHandler("play", () => {
      if (stateRef.current !== "playing") {
        stoppedRef.current = false;
        window.speechSynthesis?.resume();
        setState("playing"); stateRef.current = "playing";
        startWatchdog(); startAudioCtx();
        updateMediaSession("playing");
      }
    });

    navigator.mediaSession.setActionHandler("pause", () => {
      if (stateRef.current === "playing") {
        window.speechSynthesis?.pause();
        setState("paused"); stateRef.current = "paused";
        stopWatchdog();
        updateMediaSession("paused");
      }
    });

    navigator.mediaSession.setActionHandler("seekbackward", () => {
      const newIdx = Math.max(0, segIdxRef.current - 10);
      stoppedRef.current = true;
      window.speechSynthesis?.cancel();
      setTimeout(() => {
        stoppedRef.current = false;
        setState("playing"); stateRef.current = "playing";
        speakRef.current(newIdx);
      }, 80);
    });

    navigator.mediaSession.setActionHandler("seekforward", () => {
      const newIdx = Math.min(segsRef.current.length - 1, segIdxRef.current + 10);
      stoppedRef.current = true;
      window.speechSynthesis?.cancel();
      setTimeout(() => {
        stoppedRef.current = false;
        setState("playing"); stateRef.current = "playing";
        speakRef.current(newIdx);
      }, 80);
    });

    return () => {
      (["play", "pause", "seekbackward", "seekforward"] as MediaSessionAction[]).forEach((a) => {
        try { navigator.mediaSession.setActionHandler(a, null); } catch { /* ignore */ }
      });
    };
  }, [startWatchdog, startAudioCtx, stopWatchdog, updateMediaSession]);

  // ── Provider unmount cleanup ─────────────────────────────────────────────
  useEffect(() => () => {
    stoppedRef.current = true;
    window.speechSynthesis?.cancel();
    stopWatchdog();
    stopAudioCtx();
  }, [stopWatchdog, stopAudioCtx]);

  // ── Public API ───────────────────────────────────────────────────────────

  const setChapter = useCallback((
    segs:        Segment[],
    meta:        AudioChapterMeta,
    onProgress?: (idx: number, key: string) => void,
  ) => {
    const prevKey = chapterMetaRef.current?.chapterKey;
    segsRef.current    = segs;
    onProgressRef.current = onProgress;

    // Full reset only when a different chapter is loaded
    if (prevKey !== meta.chapterKey) {
      stoppedRef.current = true;
      window.speechSynthesis?.cancel();
      stopWatchdog(); stopAudioCtx();
      segIdxRef.current = 0;
      setState("idle"); stateRef.current = "idle";
      setCurrentSeg(null); setCurrentWord(-1); setSegIdx(0);
      updateMediaSession("idle");
    }

    setSegTotal(segs.length);
    setChapterMeta(meta);
    chapterMetaRef.current = meta;

    if (typeof window !== "undefined" && "mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title:  meta.title,
        artist: "Nexus Reader",
        album:  meta.bookTitle,
      });
    }
  }, [stopWatchdog, stopAudioCtx, updateMediaSession]);

  const play = useCallback((fromIdx = segIdxRef.current) => {
    stoppedRef.current = false;
    setState("playing"); stateRef.current = "playing";
    startAudioCtx(); startWatchdog();
    updateMediaSession("playing");
    speakRef.current(fromIdx);
  }, [startAudioCtx, startWatchdog, updateMediaSession]);

  const pause = useCallback(() => {
    window.speechSynthesis?.pause();
    setState("paused"); stateRef.current = "paused";
    stopWatchdog();
    updateMediaSession("paused");
  }, [stopWatchdog, updateMediaSession]);

  const resume = useCallback(() => {
    stoppedRef.current = false;
    window.speechSynthesis?.resume();
    setState("playing"); stateRef.current = "playing";
    startWatchdog();
    updateMediaSession("playing");
  }, [startWatchdog, updateMediaSession]);

  const stop = useCallback(() => {
    stoppedRef.current = true;
    window.speechSynthesis?.cancel();
    stopWatchdog(); stopAudioCtx();
    segIdxRef.current = 0;
    setState("idle"); stateRef.current = "idle";
    setCurrentSeg(null); setCurrentWord(-1); setSegIdx(0);
    updateMediaSession("idle");
  }, [stopWatchdog, stopAudioCtx, updateMediaSession]);

  const cycleRate = useCallback(() => {
    const next = (rateIdxRef.current + 1) % RATES.length;
    setRateIdx(next); rateIdxRef.current = next;
    if (stateRef.current === "playing") {
      stoppedRef.current = false;
      window.speechSynthesis?.cancel();
      setTimeout(() => speakRef.current(segIdxRef.current), 60);
    }
  }, []);

  const seekTo = useCallback((idx: number) => {
    stoppedRef.current = true;
    window.speechSynthesis?.cancel();
    setTimeout(() => {
      stoppedRef.current = false;
      setState("playing"); stateRef.current = "playing";
      startAudioCtx(); startWatchdog();
      updateMediaSession("playing");
      speakRef.current(idx);
    }, 80);
  }, [startAudioCtx, startWatchdog, updateMediaSession]);

  return (
    <AudioPlayerContext.Provider
      value={{
        state, currentSeg, currentWord, segIdx, segTotal,
        rateIdx, chapterMeta,
        setChapter, play, pause, resume, stop, cycleRate, seekTo,
      }}
    >
      {children}
    </AudioPlayerContext.Provider>
  );
}
