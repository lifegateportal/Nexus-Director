import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { deepSeekModel } from "@/lib/ai-providers";
import { ArchitectRequestSchema } from "@/lib/schemas/ebook";

export const runtime = "nodejs";
export const maxDuration = 120;

// ── Absolute minimum schema — no keyPoints, no quotes, no nested arrays ──────
// Everything gets rehydrated server-side from the contentMap after generation.
const MinimalSectionSchema = z.object({
  sectionNumber: z.number().int().positive(),
  heading: z.string(),
  sourceSegmentIds: z.array(z.string()),
  targetWordCount: z.number().int().positive(),
});

const MinimalChapterSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  keyTheme: z.string(),
  sections: z.array(MinimalSectionSchema),
});

const MinimalArchitectureSchema = z.object({
  bookTitle: z.string(),
  subtitle: z.string(),
  authorName: z.string(),
  estimatedTotalWords: z.number().int().positive(),
  frontMatterNotes: z.string(),
  backMatterNotes: z.string(),
  chapters: z.array(MinimalChapterSchema),
});

export async function POST(req: NextRequest) {
  const body = await req.json() as unknown;
  let input;
  try {
    input = ArchitectRequestSchema.parse(body);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Invalid input" }, { status: 400 });
  }

  // Build segment + quote lookups for rehydration
  const segmentMap = Object.fromEntries(input.contentMap.segments.map((s) => [s.id, s]));
  const quoteMap = Object.fromEntries((input.contentMap.allQuotes ?? []).map((q) => [q.id, q]));

  // Trim input to only what the LLM needs for architecture decisions
  const segmentsLite = input.contentMap.segments.map((s) => ({
    id: s.id,
    sourceAudio: s.sourceAudio,
    topic: s.topic,
    keyPoints: (s.keyPoints ?? []).slice(0, 3), // first 3 only
    estimatedWordCount: s.estimatedWordCount,
  }));

  try {
    const { object: minimal } = await generateObject({
      model: deepSeekModel,
      schema: MinimalArchitectureSchema,
      mode: "tool",
      temperature: 0.2,
      system: `You are a book architect designing the chapter structure of a published teaching book.

RULES:
- sourceSegmentIds must reference actual segment IDs from the segment list (e.g. "seg-1")
- Group thematically related segments into chapters
- Each chapter: 3–5 sections; each section: one focused teaching point
- targetWordCount per section = sum of that section's segments' estimatedWordCount
- bookTitle and authorName must come from the content; use "the Author" if name is unknown
- estimatedTotalWords = sum of all section targetWordCounts`,
      prompt: `Design the chapter architecture.\n\nVOICE DNA TONE: ${input.voiceDNA.toneProfile}\nTEACHING ARC: ${input.contentMap.teachingArc}\nTHEMES: ${input.contentMap.overarchingThemes.join(", ")}\n\nSEGMENTS:\n${JSON.stringify(segmentsLite)}`,
    });

    // ── Rehydrate full BookArchitecture from minimal output ───────────────
    const hydrated = {
      bookTitle: minimal.bookTitle,
      subtitle: minimal.subtitle,
      authorName: minimal.authorName,
      estimatedTotalWords: minimal.estimatedTotalWords,
      frontMatterNotes: minimal.frontMatterNotes,
      backMatterNotes: minimal.backMatterNotes,
      chapters: minimal.chapters.map((ch) => {
        const chapterSegIds = [...new Set(ch.sections.flatMap((s) => s.sourceSegmentIds))];
        const chapterQuotes = chapterSegIds
          .flatMap((sid) => segmentMap[sid]?.quotes ?? [])
          .map((q) => quoteMap[q.id] ?? q)
          .filter((q, i, arr) => arr.findIndex((x) => x.id === q.id) === i); // dedupe

        return {
          number: ch.number,
          title: ch.title,
          keyTheme: ch.keyTheme,
          sourceSegmentIds: chapterSegIds,
          quotesInChapter: chapterQuotes,
          sections: ch.sections.map((sec) => {
            const secSegments = sec.sourceSegmentIds.map((id) => segmentMap[id]).filter(Boolean);
            const secKeyPoints = secSegments.flatMap((s) => s?.keyPoints ?? []);
            const secQuotes = secSegments
              .flatMap((s) => s?.quotes ?? [])
              .map((q) => quoteMap[q.id] ?? q)
              .filter((q, i, arr) => arr.findIndex((x) => x.id === q.id) === i);

            return {
              sectionNumber: sec.sectionNumber,
              heading: sec.heading,
              sourceSegmentIds: sec.sourceSegmentIds,
              targetWordCount: sec.targetWordCount,
              keyPoints: secKeyPoints,
              quotesInSection: secQuotes,
            };
          }),
        };
      }),
    };

    return NextResponse.json(hydrated, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Architecture generation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
