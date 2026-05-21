import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { deepSeekModel } from "@/lib/ai-providers";
import { ContentMapRequestSchema, QuoteSchema } from "@/lib/schemas/ebook";

export const runtime = "nodejs";
export const maxDuration = 240;

// Max words to send to the LLM per slot (keeps output token count manageable)
const MAX_SLOT_WORDS = 5000;

// Per-slot extraction schema — NO rawText (LLM must not copy back large text blobs)
const SlotSegmentExtractSchema = z.object({
  topic: z.string(),
  keyPoints: z.array(z.string()),
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
  overarchingThemes: z.array(z.string()),
  teachingArc: z.string(),
});

const SEGMENT_SYSTEM = `You are a content analyst extracting teaching segments from a single sermon/teaching recording.

SEGMENT RULES:
- Identify natural topic shifts as segment boundaries
- keyPoints: explicit claims made in that segment (not your interpretation)
- Aim for 3–8 segments per recording, each covering 200–600 words of material

SCRIPTURE / QUOTE DETECTION: For every scripture or quote mentioned:
- type: "scripture" | "quote" | "proverb"
- text: exact words spoken
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
    for (const part of parts) {
      const m = part.match(/^\s*\[Slot-(\d+)\]\s*([\s\S]+)/);
      if (!m) continue;
      const slotNum = parseInt(m[1], 10);
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

    for (const chunk of slotChunks) {
      // Truncate slot to MAX_SLOT_WORDS to prevent context overflow
      const words = chunk.text.split(/\s+/);
      const truncated = words.length > MAX_SLOT_WORDS
        ? words.slice(0, MAX_SLOT_WORDS).join(" ") + "\n[… transcript continues …]"
        : chunk.text;

      const { object } = await generateObject({
        model: deepSeekModel,
        schema: SlotSegmentsSchema,
        mode: "tool",
        temperature: 0.2,
        system: SEGMENT_SYSTEM,
        prompt: `Extract all teaching segments from this recording (${chunk.sourceAudio}):\n\n${truncated}`,
      });

      // Distribute the full slot text across extracted segments proportionally
      const totalEstimatedWords = object.segments.reduce((sum, s) => sum + (s.estimatedWordCount || 1), 0) || 1;
      const slotWords = chunk.text.split(/\s+/);
      let wordOffset = 0;

      for (const seg of object.segments) {
        const id = `seg-${segmentIdCounter++}`;
        const segWordCount = Math.max(1, seg.estimatedWordCount);
        const sliceFraction = segWordCount / totalEstimatedWords;
        const sliceLen = Math.round(slotWords.length * sliceFraction);
        const rawText = slotWords.slice(wordOffset, wordOffset + sliceLen).join(" ");
        wordOffset += sliceLen;

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
          estimatedWordCount: seg.estimatedWordCount,
        });

        allQuotes.push(...quotes);
      }
    }

    // ── 3. Synthesise themes/arc from segment topics only (no rawText) ──────
    const topicSummary = allSegments
      .map((s) => `- [${s.sourceAudio}] ${s.topic}: ${s.keyPoints.join("; ")}`)
      .join("\n");

    const { object: synthesis } = await generateObject({
      model: deepSeekModel,
      schema: SynthesisSchema,
      mode: "tool",
      temperature: 0.2,
      system: `You are a senior editor identifying the overarching message of a multi-part teaching series.`,
      prompt: `Based on these teaching segment topics, identify the overall themes and teaching arc.\n\n${topicSummary}`,
    });

    const contentMap = {
      ...synthesis,
      segments: allSegments,
      allQuotes,
    };

    return NextResponse.json(contentMap, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Content mapping failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

