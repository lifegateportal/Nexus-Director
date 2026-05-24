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
  // Group segments by sourceAudio to produce one chapter per message in series order
  const audioOrder = ["audio-1", "audio-2", "audio-3", "audio-4", "audio-5", "audio-6"];
  const segmentsByAudio = new Map<string, typeof input.contentMap.segments>();
  for (const seg of input.contentMap.segments) {
    const bucket = segmentsByAudio.get(seg.sourceAudio) ?? [];
    bucket.push(seg);
    segmentsByAudio.set(seg.sourceAudio, bucket);
  }

  const audioKeys = audioOrder.filter((k) => segmentsByAudio.has(k));
  const chapters = audioKeys.map((audioKey, chapterIndex) => {
    const segs = segmentsByAudio.get(audioKey)!;
    const sections = segs.map((segment, sectionIndex) => ({
      sectionNumber: sectionIndex + 1,
      heading: segment.topic || `Section ${sectionIndex + 1}`,
      sourceSegmentIds: [segment.id],
      targetWordCount: Math.max(segment.estimatedWordCount || 0, 250),
    }));
    return {
      number: chapterIndex + 1,
      title: segs[0]?.topic || `Chapter ${chapterIndex + 1}`,
      keyTheme: segs[0]?.topic || input.contentMap.overarchingThemes[chapterIndex] || "Core teaching",
      sections,
    };
  });

  const fallbackChapters = chapters.length > 0 ? chapters : [{
    number: 1,
    title: input.contentMap.coreThesis || input.contentMap.overarchingThemes[0] || "Core Teaching",
    keyTheme: input.contentMap.coreThesis || input.contentMap.overarchingThemes[0] || input.contentMap.teachingArc || "Core teaching",
    sections: input.contentMap.segments.map((segment, index) => ({
      sectionNumber: index + 1,
      heading: segment.topic || `Section ${index + 1}`,
      sourceSegmentIds: [segment.id],
      targetWordCount: Math.max(segment.estimatedWordCount || 0, 250),
    })),
  }];

  return {
    bookTitle: input.contentMap.coreThesis || input.contentMap.overarchingThemes[0] || input.contentMap.segments[0]?.topic || "Untitled Teaching Manuscript",
    subtitle: input.contentMap.targetAudience || input.contentMap.teachingArc || "Drawn directly from the source teaching",
    authorName: "the Author",
    estimatedTotalWords: fallbackChapters.flatMap((c) => c.sections).reduce((sum, s) => sum + s.targetWordCount, 0),
    frontMatterNotes: input.contentMap.coreThesis || input.contentMap.segments[0]?.topic || "",
    backMatterNotes: input.contentMap.teachingArc || input.contentMap.segments.at(-1)?.topic || "",
    chapters: fallbackChapters,
  };
}

function normalizeArchitecture(
  minimal: z.infer<typeof MinimalArchitectureSchema>,
  input: z.infer<typeof ArchitectRequestSchema>,
) {
  const fallback = fallbackArchitecture(input);
  const validIds = new Set(input.contentMap.segments.map((s) => s.id));

  // Deduplicate segment IDs globally — each segment must feed exactly one section.
  // First-come-first-served: whichever section claims a segment first keeps it.
  const globalUsedSegIds = new Set<string>();

  const chapters = (minimal.chapters ?? [])
    .map((chapter, chapterIndex) => ({
      number: Math.max(1, Math.trunc(chapter.number || chapterIndex + 1)),
      title: (chapter.title || "").trim() || fallback.chapters[0].title,
      keyTheme: (chapter.keyTheme || "").trim() || fallback.chapters[0].keyTheme,
      sections: (chapter.sections ?? [])
        .map((section, sectionIndex) => {
          const uniqueIds = (section.sourceSegmentIds ?? [])
            .filter((id) => validIds.has(id) && !globalUsedSegIds.has(id));
          uniqueIds.forEach((id) => globalUsedSegIds.add(id));
          return {
            sectionNumber: Math.max(1, Math.trunc(section.sectionNumber || sectionIndex + 1)),
            heading: (section.heading || "").trim() || `Section ${sectionIndex + 1}`,
            sourceSegmentIds: uniqueIds,
            targetWordCount: Math.max(0, Math.trunc(section.targetWordCount || 0)),
          };
        })
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
        system: `# ROLE
You are an elite structural editor for a top-tier publishing house. Your job is to map raw, sanitized audio transcript segments into a clean chapter architecture for a published book series.

# OBJECTIVE
This content is a sermon series. The author's preaching sequence IS the book's sequence. Your job is to give each message a strong chapter structure — not to reorganize which ideas belong in which message.

# STRICT EDITORIAL INSTRUCTIONS
1. SEQUENCE PRESERVATION — NON-NEGOTIABLE: Chapters must follow the source audio order (audio-1 before audio-2 before audio-3, etc.). A single audio source may produce more than one chapter if the content depth warrants it — but all chapters from audio-1 must appear consecutively before any chapter from audio-2. Never interleave chapters from different audio sources. Never place a segment from audio-2 into a chapter that also contains segments from audio-1.
2. WITHIN-CHAPTER SYNTHESIS ONLY: Within a single message (single sourceAudio), you may group scattered thoughts on the same topic into unified sections. If the speaker revisits a point within the same message, consolidate it into one section. Do not synthesize across messages.
3. WITHIN-CHAPTER ARC: Within each chapter, structure the sections to reflect the message's natural teaching progression. Where the content supports it, apply the arc below — but never at the cost of distorting the speaker's own sequence:
   - The Hook: The core problem or provocative claim that opens the message
   - The Context: Why this matters (as the speaker framed it)
   - The Mechanism: The core argument or framework the speaker taught
   - The Application: How the speaker called the listener to respond
4. WITHIN-CHAPTER DEDUPLICATION ONLY: Within a single message, pure title-restatement recap lines (e.g., "our series this month is...") with zero new substance may be collapsed. Do not discard content that transitions the series narrative forward.

# PIPELINE RULES — REQUIRED FOR OUTPUT VALIDITY
- sourceSegmentIds MUST reference actual segment IDs from the provided segment list (e.g. "seg-1"). Never invent IDs.
- SEGMENT UNIQUENESS — NON-NEGOTIABLE: Each segment ID must appear in EXACTLY ONE section across the entire book. Never assign the same segment ID to two or more sections or chapters. If two sections seem to need the same content, merge them into one section.
- Each chapter must draw segments from only one sourceAudio. A single sourceAudio may produce multiple consecutive chapters if the content depth warrants it.
- Each chapter: 3–5 sections; each section covers one focused teaching point.
- targetWordCount per section = sum of that section's segments' estimatedWordCount.
- bookTitle and authorName must come from the content; use "the Author" if name is unknown.
- estimatedTotalWords = sum of all section targetWordCounts.
- Always return every required field, even if some strings are brief.
- Never leave sections empty; every chapter must have at least one section with at least one sourceSegmentId.`,
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
