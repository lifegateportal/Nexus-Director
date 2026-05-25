import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { deepSeekModel } from "@/lib/ai-providers";
import { z } from "zod";
import { PolishChapterRequestSchema } from "@/lib/schemas/ebook";
import { PREMIUM_BOOK_STYLE_RULES, READER_NORMALIZATION_RULES, SOURCE_LOCK_RULES } from "@/lib/editorial-style-bible";
import { stripAudienceLanguage } from "@/lib/editorial-style-bible";

export const runtime = "nodejs";
export const maxDuration = 300;

// Slim output — section bodies are already written; LLM only adds framing + takeaways
const PolishOutputSchema = z.object({
  intro: z.string().default(""),
  conclusion: z.string().default(""),
  keyTakeaways: z.array(z.string()).default([]),
  reflectionQuestions: z.array(z.string()).default([]),
  epigraph: z.string().default(""),
  premiseLine: z.string().default(""),
});

function fallbackPolishOutput(chapter: z.infer<typeof PolishChapterRequestSchema>["input"]): z.infer<typeof PolishOutputSchema> {
  const sections = chapter.sections ?? [];
  const firstBody = sections.map((section) => (section.body ?? "").trim()).find(Boolean) ?? "";
  const lastBody = [...sections].reverse().map((section) => (section.body ?? "").trim()).find(Boolean) ?? "";

  const takeaways = sections
    .flatMap((section) => [section.heading, ...(section.keyTakeaways ?? [])])
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 5);

  const reflectionQuestions = takeaways.length > 0
    ? takeaways.slice(0, 3).map((item) => `How does ${item.replace(/[.?!]+$/g, "")} shape the chapter's message?`)
    : [
        `What is the main message of chapter ${chapter.number}?`,
        `How do the section themes build on each other in chapter ${chapter.number}?`,
        `What should the reader carry forward from this chapter?`,
      ];

  // Intro: derive from headings and key points — never copy the body prose.
  const headingsSummary = sections
    .map((s) => s.heading?.trim())
    .filter(Boolean)
    .join(", ");
  const fallbackIntro = headingsSummary
    ? `This chapter examines: ${headingsSummary}.`
    : chapter.title || "";

  return {
    intro: stripAudienceLanguage(fallbackIntro),
    conclusion: stripAudienceLanguage(lastBody || firstBody || chapter.title || ""),

    keyTakeaways: takeaways.length > 0 ? takeaways.map((item) => stripAudienceLanguage(item)) : [stripAudienceLanguage(chapter.title || "")].filter(Boolean),
    reflectionQuestions: reflectionQuestions.map((item) => stripAudienceLanguage(item)).filter(Boolean),
  };
}

export async function POST(req: NextRequest) {
  const body = await req.json() as unknown;
  let input;
  try {
    input = PolishChapterRequestSchema.parse(body);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Invalid input" }, { status: 400 });
  }

  const { input: chapter } = input;
  const authorConfig = input.authorConfig;
  const authorConfigBlock = (authorConfig?.instructions || authorConfig?.targetAudience)
    ? `\n\nAUTHOR BOOK CONFIGURATION (highest priority):\n${authorConfig.targetAudience ? `TARGET AUDIENCE: ${authorConfig.targetAudience}` : ""}${authorConfig.instructions ? `\nAUTHOR WRITING INSTRUCTIONS: ${authorConfig.instructions}` : ""}`
    : "";

  try {
    // Send section headings + key takeaways only — NOT body prose.
    // Sending body prose caused the LLM to mirror the section-1 opening verbatim as the intro.
    const sectionsSummary = (chapter.sections ?? [])
      .map((s) => {
        const kp = (s.keyTakeaways ?? []).slice(0, 3).join("; ");
        return `Section ${s.sectionNumber} — ${s.heading}${kp ? `: ${kp}` : ""}`;
      })
      .join("\n");

    const totalWordCount = (chapter.sections ?? []).reduce((acc, s) => acc + (s.wordCount ?? 0), 0);

    // Trim VoiceDNA to key fields only to keep the prompt small and response fast
    const voiceDNASlim = {
      signaturePhrases: (chapter.voiceDNA?.signaturePhrases ?? []).slice(0, 6),
      toneProfile: chapter.voiceDNA?.toneProfile ?? "",
      preferredTerminology: (chapter.voiceDNA?.preferredTerminology ?? []).slice(0, 6),
      avoidWords: (chapter.voiceDNA?.avoidWords ?? []).slice(0, 8),
    };

    const epigraphCandidates = (chapter.quotesInChapter ?? [])
      .filter((q) => q.type === "scripture")
      .slice(0, 5)
      .map((q) => `"${q.text.slice(0, 120)}" \u2014 ${q.reference}${q.translation ? ` (${q.translation})` : ""}`)
      .join("\n");

    const prevChapterBlock = chapter.previousChapterConclusion
      ? `\n\nPREVIOUS CHAPTER CLOSING (connective tissue — do NOT repeat, only continue the arc):\n${chapter.previousChapterConclusion.slice(0, 350)}`
      : "";

    let object: z.infer<typeof PolishOutputSchema>;
    try {
      const { text } = await generateText({
        model: deepSeekModel,
        temperature: 0.2,
        system: `You are an editorial assistant finalizing a chapter of a published teaching book.

ABSOLUTE CONTENT RULE: Every sentence must come from the provided transcript content.
Do NOT add new ideas, examples, or explanations not present in the transcript.

EM DASH ABSOLUTE BAN: Never use an em dash (—) in any output. No spaced em dashes ( — ), no unspaced em dashes (—), no double hyphens (--) used as em dashes. Use a comma, colon, or split into two sentences instead.

HUMANIZATION: Use contractions naturally. Avoid "not just...but", "not merely...but", "indeed,", "certainly,", "ultimately,", "at its core", "in essence", "profoundly", "transformative". Break any run of three parallel-structured sentences.

Your tasks:
1. EPIGRAPH: From the provided scripture candidates, pick the ONE most resonant opening quote for this chapter. Return it formatted as: "Quote text." — Reference (Translation). If no candidate strongly fits or none are provided, return an empty string. Never invent a quote.
2. PREMISE LINE: Write ONE bold declarative sentence (not a question, not a list preview) stating what is at stake in this chapter. Read like a thesis, not a table of contents. Max 25 words. Drawn entirely from the chapter content.
3. INTRO: 2–4 sentences that FRAME what this chapter covers, written in the author's voice.
   CRITICAL: Do NOT copy, quote, or paraphrase the opening sentences of Section 1.
   The intro must be a distinct orienting passage — a door the reader walks through before
   entering Section 1's prose. It should name the chapter's central question or tension
   without restating any sentence that will appear in the body.
   CONNECTIVE TISSUE: If a "PREVIOUS CHAPTER CLOSING" is provided, the intro's opening should feel like a natural forward step from that closing — not a restatement, but a continuation of the arc.
4. CONCLUSION: 2–4 sentences closing the chapter, drawing on what was actually said.
   Do NOT repeat the intro verbatim.
5. KEY TAKEAWAYS: 3–6 bullet statements taken VERBATIM or near-verbatim from the chapter content.
6. REFLECTION QUESTIONS: 3–4 questions that are SPECIFIC, PERSONAL, and ACTIONABLE.
   REQUIRED: Each question must reference a concrete claim, story, or scripture from this chapter.
   FORBIDDEN generic forms: "How does X shape the message?", "What is the main message?", "What should the reader carry forward?", "How can you apply this?".
   REQUIRED: Name the specific idea, then ask about its implication in the reader's real life. Example: "Peter says diligence is required, not passive waiting — where in your life are you waiting for God to act when He has already told you to move?"

VOICE: Use the author's signature phrases and preferred terminology consistently. Never swap a synonym for variety when the author has a preferred term. Do not use words in the avoidWords list.

READER NORMALIZATION:
- Remove live-audience language and stage commands.
- Rewrite spoken-room references into reader-facing prose.

${SOURCE_LOCK_RULES}

${READER_NORMALIZATION_RULES}

${PREMIUM_BOOK_STYLE_RULES}${authorConfigBlock}

Respond with ONLY a valid JSON object — no markdown, no code blocks, no explanation:
{"intro":"...","conclusion":"...","keyTakeaways":["..."],"reflectionQuestions":["..."],"epigraph":"...","premiseLine":"..."}`,
        prompt: `Finalize this chapter.\n\nCHAPTER ${chapter.number}: ${chapter.title}\n\nVOICE DNA:\n${JSON.stringify(voiceDNASlim)}\n\nSECTION SUMMARIES:\n${sectionsSummary}${epigraphCandidates ? `\n\nSCRIPTURE CANDIDATES FOR EPIGRAPH (pick the most resonant ONE, or return empty string if none fits):\n${epigraphCandidates}` : ""}${prevChapterBlock}`,
      });
      const _jsonMatch = text.match(/\{[\s\S]*\}/);
      object = PolishOutputSchema.parse(_jsonMatch ? JSON.parse(_jsonMatch[0]) : {});
    } catch {
      try {
        object = fallbackPolishOutput(chapter);
      } catch {
        object = { intro: "", conclusion: "", keyTakeaways: [], reflectionQuestions: [] };
      }
    }

    // Merge: preserve section bodies that were already written
    const merged = {
      ...object,
      intro: stripAudienceLanguage(object.intro ?? ""),
      conclusion: stripAudienceLanguage(object.conclusion ?? ""),
      keyTakeaways: (object.keyTakeaways ?? []).map((t) => stripAudienceLanguage(t)),
      reflectionQuestions: (object.reflectionQuestions ?? []).map((q) => stripAudienceLanguage(q)),
      epigraph: object.epigraph ?? "",
      premiseLine: object.premiseLine ?? "",
      number: chapter.number,
      title: chapter.title,
      sections: chapter.sections,
      totalWordCount,
      status: "complete" as const,
    };

    return NextResponse.json(merged, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Chapter polish failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
