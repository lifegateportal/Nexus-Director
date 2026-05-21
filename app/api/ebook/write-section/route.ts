import { NextRequest } from "next/server";
import { streamText } from "ai";
import { deepSeekModel } from "@/lib/ai-providers";
import { WriteSectionRequestSchema } from "@/lib/schemas/ebook";

export const runtime = "nodejs";
export const maxDuration = 90;

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
• Target the specified word count based on available content — do not pad to reach it`;

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

Now write the section prose:`;

  const result = streamText({
    model: deepSeekModel,
    system: EDITORIAL_SYSTEM,
    prompt,
    temperature: 0.25,
  });

  return result.toTextStreamResponse();
}
