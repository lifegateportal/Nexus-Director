import { NextRequest, NextResponse } from "next/server";
import {
  AssignSegmentsRequestSchema,
} from "@/lib/schemas/ebook";
import type { SectionAssignment } from "@/lib/schemas/ebook";

export const runtime = "nodejs";
export const maxDuration = 90;

export async function POST(req: NextRequest) {
  const body = await req.json() as unknown;
  let input;
  try {
    input = AssignSegmentsRequestSchema.parse(body);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Invalid input" }, { status: 400 });
  }

  try {
    // Build a segment lookup for fast retrieval
    const segmentMap = Object.fromEntries(
      input.contentMap.segments.map((s) => [s.id, s])
    );

    // ── Scripture Amendment 4: Compute dominant Bible translation ──────────
    // Count non-empty translation strings across all quotes in the content map.
    // The most-frequent one becomes the book's primaryTranslation, used as the
    // default when a verse is quoted without an explicit translation label.
    const translationCounts: Record<string, number> = {};
    for (const q of input.contentMap.allQuotes ?? []) {
      const t = (q.translation ?? "").trim().toUpperCase();
      if (t) translationCounts[t] = (translationCounts[t] ?? 0) + 1;
    }
    const primaryTranslation = Object.keys(translationCounts).length > 0
      ? Object.entries(translationCounts).sort((a, b) => b[1] - a[1])[0][0]
      : undefined;

    // Build all assignments by resolving segment text for each section
    const assignments = input.architecture.chapters.flatMap((chapter) =>
      chapter.sections.map((section, idx) => {
        const excerpts = section.sourceSegmentIds
          .map((id) => segmentMap[id]?.rawText ?? "")
          .filter(Boolean);

        // We don't have the previous section's ending yet (that gets filled at write time)
        return {
          chapterNumber: chapter.number,
          chapterTitle: chapter.title,
          sectionNumber: section.sectionNumber,
          heading: section.heading,
          transcriptExcerpts: excerpts,
          quotes: section.quotesInSection,
          keyPoints: section.keyPoints,
          voiceDNA: input.voiceDNA,
          previousSectionEnding: "", // filled in at write time by the pipeline client
          targetWordCount: section.targetWordCount,
          // Upgrade 1: carry stable segment IDs so the pipeline can track consumption
          sourceSegmentIds: section.sourceSegmentIds,
          // A2: carry chapter premise so standalone callers get the north-star anchor
          chapterPremise: chapter.chapterPremise || undefined,
          // Upgrade 3: book thesis threaded from content map
          coreThesis: input.contentMap.coreThesis || undefined,
          // Scripture Amendment 4: primary translation for consistency
          primaryTranslation,
        };
      })
    );

    return NextResponse.json({ assignments }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Segment assignment failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
