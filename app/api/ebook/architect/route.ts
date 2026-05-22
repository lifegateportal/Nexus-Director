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
  sectionNumber: z.number().default(1),
  heading: z.string().default(""),
  sourceSegmentIds: z.array(z.string()).default([]),
  targetWordCount: z.number().default(0),
});

const MinimalChapterSchema = z.object({
  number: z.number().default(1),
  title: z.string().default(""),
  keyTheme: z.string().default(""),
  sections: z.array(MinimalSectionSchema).default([]),
});

const MinimalArchitectureSchema = z.object({
  bookTitle: z.string().default("Untitled Teaching Manuscript"),
  subtitle: z.string().default(""),
  authorName: z.string().default("the Author"),
  estimatedTotalWords: z.number().default(0),
  frontMatterNotes: z.string().default(""),
  backMatterNotes: z.string().default(""),
  chapters: z.array(MinimalChapterSchema).default([]),
});

function fallbackArchitecture(input: z.infer<typeof ArchitectRequestSchema>) {
  const sections = input.contentMap.segments.map((segment, index) => ({
    sectionNumber: index + 1,
    heading: segment.topic || `Section ${index + 1}`,
    sourceSegmentIds: [segment.id],
    targetWordCount: Math.max(segment.estimatedWordCount || 0, 250),
  }));

  return {
    bookTitle: input.contentMap.coreThesis || input.contentMap.overarchingThemes[0] || input.contentMap.segments[0]?.topic || "Untitled Teaching Manuscript",
    subtitle: input.contentMap.targetAudience || input.contentMap.teachingArc || "Drawn directly from the source teaching",
    authorName: "the Author",
    estimatedTotalWords: sections.reduce((sum, section) => sum + section.targetWordCount, 0),
    frontMatterNotes: input.contentMap.coreThesis || input.contentMap.segments[0]?.topic || "",
    backMatterNotes: input.contentMap.teachingArc || input.contentMap.segments.at(-1)?.topic || "",
    chapters: [
      {
        number: 1,
        title: input.contentMap.coreThesis || input.contentMap.overarchingThemes[0] || "Core Teaching",
        keyTheme: input.contentMap.coreThesis || input.contentMap.overarchingThemes[0] || input.contentMap.teachingArc || "Core teaching",
        sections,
      },
    ],
  };
}

function normalizeArchitecture(
  minimal: z.infer<typeof MinimalArchitectureSchema>,
  input: z.infer<typeof ArchitectRequestSchema>,
) {
  const fallback = fallbackArchitecture(input);
  const chapters = (minimal.chapters ?? [])
    .map((chapter, chapterIndex) => ({
      number: Math.max(1, Math.trunc(chapter.number || chapterIndex + 1)),
      title: (chapter.title || "").trim() || fallback.chapters[0].title,
      keyTheme: (chapter.keyTheme || "").trim() || fallback.chapters[0].keyTheme,
      sections: (chapter.sections ?? [])
        .map((section, sectionIndex) => ({
          sectionNumber: Math.max(1, Math.trunc(section.sectionNumber || sectionIndex + 1)),
          heading: (section.heading || "").trim() || `Section ${sectionIndex + 1}`,
          sourceSegmentIds: (section.sourceSegmentIds ?? []).filter((id) => id in Object.fromEntries(input.contentMap.segments.map((s) => [s.id, true]))),
          targetWordCount: Math.max(0, Math.trunc(section.targetWordCount || 0)),
        }))
        .filter((section) => section.sourceSegmentIds.length > 0),
    }))
    .filter((chapter) => chapter.sections.length > 0);

  return {
    bookTitle: (minimal.bookTitle || "").trim() || fallback.bookTitle,
    subtitle: (minimal.subtitle || "").trim(),
    authorName: (minimal.authorName || "").trim() || fallback.authorName,
    estimatedTotalWords: Math.max(0, Math.trunc(minimal.estimatedTotalWords || 0)) || fallback.estimatedTotalWords,
    frontMatterNotes: (minimal.frontMatterNotes || "").trim() || fallback.frontMatterNotes,
    backMatterNotes: (minimal.backMatterNotes || "").trim() || fallback.backMatterNotes,
    chapters: chapters.length > 0 ? chapters : fallback.chapters,
  };
}

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
  const validSegmentIds = new Set(input.contentMap.segments.map((s) => s.id));
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
    let minimal: z.infer<typeof MinimalArchitectureSchema>;
    try {
      const result = await generateObject({
        model: deepSeekModel,
        schema: MinimalArchitectureSchema,
        mode: "tool",
        temperature: 0.2,
        system: `You are a book architect designing the chapter structure of a published teaching book.

RULES:
- sourceSegmentIds must reference actual segment IDs from the segment list (e.g. "seg-1")
- Group thematically related segments into chapters
      - Group repeated series recaps, monthly-theme reminders, and prior-message refreshers into a single foundational treatment when they do not add new substance
      - Arrange related ideas contiguously so the manuscript reads like a coherent book, not a week-by-week sermon archive
- Each chapter: 3–5 sections; each section: one focused teaching point
- targetWordCount per section = sum of that section's segments' estimatedWordCount
- bookTitle and authorName must come from the content; use "the Author" if name is unknown
- estimatedTotalWords = sum of all section targetWordCounts
- Always return every required field, even if some strings are brief
- Never leave sections empty; every chapter must include at least one section with at least one sourceSegmentId`,
        prompt: `Design the chapter architecture.

      VOICE DNA TONE: ${input.voiceDNA.toneProfile}
      TEACHING ARC: ${input.contentMap.teachingArc}
      CORE THESIS: ${input.contentMap.coreThesis}
      TARGET AUDIENCE: ${input.contentMap.targetAudience}
      UNIQUE VOCABULARY: ${(input.contentMap.uniqueVocabulary ?? []).join(", ")}
      TONE MAP: ${input.contentMap.toneMap}
      THEMES: ${(input.contentMap.overarchingThemes ?? []).join(", ")}

      SEGMENTS:
      ${JSON.stringify(segmentsLite)}`,
      });
      minimal = result.object;
    } catch {
      minimal = fallbackArchitecture(input);
    }

    const normalized = normalizeArchitecture(minimal, input);

    // ── Rehydrate full BookArchitecture from minimal output ───────────────
    const hydrated = {
      bookTitle: normalized.bookTitle,
      subtitle: normalized.subtitle,
      authorName: normalized.authorName,
      estimatedTotalWords: normalized.estimatedTotalWords,
      frontMatterNotes: normalized.frontMatterNotes,
      backMatterNotes: normalized.backMatterNotes,
      chapters: normalized.chapters.map((ch) => {
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
            const safeSourceSegmentIds = sec.sourceSegmentIds.filter((id) => validSegmentIds.has(id));
            const secSegments = safeSourceSegmentIds.map((id) => segmentMap[id]).filter(Boolean);
            const secKeyPoints = secSegments.flatMap((s) => s?.keyPoints ?? []);
            const secQuotes = secSegments
              .flatMap((s) => s?.quotes ?? [])
              .map((q) => quoteMap[q.id] ?? q)
              .filter((q, i, arr) => arr.findIndex((x) => x.id === q.id) === i);

            return {
              sectionNumber: sec.sectionNumber,
              heading: sec.heading,
              sourceSegmentIds: safeSourceSegmentIds,
              targetWordCount: sec.targetWordCount || secSegments.reduce((sum, seg) => sum + (seg?.estimatedWordCount ?? 0), 0),
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
    return NextResponse.json({
      route: "ebook/architect",
      error: message,
      details: err instanceof Error && err.stack
        ? err.stack.split("\n").slice(0, 3).join(" | ")
        : undefined,
    }, { status: 500 });
  }
}
