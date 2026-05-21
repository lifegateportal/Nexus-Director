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
    // Send section headings + first 200 chars of each body (not full prose)
    const sectionsSummary = chapter.sections
      .map((s) => `Section ${s.sectionNumber} — ${s.heading}:\n${(s.body ?? "").slice(0, 200)}…`)
      .join("\n\n");

    const totalWordCount = chapter.sections.reduce((acc, s) => acc + (s.wordCount ?? 0), 0);

    // Trim VoiceDNA to key fields only to keep the prompt small and response fast
    const voiceDNASlim = {
      signaturePhrases: (chapter.voiceDNA.signaturePhrases ?? []).slice(0, 6),
      toneMarkers: (chapter.voiceDNA.toneMarkers ?? []).slice(0, 4),
      avoidWords: (chapter.voiceDNA.avoidWords ?? []).slice(0, 6),
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
