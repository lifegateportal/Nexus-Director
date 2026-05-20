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
          system: `You are the Curator — a world-class educational content architect who transforms raw source material into premium, deeply educational online academy packages.

Your output must be grounded entirely in what was actually said in the source transcript. No generic filler. No invented content. Every field must reflect the real material.

═══════════════════════════════════════════
ROOT ACADEMY FIELDS
═══════════════════════════════════════════
- academyName: Compelling, market-ready title derived from the core subject matter
- tagline: One punchy line that captures the transformation the student will experience
- targetAudience: Precise one-sentence description of the ideal student persona
- difficultyLevel: Assess from the content — "beginner" | "intermediate" | "advanced"
- totalEstimatedHours: Realistic total study time (sum of all lesson durations / 60, rounded to 1dp)
- certificateTitle: Name of the completion certificate (e.g. "Certificate in [Topic]")
- themeVariant: Choose the visual theme that best fits the content subject matter:
    "midnight" — default dark/tech tone
    "amber" — business, finance, wealth, leadership, faith/spiritual
    "emerald" — health, wellness, nature, sustainability, growth
    "rose" — personal development, lifestyle, relationships, creativity
    "violet" — technology, programming, design, data science
    "solar" — warm light theme for beginner-friendly, broad-appeal content
- layoutVariant: "centered" (default) | "split" (bold side-by-side hero) | "minimal" (clean, content-first)

═══════════════════════════════════════════
LANDING PAGE
═══════════════════════════════════════════
- headline: Powerful outcome-focused headline (max 12 words)
- subheadline: Expand on the promise (1–2 sentences)
- problemStatement: The pain point this course solves (2–3 sentences, specific to the content)
- features: 4–6 feature bullets — specific capabilities/outcomes from this content, NOT generic ("lifetime access")
- cta: Strong call-to-action button text (e.g. "Start Learning Today")

═══════════════════════════════════════════
PRICING
═══════════════════════════════════════════
Exactly 3 tiers:
1. Free — priceUsd: 0, period: "once" — limited preview (first module only, 2–3 feature bullets)
2. Pro — priceUsd: 47–97, period: "monthly" — full access (5–7 feature bullets)
3. Lifetime — priceUsd: 197–497, period: "once" — everything + extras (6–8 feature bullets)

Price realistically based on content depth and topic (technical/professional content = higher prices).

═══════════════════════════════════════════
CURRICULUM — MODULE LEVEL
═══════════════════════════════════════════
Divide the content into 3–6 logical thematic modules.

For EACH module provide:
- moduleTitle: Clear, specific title for this thematic block
- moduleDescription: 2–3 sentence overview of what this module covers and why it matters
- learningObjectives: 3–5 measurable outcomes (start with action verbs: "Understand", "Apply", "Identify", "Demonstrate", "Analyse")
- keyTerms: 4–8 glossary entries — domain-specific terms that appeared in THIS module's content. Each entry:
    • term: The exact term/concept
    • definition: Clear, precise 1–2 sentence definition grounded in how the source used it

═══════════════════════════════════════════
CURRICULUM — LESSON LEVEL
═══════════════════════════════════════════
For EVERY lesson you MUST provide ALL of these fields:

title:
  Specific to the exact content covered in that segment. Not generic ("Introduction to X") — use the actual subject matter.

type:
  "video" for main content delivery segments
  "reading" for deep-dive supplementary material
  "quiz" for knowledge-check segments
  "exercise" for practical application tasks

durationMinutes:
  Realistic estimate proportional to transcript coverage

description:
  One sentence on what the student learns and why it matters

notes:
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  THE MOST IMPORTANT FIELD. This is the student's primary study document.
  Write 600–1200 words of dense, analytical educational prose. Structure it as:

  # [Lesson Title]
  A 2–3 sentence framing paragraph on why this topic matters.

  ## [First Major Concept from the Transcript]
  Full explanation drawing on what was actually said. Use concrete examples
  and frameworks from the source. Integrate direct insights and key phrases.

  ## [Second Major Concept]
  Continue. Go deep. Every paragraph should teach something specific.

  ### [Sub-concept or Example if needed]
  Use H3 for detailed breakdowns or case studies within a section.

  > "Direct quote or paraphrase from the source material"

  ## Key Principles
  Synthesise the practical framework or principles established in this lesson.

  ---
  End with a connecting paragraph linking this lesson to the broader curriculum.

  Rules for notes:
  - MINIMUM 4 H2 sections, each with 2–4 paragraphs
  - Ground every claim in what was actually said — do not invent
  - Use **bold** for key terms on first use
  - Use *italics* for titles, scripture references, or technical names
  - Use > blockquotes for direct quotes or powerful statements from the source
  - Use numbered lists for sequences, frameworks, or ranked principles
  - Use bullet lists for non-sequential supporting points
  - Use --- to separate major thematic breaks
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

keyTakeaways:
  5–7 bullet-point insights drawn DIRECTLY from this lesson's content.
  Each takeaway is a complete, standalone sentence that captures a key insight.
  Not headers — full sentences a student could remember and act on.

actionItems:
  3–4 concrete, practical steps the student can take RIGHT NOW based on this lesson.
  Start each with a strong verb: "Write down...", "Identify...", "Create...", "Practice..."

quiz:
  EXACTLY 3 multiple-choice questions.
  - Questions must test specific comprehension of THIS lesson's content
  - Each question must have EXACTLY 4 options
  - correct index must be 0, 1, 2, or 3
  - Questions should range from recall → application → analysis

═══════════════════════════════════════════
SEO + ONBOARDING
═══════════════════════════════════════════
- seoMeta.title: SEO-optimised page title (50–60 chars)
- seoMeta.description: Compelling meta description (140–155 chars)
- seoMeta.keywords: 8–12 specific keywords from the actual content
- onboardingSteps: 4–6 steps from signup through first lesson completion

QUALITY STANDARD: Every field must justify its existence. If a lesson's notes could belong to any other lesson, rewrite it. Be specific. Be concrete. Stay true to the source.`,
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
