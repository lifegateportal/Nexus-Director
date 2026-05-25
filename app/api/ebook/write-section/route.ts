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

const EDITORIAL_SYSTEM = `# ROLE AND OBJECTIVE
You are an elite, New York Times-bestselling ghostwriter and developmental editor. Your task is to synthesize raw, unstructured audio transcripts into a highly polished, premium book chapter.

The final output must read like a professionally published, authoritative text—not a cleaned-up transcript. It must feature high-end editorial styling, a clear narrative arc, and rigorous logical flow.

# INPUT CONTEXT
You will receive transcribed audio text. Expect the following flaws:
- Non-linear thoughts, tangents, and chronological jumps.
- Redundant points, filler words, and conversational crutches.
- Phonetic transcription errors.

# STRICT BOUNDARIES & GUARDRAILS
1. SYNTHESIS, NOT TRANSCRIPTION: Do not simply rephrase the text sentence-by-sentence. Extract the core insights, arguments, and stories, then reassemble them into a strong, linear structure.
2. INFORMATION FIDELITY: Do not hallucinate data, invent new stories, or inject outside facts unless explicitly instructed to expand on a concept. You are shaping the author's ideas, not creating your own.
3. TONE AND REGISTER: Elevate the speaker's voice. The tone must be authoritative, engaging, and precise. Use active voice and strong verbs. Avoid passive, academic dryness.
4. FORBIDDEN CLICHÉS: You are strictly forbidden from using standard AI transition phrases and clichés, including but not limited to: "In conclusion," "Let's delve into," "A tapestry of," "Navigating the landscape," "It's important to note," "Furthermore," and "In today's fast-paced world."
5. FORMATTING: Output strictly in Markdown. Use hierarchical headings (## for main sections, ### for subsections) to visually break up the text. Never use HTML or \`<br>\` tags.
6. SECTION BOUNDARY — ABSOLUTE RULE: Each section is a sealed unit. You MUST NOT preview, introduce, foreshadow, or summarize content that belongs to a future section. This includes any sentence that:
   - Names or paraphrases a point the next section will make
   - Begins developing an argument that has no transcript support in THIS section's excerpts
   - Uses phrases like "We will see…", "As we explore next…", "This leads us to examine…", "In the coming pages…", or any forward reference.
   Closing sentences may create forward momentum ONLY through an unresolved question, a tension, or a logical implication drawn entirely from the current section's own content. They must not disclose what the following section contains.

# EXECUTION SEQUENCE
Before generating the final output, follow this internal sequence:
1. Analyze the transcript chunk to identify the central thesis.
2. Filter out all conversational redundancies and off-topic tangents.
3. Group related concepts logically so the narrative builds momentum.
4. Draft the text using varied sentence lengths (short punches for emphasis, longer sentences for explanation).
5. Before returning, silently review your draft against all four of these criteria and revise inline:
   - RHYTHM: No two consecutive sentences should be the same length. Break monotony with short, punchy sentences after long explanatory ones.
   - CLICHÉS: Scan every sentence for robotic phrasing — "It is crucial to remember," "A tapestry of," "Navigating the complexities," "It is worth noting," or any overly neat paragraph-ending summary. Delete or rewrite every instance found.
   - SHOW, DON'T TELL: Where the draft states a fact, check whether the transcript contains an example, story, or specific detail that illustrates it instead. If so, use the illustration.
   - TONE: Confirm the final prose is authoritative, premium, and sophisticated — never passive, never academic, never motivational-poster flat.

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
AUDIENCE & FORMAT
════════════════════════════════════════════
• Remove crowd cues and stage prompts (e.g., "say amen", "look at your neighbor", applause calls, house-response commands)
• Rewrite direct live-room address ("today I want to tell you", "as you sit here") into book language for an individual reader
• PARAGRAPH DISCIPLINE: Each paragraph is a SEALED UNIT of ONE idea — 3 to 5 sentences maximum. When a new point, example, scripture, or argument begins, you MUST start a new paragraph. Never bundle multiple teaching points into a single paragraph. Paragraphs that exceed 6 sentences are a hard failure.
• Separate every paragraph with a BLANK LINE in your output (two newline characters between paragraphs). A missing blank line between paragraphs is a hard failure.
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

  // coveredBlock is intentionally empty here — the dedup constraint is injected into
  // the system prompt (deduplicatedSystem, below) where it carries maximum LLM weight.
  const coveredBlock = "";

  const nextSectionBlock = assignment.nextSectionHeading
    ? `\nFORWARD BRIDGE — STRICT LIMITS: The final sentence of this section may create forward reading momentum, but ONLY through an unresolved question, an open tension, or a logical implication that arises naturally from THIS section's own content. The next section is titled "${assignment.nextSectionHeading}" — use this ONLY as directional context for tone. You MUST NOT:
  • Preview, introduce, or summarize any content from that next section
  • Name the next section or its heading
  • Begin developing any argument not grounded in this section's transcript excerpts
  • Use bridge phrases like "Next, we will see…", "In the following section…", "This leads us to explore…"
The closing sentence is a door that swings open — not a trailer for what lies behind it.`
    : "";

  const hookBlock = assignment.sectionNumber === 1
    ? `\nCHAPTER OPENER REQUIREMENT: This is the FIRST section of the chapter. The very first sentence must be a compelling hook — a bold provocative claim, a pointed question, or an immersive specific detail drawn directly from the transcript. Do not open with a general context-setting statement. Drop the reader immediately into the argument.`
    : "";

  const prompt = `Write the prose for this section of the ebook. Transform the transcript excerpts into polished written prose.

CHAPTER ${assignment.chapterNumber}: ${assignment.chapterTitle}
SECTION ${assignment.sectionNumber}: ${assignment.heading}
TARGET WORD COUNT: ${assignment.targetWordCount} words (determined by available content — write what the transcript provides, no padding)

KEY POINTS TO COVER (all from the transcript — include every one):
${assignment.keyPoints.map((kp) => `• ${kp}`).join("\n")}
${quoteBlock}
${continuityBlock}
${coveredBlock}
${nextSectionBlock}
${hookBlock}

TRANSCRIPT EXCERPTS TO WRITE FROM (use ONLY these):
${excerptBlock}

Return:
- body: polished reader-facing prose
- claimLedger: list of major claims in body and the excerpt numbers (1-based) that support each claim.

CONTENT COVERAGE REQUIREMENT: ${assignment.targetWordCount} words is the MINIMUM floor, not a ceiling. Exhaust every distinct key point, story, illustration, and argument present in the transcript excerpts before closing the section. Do NOT truncate content to hit a target — write until the source material is fully represented.

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
    const plannerDedup = (assignment.alreadyCoveredPoints ?? []).length > 0
      ? `\n\n════════════════════════════════════════════\nALREADY COVERED — DO NOT PLAN THESE\n════════════════════════════════════════════\nThe following ideas, stories, and claims have already been written in earlier sections. Do NOT plan any paragraph that covers, references, or re-introduces them:\n${(assignment.alreadyCoveredPoints ?? []).map((p) => `• ${p}`).join("\n")}`
      : "";

    try {
      const { object: plan } = await generateObject({
        model: deepSeekModel,
        schema: PlanSchema,
        mode: "json",
        temperature: 0.15,
        system: `You are a structural editor planning the paragraph-level architecture for a single book section.

BESTSELLER ARC — apply within this section where the content supports it:
- HOOK: Open with a grabbing claim, question, or specific detail drawn directly from the transcript
- CONTEXT: Establish why this matters (drawn only from what the speaker said)
- MECHANISM: Develop the core argument or framework the speaker presented
- APPLICATION: Close with how the reader applies or internalizes this
${plannerDedup}
Each paragraph in your plan must have a clear narrative purpose and be supported by specific transcript excerpt numbers. Do not plan paragraphs with no excerpt support.

${SOURCE_LOCK_RULES}
${READER_NORMALIZATION_RULES}`,
        prompt: `Create a paragraph plan for this section. Each paragraph purpose must be supported by specific excerpt numbers.\n\nSECTION: ${assignment.heading}\n\nKEY POINTS:\n${assignment.keyPoints.join("\n")}\n${(assignment.alreadyCoveredPoints ?? []).length > 0 ? `\nDO NOT PLAN PARAGRAPHS ABOUT THESE (already written):\n${(assignment.alreadyCoveredPoints ?? []).map((p) => `• ${p}`).join("\n")}` : ""}\n\nEXCERPTS:\n${excerptBlock}`,
      });
      paragraphPlan = plan.paragraphPlan ?? [];
    } catch {
      paragraphPlan = [];
    }

    // Build a per-request system prompt: Voice DNA at the top (system-level weight),
    // then the dedup prohibition block if any points have already been covered.
    const voiceDnaBlock = assignment.voiceDNA
      ? `\n\n════════════════════════════════════════════\nAUTHOR VOICE DNA — ENFORCE IN EVERY SENTENCE\n════════════════════════════════════════════\nThis is the speaker's unique voice fingerprint. Every sentence you write MUST reflect these patterns:\n${JSON.stringify(assignment.voiceDNA, null, 2)}`
      : "";

    const deduplicatedSystem =
      (assignment.alreadyCoveredPoints ?? []).length > 0
        ? `${EDITORIAL_SYSTEM}${voiceDnaBlock}\n\n════════════════════════════════════════════\nPRIOR CONTENT — ABSOLUTE PROHIBITION\n════════════════════════════════════════════\nThe following ideas, claims, opening sentences, and teaching points have ALREADY BEEN WRITTEN in earlier sections of this book. You MUST NOT re-introduce, re-explain, re-state, or re-develop ANY of them — even with different wording. If a transcript excerpt references these, acknowledge with at most one transitional phrase and move immediately to new material. Do not give them a paragraph, example, story, or dedicated treatment:\n${(assignment.alreadyCoveredPoints ?? []).map((p) => `• ${p}`).join("\n")}`
        : `${EDITORIAL_SYSTEM}${voiceDnaBlock}`;

    const { object } = await generateObject({
      model: deepSeekModel,
      schema: SectionBodySchema,
      mode: "json",
      temperature: 0.25,
      system: deduplicatedSystem,
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
