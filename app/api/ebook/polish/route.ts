import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { deepSeekModel } from "@/lib/ai-providers";
import { z } from "zod";
import { PolishChapterRequestSchema } from "@/lib/schemas/ebook";
import { PREMIUM_BOOK_STYLE_RULES, READER_NORMALIZATION_RULES, SOURCE_LOCK_RULES } from "@/lib/editorial-style-bible";
import { stripAudienceLanguage } from "@/lib/editorial-style-bible";

export const runtime = "nodejs";
export const maxDuration = 90;

// Slim output — section bodies are already written; LLM only adds framing + takeaways
const PolishOutputSchema = z.object({
  intro: z.string().default(""),
  conclusion: z.string().default(""),
  keyTakeaways: z.array(z.string()).default([]),
  reflectionQuestions: z.array(z.string()).default([]),
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
      toneMarkers: (chapter.voiceDNA?.toneMarkers ?? []).slice(0, 4),
      avoidWords: (chapter.voiceDNA?.avoidWords ?? []).slice(0, 6),
    };

    let object: z.infer<typeof PolishOutputSchema>;
    try {
      const { text } = await generateText({
        model: deepSeekModel,
        temperature: 0.2,
        system: `You are an editorial assistant finalizing a chapter of a published teaching book.

ABSOLUTE CONTENT RULE: Every sentence must come from the provided transcript content.
Do NOT add new ideas, examples, or explanations not present in the transcript.

Your tasks:
1. INTRO: 2–4 sentences that FRAME what this chapter covers, written in the author's voice.
   CRITICAL: Do NOT copy, quote, or paraphrase the opening sentences of Section 1.
   The intro must be a distinct orienting passage — a door the reader walks through before
   entering Section 1's prose. It should name the chapter's central question or tension
   without restating any sentence that will appear in the body.
2. CONCLUSION: 2–4 sentences closing the chapter, drawing on what was actually said.
   Do NOT repeat the intro verbatim.
3. KEY TAKEAWAYS: 3–6 bullet statements taken VERBATIM or near-verbatim from the chapter.
4. REFLECTION QUESTIONS: 3–4 questions arising naturally from what the author actually taught.

VOICE: Use the author's signature phrases and tone. Do not use words in the avoidWords list.

READER NORMALIZATION:
- Remove live-audience language and stage commands (e.g., "say amen", "look at your neighbor", altar prompts, crowd-response cues).
- Rewrite spoken-room references into reader-facing prose suitable for a book.
- Keep the meaning and theology unchanged while making the text read like writing, not a live sermon transcript.

${SOURCE_LOCK_RULES}

${READER_NORMALIZATION_RULES}

${PREMIUM_BOOK_STYLE_RULES}

Respond with ONLY a valid JSON object — no markdown, no code blocks, no explanation:
{"intro":"...","conclusion":"...","keyTakeaways":["..."],"reflectionQuestions":["..."]}`,
        prompt: `Finalize this chapter.\n\nCHAPTER ${chapter.number}: ${chapter.title}\n\nVOICE DNA:\n${JSON.stringify(voiceDNASlim)}\n\nSECTION SUMMARIES:\n${sectionsSummary}`,
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
