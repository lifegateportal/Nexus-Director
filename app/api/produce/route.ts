import { NextRequest } from "next/server";
import { generateObject } from "ai";
import { deepSeekModel } from "@/lib/ai-providers";
import { ProduceInputSchema, AcademyPackageSchema } from "@/lib/schemas/academy";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json() as unknown;
  let input;
  try {
    input = ProduceInputSchema.parse(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid request body";
    return new Response(JSON.stringify({ error: message }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const encoder = new TextEncoder();

  // SSE stream — keeps the connection alive with ping comments so reverse
  // proxies don't close the socket while DeepSeek generates the large object.
  const stream = new ReadableStream({
    async start(controller) {
      const ping = setInterval(() => {
        try { controller.enqueue(encoder.encode(": ping\n\n")); } catch { /* closed */ }
      }, 15_000);

      try {
        const transcriptSection = input.rawTranscript
          ? `\n\nRAW TRANSCRIPT (use this as the primary source for lesson notes and quiz questions):\n${input.rawTranscript}`
          : "";
        const deliverySection = input.deliveryInstructions
          ? `\n\nDELIVERY INSTRUCTIONS:\n${input.deliveryInstructions}`
          : "";

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
          prompt: JSON.stringify({
            title: input.title,
            summary: input.summary,
            assets: input.assets,
            workflow: input.workflow,
            executionPlan: input.executionPlan,
            entities: input.entities,
            visualDirection: input.visualDirection,
          }) + transcriptSection + deliverySection,
        });

        clearInterval(ping);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(object)}\n\n`));
      } catch (error) {
        clearInterval(ping);
        const message = error instanceof Error ? error.message : "Produce stage failed";
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: message })}\n\n`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no", // disable nginx buffering
    },
  });
}
