import { NextRequest } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { deepSeekModel } from "@/lib/ai-providers";
import { ProduceInputSchema, AcademyPackageSchema, AcademyShellSchema } from "@/lib/schemas/academy";

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

        // ── Phase 0: Content map ────────────────────────────────────────
        // Force DeepSeek to READ and MAP the source's distinct themes BEFORE
        // designing the curriculum. Each theme gets direct source passages so
        // every module is anchored to real, non-overlapping content.
        const ThemeEntrySchema = z.object({
          index:        z.number().int().min(0).max(3),
          title:        z.string(),
          summary:      z.string(),
          keyPassages:  z.array(z.string()).min(1).max(3),
          sourceRegion: z.enum(["beginning", "early-middle", "late-middle", "end"]),
        });
        const ContentMapSchema = z.object({
          themes: z.array(ThemeEntrySchema).min(3).max(4),
        });
        type ContentMap = z.infer<typeof ContentMapSchema>;

        const phase0Source = phase1Source || input.rawTranscript?.slice(0, 12_000) || "";
        let contentMap: ContentMap = { themes: [] };
        if (phase0Source) {
          const { object: map } = await generateObject({
            model: deepSeekModel,
            schema: ContentMapSchema,
            mode: "json",
            maxTokens: 1_200,
            temperature: 0.1,
            system: `You are a source analyst. Read the material and identify 3–4 completely DISTINCT major themes or sections. Cover the FULL arc of the document.

For each theme:
- index: 0-based (0 = first theme in the source)
- title: 4–7 words, the theme name using the source's own language
- summary: exactly 2 sentences — what the source specifically says about this theme
- keyPassages: 2–3 short verbatim or near-verbatim quotes (10–30 words each) taken directly from the source for this theme
- sourceRegion: where this theme appears in the document: "beginning" | "early-middle" | "late-middle" | "end"

RULES — non-negotiable:
- Every theme must be DISTINCT — zero conceptual overlap between themes
- keyPassages must be actual text from the source, not paraphrases
- Assign themes across the full document — themes must span beginning to end, not cluster in one region
- Do NOT invent content absent from the source`,
            prompt: `SOURCE MATERIAL:\n${phase0Source}`,
          });
          contentMap = map;
        }

        // Build a content map string for Phase 1 injection
        const contentMapSection = contentMap.themes.length > 0
          ? `\n\nCONTENT MAP — your curriculum MUST map exactly to these themes (one theme per module):\n${contentMap.themes.map((t) =>
              `MODULE ${t.index + 1}: "${t.title}"\n  What the source says: ${t.summary}\n  Source passages: ${t.keyPassages.map(p => `"${p}"`).join(" | ")}`
            ).join("\n\n")}`
          : "";

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

CURRICULUM RULE — the content map below defines exactly what each module covers:
- Module 1 covers ONLY the content of Theme 1. Module 2 covers ONLY Theme 2. Etc.
- Module title = the theme title (you may rephrase for marketing but must stay on that theme)
- Lesson titles must name SPECIFIC sub-concepts from that theme's source passages ONLY
- Zero topic overlap between any two modules — each module owns its theme exclusively

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
- Every module and lesson title must reflect actual content from the source material or the content map below
- Do NOT invent topics absent from the source`,
          prompt: basePrompt + contentMapSection + phase1SourceSection + deliverySection,
        });

        // ── Phase 2: ALL module + lesson content in a SINGLE call ─────────────
        // One context window = one consistent voice, zero repetition.
        // The model sees the complete curriculum outline and all theme passages
        // simultaneously, so it naturally writes distinct content per lesson.
        const AllModulesContentSchema = z.object({
          modules: z.array(z.object({
            moduleIndex:        z.number().int().min(0),
            learningObjectives: z.array(z.string()).min(1).max(5),
            keyTerms: z.array(z.object({
              term:       z.string(),
              definition: z.string(),
            })).min(1).max(6),
            lessons: z.array(z.object({
              lessonIndex:  z.number().int().min(0),
              description:  z.string(),
              notes:        z.string(),
              keyTakeaways: z.array(z.string()).min(1).max(7),
              actionItems:  z.array(z.string()).min(1).max(4),
              quiz: z.array(z.object({
                q:       z.string(),
                options: z.array(z.string()).length(4),
                correct: z.number().int().min(0).max(3),
              })).min(3).max(3),
            })),
          })),
        });

        // Build the full curriculum outline so the model sees every lesson at once
        const curriculumOutline = shell.curriculum.map((mod, mi) => [
          `MODULE ${mi} "${mod.moduleTitle}": ${mod.moduleDescription}`,
          ...mod.lessonOutlines.map((l, li) => `  LESSON ${li}: "${l.title}" (${l.type}, ${l.durationMinutes}min)`),
        ].join("\n")).join("\n\n");

        const themePassages = contentMap.themes.length > 0
          ? contentMap.themes.map((t) =>
              `Theme ${t.index} \u201c${t.title}\u201d (${t.sourceRegion}): ${t.summary}\n  Passages: ${t.keyPassages.map(p => `\u201c${p}\u201d`).join(" | ")}`
            ).join("\n")
          : "";

        const { object: allContent } = await generateObject({
          model: deepSeekModel,
          schema: AllModulesContentSchema,
          mode: "json",
          maxTokens: 14_000,
          temperature: 0.3,
          system: `You are the Curator — a world-class educational content writer. You will receive a complete academy curriculum outline and must write ALL content for every module and lesson in ONE response.

CRITICAL — you can see the FULL curriculum. Use this to:
- Write each lesson about DIFFERENT content. If you cover a concept in Lesson A, do NOT mention it in Lesson B.
- Maintain a single, consistent teaching voice and tone across the entire academy.
- Each module covers its assigned theme ONLY — no theme content bleeds into another module.

PER MODULE output:
- learningObjectives: exactly 3 (Understand/Apply/Identify pattern), drawn from the theme's source passages
- keyTerms: exactly 4 terms that appear in the source, exclusive to this module

PER LESSON output:
- description: 1 sentence stating the specific learning outcome for THIS lesson
- notes: 350–500 words. This is the core teaching content — make it rich, substantive, and practical.
  Format:
  1. Opening paragraph (3–4 sentences): frame the lesson topic and why it matters, grounded in the source.
  2. "## [Section Title]" — first concept block (2–3 paragraphs): explain the core idea in depth using specific language, examples, or frameworks from the source material. **bold** key terms where introduced.
  3. "## [Section Title]" — second concept block (2–3 paragraphs): a distinct sub-topic or application angle from the source. No overlap with the first section.
  4. "## Key Insight" — closing paragraph (2–3 sentences): distil the single most important idea from THIS lesson into a memorable takeaway statement.
  Rules: every claim must come from the source. Use **bold** for 2–4 terms per lesson. Vary sentence length for rhythm. Do NOT use bullet lists inside notes — prose only.
- keyTakeaways: exactly 3 — specific, distinct insights from THIS lesson only
- actionItems: exactly 2 practical steps grounded in the source
- quiz: exactly 3 questions, each with exactly 4 options, correct index 0–3

GROUNDING — every sentence must be traceable to the source material or theme passages provided. No invented content.`,`
          prompt: [
            "CURRICULUM OUTLINE (write content for all of these):",
            curriculumOutline,
            "",
            themePassages ? `THEME PASSAGES (each module must be grounded in its theme passages):\n${themePassages}` : "",
            "",
            phase1Source ? `SOURCE MATERIAL (sampled: beginning \u00b7 middle \u00b7 end):\n${phase1Source}` : "",
            deliverySection,
          ].filter(Boolean).join("\n"),
        });

        // Merge Phase 2 content back onto the Phase 1 shell
        const fullCurriculum = shell.curriculum.map((mod, mi) => {
          const modContent = allContent.modules.find(m => m.moduleIndex === mi)
            ?? allContent.modules[mi]
            ?? allContent.modules[allContent.modules.length - 1];
          return {
            moduleTitle:        mod.moduleTitle,
            moduleDescription:  mod.moduleDescription,
            learningObjectives: modContent.learningObjectives,
            keyTerms:           modContent.keyTerms,
            lessons: mod.lessonOutlines.map((outline, li) => {
              const lc = modContent.lessons.find(l => l.lessonIndex === li)
                ?? modContent.lessons[li]
                ?? modContent.lessons[modContent.lessons.length - 1];
              return {
                title:           outline.title,
                type:            outline.type,
                durationMinutes: outline.durationMinutes,
                description:     lc.description,
                notes:           lc.notes.trim(),
                keyTakeaways:    lc.keyTakeaways,
                actionItems:     lc.actionItems,
                quiz:            lc.quiz,
              };
            }),
          };
        });

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

