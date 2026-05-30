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

// ── S5: Post-write paragraph length validation ────────────────────────────
// Detects orphaned long sentences that are not deliberate fragments (≤12 words).
// Merges them with the following paragraph when the next para starts with a
// conjunction-like opener, otherwise logs for visibility.
function repairOrphanParagraphs(paragraphs: string[]): { paragraphs: string[]; orphansFixed: number } {
  const CONJUNCTION_OPENERS = /^(and|but|so|because|which|who|whose|although|since|while|however|therefore|thus)\b/i;
  const result: string[] = [];
  let orphansFixed = 0;
  let i = 0;
  while (i < paragraphs.length) {
    const para = paragraphs[i].trim();
    const sentences = para.split(/(?<=[.!?])\s+/).filter(Boolean);
    const wordCount = para.split(/\s+/).filter(Boolean).length;
    // A paragraph is an orphaned long sentence if it has exactly 1 sentence and >12 words
    const isOrphan = sentences.length === 1 && wordCount > 12;
    if (isOrphan && i + 1 < paragraphs.length) {
      const next = paragraphs[i + 1].trim();
      if (CONJUNCTION_OPENERS.test(next)) {
        // Merge forward: orphan sentence flows directly into the next paragraph
        result.push(`${para} ${next}`);
        i += 2;
        orphansFixed++;
        continue;
      }
    }
    // A4: Merge upward when forward merge isn't possible (last paragraph or no conjunction opener)
    // Appending to the preceding paragraph keeps the thought in context rather than leaving it dangling.
    if (isOrphan && result.length > 0) {
      result[result.length - 1] = `${result[result.length - 1]} ${para}`;
      i++;
      orphansFixed++;
      continue;
    }
    result.push(para);
    i++;
  }
  return { paragraphs: result, orphansFixed };
}

// ── Upgrade 2: Server-side n-gram excerpt dedup ────────────────────────────
// Strips excerpts whose content is substantially covered by already-covered points
// before the LLM ever receives them, removing the root-cause material.

function extractNgrams(text: string, n = 4): Set<string> {
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean);
  const grams = new Set<string>();
  for (let i = 0; i <= words.length - n; i++) {
    grams.add(words.slice(i, i + n).join(" "));
  }
  return grams;
}

function excerptOverlapWithCoveredContent(excerpt: string, coveredText: string, n = 4): number {
  const excerptGrams = extractNgrams(excerpt, n);
  const coveredGrams = extractNgrams(coveredText, n);
  if (excerptGrams.size === 0) return 0;
  let shared = 0;
  for (const g of excerptGrams) { if (coveredGrams.has(g)) shared++; }
  return shared / excerptGrams.size;
}

function filterConsumedExcerpts(
  excerpts: string[],
  alreadyCoveredPoints: string[],
  threshold = 0.55
): { filtered: string[]; removedCount: number } {
  if (alreadyCoveredPoints.length === 0) return { filtered: excerpts, removedCount: 0 };
  const coveredText = alreadyCoveredPoints.join(" ");
  const filtered: string[] = [];
  let removedCount = 0;
  for (const excerpt of excerpts) {
    const wordCount = excerpt.trim().split(/\s+/).length;
    // Only run dedup on substantial excerpts; short ones pass through
    if (wordCount < 40) { filtered.push(excerpt); continue; }
    const overlap = excerptOverlapWithCoveredContent(excerpt, coveredText);
    if (overlap >= threshold) {
      removedCount++;
    } else {
      filtered.push(excerpt);
    }
  }
  // Always keep at least one excerpt so the section has source material
  return { filtered: filtered.length > 0 ? filtered : excerpts.slice(0, 1), removedCount };
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
8. SECTION BOUNDARY — ABSOLUTE RULE: Each section is a sealed unit. You MUST NOT preview, introduce, foreshadow, or summarize content that belongs to a future section. This includes any sentence that:
   - Names or paraphrases a point the next section will make
   - Begins developing an argument that has no transcript support in THIS section's excerpts
   - Uses phrases like "We will see…", "As we explore next…", "This leads us to examine…", "In the coming pages…", or any forward reference.
   Closing sentences may create forward momentum ONLY through an unresolved question, a tension, or a logical implication drawn entirely from the current section's own content. They must not disclose what the following section contains.

# SENTENCE STRUCTURE — INDUSTRY EDITORIAL STANDARDS
Apply all of these on every paragraph before finalizing output:

S1 — FRAGMENT DISCIPLINE: A one-sentence paragraph is a deliberate rhetorical fragment ONLY if the sentence is 12 words or fewer. Any paragraph with a single sentence of 13+ words must be followed by at least one additional sentence that develops, illustrates, or applies the idea. Isolated long sentences read as orphaned thoughts, not emphasis.

S2 — SYNTACTIC DEPTH (complex sentence requirement): Every paragraph of three or more sentences must contain at least one sentence joined by a subordinating conjunction: "although," "because," "while," "since," "which," "who," "whose," "even though," "as long as," "whenever." All-simple-sentence paragraphs score at a 5th-grade reading level regardless of vocabulary.

S3 — SAME-OPENER BAN: No three consecutive sentences in the same paragraph may begin with the same word. This is an absolute structural error. Anaphora is intentional repetition; accidental opener repetition is monotony.

S4 — SENTENCE-LENGTH RATIO: In any paragraph of three or more sentences, the longest sentence must contain at least 2× the words of the shortest sentence. Uniformly medium-length sentences produce a flat, metronomic rhythm that signals machine generation. Deliberate contrast — a short punch after a long explanation — is what makes prose feel alive.

S6 — PARAGRAPH OPENER VARIATION: The opening word of a paragraph must differ from the opening word of the immediately preceding paragraph. Back-to-back paragraphs that both start with "The," "This," "God," or any proper noun are a structural tell — they reveal that the writer generated a list, not flowing prose. Vary grammatical form at the opening: start one paragraph with a participial phrase, the next with a subordinate clause, the next with a concrete noun.

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
SCRIPTURE & QUOTE FORMATTING (Chicago Manual of Style + Premium Print Standards)
════════════════════════════════════════════

DETECTION RULE — This is the most important formatting rule in this prompt:
Any text enclosed in quotation marks (or reproduced verbatim) that is IMMEDIATELY followed by a Bible book name and chapter:verse citation (e.g. "John 3:16", "Genesis 1:1", "Psalm 23:1–4") is SCRIPTURE. Treat it as scripture regardless of its word count. Do not treat it as ordinary prose or dialogue.

SCRIPTURE MUST ALWAYS be visually distinct from the speaker's explanatory words. The reader must never have to guess which words are God's Word and which are the author's commentary.

SHORT SCRIPTURE (under 40 words) WOVEN INTO A SENTENCE:
  Integrate inline with quotation marks, followed by the reference in parentheses. Use italic emphasis via markdown: *"verse text"* (Book Chapter:Verse, Translation).
  Example: *"For God so loved the world that he gave his one and only Son"* (John 3:16, NIV).

STANDALONE SHORT SCRIPTURE (under 40 words but quoted as its own statement, not mid-sentence):
  Use a markdown blockquote:
  > Verse text here.
  > — Book Chapter:Verse (Translation)

LONG SCRIPTURE (40+ words — block quote mandatory):
  Begin the blockquote on its own line. No quotation marks around the block.
  > For I know the plans I have for you, declares the Lord,
  > plans to prosper you and not to harm you, plans to give you
  > hope and a future.
  > — Jeremiah 29:11 (NIV)

CHAPTER-OPENING VERSE (epigraph — placed before the body of a chapter or section):
  Use a blockquote. Add a blank line after it before the author's prose begins.
  > Verse text.
  > — Book Chapter:Verse (Translation)

TRANSLATION RULE: Always include the translation abbreviation in parentheses — KJV, NIV, ESV, NKJV, NLT, NASB, AMP, MSG, etc. If the speaker stated the translation, use it exactly. If no translation was stated, write (translation unspecified).

NON-SCRIPTURE BLOCK QUOTE (attributed to a person, not the Bible):
  Use a blockquote WITHOUT the accent-style attribution format.
  > Quote text here.
  > — Author Name, Source (if given)
  Do NOT use italics for non-scripture block quotes.

PROVERBS / UNATTRIBUTED SAYINGS:
  Use quotation marks only. If no attribution is known, do not fabricate one.

CRITICAL: Reproduce scripture text EXACTLY as the speaker quoted it. Never paraphrase scripture. Never merge two separate verses into one block unless the speaker quoted them together.

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

  // ── Upgrade 2: Server-side excerpt dedup ────────────────────────────────
  // Strip excerpts that are substantially covered by alreadyCoveredPoints before
  // the LLM sees them. This removes root-cause material — not just an instruction.
  const { filtered: dedupedExcerpts, removedCount: excerptRemovedCount } = filterConsumedExcerpts(
    assignment.transcriptExcerpts,
    assignment.alreadyCoveredPoints ?? []
  );
  const effectiveExcerpts = excerptRemovedCount > 0 ? dedupedExcerpts : assignment.transcriptExcerpts;

  const excerptBlock = effectiveExcerpts
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

  // ── Upgrade 7: Tiered quote dedup — structured hard-ban blocks ──────────
  // Tier 1: forbiddenVerseTexts — the EXACT verse texts are listed so the LLM
  // cannot accidentally re-print them even with different framing.
  // Tier 2: allowedInlineOnly — refs that may only appear as brief inline mentions.
  const forbiddenVerseTextsBlock = (assignment.forbiddenVerseTexts ?? []).length > 0
    ? `\n\n════════════════════════════════════════════
FORBIDDEN VERSE TEXTS — DO NOT PRINT (HARD BAN)
════════════════════════════════════════════
The following verse texts have ALREADY BEEN REPRODUCED IN FULL in an earlier section of this book. You are ABSOLUTELY FORBIDDEN from printing them again — not one word of the verse, not a paraphrase, not a near-quote. If you reference the scripture at all, use ONLY its citation inline (e.g. "as John 3:16 states"). Never reprint the text:
${(assignment.forbiddenVerseTexts ?? []).map((t) => `• "${t.slice(0, 120)}${t.length > 120 ? "..." : ""}"`).join("\n")}`
    : "";

  const allowedInlineOnlyBlock = (assignment.allowedInlineOnly ?? []).length > 0
    ? `\n\n════════════════════════════════════════════
SCRIPTURES ALLOWED INLINE ONLY (NO FULL QUOTE)
════════════════════════════════════════════
The following references have already been quoted in full earlier. You may reference them briefly inline ONLY — never re-print the verse text:
${(assignment.allowedInlineOnly ?? []).map((r) => `• ${r}`).join("\n")}`
    : "";

  const alreadyQuotedBlock = forbiddenVerseTextsBlock + allowedInlineOnlyBlock;

  // coveredBlock is intentionally empty here — the dedup constraint is injected into
  // the system prompt (deduplicatedSystem, below) where it carries maximum LLM weight.
  const coveredBlock = "";

  // ── Upgrade 5: Concept ownership map block ──────────────────────────────
  // Structured JSON listing which chapter owns each concept so the LLM knows
  // what belongs here vs. what belongs to a different chapter.
  const conceptOwnershipMap = assignment.conceptOwnershipMap ?? {};
  const foreignConcepts = Object.entries(conceptOwnershipMap)
    .filter(([, chNum]) => chNum !== assignment.chapterNumber)
    .slice(0, 30); // cap to avoid prompt bloat
  const conceptOwnershipBlock = foreignConcepts.length > 0
    ? `\n\n════════════════════════════════════════════
CONCEPT OWNERSHIP — WRITE ONLY CHAPTER ${assignment.chapterNumber}'S OWN CONTENT
════════════════════════════════════════════
The following concepts, section headings, and key points are OWNED BY OTHER CHAPTERS. Do NOT develop, introduce, or reference any of them in this section — not even as context-setting:
${foreignConcepts.map(([concept, chNum]) => `• Ch ${chNum} owns: "${concept}"`).join("\n")}`
    : "";

  const nextSectionBlock = assignment.nextSectionHeading
    ? `\nFORWARD BRIDGE — STRICT LIMITS: The final sentence of this section may create forward reading momentum, but ONLY through an unresolved question, an open tension, or a logical implication that arises naturally from THIS section's own content. The next section is titled "${assignment.nextSectionHeading}" — use this ONLY as directional context for tone. You MUST NOT:
  • Preview, introduce, or summarize any content from that next section
  • Name the next section or its heading
  • Begin developing any argument not grounded in this section's transcript excerpts
  • Use bridge phrases like "Next, we will see…", "In the following section…", "This leads us to explore…"
The closing sentence is a door that swings open — not a trailer for what lies behind it.`
    : "";

  // Chapter-final sections get an explicit hard stop at the chapter boundary.
  // This is the #1 cause of cross-chapter content bleed: the transcript excerpt
  // contains content that OPENS the next chapter, and the writer keeps going.
  const chapterClosingBlock = assignment.isLastSectionInChapter && assignment.nextChapterTitle
    ? `\n\nCHAPTER BOUNDARY — HARD STOP (CRITICAL):
This is the FINAL section of Chapter ${assignment.chapterNumber}. The next chapter is titled "${assignment.nextChapterTitle}".

The transcript excerpt provided to you WILL continue past the chapter boundary. The words belonging to Chapter ${assignment.chapterNumber + 1} are in the excerpt — you must identify where that transition happens and STOP WRITING before you reach it.

HARD RULES for this section's close:
• DO NOT introduce the opening argument, definition, or thesis of "${assignment.nextChapterTitle}".
• DO NOT quote or paraphrase any scripture or story that will be used to open "${assignment.nextChapterTitle}".
• DO NOT begin developing any concept, key point, or illustration that is not grounded in Chapter ${assignment.chapterNumber}'s own assigned key points.
• The final sentence of this section must bring Chapter ${assignment.chapterNumber} to a natural close — a resolved statement, a challenge, or a final declaration rooted entirely in THIS chapter's own content.
• If the transcript excerpt begins introducing the theme of "${assignment.nextChapterTitle}", stop before that line. Shorter is correct; bleed into the next chapter is a critical error.`
    : "";

  const hookBlock = assignment.sectionNumber === 1
    ? `\nCHAPTER OPENER REQUIREMENT: This is the FIRST section of the chapter. The very first sentence must be a compelling hook — a bold provocative claim, a pointed question, or an immersive specific detail drawn directly from the transcript. Do not open with a general context-setting statement. Drop the reader immediately into the argument.`
    : "";

  // ── S7: Chapter premise anchor ──────────────────────────────────────────
  // First paragraph's opening sentence should echo (not quote) the chapter premise
  // so the reader feels immediate orientation within the chapter's thesis.
  const chapterPremiseBlock = assignment.chapterPremise
    ? `\n\nCHAPTER PREMISE (north star for this chapter):\n"${assignment.chapterPremise}"\nThe opening sentence of the FIRST paragraph of this section should echo the spirit of this premise — not quote it verbatim, but orient the reader toward the same central tension or claim. Subsequent paragraphs should build from it.`
    : "";

  const prompt = `Write the prose for this section of the ebook. Transform the transcript excerpts into polished written prose.

CHAPTER ${assignment.chapterNumber}: ${assignment.chapterTitle}
SECTION ${assignment.sectionNumber}: ${assignment.heading}
TARGET WORD COUNT: ${assignment.targetWordCount} words (determined by available content — write what the transcript provides, no padding)
${excerptRemovedCount > 0 ? `NOTE: ${excerptRemovedCount} excerpt(s) were pre-filtered as already-covered — write ONLY from the excerpts provided below.` : ""}

KEY POINTS TO COVER (all from the transcript — include every one):
${assignment.keyPoints.map((kp) => `• ${kp}`).join("\n")}
${quoteBlock}
${continuityBlock}
${coveredBlock}
${nextSectionBlock}
${chapterClosingBlock}
${hookBlock}
${conceptOwnershipBlock}
${chapterPremiseBlock}

TRANSCRIPT EXCERPTS TO WRITE FROM (use ONLY these):
${excerptBlock}

SECTION SCOPE RULE — READ BEFORE WRITING:
Your section is: "${assignment.heading}"${assignment.nextSectionHeading ? `\nThe NEXT section is: "${assignment.nextSectionHeading}"` : ""}${assignment.isLastSectionInChapter && assignment.nextChapterTitle ? `\nThis is the LAST section of Chapter ${assignment.chapterNumber}. The next chapter is "${assignment.nextChapterTitle}". STOP before any content that opens that chapter.` : ""}
Write ONLY content that belongs to THIS section's heading and key points. If any excerpt contains sentences that transition into or introduce the next section's topic, STOP before those sentences. Do not write them. A transcript boundary does not override a section boundary.

CONTENT COVERAGE REQUIREMENT: Exhaust every distinct key point, story, illustration, and argument that belongs to THIS section's scope. Skip any excerpt content that clearly belongs to the next section or next chapter. Write shorter rather than bleed forward.

Return:
- paragraphs: an array of strings where EACH ELEMENT IS ONE PARAGRAPH of polished prose. Every paragraph is a separate array item. Never put more than one paragraph in a single array element. Do not use \n or \n\n inside any element — each element is exactly one paragraph.
- claimLedger: list of major claims and the excerpt numbers (1-based) that support each claim.

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
      ? `\n\n════════════════════════════════════════════\nALREADY COVERED — HARD SKIP\n════════════════════════════════════════════\nThe following sections and ideas have already been written. Do NOT plan ANY paragraph that touches, references, or re-introduces them — not even one sentence. If an excerpt only contains already-covered content, plan zero paragraphs from it:\n${(assignment.alreadyCoveredPoints ?? []).map((p) => `• ${p}`).join("\n")}`
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
        prompt: `Create a paragraph plan for this section. Each paragraph purpose must be supported by specific excerpt numbers.\n\nSECTION: ${assignment.heading}${assignment.nextSectionHeading ? `\nNEXT SECTION (do NOT plan paragraphs about this): "${assignment.nextSectionHeading}"` : ""}${assignment.isLastSectionInChapter && assignment.nextChapterTitle ? `\nCHAPTER BOUNDARY: This is the LAST section of Chapter ${assignment.chapterNumber}. The next chapter is titled "${assignment.nextChapterTitle}". Do NOT plan any paragraph that introduces or develops content from that next chapter. If an excerpt transitions into the next chapter's opening topic, stop planning before that line.` : ""}\n\nKEY POINTS:\n${assignment.keyPoints.join("\n")}\n${(assignment.alreadyCoveredPoints ?? []).length > 0 ? `\nDO NOT PLAN PARAGRAPHS ABOUT THESE (already written):\n${(assignment.alreadyCoveredPoints ?? []).map((p) => `• ${p}`).join("\n")}` : ""}\n\nEXCERPTS:\n${excerptBlock}`,
      });

      // ── Upgrade 3: Planner prune pass ────────────────────────────────────
      // Remove any planned paragraph whose stated purpose n-gram-overlaps heavily
      // with already-covered content. This is a structural guard — the dedup
      // constraint is enforced before the writer even sees the plan.
      const coveredPointsText = (assignment.alreadyCoveredPoints ?? []).join(" ");
      const prunedPlan = (plan.paragraphPlan ?? []).filter((entry) => {
        if (!entry.purpose || coveredPointsText.length < 50) return true;
        const purposeWords = entry.purpose.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean);
        const coveredWords = new Set(coveredPointsText.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/));
        if (purposeWords.length < 4) return true;
        const matchCount = purposeWords.filter((w) => coveredWords.has(w) && w.length > 4).length;
        const overlap = matchCount / purposeWords.length;
        return overlap < 0.65; // prune if >65% of meaningful purpose words are in covered content
      });
      paragraphPlan = prunedPlan.length > 0 ? prunedPlan : (plan.paragraphPlan ?? []);
    } catch {
      paragraphPlan = [];
    }

    // Build a per-request system prompt: Voice DNA at the top (system-level weight),
    // then the dedup prohibition block if any points have already been covered.
    const voiceDnaBlock = assignment.voiceDNA
      ? (() => {
          const dna = assignment.voiceDNA;
          const lines: string[] = [
            "\n\n════════════════════════════════════════════",
            "AUTHOR VOICE DNA — ENFORCE IN EVERY SENTENCE",
            "════════════════════════════════════════════",
            "This is the speaker's unique voice fingerprint. Every sentence you write MUST reflect these patterns.",
            "",
          ];
          if (dna.toneProfile)
            lines.push(`TONE: ${dna.toneProfile}`);
          if (dna.vocabularyLevel)
            lines.push(`VOCABULARY REGISTER: ${dna.vocabularyLevel}`);
          if (dna.sentencePattern)
            lines.push(`SENTENCE RHYTHM: ${dna.sentencePattern}`);
          if (dna.pacingFingerprint)
            lines.push(`PACING: ${dna.pacingFingerprint}`);
          if (dna.emotionalArc)
            lines.push(`EMOTIONAL ARC: ${dna.emotionalArc}`);
          if (dna.openingPattern)
            lines.push(`HOW TO OPEN A NEW POINT: ${dna.openingPattern}`);
          if (dna.closingPattern)
            lines.push(`HOW TO CLOSE A POINT: ${dna.closingPattern}`);
          if (dna.narrativeDevice)
            lines.push(`STORY/ILLUSTRATION STRUCTURE: ${dna.narrativeDevice}`);
          if (dna.teachingStyle)
            lines.push(`TEACHING STYLE: ${dna.teachingStyle}`);
          if ((dna.signaturePhrases ?? []).length > 0)
            lines.push(`\nSIGNATURE PHRASES (use naturally, verbatim):\n${dna.signaturePhrases.map((p) => `  • ${p}`).join("\n")}`);
          if ((dna.preferredTerminology ?? []).length > 0)
            lines.push(`\nPREFERRED TERMINOLOGY (always prefer these terms):\n${dna.preferredTerminology.map((t) => `  • ${t}`).join("\n")}`);
          if ((dna.vernacularMarkers ?? []).length > 0)
            lines.push(`\nVERNACULAR MARKERS (must appear verbatim to authenticate the voice):\n${dna.vernacularMarkers.map((v) => `  • ${v}`).join("\n")}`);
          if ((dna.rhetoricalPatterns ?? []).length > 0)
            lines.push(`\nRHETORICAL PATTERNS (replicate these devices):\n${dna.rhetoricalPatterns.map((r) => `  • ${r}`).join("\n")}`);
          if ((dna.avoidStructures ?? []).length > 0)
            lines.push(`\nFORBIDDEN SENTENCE STRUCTURES (never construct sentences this way):\n${dna.avoidStructures.map((s) => `  • ${s}`).join("\n")}`);
          if ((dna.avoidWords ?? []).length > 0)
            lines.push(`\nFORBIDDEN WORDS & PHRASES (zero tolerance — not one instance):\n${dna.avoidWords.map((w) => `  • ${w}`).join("\n")}`);
          return lines.join("\n");
        })()
      : "";

    const deduplicatedSystem =
      (assignment.alreadyCoveredPoints ?? []).length > 0
        ? `${EDITORIAL_SYSTEM}${voiceDnaBlock}${authorConfigBlock}${alreadyQuotedBlock}\n\n════════════════════════════════════════════\nPRIOR CONTENT — HARD SKIP (NON-NEGOTIABLE)\n════════════════════════════════════════════\nThe following sections, ideas, claims, and teaching points have ALREADY BEEN WRITTEN in earlier sections of this book. You MUST skip them COMPLETELY — zero sentences, zero phrases, zero acknowledgment. Do not re-introduce, re-explain, re-state, or re-develop ANY of them, even briefly, even in passing, even with different wording. If a transcript excerpt contains these topics, skip that part of the excerpt entirely and write ONLY the new content from the remaining excerpts. Writing even one sentence about an already-covered topic is a critical error:\n${(assignment.alreadyCoveredPoints ?? []).map((p) => `• ${p}`).join("\n")}`
        : `${EDITORIAL_SYSTEM}${voiceDnaBlock}${authorConfigBlock}${alreadyQuotedBlock}`;

    const { object } = await generateObject({
      model: deepSeekModel,
      schema: SectionBodySchema,
      mode: "json",
      temperature: 0.7,
      system: deduplicatedSystem,
      prompt: `${prompt}\n\nPARAGRAPH PLAN (must follow if provided):\n${JSON.stringify(paragraphPlan)}`,
    });
    const rawParagraphs = (object.paragraphs ?? []).map((p) => p.trim()).filter(Boolean);
    const { paragraphs: repairedParagraphs, orphansFixed } = repairOrphanParagraphs(rawParagraphs);
    if (orphansFixed > 0) {
      console.log(`[write-section] S5: merged ${orphansFixed} orphan paragraph(s) in Ch${assignment.chapterNumber} §${assignment.sectionNumber}`);
    }
    const rawBody = repairedParagraphs.join("\n\n") || fallbackSectionBody(assignment);
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
