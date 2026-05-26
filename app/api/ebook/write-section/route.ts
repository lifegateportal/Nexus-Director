import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { deepSeekModel } from "@/lib/ai-providers";
import { WriteSectionRequestSchema } from "@/lib/schemas/ebook";
import { PREMIUM_BOOK_STYLE_RULES, READER_NORMALIZATION_RULES, SOURCE_LOCK_RULES } from "@/lib/editorial-style-bible";
import { stripAudienceLanguage } from "@/lib/editorial-style-bible";

export const runtime = "nodejs";
export const maxDuration = 300;

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
    .replace(/[ \t]{2,}/g, " ")   // collapse only horizontal whitespace, never newlines
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
2. INFORMATION FIDELITY — ZERO FABRICATION: Do not hallucinate data, invent new stories, or inject outside facts. This ban covers plausible extensions, inferred context, and theological background the author "probably" knows. Every sentence must trace to the provided transcript excerpts. If an idea is not in the excerpts, delete it. Write shorter rather than pad with invented content.
3. TONE AND REGISTER: Elevate the speaker's voice. The tone must be authoritative, engaging, and precise. Use active voice and strong verbs. Avoid passive, academic dryness.
4. FORBIDDEN CLICHÉS: You are strictly forbidden from using standard AI transition phrases and clichés, including but not limited to: "In conclusion," "Let's delve into," "A tapestry of," "Navigating the landscape," "It's important to note," "Furthermore," and "In today's fast-paced world."
5. EM DASH ABSOLUTE BAN: Never use an em dash (—) anywhere in the output. No spaced em dashes ( — ), no unspaced em dashes (—), no double hyphens (--) used as em dashes. Rewrite every sentence that would need one using a comma, colon, semicolon, or subordinate clause ("which," "who," "although," "because," "while," "since"). Splitting into two sentences is the last resort — only when both halves stand alone as strong, complete thoughts.
6. HUMANIZATION — ANTI-AI DETECTION (enforce on every paragraph before returning):
   - Use contractions naturally (it's, you're, that's, don't, isn't, won't) — they occur in natural prose.
   - Avoid "X is not just A; it is B" and "X is not merely A, it is B" sentence frames.
   - Break perfect parallel structure. If three items are listed with matching grammar, make one slightly different.
   - Never follow a scripture quote with a sentence that explains what the quote means in the same way it just said it. Trust the reader to absorb it.
   - Avoid stacking rhetorical questions in consecutive sentences.
   - One sentence per paragraph may be a deliberate fragment. For emphasis. That's allowed.
   - Never close a paragraph with "This is what it means to..." or "This is why..." followed by a restatement.
   - Banned AI-signature words in this output: "indeed," "certainly," "ultimately," "at its core," "in essence," "simply put," "profoundly," "transformative," "vibrant," "fostering," "crucial," "vital" (overused), "journey" (metaphorical use).
7. FORMATTING: Output strictly in Markdown. Use hierarchical headings (## for main sections, ### for subsections) to visually break up the text. Never use HTML or \`<br>\` tags.
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
• PARAGRAPH DISCIPLINE: You are returning paragraphs as a JSON ARRAY — each array element is exactly one paragraph. ONE idea per paragraph, 3 to 5 sentences. When a new point, scripture quotation, example, or argument begins, it must be a new array element. Never put two paragraphs in one array element. Never split a single paragraph across two elements.
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
  const authorConfig = input.authorConfig;
  const authorConfigBlock = (authorConfig?.instructions || authorConfig?.targetAudience)
    ? `\n\n════════════════════════════════════════════
AUTHOR BOOK CONFIGURATION (highest priority)
════════════════════════════════════════════${authorConfig.targetAudience ? `\nTARGET AUDIENCE: ${authorConfig.targetAudience}\nWrite at the vocabulary level, cultural register, and depth appropriate for this specific audience. Every example, illustration, and application point must land for this reader.` : ""}${authorConfig.instructions ? `\nAUTHOR WRITING INSTRUCTIONS: ${authorConfig.instructions}\nThese are the author's direct instructions for how the book should read. Honor them on every paragraph. They override any default style preference where they conflict.` : ""}`
    : "";
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
    ? `\nSECTION BRIDGE: The previous section ended with this sentence: "${assignment.previousSectionEnding}" — if the opening of this section benefits from it, write ONE brief connecting sentence that picks up the thread naturally. Do NOT repeat, recap, paraphrase, or expand on that ending. One sentence maximum — then move immediately into this section's own content.`
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
- paragraphs: an array of strings where EACH ELEMENT IS ONE PARAGRAPH of polished prose. Every paragraph is a separate array item. Never put more than one paragraph in a single array element. Do not use \n or \n\n inside any element — each element is exactly one paragraph.
- claimLedger: list of major claims and the excerpt numbers (1-based) that support each claim.

CONTENT COVERAGE REQUIREMENT: ${assignment.targetWordCount} words is the MINIMUM floor, not a ceiling. Exhaust every distinct key point, story, illustration, and argument present in the transcript excerpts before closing the section. Do NOT truncate content to hit a target — write until the source material is fully represented.

Now write the section prose:`;

  const PlanSchema = z.object({
    paragraphPlan: z.array(z.object({
      purpose: z.string().default(""),
      supportedExcerptNumbers: z.array(z.number().int().positive()).default([]),
    })).default([]),
  });

  const SectionBodySchema = z.object({
    paragraphs: z.array(z.string()).default([]).describe(
      "Each element is exactly one paragraph of polished prose. Never embed newlines inside an element. Each paragraph is a standalone array item."
    ),
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
      // Cap the planner at 45 seconds so it never eats into the writer's budget
      const plannerAbort = AbortSignal.timeout(45_000);
      const { object: plan } = await generateObject({
        model: deepSeekModel,
        schema: PlanSchema,
        mode: "json",
        temperature: 0.15,
        abortSignal: plannerAbort,
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
        ? `${EDITORIAL_SYSTEM}${voiceDnaBlock}${authorConfigBlock}\n\n════════════════════════════════════════════\nPRIOR CONTENT — ABSOLUTE PROHIBITION\n════════════════════════════════════════════\nThe following ideas, claims, opening sentences, and teaching points have ALREADY BEEN WRITTEN in earlier sections of this book. You MUST NOT re-introduce, re-explain, re-state, or re-develop ANY of them — even with different wording. If a transcript excerpt references these, acknowledge with at most one transitional phrase and move immediately to new material. Do not give them a paragraph, example, story, or dedicated treatment:\n${(assignment.alreadyCoveredPoints ?? []).map((p) => `• ${p}`).join("\n")}`
        : `${EDITORIAL_SYSTEM}${voiceDnaBlock}${authorConfigBlock}`;

    const { object } = await generateObject({
      model: deepSeekModel,
      schema: SectionBodySchema,
      mode: "json",
      temperature: 0.25,
      system: deduplicatedSystem,
      prompt: `${prompt}\n\nPARAGRAPH PLAN (must follow if provided):\n${JSON.stringify(paragraphPlan)}`,
    });
    const rawBody = (object.paragraphs ?? []).map((p) => p.trim()).filter(Boolean).join("\n\n") || fallbackSectionBody(assignment);
    const body = stripAudienceLanguage(normalizeReaderFacingProse(rawBody));
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
