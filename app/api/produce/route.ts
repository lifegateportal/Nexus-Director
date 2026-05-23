import { NextRequest } from "next/server";
import { generateObject, generateText } from "ai";
import { deepSeekModel } from "@/lib/ai-providers";
import { ProduceInputSchema, AcademyPackageSchema, AcademyShellSchema, ModuleMetaSchema, LessonStructuredSchema } from "@/lib/schemas/academy";

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
        // 15,000 chars ≈ 4,000–5,000 tokens used as Phase 1 context.
        // Per-lesson calls use a much tighter 3,000-char window to keep each
        // call small and well within DeepSeek's 8K output limit.
        const MAX_TRANSCRIPT_CHARS = 15_000;
        const MAX_LESSON_TRANSCRIPT_CHARS = 3_000;
        const rawTranscript = input.rawTranscript && input.rawTranscript.length > MAX_TRANSCRIPT_CHARS
          ? input.rawTranscript.slice(0, MAX_TRANSCRIPT_CHARS) + "\n\n[Transcript truncated]"
          : input.rawTranscript;

        // Phase 1 source: sample beginning + middle + end of the FULL raw input
        // so the curriculum reflects the entire book, not just the opening pages.
        // Uses input.rawTranscript (pre-truncation) to capture the full range.
        const buildPhase1Source = (text: string | undefined): string => {
          if (!text) return "";
          const SAMPLE = 4_500; // chars per sample point (~1,200 tokens)
          const len = text.length;
          const beginning = text.slice(0, SAMPLE);
          const midStart  = Math.max(SAMPLE, Math.floor(len / 2) - Math.floor(SAMPLE / 2));
          const middle    = len > SAMPLE * 2 ? text.slice(midStart, midStart + SAMPLE) : "";
          const ending    = len > SAMPLE     ? text.slice(Math.max(0, len - SAMPLE))   : "";
          return [beginning, middle, ending].filter(Boolean).join("\n\n[…]\n\n");
        };
        const phase1Source = buildPhase1Source(input.rawTranscript);
        const phase1SourceSection = phase1Source
          ? `\n\nSOURCE MATERIAL (sampled: beginning · middle · end of the full document):\n${phase1Source}`
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

OUTPUT ALL ACADEMY FIELDS. TOKEN BUDGET IS TIGHT — be concise in every field.

FOR THE CURRICULUM: produce exactly 3–4 modules (HARD MAX 4). Each module gets exactly 2–3 lesson outlines (HARD MAX 3). Lesson outline = title + type + durationMinutes only.
DO NOT write notes, quiz, keyTakeaways, or actionItems in this phase.

FIELD GUIDE:
- academyName: Market-ready title from the core subject matter
- tagline: One punchy line — the student transformation
- targetAudience: One precise sentence
- difficultyLevel: "beginner" | "intermediate" | "advanced"
- totalEstimatedHours: Sum of lesson durations ÷ 60, rounded to 1dp
- certificateTitle: e.g. "Certificate in [Topic]"
- themeVariant: midnight (tech) | amber (business/faith) | emerald (health/nature) | rose (personal dev) | violet (design/code) | solar (beginner/broad)
- layoutVariant: "centered" | "split" | "minimal"

LANDING PAGE: headline (max 10 words), subheadline (1 sentence), problemStatement (2 sentences), features (4 bullets — specific outcomes only), cta (button text)

PRICING — exactly 3 tiers:
1. Free — priceUsd: 0, period: "once", 2 bullets
2. Pro — priceUsd: 47–97, period: "monthly", 4 bullets
3. Lifetime — priceUsd: 197–497, period: "once", 5 bullets

CURRICULUM: moduleTitle, moduleDescription (1–2 sentences), lessonOutlines (max 3 stubs)

SEO: title (50–60 chars), description (140–155 chars), keywords (6–8)
onboardingSteps: 3–4 steps

GROUNDING — non-negotiable:
- The ENTIRE curriculum must be extracted from the source material below.
- Module titles must reflect actual chapters, themes, or major sections of the source.
- Lesson titles must name specific concepts, arguments, or passages found in the source.
- If the source is a book on meekness, every module and lesson comes from THAT book — not generic educational content.
- Do NOT invent topics absent from the source material.

DIVERSITY & PROGRESSION — mandatory:
- Every module covers a DISTINCT topic. Zero content overlap between modules.
- Sequence: Module 1 = Foundation/Overview, Module 2 = Core Concepts, Module 3 = Application/Practice, Module 4 = Mastery/Integration.
- Lessons within a module cover DIFFERENT sub-topics that together complete that module's scope.
- No two lessons anywhere in the curriculum should share the same key point.`,
          prompt: basePrompt + phase1SourceSection + deliverySection,
        });

        // ── Phase 2: Per-module metadata + per-lesson content ─────────────────
        // Split into two calls per lesson:
        //   2a. Module meta (learningObjectives + keyTerms) — ~200 tokens output
        //   2b-structure. Lesson structured fields (no notes) — ~350 tokens output
        //   2b-notes. Lesson notes via generateText — plain text, ZERO JSON parse risk
        // This makes token overflow physically impossible.
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

        // ── Transcript segmentation ────────────────────────────────────────
        // Each module draws from a UNIQUE slice of the transcript so later
        // modules don't rehash the same opening content. Capped at
        // MAX_LESSON_TRANSCRIPT_CHARS per slice to keep inputs small.
        const numModules = shell.curriculum.length;
        const fullTranscriptLen = rawTranscript ? rawTranscript.length : 0;
        const segSize = fullTranscriptLen > 0
          ? Math.ceil(fullTranscriptLen / numModules)
          : 0;
        const allModuleTitles = shell.curriculum.map(m => m.moduleTitle);

        const fullCurriculum: FullModule[] = [];

        for (let modIdx = 0; modIdx < shell.curriculum.length; modIdx++) {
          const mod = shell.curriculum[modIdx];

          // Unique transcript window for this module
          const segStart  = modIdx * segSize;
          const segEnd    = Math.min(segStart + MAX_LESSON_TRANSCRIPT_CHARS, fullTranscriptLen);
          const modSource = rawTranscript ? rawTranscript.slice(segStart, segEnd) : "";
          const modSourceSection = modSource
            ? `\n\nSOURCE MATERIAL (section ${modIdx + 1}/${numModules}):\n${modSource}`
            : "";

          // Sibling module titles — threaded into every call to enforce zero overlap
          const siblingTitles = allModuleTitles.filter((_, i) => i !== modIdx);

          // ── 2a: Module metadata ──────────────────────────────────────────────
          const { object: meta } = await generateObject({
            model: deepSeekModel,
            schema: ModuleMetaSchema,
            mode: "json",
            maxTokens: 600,
            temperature: 0.3,
            system: `You are the Curator. Write metadata for ONE academy module grounded in the source material.
Output ONLY:
- learningObjectives: exactly 3 outcomes (Understand / Apply / Identify) drawn from what the source actually teaches in this module.
- keyTerms: exactly 4 terms that APPEAR in the source material and are exclusive to this module. Each: term + definition using the source’s own language where possible.
GROUNDING RULE: extract objectives and terms directly from the source — do NOT invent.
UNIQUENESS RULE: every objective and term must be unique to this module.`,
            prompt: `MODULE: ${mod.moduleTitle}
DESCRIPTION: ${mod.moduleDescription}
SIBLING MODULES (do NOT repeat their topics): ${siblingTitles.join(" | ")}${modSourceSection}`,
          });

          const fullLessons: FullLesson[] = [];

          for (let lessonIdx = 0; lessonIdx < mod.lessonOutlines.length; lessonIdx++) {
            const outline = mod.lessonOutlines[lessonIdx];

            // Sibling lesson awareness — prevents intra-module repetition
            const coveredLessons  = mod.lessonOutlines.slice(0, lessonIdx).map(l => l.title);
            const upcomingLessons = mod.lessonOutlines.slice(lessonIdx + 1).map(l => l.title);

            const lessonContext = [
              `ACADEMY: ${shell.academyName}`,
              `MODULE ${modIdx + 1}/${numModules}: ${mod.moduleTitle}`,
              `LESSON ${lessonIdx + 1}/${mod.lessonOutlines.length}: ${outline.title} (${outline.type}, ${outline.durationMinutes} min)`,
              `MODULE OBJECTIVES: ${meta.learningObjectives.join(" | ")}`,
              `MODULE KEY TERMS: ${meta.keyTerms.map(kt => kt.term).join(", ")}`,
              coveredLessons.length  > 0 ? `ALREADY COVERED THIS MODULE: ${coveredLessons.join(", ")} — do NOT revisit` : "",
              upcomingLessons.length > 0 ? `RESERVED FOR LATER: ${upcomingLessons.join(", ")} — leave for subsequent lessons` : "",
              modSourceSection,
            ].filter(Boolean).join("\n");

            // ── 2b-structure: Structured lesson fields (NO notes) ────────────
            const { object: structured } = await generateObject({
              model: deepSeekModel,
              schema: LessonStructuredSchema,
              mode: "json",
              maxTokens: 800,
              temperature: 0.3,
              system: `You are the Curator. Write structured content for ONE lesson grounded in the source material.
Output ONLY:
- description: 1 sentence — what the student learns from THIS lesson’s source content
- keyTakeaways: exactly 3 sentences — specific teachings extracted from the source for this lesson
- actionItems: exactly 2 practical steps based on what the source actually instructs or implies
- quiz: EXACTLY 2 questions testing concepts from the source material, each with EXACTLY 4 options, correct is 0–3
GROUNDING RULE: every field reflects actual content from the source. No invented content.
No repetition of already-covered lessons.`,
              prompt: lessonContext,
            });

            // ── 2b-notes: Lesson notes via generateText ──────────────────────
            // Plain text — no JSON, no parse error possible regardless of length.
            const { text: notes } = await generateText({
              model: deepSeekModel,
              maxTokens: 1_000,
              temperature: 0.4,
              system: `You are the Curator. Write educational notes for ONE lesson.
Base notes DIRECTLY on the source material excerpt provided. Paraphrase or quote the source’s actual language and examples.
Format: 1 intro paragraph (2–3 sentences), then 2 sections starting with "## Heading".
Length: 150–220 words MAXIMUM.
Rules:
- **bold** 1–2 key terms per section that appear in the source.
- Every sentence must come from or be directly supported by the source material.
- Do NOT add information absent from the source. No markdown outside ## and **.`,
              prompt: lessonContext,
            });

            fullLessons.push({
              title: outline.title,
              type: outline.type,
              durationMinutes: outline.durationMinutes,
              description: structured.description,
              notes: notes.trim(),
              keyTakeaways: structured.keyTakeaways,
              actionItems: structured.actionItems,
              quiz: structured.quiz,
            });
          }

          fullCurriculum.push({
            moduleTitle: mod.moduleTitle,
            moduleDescription: mod.moduleDescription,
            learningObjectives: meta.learningObjectives,
            keyTerms: meta.keyTerms,
            lessons: fullLessons,
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
