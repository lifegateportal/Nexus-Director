import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { deepSeekReasonerModel } from "@/lib/ai-providers";
import { ArchitectRequestSchema } from "@/lib/schemas/ebook";

export const runtime = "nodejs";
export const maxDuration = 120;

// ── Upgrade helpers ───────────────────────────────────────────────────────────

type ArcRole = "hook" | "context" | "mechanism" | "application" | "untagged";

// U1 — Arc scoring: classify a section heading + keyPoints into an arc role
const ARC_KEYWORDS: Record<ArcRole, string[]> = {
  hook:        ["problem", "question", "why", "challenge", "crisis", "struggle", "pain", "trap", "lie", "broken", "need", "call", "open", "begin", "what if"],
  context:     ["because", "reason", "background", "history", "context", "understand", "foundation", "basis", "root", "origin", "means", "definition", "explains"],
  mechanism:   ["how", "principle", "law", "process", "method", "key", "secret", "truth", "power", "strategy", "framework", "step", "way", "work", "operate"],
  application: ["apply", "response", "action", "do", "practice", "live", "walk", "obey", "commit", "decide", "choose", "result", "fruit", "outcome", "change", "now"],
  untagged:    [],
};

function scoreArcRole(heading: string, keyPoints: string[]): ArcRole {
  const text = [heading, ...keyPoints].join(" ").toLowerCase();
  const scores: Record<ArcRole, number> = { hook: 0, context: 0, mechanism: 0, application: 0, untagged: 0 };
  for (const [role, keywords] of Object.entries(ARC_KEYWORDS) as [ArcRole, string[]][]) {
    for (const kw of keywords) {
      if (text.includes(kw)) scores[role]++;
    }
  }
  const best = (Object.entries(scores) as [ArcRole, number][])
    .filter(([role]) => role !== "untagged")
    .sort((a, b) => b[1] - a[1])[0];
  return best && best[1] > 0 ? best[0] : "untagged";
}

function buildArcFlags(sections: { arcRole: ArcRole }[], chapterTitle: string): string[] {
  const flags: string[] = [];
  const roles = sections.map((s) => s.arcRole);
  if (!roles.includes("hook")) flags.push(`Ch "${chapterTitle}": no hook section — consider making the opening section more provocative`);
  if (!roles.includes("application")) flags.push(`Ch "${chapterTitle}": no application section — readers need a landing point`);
  const mechanismCount = roles.filter((r) => r === "mechanism").length;
  if (mechanismCount >= 3) flags.push(`Ch "${chapterTitle}": ${mechanismCount} consecutive mechanism sections — consider consolidating or adding application`);
  return flags;
}

// U2 — Cross-chapter section overlap: keyword token overlap between section headings
function keywordTokens(text: string): Set<string> {
  const stopWords = new Set(["a","an","the","and","or","of","in","to","for","with","by","is","are","was","were","be","it","its","this","that","these","those","on","at","as","from","up","about","how","what","which","who"]);
  return new Set(
    text.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter((w) => w.length > 3 && !stopWords.has(w))
  );
}

function sectionKeywordOverlap(a: string, b: string): number {
  const setA = keywordTokens(a);
  const setB = keywordTokens(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let shared = 0;
  for (const w of setA) { if (setB.has(w)) shared++; }
  return shared / Math.min(setA.size, setB.size);
}

// U3 — Word budget calibration: quality multiplier from segment density
function segmentQualityMultiplier(keyPointsCount: number, quotesCount: number): number {
  const density = keyPointsCount + quotesCount * 0.5;
  if (density >= 5) return 1.2;
  if (density <= 1) return 0.7;
  return 1.0;
}

// U5 — Chapter premise line: derive from keyTheme + first section heading
function deriveChapterPremise(
  chapterTitle: string,
  keyTheme: string,
  coreThesis: string,
  firstSectionHeading: string
): string {
  // Use the most specific available signal in priority order
  const theme = keyTheme.trim() || coreThesis.trim() || chapterTitle.trim();
  const hook = firstSectionHeading.trim();
  if (theme && hook && theme.toLowerCase() !== hook.toLowerCase()) {
    return `${theme}: ${hook.replace(/[.!?]+$/, "").trim()}.`;
  }
  return theme ? `${theme}.` : `${chapterTitle}.`;
}

// U7 — Series arc: find shared keyword thread between adjacent chapter conclusions and openings
function deriveBridgeConcept(
  fromLastSection: { heading: string; keyPoints: string[] },
  toFirstSection: { heading: string; keyPoints: string[] }
): string {
  const fromText = [fromLastSection.heading, ...fromLastSection.keyPoints].join(" ");
  const toText = [toFirstSection.heading, ...toFirstSection.keyPoints].join(" ");
  const fromTokens = keywordTokens(fromText);
  const toTokens = keywordTokens(toText);
  const shared: string[] = [];
  for (const w of fromTokens) { if (toTokens.has(w)) shared.push(w); }
  if (shared.length > 0) return shared.slice(0, 3).join(", ");
  // Fall back to stating the thematic direction
  return `${fromLastSection.heading.split(/\s+/).slice(0, 4).join(" ")} → ${toFirstSection.heading.split(/\s+/).slice(0, 4).join(" ")}`;
}

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
      heading: (segment.topic || `Section ${sectionIndex + 1}`).replace(/^(introduction|intro|overview|opening|summary|conclusion)\s*:\s*/i, "").trim() || `Section ${sectionIndex + 1}`,
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
      heading: (segment.topic || `Section ${index + 1}`).replace(/^(introduction|intro|overview|opening|summary|conclusion)\s*:\s*/i, "").trim() || `Section ${index + 1}`,
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
            heading: ((section.heading || "").trim() || `Section ${sectionIndex + 1}`).replace(/^(introduction|intro|overview|opening|summary|conclusion)\s*:\s*/i, "").trim() || `Section ${sectionIndex + 1}`,
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
      // Skip LLM when the user wants each upload to be exactly one chapter
      if (input.oneChapterPerUpload) {
        minimal = fallbackArchitecture(input);
      } else {
        const result = await generateObject({
        model: deepSeekReasonerModel,
        schema: MinimalArchitectureSchema,
        mode: "json",
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
- Never leave sections empty; every chapter must have at least one section with at least one sourceSegmentId.
- SECTION HEADING BAN: Never start a section heading with "Introduction", "Intro", "Overview", "Opening", "Summary", or "Conclusion". These are structural labels, not teaching titles. Rename any such heading to the specific claim or truth the speaker made in that segment (e.g. "Prayer changes your countenance", not "Introduction: Prayer Changes People").`,
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
      } // end else (LLM path)
    } catch {
      minimal = fallbackArchitecture(input);
    }

    const normalized = normalizeArchitecture(minimal, input);

    // ── Upgrade 6: Orphan segment recovery ──────────────────────────────────
    // Find segments not assigned to any section. Segments >150 words get assigned
    // to the most keyword-similar section. Thinner ones are logged as dropped.
    const assignedSegIds = new Set(
      normalized.chapters.flatMap((ch) => ch.sections.flatMap((s) => s.sourceSegmentIds))
    );
    const orphans = input.contentMap.segments.filter(
      (s) => !assignedSegIds.has(s.id) && !s.topic.includes("[NON-TEACHING")
    );
    const droppedSegments: string[] = [];

    if (orphans.length > 0) {
      // Build a flat list of all sections with their text for similarity scoring
      const allSectionEntries = normalized.chapters.flatMap((ch) =>
        ch.sections.map((sec) => ({
          chapterIdx: ch.number - 1,
          sectionIdx: sec.sectionNumber - 1,
          text: [sec.heading, ...sec.sourceSegmentIds.map((id) => segmentMap[id]?.topic ?? "")].join(" "),
        }))
      );

      for (const orphan of orphans) {
        if (orphan.estimatedWordCount < 150) {
          droppedSegments.push(orphan.id);
          continue;
        }
        // Find most similar section by keyword overlap with orphan topic + keyPoints
        const orphanText = [orphan.topic, ...(orphan.keyPoints ?? [])].join(" ");
        let bestScore = 0;
        let bestEntry: (typeof allSectionEntries)[0] | null = null;
        for (const entry of allSectionEntries) {
          const score = sectionKeywordOverlap(orphanText, entry.text);
          if (score > bestScore) { bestScore = score; bestEntry = entry; }
        }
        if (bestEntry && bestScore > 0.1) {
          normalized.chapters[bestEntry.chapterIdx].sections[bestEntry.sectionIdx].sourceSegmentIds.push(orphan.id);
          assignedSegIds.add(orphan.id);
        } else {
          droppedSegments.push(orphan.id);
        }
      }
    }

    // ── Rehydrate full BookArchitecture from minimal output ───────────────
    const hydratedChapters = normalized.chapters.map((ch) => {
      const chapterSegIds = [...new Set(ch.sections.flatMap((s) => s.sourceSegmentIds))];
      const chapterQuotes = chapterSegIds
        .flatMap((sid) => segmentMap[sid]?.quotes ?? [])
        .map((q) => quoteMap[q.id] ?? q)
        .filter((q, i, arr) => arr.findIndex((x) => x.id === q.id) === i);

      const rawSections = ch.sections.map((sec, secIdx) => {
        const safeSourceSegmentIds = sec.sourceSegmentIds.filter((id) => validSegmentIds.has(id));
        const secSegments = safeSourceSegmentIds.map((id) => segmentMap[id]).filter(Boolean);
        const secKeyPoints = secSegments.flatMap((s) => s?.keyPoints ?? []);
        const secQuotes = secSegments
          .flatMap((s) => s?.quotes ?? [])
          .map((q) => quoteMap[q.id] ?? q)
          .filter((q, i, arr) => arr.findIndex((x) => x.id === q.id) === i);

        // ── Upgrade 3: Word budget calibration ──────────────────────────
        const baseWordCount = sec.targetWordCount ||
          secSegments.reduce((sum, seg) => sum + (seg?.estimatedWordCount ?? 0), 0);
        const quotesCount = secQuotes.length;
        const multiplier = segmentQualityMultiplier(secKeyPoints.length, quotesCount);
        const calibratedWordCount = Math.max(250, Math.round(baseWordCount * multiplier));

        // ── Upgrade 1: Arc role scoring ──────────────────────────────────
        const arcRole = scoreArcRole(sec.heading, secKeyPoints);

        return {
          sectionNumber: sec.sectionNumber,
          heading: sec.heading,
          sourceSegmentIds: safeSourceSegmentIds,
          targetWordCount: calibratedWordCount,
          keyPoints: secKeyPoints,
          quotesInSection: secQuotes,
          arcRole,
          _contentDensity: secKeyPoints.length + quotesCount, // internal — used for U4
          _originalIdx: secIdx,                               // internal — used for U4
        };
      });

      // ── Upgrade 4: Climax section placement ─────────────────────────────
      // Move the most content-dense section to position 3 or 4 (0-indexed: 2 or 3)
      // if it's currently at position 0 (hook slot) or last slot.
      const sections = [...rawSections];
      if (sections.length >= 4) {
        const densities = sections.map((s) => s._contentDensity);
        const maxDensity = Math.max(...densities);
        const climaxIdx = densities.indexOf(maxDensity);
        const targetPos = sections.length >= 5 ? 3 : 2; // 4th of 5, or 3rd of 4
        if (climaxIdx === 0 || climaxIdx === sections.length - 1) {
          const [climax] = sections.splice(climaxIdx, 1);
          sections.splice(targetPos, 0, climax);
          // Renumber after reorder
          sections.forEach((s, i) => { s.sectionNumber = i + 1; });
        }
      }

      // ── Upgrade 1: Arc flags ─────────────────────────────────────────────
      const arcFlags = buildArcFlags(sections, ch.title);

      // ── Upgrade 5: Chapter premise line ─────────────────────────────────
      const chapterPremise = deriveChapterPremise(
        ch.title,
        ch.keyTheme,
        input.contentMap.coreThesis,
        sections[0]?.heading ?? ""
      );

      // Strip internal fields before returning
      const cleanSections = sections.map(({ _contentDensity: _d, _originalIdx: _o, ...rest }) => rest);

      return {
        number: ch.number,
        title: ch.title,
        keyTheme: ch.keyTheme,
        sourceSegmentIds: chapterSegIds,
        quotesInChapter: chapterQuotes,
        chapterPremise,
        arcFlags,
        sections: cleanSections,
      };
    });

    // ── Upgrade 2: Cross-chapter section overlap check ───────────────────
    // Flag pairs of sections from different chapters with >60% keyword overlap
    const overlapWarnings: string[] = [];
    const allSectionFlat = hydratedChapters.flatMap((ch) =>
      ch.sections.map((s) => ({ chapterNum: ch.number, heading: s.heading, keyPoints: s.keyPoints }))
    );
    for (let i = 0; i < allSectionFlat.length; i++) {
      for (let j = i + 1; j < allSectionFlat.length; j++) {
        const a = allSectionFlat[i];
        const b = allSectionFlat[j];
        if (a.chapterNum === b.chapterNum) continue;
        const aText = [a.heading, ...a.keyPoints].join(" ");
        const bText = [b.heading, ...b.keyPoints].join(" ");
        const overlap = sectionKeywordOverlap(aText, bText);
        if (overlap >= 0.60) {
          overlapWarnings.push(
            `Ch ${a.chapterNum} §"${a.heading}" ↔ Ch ${b.chapterNum} §"${b.heading}" (${Math.round(overlap * 100)}% overlap)`
          );
        }
      }
    }
    // Attach overlap warnings as arcFlags on the affected chapters
    if (overlapWarnings.length > 0) {
      for (const warning of overlapWarnings) {
        const chNumMatch = warning.match(/^Ch (\d+)/);
        if (chNumMatch) {
          const chNum = parseInt(chNumMatch[1], 10);
          const ch = hydratedChapters.find((c) => c.number === chNum);
          if (ch) ch.arcFlags.push(`[OVERLAP] ${warning}`);
        }
      }
    }

    // ── Upgrade 7: Series arc connective tissue map ──────────────────────
    const seriesArc = hydratedChapters.slice(0, -1).map((ch, idx) => {
      const nextCh = hydratedChapters[idx + 1];
      const fromLastSection = ch.sections[ch.sections.length - 1];
      const toFirstSection = nextCh.sections[0];
      return {
        fromChapter: ch.number,
        toChapter: nextCh.number,
        bridgeConcept: deriveBridgeConcept(
          { heading: fromLastSection?.heading ?? "", keyPoints: fromLastSection?.keyPoints ?? [] },
          { heading: toFirstSection?.heading ?? "", keyPoints: toFirstSection?.keyPoints ?? [] }
        ),
      };
    });

    const hydrated = {
      bookTitle: normalized.bookTitle,
      subtitle: normalized.subtitle,
      authorName: normalized.authorName,
      estimatedTotalWords: normalized.estimatedTotalWords,
      frontMatterNotes: normalized.frontMatterNotes,
      backMatterNotes: normalized.backMatterNotes,
      chapters: hydratedChapters,
      seriesArc,
      droppedSegments,
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
