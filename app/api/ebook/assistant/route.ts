import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { deepSeekReasonerModel } from "@/lib/ai-providers";
import {
  EbookManifestSchema,
  SectionDraftSchema,
  ChapterDraftSchema,
  FrontBackMatterSchema,
  BookTemplateEnum,
} from "@/lib/schemas/ebook";
import { harmonizeBookManifest } from "@/lib/editorial-style-bible";

export const runtime = "nodejs";
export const maxDuration = 120;

const RequestSchema = z.object({
  manifest: EbookManifestSchema,
  instruction: z.string().min(1).max(4000),
  pipeline: z.object({
    stage: z.string(),
    progress: z.object({ total: z.number().int().nonnegative(), completed: z.number().int().nonnegative() }),
    totalWords: z.number().int().nonnegative(),
    reviewReady: z.boolean(),
    qualityReport: z.object({
      score: z.number(),
      pass: z.boolean(),
      issues: z.array(z.object({ severity: z.enum(["warn", "error"]), message: z.string() })),
    }).nullable(),
    error: z.string().nullable(),
    bookTitle: z.string().nullable(),
    chapterCount: z.number().int().nonnegative(),
    frontMatterSections: z.number().int().nonnegative(),
  }).optional(),
});

// The agent returns only what changed — undefined fields = no change
const EbookChangeSchema = z.object({
  bookTitle: z.string().optional(),
  subtitle: z.string().optional(),
  authorName: z.string().optional(),
  frontMatter: FrontBackMatterSchema.optional(),
  chapters: z.array(ChapterDraftSchema).optional(),
  updatedSections: z.array(SectionDraftSchema).optional(), // targeted section edits
  /** Layout/print template for export */
  selectedTemplate: BookTemplateEnum.optional(),
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

  const { manifest, instruction, pipeline } = input;

  const safeExcerpt = (value: string | null | undefined, max = 600) => (value ?? "").slice(0, max);

  // Track which sections are truncated so we can restore original content if the AI loses words
  const truncatedSections = new Set<string>();

  // Build a rich book context — front matter in full, section bodies as excerpts
  // (full body sent for short sections; excerpted for long ones to stay within token budget)
  const bookSummary = {
    bookTitle: manifest.bookTitle,
    subtitle: manifest.subtitle,
    authorName: manifest.authorName,
    totalWordCount: manifest.totalWordCount,
    frontMatter: {
      preface: manifest.frontMatter.preface,
      introduction: manifest.frontMatter.introduction,
      conclusion: manifest.frontMatter.conclusion,
      aboutAuthor: manifest.frontMatter.aboutAuthor,
      resourcesList: manifest.frontMatter.resourcesList,
    },
    chapters: manifest.chapters.map((ch) => ({
      number: ch.number,
      title: ch.title,
      intro: ch.intro,
      conclusion: ch.conclusion,
      keyTakeaways: ch.keyTakeaways,
      reflectionQuestions: ch.reflectionQuestions,
      totalWordCount: ch.totalWordCount,
      sections: ch.sections.map((s) => {
        const fullBody = s.body ?? "";
        const isTruncated = fullBody.length > 1200;
        if (isTruncated) {
          truncatedSections.add(`${ch.number}:${s.sectionNumber}`);
        }
        return {
          sectionNumber: s.sectionNumber,
          chapterNumber: ch.number,
          heading: s.heading,
          // Send full body for short sections; excerpt for long ones with a NO-EDIT marker
          body: isTruncated
            ? safeExcerpt(fullBody, 800) + "\n…[TRUNCATED — DO NOT MODIFY THIS SECTION. Return its body field as an empty string so the original is preserved]"
            : fullBody,
          wordCount: s.wordCount,
        };
      }),
    })),
  };

  const pipelineSummary = pipeline
    ? {
        stage: pipeline.stage,
        progress: pipeline.progress,
        totalWords: pipeline.totalWords,
        reviewReady: pipeline.reviewReady,
        qualityReport: pipeline.qualityReport,
        error: pipeline.error,
        bookTitle: pipeline.bookTitle,
        chapterCount: pipeline.chapterCount,
        frontMatterSections: pipeline.frontMatterSections,
      }
    : null;

  try {
    const { object } = await generateObject({
      model: deepSeekReasonerModel,
      schema: EbookChangeSchema,
      mode: "json",
      system: `You are the Nexus Book Director — a precision ebook editor with MAXIMUM AUTHORITY over every part of this published teaching book. You receive the full book structure and can make any change the user requests.

════════════════════════════════════════════
SPEAKER-FIDELITY LAW — NON-NEGOTIABLE
════════════════════════════════════════════
This book was produced strictly from a speaker's transcripts. You MUST:
- NEVER add ideas, examples, stories, or theological content not already present in the book
- When rewriting or editing, work ONLY with content already in the book
- Preserve the speaker's voice, vocabulary, and teaching style exactly
- If asked to "improve" or "expand" content, do so by reorganizing or clarifying existing text — not by adding new content

BOOK-SAFETY RULE — ALWAYS APPLY
- Remove or avoid church-room chatter that does not belong in a book: greetings to congregation, thanking attendees/teams, service-flow remarks, crowd-response prompts, and stage directions.
- Keep only reader-appropriate teaching prose.

════════════════════════════════════════════
FULL AUTHORITY — WHAT YOU CAN DO
════════════════════════════════════════════
METADATA:
  "change the title to…"              → update bookTitle
  "update the subtitle"               → update subtitle
  "set the author name to…"           → update authorName

FRONT MATTER (return full frontMatter object with ALL fields):
  "rewrite the preface"               → update frontMatter.preface
  "revise the introduction"           → update frontMatter.introduction
  "update the conclusion"             → update frontMatter.conclusion
  "update about the author"           → update frontMatter.aboutAuthor
  "update the resources list"         → update frontMatter.resourcesList
  Any front matter instruction        → return the COMPLETE frontMatter object with all fields preserved

CHAPTER OPERATIONS (return the full chapters array):
  "rename chapter N to…"              → update chapters[N-1].title
  "rewrite the intro of chapter N"    → update chapters[N-1].intro (full prose, not excerpt)
  "rewrite the conclusion of chapter N" → update chapters[N-1].conclusion
  "add/replace takeaways in chapter N" → update chapters[N-1].keyTakeaways (5–7 bullet items)
  "replace reflection questions in chapter N" → update chapters[N-1].reflectionQuestions (4–6 questions)
  "reorder sections in chapter N"     → reorder chapters[N-1].sections array

SECTION OPERATIONS (return only changed sections via updatedSections):
  "rename section N.M to…"            → updatedSections: [{chapterNumber:N, sectionNumber:M, heading:…, body:existing}]
  "rewrite section N.M"               → updatedSections: [{chapterNumber:N, sectionNumber:M, heading:existing, body:FULL REWRITE}]
  "expand section N.M"                → updatedSections with longer body using existing content
  "improve section N.M"               → updatedSections with refined prose, same ideas
  "fix the tone in section N.M"       → updatedSections with tone adjusted, same content
  "remove audience language from section N.M" → updatedSections with congregation/live-event language removed

════════════════════════════════════════════
FORMATTING & CONTENT STRUCTURE
════════════════════════════════════════════
You have full control over how content is formatted within sections using Markdown.
All section bodies support: ## headings, ### sub-headings, **bold**, *italic*, > block quotes, - bullet lists, 1. numbered lists, --- dividers.

FORMATTING OPERATIONS (use updatedSections for targeted, chapters for book-wide):
  "format section N.M"                → restructure body with proper ## headings, **bold** key terms, > block quotes for scripture
  "format all sections in chapter N" → return full chapters array with all section bodies reformatted
  "format the entire book"            → return full chapters array, every section body reformatted
  "bold all key terms in chapter N"   → updatedSections: rewrite body adding **bold** around key theological/subject terms
  "add a divider before each heading" → updatedSections: insert --- before each ## heading in the body
  "make scripture passages block quotes" → updatedSections: wrap all indented scripture in > prefix
  "use numbered lists for the takeaways" → update keyTakeaways to use numbered items
  "restructure section N.M as a listicle" → updatedSections: rewrite body as intro + numbered list + closing
  "add a pull quote to section N.M"   → updatedSections: insert a > block quote of the strongest sentence at the start

FORMATTING STANDARDS — apply when formatting:
  - Chapter intro/conclusion: flowing prose, no headings
  - Section body structure: optional ## heading → prose paragraphs → optional > pull quote → optional --- divider → prose continuation
  - Key terms: **bold** on first meaningful use per section
  - Scripture (inline, under 40 words): "quoted text" (Book Chapter:Verse, Translation)
  - Scripture (block, 40+ words): > indented block, reference on next line
  - Lists: use only when the content is genuinely list-like; never convert narrative prose into bullets
  - Headings inside sections: use ## for major concept breaks, ### for sub-points — only where the content warrants it

════════════════════════════════════════════
STRUCTURAL LAYOUT — MOVE, MERGE, REORDER
════════════════════════════════════════════
You can restructure the book's architecture. Always return the FULL chapters array when making structural changes.

  "move section N.M to chapter X"     → remove section from chapter N, insert at end of chapter X, renumber sectionNumbers
  "move section N.M to position P in chapter X" → insert at position P (1-based), renumber sectionNumbers
  "swap sections N.M and N.K"         → exchange positions within a chapter, update sectionNumbers
  "reorder sections in chapter N: M, K, L" → reorder sections to the given sequence, renumber sectionNumbers
  "merge sections N.M and N.K"        → combine bodies with a --- divider, keep heading of N.M, remove N.K, renumber
  "split section N.M"                 → divide body at a natural break, create two sections, renumber
  "move chapter N to position X"      → reorder the chapters array, renumber chapter.number fields
  "split chapter N into two chapters" → divide at the natural midpoint (half the sections each), give each a title

RENUMBERING RULE — NON-NEGOTIABLE:
  After any structural change, renumber ALL sectionNumbers within each chapter sequentially starting from 1.
  After chapter reordering, renumber ALL chapter.number fields sequentially starting from 1.
  Also update every section's chapterNumber field if sections moved to a different chapter.

════════════════════════════════════════════
EXPORT LAYOUT TEMPLATE
════════════════════════════════════════════
You control which visual template is used when the book is exported to PDF, EPUB, and DOCX.
Set "selectedTemplate" to one of these values:

  "devotional"          — Warm, centered chapter titles, open paragraph spacing, wide margins.
                          Best for: sermons, spiritual growth, faith-based teaching.
  "classic-academic"    — University press style (Chicago/Oxford), justified text, paragraph indents, formal.
                          Best for: theology, doctrine, academic commentary.
  "modern-business"     — Clean sans-serif, bold chapter labels, open white space.
                          Best for: leadership, strategy, professional development books.
  "popular-nonfiction"  — Bestseller style, left-aligned, punchy chapter headers, accessible.
                          Best for: broad audience teaching, motivational, accessible faith.
  "premium-literary"    — High-end serif typography, generous leading, premium aesthetic.
                          Best for: memoirs, narrative theology, high-production ministry books.

TEMPLATE TRIGGERS:
  "use the devotional template"        → selectedTemplate: "devotional"
  "use classic academic layout"        → selectedTemplate: "classic-academic"
  "use modern business style"          → selectedTemplate: "modern-business"
  "use popular nonfiction layout"      → selectedTemplate: "popular-nonfiction"
  "use premium literary style"         → selectedTemplate: "premium-literary"
  "make it look like a published book" → selectedTemplate: "premium-literary"
  "formal academic layout"             → selectedTemplate: "classic-academic"
  "church book / sermon notes style"   → selectedTemplate: "devotional"
  "clean modern look"                  → selectedTemplate: "modern-business"

════════════════════════════════════════════
BOOK-WIDE OPERATIONS
════════════════════════════════════════════
  "fix all live-audience language"    → return full chapters array with all sections cleaned
  "remove all greeting/crowd phrases" → return full chapters array
  "standardise all section headings"  → return full chapters array with consistent heading format
  "add takeaways to all chapters"     → return full chapters array with keyTakeaways filled in
  "format the entire book"            → return full chapters array with all bodies formatted to standards
  "bold key terms throughout"         → return full chapters array with **bold** applied to first-use terms

════════════════════════════════════════════
CONTENT PRESERVATION — CRITICAL
════════════════════════════════════════════
Some section bodies end with "…[TRUNCATED — DO NOT MODIFY THIS SECTION...]".
This means the full content was too long to include in this prompt.
YOU MUST:
- Return those sections' body field as an EMPTY STRING "" — the client will restore the original automatically
- NEVER attempt to rewrite, summarise, or fill in a truncated section
- ONLY modify a truncated section if the user's instruction EXPLICITLY names it by section number (e.g., "rewrite section 2.3")
- This rule prevents catastrophic word count loss across the book

════════════════════════════════════════════
OUTPUT RULES
════════════════════════════════════════════
- Return ONLY fields that ACTUALLY changed — leave others as undefined
- If chapters array is returned, include ALL chapters (changed and unchanged) with ALL their sections
- If updatedSections is returned, include ONLY the changed sections — the client merges them by chapterNumber + sectionNumber
- The body field in updatedSections MUST be the FULL rewritten prose — never truncate
- frontMatter: if returned, include ALL fields (preface, introduction, conclusion, aboutAuthor, resourcesList)
- selectedTemplate: only include if the user explicitly asked to change the layout or template
- Always write a concise one-sentence "summary" of exactly what changed
- If the instruction is ambiguous, make the most useful interpretation and explain in summary
- If asked to do something outside your authority or that violates fidelity law, explain why in the summary and return no changes`,
      prompt: [
        "CURRENT BOOK STRUCTURE:",
        JSON.stringify(bookSummary, null, 2),
        pipelineSummary ? ["CURRENT PIPELINE STATE:", JSON.stringify(pipelineSummary, null, 2)].join("\n") : "",
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
          if (!updated) return s;
          // Safety guard: if the returned body is empty or drastically shorter than original,
          // restore the original body to prevent content loss on truncated sections
          const originalWords = (s.body ?? "").split(/\s+/).filter(Boolean).length;
          const returnedWords = (updated.body ?? "").split(/\s+/).filter(Boolean).length;
          const bodyToUse =
            !updated.body || (truncatedSections.has(`${ch.number}:${s.sectionNumber}`) && returnedWords < originalWords * 0.75)
              ? s.body
              : updated.body;
          return { ...updated, body: bodyToUse };
        }),
      }));
    }

    // If chapters array was explicitly returned, use that instead,
    // but restore original bodies for any truncated sections where content was lost
    if (object.chapters) {
      mergedChapters = object.chapters.map((returnedCh) => {
        const originalCh = manifest.chapters.find((c) => c.number === returnedCh.number);
        if (!originalCh) return returnedCh;
        return {
          ...returnedCh,
          sections: (returnedCh.sections ?? []).map((returnedSection) => {
            const originalSection = originalCh.sections.find(
              (s) => s.sectionNumber === returnedSection.sectionNumber
            );
            if (!originalSection) return returnedSection;
            const key = `${returnedCh.number}:${returnedSection.sectionNumber}`;
            const wasTruncated = truncatedSections.has(key);
            const originalWords = (originalSection.body ?? "").split(/\s+/).filter(Boolean).length;
            const returnedWords = (returnedSection.body ?? "").split(/\s+/).filter(Boolean).length;
            // Restore original body if: section was truncated AND returned body is empty or lossy
            const bodyToUse =
              wasTruncated && (!returnedSection.body || returnedWords < originalWords * 0.75)
                ? originalSection.body
                : returnedSection.body;
            return { ...returnedSection, body: bodyToUse };
          }),
        };
      });
    }

    const updatedManifest = {
      ...manifest,
      ...(object.bookTitle !== undefined && { bookTitle: object.bookTitle }),
      ...(object.subtitle !== undefined && { subtitle: object.subtitle }),
      ...(object.authorName !== undefined && { authorName: object.authorName }),
      ...(object.frontMatter !== undefined && { frontMatter: object.frontMatter }),
      ...(object.selectedTemplate !== undefined && { selectedTemplate: object.selectedTemplate }),
      chapters: mergedChapters,
    };

    const harmonized = harmonizeBookManifest(updatedManifest);

    const validated = EbookManifestSchema.safeParse(harmonized);
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
