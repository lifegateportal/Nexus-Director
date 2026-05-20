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
      temperature: 0.3,
      system: `You are the Curator — an expert at packaging real educational content into premium online academies.

Given a content blueprint that includes a real video transcript, produce a complete academy specification with deeply educational content grounded in what was actually said.

Rules:
- academyName / tagline: Compelling market-ready branding based on the actual content themes
- targetAudience: Precise one-sentence description of the ideal student
- landingPage: Headline, subheadline, problem statement, 4–6 feature bullets, strong CTA — all derived from the real content
- pricing: Exactly 3 tiers — Free (limited preview only), Pro (full access, monthly), Lifetime (one-off purchase)
- curriculum: Divide the content into logical modules and lessons that map to what was actually covered in the transcript.
  For EVERY lesson you MUST provide:
    • title: Specific to the exact content covered in that segment
    • type: "video" | "reading" | "quiz" | "exercise"
    • durationMinutes: Realistic estimate
    • description: One sentence on what the student will learn
    • notes: 4–6 dense paragraphs of full educational notes for this lesson — written in clear teaching prose (not bullet points). Cover all key concepts, frameworks, quotes, and insights drawn directly from the transcript for this segment. This is the student's primary study material.
    • quiz: Exactly 3 multiple-choice questions that test comprehension of THIS lesson's specific content. Each question must have exactly 4 options (options array length = 4) and a correct answer index (0, 1, 2, or 3).
- seoMeta: Title, meta description, 6–10 keywords
- onboardingSteps: 4–6 steps from signup to first lesson

Be concrete — every lesson's notes and quiz questions must reflect what was actually said in the source material, not generic filler.`,
      prompt: JSON.stringify(input),
    });

    return NextResponse.json(object);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Produce stage failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
