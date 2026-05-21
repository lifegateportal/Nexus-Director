import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import { deepSeekModel } from "@/lib/ai-providers";
import { VoiceDNARequestSchema, VoiceDNASchema } from "@/lib/schemas/ebook";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const body = await req.json() as unknown;
  let input;
  try {
    input = VoiceDNARequestSchema.parse(body);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Invalid input" }, { status: 400 });
  }

  // Voice DNA only needs a representative sample — truncate to ~5 000 words
  // to stay well within model context limits and avoid partial JSON output.
  const WORDS = 5_000;
  const sampleTranscript = input.masterTranscript
    .split(/\s+/)
    .slice(0, WORDS)
    .join(" ");

  try {
    const { object } = await generateObject({
      model: deepSeekModel,
      schema: VoiceDNASchema,
      mode: "tool",
      temperature: 0.2,
      system: `You are a linguistic analyst specializing in capturing an author's unique voice and teaching DNA.
Analyze the provided transcript sample and extract a precise Voice DNA profile.

CRITICAL: Extract ONLY patterns genuinely evidenced in this transcript.
Do not invent or generalize — every entry must be directly supported by the words present.

Focus on:
- signaturePhrases: exact phrases repeated (min 2 occurrences). Include verbatim.
- preferredTerminology: domain-specific words or concepts the author uses consistently.
- toneProfile: emotional and relational tone (e.g. "pastoral, direct, warm, scholarly").
- sentencePattern: short-punchy | long-explanatory | mixed.
- rhetoricalPatterns: teaching devices (e.g. "repeats key point three times", "uses rhetorical questions").
- teachingStyle: how the author opens topics, develops arguments, and lands points.
- avoidWords: words demonstrably absent (be conservative).`,
      prompt: `Extract the author's Voice DNA from this transcript sample:\n\n${sampleTranscript}`,
    });

    return NextResponse.json(object, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Voice DNA extraction failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
