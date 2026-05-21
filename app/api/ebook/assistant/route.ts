import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { deepSeekModel } from "@/lib/ai-providers";
import {
  EbookManifestSchema,
  SectionDraftSchema,
  ChapterDraftSchema,
  FrontBackMatterSchema,
} from "@/lib/schemas/ebook";

export const runtime = "nodejs";
export const maxDuration = 120;

const RequestSchema = z.object({
  manifest: EbookManifestSchema,
  instruction: z.string().min(1).max(4000),
});

// The agent returns only what changed — undefined fields = no change
const EbookChangeSchema = z.object({
  bookTitle: z.string().optional(),
  subtitle: z.string().optional(),
  authorName: z.string().optional(),
  frontMatter: FrontBackMatterSchema.optional(),
  chapters: z.array(ChapterDraftSchema).optional(),
  updatedSections: z.array(SectionDraftSchema).optional(), // targeted section edits
  summary: z.string(), // one-sentence description of what changed
});

export async function POST(req: NextRequest) {
  const body = await req.json() as unknown;
  let input;
  try {
    input = RequestSchema.parse(body);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid input" },
      { status: 400 }
    );
  }

  const { manifest, instruction } = input;

  // Build a compact book summary to give the LLM context without the full prose
  const bookSummary = {
    bookTitle: manifest.bookTitle,
    subtitle: manifest.subtitle,
    authorName: manifest.authorName,
    totalWordCount: manifest.totalWordCount,
    frontMatter: {
      prefaceExcerpt: manifest.frontMatter.preface.slice(0, 300),
      introductionExcerpt: manifest.frontMatter.introduction.slice(0, 300),
    },
    chapters: manifest.chapters.map((ch) => ({
      number: ch.number,
      title: ch.title,
      keyTakeaways: ch.keyTakeaways,
      reflectionQuestions: ch.reflectionQuestions,
      totalWordCount: ch.totalWordCount,
      sections: ch.sections.map((s) => ({
        sectionNumber: s.sectionNumber,
        heading: s.heading,
        bodyExcerpt: s.body.slice(0, 300),
        wordCount: s.wordCount,
      })),
    })),
  };

  try {
    const { object } = await generateObject({
      model: deepSeekModel,
      schema: EbookChangeSchema,
      mode: "tool",
      temperature: 0.15,
      system: `You are the Nexus Book Director — a precision ebook editor with full authority over every aspect of this published teaching book.

════════════════════════════════════════════
SPEAKER-FIDELITY LAW — NON-NEGOTIABLE
════════════════════════════════════════════
This book was produced strictly from a speaker's transcripts. You MUST:
- NEVER add ideas, examples, stories, or theological content not already present in the book
- When rewriting or editing, work ONLY with content already in the book
- Preserve the speaker's voice, vocabulary, and teaching style exactly
- If asked to "improve" or "expand" content, do so by reorganizing or clarifying existing text — not by adding new content

════════════════════════════════════════════
WHAT YOU CAN DO
════════════════════════════════════════════
TITLE & METADATA:
  "change the title to…"            → update bookTitle
  "update the subtitle"             → update subtitle
  "set the author name to…"         → update authorName

FRONT MATTER:
  "rewrite the preface"             → update frontMatter.preface using existing content
  "revise the introduction"         → update frontMatter.introduction
  "update the conclusion"           → update frontMatter.conclusion

CHAPTER OPERATIONS:
  "rename chapter N to…"            → update chapters[N-1].title
  "edit the intro of chapter N"     → update chapters[N-1].intro
  "edit the conclusion of chapter N"→ update chapters[N-1].conclusion
  "add a takeaway to chapter N"     → update chapters[N-1].keyTakeaways
  "replace the reflection questions in chapter N" → update chapters[N-1].reflectionQuestions
  "reorder the sections in chapter N"             → reorder sections array

SECTION OPERATIONS:
  "rename section N.M to…"          → use updatedSections with chapterNumber N, sectionNumber M
  "rewrite section N.M"             → use updatedSections (use body from existing bookSummary + instruction)
  "improve the heading of section N.M"→ updatedSections with updated heading

════════════════════════════════════════════
OUTPUT RULES
════════════════════════════════════════════
- Only return fields that ACTUALLY changed — leave others as undefined
- If chapters array is returned, include ALL chapters (changed and unchanged)
- If updatedSections is returned, include ONLY the changed sections; client merges them
- Always write a concise one-sentence "summary" of exactly what changed
- If the instruction is ambiguous, make the most useful interpretation and explain in summary`,
      prompt: [
        "CURRENT BOOK STRUCTURE:",
        JSON.stringify(bookSummary, null, 2),
        "",
        "USER INSTRUCTION:",
        instruction,
      ].join("\n"),
    });

    // Merge updatedSections into the full manifest chapters
    let mergedChapters = manifest.chapters;
    if (object.updatedSections && object.updatedSections.length > 0) {
      mergedChapters = manifest.chapters.map((ch) => ({
        ...ch,
        sections: ch.sections.map((s) => {
          const updated = object.updatedSections!.find(
            (u) => u.chapterNumber === ch.number && u.sectionNumber === s.sectionNumber
          );
          return updated ?? s;
        }),
      }));
    }

    // If chapters array was explicitly returned, use that instead
    if (object.chapters) {
      mergedChapters = object.chapters;
    }

    const updatedManifest = {
      ...manifest,
      ...(object.bookTitle !== undefined && { bookTitle: object.bookTitle }),
      ...(object.subtitle !== undefined && { subtitle: object.subtitle }),
      ...(object.authorName !== undefined && { authorName: object.authorName }),
      ...(object.frontMatter !== undefined && { frontMatter: object.frontMatter }),
      chapters: mergedChapters,
    };

    const validated = EbookManifestSchema.safeParse(updatedManifest);
    if (!validated.success) {
      return NextResponse.json(
        { error: `Manifest validation failed: ${validated.error.issues[0]?.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ manifest: validated.data, summary: object.summary }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Ebook assistant failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
