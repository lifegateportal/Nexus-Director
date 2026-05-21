import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import { deepSeekModel } from "@/lib/ai-providers";
import { z } from "zod";
import { PolishChapterRequestSchema } from "@/lib/schemas/ebook";

export const runtime = "nodejs";
export const maxDuration = 90;

// Slim output — section bodies are already written; LLM only adds framing + takeaways
const PolishOutputSchema = z.object({
  intro: z.string().default(""),
  conclusion: z.string().default(""),
  keyTakeaways: z.array(z.string()).default([]),
  reflectionQuestions: z.array(z.string()).default([]),
});

function fallbackPolish(chapter: z.infer<typeof PolishChapterRequestSchema>["input"], safeSections: Array<z.infer<typeof z.object({
  chapterNumber: z.ZodNumber;
  sectionNumber: z.ZodNumber;
  heading: z.ZodString;
  body: z.ZodString;
  wordCount: z.ZodNumber;
  status: z.ZodEnum<{ pending: "pending"; writing: "writing"; complete: "complete"; failed: "failed" }>;
})>>) {
  const nonEmptyBodies = safeSections
    .map((section) => section.body.trim())
    .filter(Boolean);

  const introSource = nonEmptyBodies[0] ?? "";
  const conclusionSource = nonEmptyBodies[nonEmptyBodies.length - 1] ?? introSource;
  const keyTakeaways = safeSections
    .map((section) => section.heading.trim())
    .filter(Boolean)
    .slice(0, 5);

  return {
    intro: introSource.split(/\n{2,}/)[0] ?? "",
    conclusion: conclusionSource.split(/\n{2,}/).slice(-1)[0] ?? "",
    keyTakeaways,
    reflectionQuestions: keyTakeaways.slice(0, 3).map((heading) => `How does ${heading.toLowerCase()} shape your response?`),
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
  const safeSections = (chapter.sections ?? []).map((section) => ({
    ...section,
    body: section.body ?? "",
    heading: section.heading ?? "",
  }));
  const safeVoiceDNA = {
    signaturePhrases: chapter.voiceDNA?.signaturePhrases ?? [],
    toneMarkers: (chapter.voiceDNA as { toneMarkers?: string[] } | undefined)?.toneMarkers ?? [],
    avoidWords: chapter.voiceDNA?.avoidWords ?? [],
  };
  const totalWordCount = safeSections.reduce((acc, s) => acc + (s.wordCount ?? 0), 0);

  try {
    // Send section headings + first 200 chars of each body (not full prose)
    const sectionsSummary = safeSections
      .map((s) => `Section ${s.sectionNumber} — ${s.heading}:\n${(s.body ?? "").slice(0, 200)}…`)
      .join("\n\n");

    // Trim VoiceDNA to key fields only to keep the prompt small and response fast
    const voiceDNASlim = {
      signaturePhrases: safeVoiceDNA.signaturePhrases.slice(0, 6),
      toneMarkers: safeVoiceDNA.toneMarkers.slice(0, 4),
      avoidWords: safeVoiceDNA.avoidWords.slice(0, 6),
    };

    const { object } = await generateObject({
      model: deepSeekModel,
      schema: PolishOutputSchema,
      mode: "tool",
      temperature: 0.2,
      system: `You are an editorial assistant finalizing a chapter of a published teaching book.

ABSOLUTE CONTENT RULE: Every sentence must come from the provided transcript content.
Do NOT add new ideas, examples, or explanations not present in the transcript.

Your tasks:
1. INTRO: 2–4 sentences opening the chapter using the author's own words/phrases.
2. CONCLUSION: 2–4 sentences closing the chapter, drawing on what was actually said.
3. KEY TAKEAWAYS: 3–6 bullet statements taken VERBATIM or near-verbatim from the chapter.
4. REFLECTION QUESTIONS: 3–4 questions arising naturally from what the author actually taught.

VOICE: Use the author's signature phrases and tone. Do not use words in the avoidWords list.`,
      prompt: `Finalize this chapter.\n\nCHAPTER ${chapter.number}: ${chapter.title}\n\nVOICE DNA:\n${JSON.stringify(voiceDNASlim)}\n\nSECTION SUMMARIES:\n${sectionsSummary}`,
    });

    // Merge: preserve section bodies that were already written
    const merged = {
      ...object,
      number: chapter.number,
      title: chapter.title,
      sections: safeSections,
      totalWordCount,
      status: "complete" as const,
    };

    return NextResponse.json(merged, { status: 200 });
  } catch (err) {
    const fallback = fallbackPolish(chapter, safeSections);
    return NextResponse.json({
      ...fallback,
      number: chapter.number,
      title: chapter.title,
      sections: safeSections,
      totalWordCount,
      status: "complete" as const,
      fallback: true,
      error: err instanceof Error && err.message.trim() ? err.message : "Chapter polish used fallback",
      details: err instanceof Error && err.stack
        ? err.stack.split("\n").slice(0, 3).join(" | ")
        : undefined,
    }, { status: 200 });
  }
}
