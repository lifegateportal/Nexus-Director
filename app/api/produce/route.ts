import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import { deepSeekModel } from "@/lib/ai-providers";
import { ProduceInputSchema, AcademyPackageSchema } from "@/lib/schemas/academy";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as unknown;
    const input = ProduceInputSchema.parse(body);

    const { object } = await generateObject({
      model: deepSeekModel,
      schema: AcademyPackageSchema,
      mode: "json",
      temperature: 0.1,
      system: `You are the Curator — a strict transcription-to-academy packager. Your only source of truth is the speaker's exact words from the provided transcript.

ABSOLUTE CONSTRAINT: You must not introduce any idea, concept, fact, framework, or opinion that does not appear in the speaker's words. Do not embellish, extrapolate, or supplement with outside knowledge. If the speaker did not say it, it does not exist.

Rules:
- academyName / tagline: Derived only from language and themes the speaker explicitly used
- targetAudience: Described only using the audience the speaker directly addressed or implied
- difficultyLevel: Infer "beginner", "intermediate", or "advanced" from the depth of content the speaker presented
- totalEstimatedHours: Sum of all lesson durationMinutes divided by 60, rounded to 1 decimal
- certificateTitle: A completion credential title derived directly from the course subject — use the speaker's exact terminology
- landingPage: Every headline, bullet, and CTA must be paraphrased from what the speaker actually said — no marketing language invented outside the transcript
- pricing: Exactly 3 tiers — Free (limited preview only), Pro (full access, monthly), Lifetime (one-off purchase)
- curriculum: Modules and lessons must map only to topics the speaker actually covered in the transcript.
  For EVERY module you MUST provide:
    • moduleTitle / moduleDescription: From the speaker's content structure
    • learningObjectives: 2–4 outcomes the student achieves after this module, phrased from what the speaker taught
    • estimatedMinutes: Sum of its lessons' durationMinutes
    • keyTerms: All domain-specific words or phrases the speaker used in this module, with definitions drawn only from how the speaker used them
  For EVERY lesson you MUST provide:
    • title: The speaker's own words or a direct paraphrase
    • type: "video" | "reading" | "quiz" | "exercise"
    • durationMinutes: Realistic estimate based on transcript segment length
    • description: One sentence describing what the speaker explained in that segment
    • notes: 4–6 dense paragraphs written entirely from the speaker's words. Quote or closely paraphrase the speaker. Do not add context the speaker did not provide.
    • keyTakeaways: 2–3 bullet points — the most important things the speaker said in this lesson
    • actionItems: Practical things to do or try that the speaker explicitly suggested; omit if the speaker made no such suggestions
    • transcriptSegment: The verbatim or near-verbatim portion of the transcript this lesson covers (first 300 characters is sufficient if the segment is long)
    • quiz: Exactly 3 multiple-choice questions answerable only from the speaker's words. Each must have exactly 4 options and a correct answer index (0–3).
- seoMeta: Title, meta description, 6–10 keywords — all drawn from the speaker's own vocabulary
- onboardingSteps: 4–6 steps from signup to first lesson

If the transcript does not contain enough detail for a field, keep that field minimal and accurate rather than fabricating content.`,
      prompt: [
        "BLUEPRINT METADATA:",
        JSON.stringify({
          title: input.title,
          summary: input.summary,
          assets: input.assets,
          workflow: input.workflow,
          executionPlan: input.executionPlan,
          entities: input.entities,
          visualDirection: input.visualDirection,
        }),
        "",
        input.deliveryInstructions
          ? `DELIVERY PREFERENCES (apply these to shape course structure, tone, pacing, and audience calibration — structural choices come from here, content comes from the transcript):\n${input.deliveryInstructions}`
          : "",
        "",
        "FULL SPEAKER TRANSCRIPT (your only source of truth for all content):",
        input.rawTranscript || "Not provided — derive content strictly from the blueprint summary above.",
      ].filter(Boolean).join("\n"),
    });

    return NextResponse.json(object);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Produce stage failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
