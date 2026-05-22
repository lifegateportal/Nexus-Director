import { NextRequest } from "next/server";
import { generateObject } from "ai";
import { deepSeekModel } from "@/lib/ai-providers";
import { ProduceInputSchema, AcademyPackageSchema, AcademyShellSchema, ModuleLessonsSchema } from "@/lib/schemas/academy";

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
        // Truncate transcript to prevent input token overflow for large PDFs/videos.
        // 15,000 chars ≈ 4,000–5,000 tokens, well within context limits.
        const MAX_TRANSCRIPT_CHARS = 15_000;
        const rawTranscript = input.rawTranscript && input.rawTranscript.length > MAX_TRANSCRIPT_CHARS
          ? input.rawTranscript.slice(0, MAX_TRANSCRIPT_CHARS) + "\n\n[Transcript truncated]"
          : input.rawTranscript;

        const transcriptSection = rawTranscript
          ? `\n\nRAW TRANSCRIPT (primary source — ground all content in this):\n${rawTranscript}`
          : "";
        const deliverySection = input.deliveryInstructions
          ? `\n\nDELIVERY INSTRUCTIONS:\n${input.deliveryInstructions}`
          : "";

        const basePrompt = JSON.stringify({
          title: input.title,
          summary: input.summary,
          assets: input.assets,
          workflow: input.workflow,
          executionPlan: input.executionPlan,
          entities: input.entities,
          visualDirection: input.visualDirection,
        });

        // ── Phase 1: Academy shell ─────────────────────────────────────────────
        // Generates all metadata, landing page, pricing, SEO, and module outlines
        // with lightweight lesson stubs only. Stays well under the 8K output limit.
        const { object: shell } = await generateObject({
          model: deepSeekModel,
          schema: AcademyShellSchema,
          mode: "json",
          maxTokens: 6_000,
          temperature: 0.3,
          system: `You are the Curator — a world-class educational content architect. Transform source material into an online academy structure.

OUTPUT ALL ACADEMY FIELDS. For curriculum, produce 3–5 modules each with 2–4 lesson OUTLINES (stub only: title, type, durationMinutes, description). Do NOT write notes, quiz, keyTakeaways, or actionItems in this phase.

FIELD GUIDE:
- academyName: Compelling, market-ready title from the core subject matter
- tagline: One punchy line capturing the student transformation
- targetAudience: Precise one-sentence ideal student persona
- difficultyLevel: "beginner" | "intermediate" | "advanced"
- totalEstimatedHours: Sum of lesson durations ÷ 60, rounded to 1dp
- certificateTitle: e.g. "Certificate in [Topic]"
- themeVariant: midnight (tech) | amber (business/faith) | emerald (health/nature) | rose (personal dev) | violet (design/code) | solar (beginner/broad)
- layoutVariant: "centered" | "split" | "minimal"

LANDING PAGE: headline (max 12 words), subheadline (1–2 sentences), problemStatement (2–3 sentences), features (4–6 specific outcome bullets, NOT "lifetime access"), cta (button text)

PRICING — exactly 3 tiers:
1. Free — priceUsd: 0, period: "once", 2–3 bullets
2. Pro — priceUsd: 47–97, period: "monthly", 5–7 bullets
3. Lifetime — priceUsd: 197–497, period: "once", 6–8 bullets

CURRICULUM — each module: moduleTitle, moduleDescription (2–3 sentences), learningObjectives (3–5), keyTerms (4–8 entries with term + definition), lessonOutlines (2–4 stubs)

SEO: title (50–60 chars), description (140–155 chars), keywords (8–12)
onboardingSteps: 4–6 steps from signup → first lesson`,
          prompt: basePrompt + transcriptSection + deliverySection,
        });

        // ── Phase 2: Full lesson content per module ────────────────────────────
        // Each module is a separate DeepSeek call (~3,500 tokens) to stay under
        // the 8K output limit. Runs sequentially to avoid rate-limit issues.
        type FullLesson = {
          title: string;
          type: "video" | "reading" | "quiz" | "exercise";
          durationMinutes: number;
          description: string;
          notes: string;
          keyTakeaways: string[];
          actionItems: string[];
          quiz: Array<{ q: string; options: string[]; correct: number }>;
        };
        type FullModule = {
          moduleTitle: string;
          moduleDescription: string;
          learningObjectives: string[];
          keyTerms: Array<{ term: string; definition: string }>;
          lessons: FullLesson[];
        };

        const fullCurriculum: FullModule[] = [];

        for (const mod of shell.curriculum) {
          const { object: lessonData } = await generateObject({
            model: deepSeekModel,
            schema: ModuleLessonsSchema,
            mode: "json",
            maxTokens: 7_000,
            temperature: 0.3,
            system: `You are the Curator. Write full lesson content for one academy module. You receive lesson outlines — expand each into the complete lesson.

For EVERY lesson provide:
- title / type / durationMinutes / description: match the outline exactly
- notes: 300–600 words of dense educational prose grounded in the transcript.
  Structure: # [Title] → framing para → ## [Concept 1] → ## [Concept 2] → ## Key Principles
  Rules: min 2 H2 sections, **bold** key terms, > blockquotes for direct quotes, no invented content.
- keyTakeaways: 5–7 complete sentences — specific insights from THIS lesson
- actionItems: 3–4 steps starting with action verbs (Write down..., Identify..., Practice...)
- quiz: EXACTLY 3 questions, each with EXACTLY 4 options, correct is 0–3

Ground every claim in the transcript. Be specific to this module's content.`,
            prompt: `MODULE: ${mod.moduleTitle}
DESCRIPTION: ${mod.moduleDescription}
LESSON OUTLINES:
${JSON.stringify(mod.lessonOutlines, null, 2)}${transcriptSection}`,
          });

          fullCurriculum.push({
            moduleTitle: mod.moduleTitle,
            moduleDescription: mod.moduleDescription,
            learningObjectives: mod.learningObjectives,
            keyTerms: mod.keyTerms,
            lessons: lessonData.lessons,
          });
        }

        // ── Phase 3: Merge and validate ────────────────────────────────────────
        const academy = AcademyPackageSchema.parse({
          ...shell,
          curriculum: fullCurriculum,
        });

        clearInterval(ping);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(academy)}\n\n`));
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
