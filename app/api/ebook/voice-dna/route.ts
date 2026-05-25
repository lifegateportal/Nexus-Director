import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { deepSeekModel } from "@/lib/ai-providers";
import { VoiceDNARequestSchema, VoiceDNASchema } from "@/lib/schemas/ebook";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const body = await req.json() as unknown;
  let input;
  try {
    input = VoiceDNARequestSchema.parse(body);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Invalid input" }, { status: 400 });
  }

  // Distributed 900-word sample: start + middle + end captures voice range without
  // overwhelming DeepSeek's context and risking a truncated/empty JSON response.
  const words = input.masterTranscript.split(/\s+/);
  const total = words.length;
  const startSample = words.slice(0, 300).join(" ");
  const midStart = Math.max(300, Math.floor(total / 2) - 150);
  const midSample = words.slice(midStart, midStart + 300).join(" ");
  const endSample = words.slice(Math.max(0, total - 300)).join(" ");
  const sampleTranscript = [
    "[START]\n" + startSample,
    "[MIDDLE]\n" + midSample,
    "[END]\n" + endSample,
  ].join("\n\n---\n\n");

  try {
    const { text } = await generateText({
      model: deepSeekModel,
      temperature: 0.2,
      maxTokens: 1024,
      system: `You are a linguistic analyst specializing in capturing an author's unique voice and teaching DNA.
Analyze the provided transcript sample and extract a precise Voice DNA profile.

CRITICAL: Extract ONLY patterns genuinely evidenced in this transcript.
Do not invent or generalize — every entry must be directly supported by the words present.

Focus on:
- signaturePhrases: exact phrases repeated (min 2 occurrences). Include verbatim.
- preferredTerminology: domain-specific words or concepts the author uses consistently.
- toneProfile: emotional and relational tone (e.g. "pastoral, direct, warm, scholarly").
- sentencePattern: must be exactly one of: "short-punchy", "long-explanatory", or "mixed".
- rhetoricalPatterns: teaching devices (e.g. "repeats key point three times", "uses rhetorical questions").
- teachingStyle: how the author opens topics, develops arguments, and lands points.
- avoidWords: Always start with this mandatory baseline of forbidden AI writing clichés, then add any words the author demonstrably never uses on top:
  BASELINE (always include all of these): ["In conclusion", "delve into", "tapestry", "navigating", "It's important to note", "Furthermore", "Moreover", "In today's fast-paced world", "It is crucial", "It is worth noting", "At the end of the day", "Game-changer", "Paradigm shift", "Deep dive", "Unpack", "Moving forward", "Robust", "Leverage", "Synergy", "It goes without saying", "The truth is,", "The fact of the matter is"]
  Then append author-specific words genuinely absent from their speech.

Respond with ONLY a valid JSON object matching this exact shape:
{
  "signaturePhrases": ["..."],
  "preferredTerminology": ["..."],
  "toneProfile": "...",
  "sentencePattern": "short-punchy" | "long-explanatory" | "mixed",
  "rhetoricalPatterns": ["..."],
  "teachingStyle": "...",
  "avoidWords": ["..."]
}`,
      prompt: `Extract the author's Voice DNA from this transcript sample:\n\n${sampleTranscript}`,
    });

    // Extract the first {...} JSON block — handles leading text, code fences, or truncation artifacts
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error(`Voice DNA response contained no JSON object. Raw: ${text.slice(0, 200)}`);
    const raw = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

    // Coerce sentencePattern to a valid enum value
    if (typeof raw.sentencePattern === "string") {
      const sp = raw.sentencePattern.toLowerCase();
      if (sp.includes("short") || sp.includes("punchy")) raw.sentencePattern = "short-punchy";
      else if (sp.includes("long") || sp.includes("explanatory")) raw.sentencePattern = "long-explanatory";
      else raw.sentencePattern = "mixed";
    }

    const object = VoiceDNASchema.parse(raw);
    return NextResponse.json(object, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Voice DNA extraction failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
