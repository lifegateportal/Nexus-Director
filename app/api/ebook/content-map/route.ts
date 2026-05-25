import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { deepSeekModel } from "@/lib/ai-providers";
import { ContentMapRequestSchema, QuoteSchema } from "@/lib/schemas/ebook";

export const runtime = "nodejs";
export const maxDuration = 240;

// Max words to send to the LLM per slot.
// 12 000 covers the vast majority of sermon recordings (~60–90 min) without
// hitting DeepSeek's context limit, and prevents the truncation that was causing
// the last ~37 % of each slot to be invisble to segment extraction.
const MAX_SLOT_WORDS = 12000;

// Per-slot extraction schema — NO rawText (LLM must not copy back large text blobs)
const SlotSegmentExtractSchema = z.object({
  topic: z.string(),
  keyPoints: z.array(z.string()).default([]),
  quotes: z.array(
    z.object({
      text: z.string(),
      reference: z.string(),
      translation: z.string(),
      type: z.enum(["scripture", "quote", "proverb"]),
      isBlockQuote: z.boolean(),
    })
  ).default([]),
  estimatedWordCount: z.number(),
});

const SlotSegmentsSchema = z.object({
  segments: z.array(SlotSegmentExtractSchema),
});

// Final synthesis schema (receives only topics/themes, no raw text)
const SynthesisSchema = z.object({
  totalEstimatedWords: z.number(),
  overarchingThemes: z.array(z.string()).default([]),
  teachingArc: z.string().default(""),
  coreThesis: z.string().default(""),
  targetAudience: z.string().default(""),
  uniqueVocabulary: z.array(z.string()).default([]),
  toneMap: z.string().default(""),
});

const SEGMENT_SYSTEM = `You are a content analyst extracting teaching segments from a single sermon/teaching recording.

════════════════════════════════════════════
SPEAKER-FIDELITY MANDATE — READ FIRST
════════════════════════════════════════════
You are cataloguing the SPEAKER'S material only. Every key point you extract must be:
  - Explicitly stated or demonstrated by the speaker in this transcript
  - Phrased using the speaker's own words and concepts
  - Directly observable in the provided text — not inferred, interpolated, or generalized

YOU MUST NOT:
  - Add points the speaker did not make
  - Summarize away nuance or add editorial framing
  - Introduce theological, doctrinal, or practical concepts not in the transcript
  - Merge ideas from outside the recording to "fill gaps"

════════════════════════════════════════════
NON-TEACHING CONTENT — SKIP ENTIRELY
════════════════════════════════════════════
Do NOT create segments from:
  - Opening or closing prayers / benedictions
  - Announcements, event notices, giving appeals, offering moments
  - "Good morning", "welcome", "turn to your neighbor" instructions
  - Altar calls or sinner's prayer recitations
  - Technical interruptions (mic check, applause breaks)
  - Repeated monthly-theme or previous-message recap lines that add no new teaching substance
  - Jokes or stories with no direct teaching application
  - Any content already stripped by the signal filter

If such content appears in the transcript, mark the segment topic as "[NON-TEACHING — SKIP]"
and set estimatedWordCount to 0. The architect will discard these automatically.

════════════════════════════════════════════
SEGMENT RULES
════════════════════════════════════════════
- Identify natural topic shifts as segment boundaries
- keyPoints: exact claims made in that segment — use the speaker's own words
- Aim for 3–8 segments per recording, each covering 200–600 words of teaching material

════════════════════════════════════════════
SCRIPTURE / QUOTE DETECTION
════════════════════════════════════════════
For every scripture or quote mentioned:
- type: "scripture" | "quote" | "proverb"
- text: exact words as spoken
- reference: "Book Ch:V" for scripture, "Author, Source" for quotes, "" otherwise
- translation: NIV / KJV / ESV etc., "" if not stated
- isBlockQuote: true if 40+ words

DO NOT reproduce large blocks of transcript text. Focus on structure and meaning.`;

export async function POST(req: NextRequest) {
  const body = await req.json() as unknown;
  let input;
  try {
    input = ContentMapRequestSchema.parse(body);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Invalid input" }, { status: 400 });
  }

  try {
    // ── 1. Split masterTranscript into per-slot chunks ──────────────────────
    const slotChunks: { sourceAudio: string; text: string }[] = [];
    const parts = input.masterTranscript.split(/═{3,}/);
    let nextSlotFallback = 1; // used when [Slot-N] header was stripped by filter-signal
    for (const part of parts) {
      const m = part.match(/^\s*\[Slot-(\d+)\]\s*([\s\S]+)/);
      if (!m) {
        // The [Slot-1] label may have been removed by the signal filter when it
        // trimmed opening prayers/greetings that preceded the teaching start phrase.
        // Don't silently skip — assign to the next expected slot number.
        const content = part.trim();
        if (!content) continue; // genuinely empty separator between slots
        slotChunks.push({ sourceAudio: `audio-${nextSlotFallback}`, text: content });
        continue;
      }
      const slotNum = parseInt(m[1], 10);
      nextSlotFallback = slotNum + 1;
      slotChunks.push({ sourceAudio: `audio-${slotNum}`, text: m[2].trim() });
    }

    if (slotChunks.length === 0) {
      slotChunks.push({ sourceAudio: "audio-1", text: input.masterTranscript });
    }

    // ── 2. Extract segments per slot — LLM identifies structure only ─────────
    let segmentIdCounter = 1;
    const allSegments: Array<{
      id: string;
      sourceAudio: string;
      topic: string;
      rawText: string;
      keyPoints: string[];
      quotes: Array<{ id: string; text: string; reference: string; translation: string; type: "scripture" | "quote" | "proverb"; isBlockQuote: boolean }>;
      estimatedWordCount: number;
    }> = [];

    const allQuotes: Array<{ id: string; text: string; reference: string; translation: string; type: "scripture" | "quote" | "proverb"; isBlockQuote: boolean }> = [];

    // Accumulate topics already seen in earlier slots so later slots can identify
    // cross-sermon recaps and mark them [NON-TEACHING — SKIP].
    const seenTopics: string[] = [];

    for (const chunk of slotChunks) {
      // Split long slots into overlapping chunks so every word is seen by the LLM.
      // Each chunk is MAX_SLOT_WORDS wide with a 200-word overlap so segment
      // boundaries that fall at a chunk edge are not split mid-thought.
      const slotWords = chunk.text.split(/\s+/);
      const OVERLAP = 200;
      const chunkRanges: Array<{ start: number; end: number }> = [];
      let start = 0;
      while (start < slotWords.length) {
        const end = Math.min(start + MAX_SLOT_WORDS, slotWords.length);
        chunkRanges.push({ start, end });
        if (end === slotWords.length) break;
        start = end - OVERLAP;
      }

      // Collect raw segment extractions across all chunks for this slot,
      // then deduplicate topics that appeared in multiple overlapping windows.
      const rawSegmentsForSlot: Array<z.infer<typeof SlotSegmentExtractSchema> & { chunkStart: number; chunkEnd: number }> = [];

      for (const range of chunkRanges) {
        const chunkText = slotWords.slice(range.start, range.end).join(" ");
        const seenTopicsBlock = seenTopics.length > 0
          ? `\n\nTOPICS ALREADY COVERED IN EARLIER RECORDINGS (mark any recap of these as [NON-TEACHING — SKIP]):\n${seenTopics.map((t) => `- ${t}`).join("\n")}`
          : "";

        const { object } = await generateObject({
          model: deepSeekModel,
          schema: SlotSegmentsSchema,
          mode: "tool",
          temperature: 0.2,
          system: SEGMENT_SYSTEM,
          prompt: `Extract all teaching segments from this recording (${chunk.sourceAudio}):\n\n${chunkText}${seenTopicsBlock}`,
        });

        for (const seg of object.segments) {
          rawSegmentsForSlot.push({ ...seg, chunkStart: range.start, chunkEnd: range.end });
        }
      }

      // Deduplicate segments that appeared in overlapping chunk windows:
      // keep only the first occurrence of each topic (case-insensitive prefix match).
      const seenSegTopics = new Set<string>();
      const dedupedSegs = rawSegmentsForSlot.filter((seg) => {
        const key = seg.topic.toLowerCase().trim().slice(0, 60);
        if (seenSegTopics.has(key)) return false;
        seenSegTopics.add(key);
        return true;
      });

      // Distribute the full slot text across segments proportionally.
      // Use the LLM's estimates only as weights; the authoritative word count
      // is derived from the actual rawText slice length after distribution.
      const totalEstimatedWords = dedupedSegs.reduce((sum, s) => sum + Math.max(1, s.estimatedWordCount), 0) || 1;
      let wordOffset = 0;
      const lastSegIdx = dedupedSegs.length - 1;

      for (let si = 0; si < dedupedSegs.length; si++) {
        const seg = dedupedSegs[si];
        const id = `seg-${segmentIdCounter++}`;
        const segWordCount = Math.max(1, seg.estimatedWordCount);
        const sliceFraction = segWordCount / totalEstimatedWords;
        // Last segment always gets all remaining words — prevents rounding loss.
        const sliceLen = si === lastSegIdx
          ? slotWords.length - wordOffset
          : Math.round(slotWords.length * sliceFraction);
        const rawText = slotWords.slice(wordOffset, wordOffset + sliceLen).join(" ");
        wordOffset += sliceLen;

        // Use actual rawText length as the authoritative word count.
        // This is what downstream targetWordCount is built from, so it must
        // reflect real content — not the LLM's estimate of the truncated view.
        const actualWordCount = rawText.split(/\s+/).filter(Boolean).length;

        const quotes = (seg.quotes ?? []).map((q, qi) => ({
          ...q,
          id: `q-${allQuotes.length + qi + 1}`,
        }));

        allSegments.push({
          id,
          sourceAudio: chunk.sourceAudio,
          topic: seg.topic,
          rawText,
          keyPoints: seg.keyPoints,
          quotes,
          estimatedWordCount: actualWordCount,
        });

        allQuotes.push(...quotes);
      }

      // Register all teaching topics from this slot so later slots can detect recaps.
      seenTopics.push(...dedupedSegs
        .filter((s) => !s.topic.includes("[NON-TEACHING"))
        .map((s) => s.topic)
      );
    }

    // ── 3. Synthesise themes/arc from segment topics only (no rawText) ──────
    // Strip any non-teaching segments the LLM flagged before synthesis and export
    const teachingSegments = allSegments.filter(
      (s) => !s.topic.includes("[NON-TEACHING") && s.estimatedWordCount > 0
    );

    const topicSummary = teachingSegments
      .map((s) => `- [${s.sourceAudio}] ${s.topic}: ${s.keyPoints.join("; ")}`)
      .join("\n");

    const { object: synthesis } = await generateObject({
      model: deepSeekModel,
      schema: SynthesisSchema,
      mode: "tool",
      temperature: 0.2,
      system: `You are a senior editor identifying the overarching message of a multi-part teaching series.
    Base your synthesis ONLY on what the speaker explicitly taught — do not add external theological context.

    Your job is to perform the sermon-to-book "Narrative North Star" pass:
    - Extract the core thesis that governs the whole manuscript.
    - Identify the target audience the speaker is actually addressing in substance, not the live room.
    - Capture the speaker's unique vocabulary, metaphors, and repeated conceptual language.
    - Describe the tone map for the eventual book.
    - Organize recurring ideas into a coherent flow, treating repeated series recaps or monthly-theme refreshers as support material rather than fresh chapters.`,
      prompt: `Based on these teaching segment topics, identify the overall themes, teaching arc, core thesis, target audience, unique vocabulary, and tone map.

    Group repeated themes together conceptually so the eventual book reads contiguously instead of repeating sermon-series refreshers.

    ${topicSummary}`,
    });

    const contentMap = {
      ...synthesis,
      segments: teachingSegments,
      allQuotes,
    };

    return NextResponse.json(contentMap, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Content mapping failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

