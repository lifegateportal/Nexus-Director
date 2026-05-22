import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { deepSeekModel } from "@/lib/ai-providers";
import { WriteSectionRequestSchema } from "@/lib/schemas/ebook";
import { PREMIUM_BOOK_STYLE_RULES, READER_NORMALIZATION_RULES, SOURCE_LOCK_RULES } from "@/lib/editorial-style-bible";
import { stripAudienceLanguage } from "@/lib/editorial-style-bible";

export const runtime = "nodejs";
export const maxDuration = 90;

function fallbackSectionBody(input: z.infer<typeof WriteSectionRequestSchema>["assignment"]): string {
  const cleanedExcerpts = input.transcriptExcerpts
    .map((excerpt) => excerpt
      .replace(/\r\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim())
    .filter(Boolean);

  const bodyFromTranscript = cleanedExcerpts.join("\n\n").trim();
  if (bodyFromTranscript) return bodyFromTranscript;

  const bodyFromKeyPoints = input.keyPoints
    .map((point) => point.trim())
    .filter(Boolean)
    .join(" ")
    .trim();
  if (bodyFromKeyPoints) return bodyFromKeyPoints;

  return input.heading.trim() || "Section content unavailable.";
}

function normalizeReaderFacingProse(text: string): string {
  return text
    .replace(/\b(turn to your neighbor|say amen|clap your hands|lift your hands)\b/gi, "")
    .replace(/\b(as you sit here today|in this room today|right here in this place)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const EDITORIAL_SYSTEM = `You are an editorial assistant transforming a teacher's spoken transcript into polished written prose.

════════════════════════════════════════════
ABSOLUTE CONTENT RULE — READ CAREFULLY
════════════════════════════════════════════
You are NOT an author. You are an editor.

Every sentence you write MUST be directly traceable to the provided transcript excerpts.

YOU MUST NOT:
• Add examples, analogies, or stories not present in the transcript
• Introduce concepts or ideas not discussed by the speaker
• Pad sections with generic filler, background context, or extra explanation
• Invent transitions that change the meaning of what was said
• Summarize away or omit any point the speaker explicitly made

YOU MAY:
• Remove speech disfluencies: "um", "uh", "you know", "like", "sort of", "kind of"
• Complete grammatically incomplete sentences using ONLY the speaker's own words from nearby context
• Break run-on spoken sentences into readable written paragraphs
• Add paragraph breaks for readability
• Rephrase spoken grammar into written prose while preserving exact meaning and vocabulary
• Use simple transitional phrases ("Furthermore,", "This means that,") only to connect ideas already present in the transcript
• Convert live-audience delivery into reader-facing prose while preserving meaning
• Remove crowd cues and stage prompts (e.g., "say amen", "look at your neighbor", applause calls, house-response commands)
• Rewrite direct sermon-room address ("today I want to tell you", "as you sit here") into book language for an individual reader

════════════════════════════════════════════
VOICE DNA — MUST BE ENFORCED
════════════════════════════════════════════
The author's Voice DNA is provided. You MUST:
• Use the author's signature phrases exactly as they appear in the Voice DNA
• Maintain the stated tone profile throughout
• Match the sentence pattern described
• Use the author's preferred terminology consistently
• Never use the words in the avoidWords list

════════════════════════════════════════════
SCRIPTURE & QUOTE FORMATTING (Chicago Manual of Style)
════════════════════════════════════════════
SHORT SCRIPTURE (under 40 words):
  Integrate inline with quotation marks, followed by the reference in parentheses.
  Example: "For God so loved the world that he gave his one and only Son" (John 3:16, NIV).

LONG SCRIPTURE (40+ words — block quote):
  Begin on a new line. Indent the entire passage. No quotation marks.
  Place the reference (Book Chapter:Verse, Translation) on a new line immediately after.
  Example:
    For I know the plans I have for you, declares the Lord,
    plans to prosper you and not to harm you, plans to give you
    hope and a future.
    — Jeremiah 29:11 (NIV)

GENERAL QUOTES (attributed to a person):
  Use quotation marks. Place attribution after the quote.
  Example: "Quote text here." — Author Name

PROVERBS / UNATTRIBUTED SAYINGS:
  Use quotation marks. If no attribution is known, do not fabricate one.

CRITICAL: Reproduce scripture text EXACTLY as the speaker quoted it. Do not paraphrase scripture.
If the speaker stated a translation (NIV, KJV, ESV, NKJV, etc.), use it exactly.
If no translation was stated, note "(translation unspecified)" in the reference.

════════════════════════════════════════════
FORMAT
════════════════════════════════════════════
• Output clean prose only — no markdown headers, no bullet points (unless the speaker listed items)
• Separate paragraphs with a blank line
• Target the specified word count based on available content — do not pad to reach it

${SOURCE_LOCK_RULES}

${READER_NORMALIZATION_RULES}

${PREMIUM_BOOK_STYLE_RULES}`;

export async function POST(req: NextRequest) {
  const body = await req.json() as unknown;
  let input;
  try {
    input = WriteSectionRequestSchema.parse(body);
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Invalid input" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const { assignment } = input;
  const excerptBlock = assignment.transcriptExcerpts
    .map((t, i) => `[EXCERPT ${i + 1}]\n${t}`)
    .join("\n\n---\n\n");

  const quoteBlock =
    assignment.quotes.length > 0
      ? `\nSCRIPTURES / QUOTES IN THIS SECTION:\n${assignment.quotes
          .map(
            (q) =>
              `• ${q.type.toUpperCase()}: "${q.text}" — Ref: ${q.reference || "none"} ${q.translation ? `(${q.translation})` : ""} — Block: ${q.isBlockQuote}`
          )
          .join("\n")}`
      : "";

  const continuityBlock = assignment.previousSectionEnding
    ? `\nPREVIOUS SECTION ENDING (for prose continuity — do NOT repeat this):\n${assignment.previousSectionEnding}`
    : "";

  const prompt = `Write the prose for this section of the ebook. Transform the transcript excerpts into polished written prose.

CHAPTER ${assignment.chapterNumber}: ${assignment.chapterTitle}
SECTION ${assignment.sectionNumber}: ${assignment.heading}
TARGET WORD COUNT: ${assignment.targetWordCount} words (determined by available content — write what the transcript provides, no padding)

KEY POINTS TO COVER (all from the transcript — include every one):
${assignment.keyPoints.map((kp) => `• ${kp}`).join("\n")}
${quoteBlock}
${continuityBlock}

AUTHOR VOICE DNA:
${JSON.stringify(assignment.voiceDNA, null, 2)}

TRANSCRIPT EXCERPTS TO WRITE FROM (use ONLY these):
${excerptBlock}

Return:
- body: polished reader-facing prose
- claimLedger: list of major claims in body and the excerpt numbers (1-based) that support each claim.

Now write the section prose:`;

  const PlanSchema = z.object({
    paragraphPlan: z.array(z.object({
      purpose: z.string().default(""),
      supportedExcerptNumbers: z.array(z.number().int().positive()).default([]),
    })).default([]),
  });

  const SectionBodySchema = z.object({
    body: z.string().default("").describe("The polished prose for this section, using only the provided transcript content"),
    claimLedger: z.array(z.object({
      claim: z.string().default(""),
      excerptNumbers: z.array(z.number().int().positive()).default([]),
    })).default([]),
  });

  try {
    let paragraphPlan: z.infer<typeof PlanSchema>["paragraphPlan"] = [];
    try {
      const { object: plan } = await generateObject({
        model: deepSeekModel,
        schema: PlanSchema,
        mode: "tool",
        temperature: 0.15,
        system: `${SOURCE_LOCK_RULES}\n${READER_NORMALIZATION_RULES}`,
        prompt: `Create a paragraph plan for this section. Each paragraph purpose must be supported by specific excerpt numbers.\n\nSECTION: ${assignment.heading}\n\nKEY POINTS:\n${assignment.keyPoints.join("\n")}\n\nEXCERPTS:\n${excerptBlock}`,
      });
      paragraphPlan = plan.paragraphPlan ?? [];
    } catch {
      paragraphPlan = [];
    }

    const { object } = await generateObject({
      model: deepSeekModel,
      schema: SectionBodySchema,
      mode: "tool",
      temperature: 0.25,
      system: EDITORIAL_SYSTEM,
      prompt: `${prompt}\n\nPARAGRAPH PLAN (must follow if provided):\n${JSON.stringify(paragraphPlan)}`,
    });
    const body = stripAudienceLanguage(normalizeReaderFacingProse((object.body ?? "").trim()) || fallbackSectionBody(assignment));
    return NextResponse.json({ body, claimLedger: object.claimLedger ?? [] }, { status: 200 });
  } catch (err) {
    const fallbackBody = stripAudienceLanguage(normalizeReaderFacingProse(fallbackSectionBody(assignment)));
    return NextResponse.json({
      body: fallbackBody,
      claimLedger: [],
      fallback: true,
      error: err instanceof Error && err.message.trim() ? err.message : "Section write used transcript fallback",
      details: err instanceof Error && err.stack
        ? err.stack.split("\n").slice(0, 3).join(" | ")
        : undefined,
    }, { status: 200 });
  }
}
