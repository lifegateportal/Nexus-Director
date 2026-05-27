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
import { harmonizeBookManifest } from "@/lib/editorial-style-bible";

export const runtime = "nodejs";
export const maxDuration = 120;

const ChatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(8000),
});

const RequestSchema = z.object({
  manifest: EbookManifestSchema,
  instruction: z.string().min(1).max(4000),
  history: z.array(ChatMessageSchema).max(20).optional(),
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

// Lightweight patch for chapter-level metadata — use this instead of the full chapters array
// for any operation that doesn't restructure sections (e.g. edit conclusion, rename, takeaways).
const ChapterPatchSchema = z.object({
  chapterNumber: z.number().int().min(1),
  title: z.string().optional(),
  intro: z.string().optional(),
  epigraph: z.string().optional(),
  premiseLine: z.string().optional(),
  conclusion: z.string().optional(),
  keyTakeaways: z.array(z.string()).optional(),
  reflectionQuestions: z.array(z.string()).optional(),
});

// The agent returns only what changed — undefined fields = no change
const EbookChangeSchema = z.object({
  bookTitle: z.string().optional(),
  subtitle: z.string().optional(),
  authorName: z.string().optional(),
  frontMatter: FrontBackMatterSchema.optional(),
  chapters: z.array(ChapterDraftSchema).optional(),          // ONLY for section reorders / full restructures
  chapterPatches: z.array(ChapterPatchSchema).optional(),    // preferred for chapter-level field edits
  updatedSections: z.array(SectionDraftSchema).optional(),   // targeted section edits
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

  const { manifest, instruction, history, pipeline } = input;

  const safeExcerpt = (value: string | null | undefined, max = 600) => (value ?? "").slice(0, max);

  // Parse explicit section references from text.
  // Catches: "section 2.1", "section 2§1", "ch2 sec 1", "chapter 2 section 1", "2-1", "2.1"
  // Explicitly named sections are always sent at full length and not subject to the word-count guard.
  function parseExplicitSectionRefs(text: string): Set<string> {
    const refs = new Set<string>();
    const patterns = [
      // "section 2.1" / "section 2 §1" / "section 2-1"
      /\bsection\s+(\d+)[.\s§\-]+(\d+)/gi,
      // "(\d).(\d) section" reverse order
      /(\d+)[.\s§\-]+(\d+)\s+section\b/gi,
      // "chapter 2 section 1" / "ch 2 sec 1" / "ch2 s1"
      /\bch(?:apter)?\s*(\d+)\s+s(?:ec(?:tion)?)?\s*(\d+)/gi,
      // bare "2.1" preceded/followed by non-digits (to avoid matching dates/decimals)
      /(?<![\d.\-])(\d+)\.(\d+)(?![\d.\-])/g,
    ];
    for (const re of patterns) {
      let m;
      while ((m = re.exec(text)) !== null) {
        const ch = m[1];
        const sc = m[2];
        if (ch && sc) refs.add(`${ch}:${sc}`);
      }
    }
    return refs;
  }
  // Gather refs from the full conversation so contextual follow-ups ("make it longer") work
  const historyText = (history ?? []).map((m) => m.content).join(" ");
  const explicitRefs = parseExplicitSectionRefs(instruction + " " + historyText);

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
        const isExplicit = explicitRefs.has(`${ch.number}:${s.sectionNumber}`);
        // Explicit sections are always sent in full; others truncated only if they exceed 4000 chars
        const isTruncated = !isExplicit && fullBody.length > 4000;
        if (isTruncated) {
          truncatedSections.add(`${ch.number}:${s.sectionNumber}`);
        }
        return {
          sectionNumber: s.sectionNumber,
          chapterNumber: ch.number,
          heading: s.heading,
          // Send full body for explicit/short sections; excerpt for long background sections
          body: isTruncated
            ? safeExcerpt(fullBody, 1200) + "\n…[TRUNCATED — DO NOT MODIFY THIS SECTION. Return its body field as an empty string so the original is preserved]"
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
      model: deepSeekModel,
      schema: EbookChangeSchema,
      mode: "json",
      maxTokens: 8000,
      temperature: 0.15,
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
NATURAL LANGUAGE MAPPINGS — interpret these colloquial phrases correctly
════════════════════════════════════════════
"take out the church talk" / "remove pulpit language" / "congregation chatter" / "audience talk" / "live service language" / "speaker talking to audience"
  → fix live-audience language (updatedSections for affected sections)

"the ending is weak" / "fix the ending" / "the conclusion drags" / "wrap up chapter X better" / "chapter X needs a better close"
  → rewrite chapterPatches: conclusion for the named chapter

"remove the conclusions" / "take out the chapter endings" / "no need for summaries" / "cut the chapter summaries"
  → chapterPatches: conclusion: "" for named chapters

"the intro is weak" / "fix the opening" / "chapter X needs a better hook" / "the start is slow" / "strengthen the beginning"
  → rewrite chapterPatches: intro (and/or premiseLine) for the named chapter

"tighten up section X" / "clean it up" / "section X flows badly" / "make it read better" / "improve the writing"
  → updatedSections: rewrite body with tighter prose, same content

"make section X shorter" / "trim section X" / "condense section X" / "too long"
  → updatedSections: condensed body

"update the author bio" / "change the about section" / "author section needs updating"
  → frontMatter: update aboutAuthor

"take out the resources" / "remove the reading list" / "delete the resources section"
  → frontMatter: resourcesList: []

"the scripture is repeated" / "same verse appears twice" / "duplicate Bible verses"
  → updatedSections: remove the duplicate scripture reference from the later section

"move section X to chapter Y" / "transfer section X" / "section X belongs in chapter Y"
  → chapters array restructure: remove from source chapter, add to target chapter

"chapter X needs reflection questions" / "add questions at the end of chapter X"
  → chapterPatches: reflectionQuestions for that chapter

"chapter X needs takeaways" / "key points for chapter X" / "summarise chapter X"
  → chapterPatches: keyTakeaways for that chapter

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

CHAPTER OPERATIONS — use chapterPatches for field edits, chapters array ONLY for section reorders:
  "rename chapter N to…"               → chapterPatches: [{chapterNumber:N, title:"..."}]
  "rewrite the intro of chapter N"     → chapterPatches: [{chapterNumber:N, intro:"full prose"}]
  "rewrite the conclusion of chapter N"→ chapterPatches: [{chapterNumber:N, conclusion:"full prose"}]
  "remove the conclusion of chapter N" → chapterPatches: [{chapterNumber:N, conclusion:""}]
  "remove all conclusions"             → chapterPatches: [{chapterNumber:1,conclusion:""},{chapterNumber:2,conclusion:""},…]
  "add/replace takeaways in chapter N" → chapterPatches: [{chapterNumber:N, keyTakeaways:[…5–7 items]}]
  "replace reflection questions in chapter N" → chapterPatches: [{chapterNumber:N, reflectionQuestions:[…4–6]}]
  "reorder sections in chapter N"      → chapters array (only when restructuring section order)

SECTION OPERATIONS — return only changed sections via updatedSections:
  "rename section N.M to…"            → updatedSections: [{chapterNumber:N, sectionNumber:M, heading:…, body:existing}]
  "rewrite section N.M"               → updatedSections: [{chapterNumber:N, sectionNumber:M, heading:existing, body:FULL REWRITE}]
  "expand section N.M"                → updatedSections with longer body using existing content
  "improve section N.M"               → updatedSections with refined prose, same ideas
  "fix the tone in section N.M"       → updatedSections with tone adjusted, same content
  "remove audience language from section N.M" → updatedSections with congregation/live-event language removed

BOOK-WIDE OPERATIONS:
  "fix all live-audience language"    → updatedSections for every section that contains crowd language
  "remove all greeting/crowd phrases" → updatedSections for affected sections only
  "standardise all section headings"  → updatedSections with heading field only (body unchanged)
  "add takeaways to all chapters"     → chapterPatches: one entry per chapter with keyTakeaways filled in
  "remove all conclusions"            → chapterPatches: one entry per chapter with conclusion: ""

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
- Always write a concise one-sentence "summary" of exactly what changed
- If the instruction is ambiguous, make the most useful interpretation and describe what you did in summary
- ALWAYS attempt the instruction — never refuse or treat instructions as comments
- If you make ANY change, you MUST include the corresponding change fields (chapterPatches, updatedSections, chapters, frontMatter, etc.). Returning ONLY summary with no change fields = zero manuscript changes. The user will see your summary but the book will be IDENTICAL.
- Only return empty change fields when the user is asking a question ("show me...", "explain...") — not for edit instructions`,
      prompt: [
        "CURRENT BOOK STRUCTURE:",
        JSON.stringify(bookSummary, null, 2),
        pipelineSummary ? ["CURRENT PIPELINE STATE:", JSON.stringify(pipelineSummary, null, 2)].join("\n") : "",
        "",
        ...(history && history.length > 0
          ? [
              "CONVERSATION HISTORY (oldest first — use this to understand follow-up instructions):",
              history.map((m) => `${m.role === "user" ? "USER" : "DIRECTOR"}: ${m.content}`).join("\n"),
              "",
            ]
          : []),
        "CURRENT USER INSTRUCTION:",
        instruction,
      ].join("\n"),
    });

    // Merge updatedSections into the full manifest chapters
    let mergedChapters = manifest.chapters;

    // Apply lightweight chapter-level patches first (title, intro, conclusion, takeaways, etc.)
    if (object.chapterPatches && object.chapterPatches.length > 0) {
      mergedChapters = mergedChapters.map((ch) => {
        const patch = object.chapterPatches!.find((p) => p.chapterNumber === ch.number);
        if (!patch) return ch;
        const { chapterNumber: _ignored, ...fields } = patch;
        return { ...ch, ...fields };
      });
    }

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
          // For explicitly requested sections, trust the AI's non-empty response.
          // For truncated background sections, restore original if content loss > 25%.
          const sectionKey = `${ch.number}:${s.sectionNumber}`;
          const bodyToUse =
            !updated.body ||
            (!explicitRefs.has(sectionKey) && truncatedSections.has(sectionKey) && returnedWords < originalWords * 0.75)
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
            // Restore original body if: section was truncated (not explicitly requested) AND body is empty or lossy
            const bodyToUse =
              !explicitRefs.has(key) && wasTruncated && (!returnedSection.body || returnedWords < originalWords * 0.75)
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
      chapters: mergedChapters,
    };

    // Detect whether the AI actually produced any change fields.
    // If all change fields are absent, the manuscript would be identical to the input —
    // return noChanges so the client can warn the user instead of silently confirming.
    const hasChanges =
      object.chapterPatches?.length ||
      object.updatedSections?.length ||
      object.chapters?.length ||
      object.frontMatter !== undefined ||
      object.bookTitle !== undefined ||
      object.subtitle !== undefined ||
      object.authorName !== undefined;

    if (!hasChanges) {
      return NextResponse.json({ noChanges: true, summary: object.summary }, { status: 200 });
    }

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
