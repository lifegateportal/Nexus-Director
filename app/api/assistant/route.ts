import { generateObject } from "ai";
import { NextRequest, NextResponse } from "next/server";
import { deepSeekModel } from "@/lib/ai-providers";
import { AcademyPackageSchema } from "@/lib/schemas/academy";
import type { AcademyPackage } from "@/lib/schemas/academy";
import { SiteConfigSchema } from "@/lib/schemas/site-config";
import type { SiteConfig } from "@/lib/schemas/site-config";
import { z } from "zod";

export const runtime = "nodejs";
export const maxDuration = 120;

const RequestSchema = z.object({
  academy:     AcademyPackageSchema,
  instruction: z.string().min(1).max(4000),
  siteConfig:  SiteConfigSchema.optional(),
});

// ── Patch schemas — AI returns ONLY changed fields, never the full academy. ──
// This keeps output well under DeepSeek's 8K token limit regardless of academy size.

const LessonPatchSchema = z.object({
  lessonIndex:    z.number().int().min(0),
  title:          z.string().optional(),
  type:           z.enum(["video", "reading", "quiz", "exercise"]).optional(),
  durationMinutes:z.number().optional(),
  description:    z.string().optional(),
  notes:          z.string().optional(),
  keyTakeaways:   z.array(z.string()).optional(),
  actionItems:    z.array(z.string()).optional(),
  quiz: z.array(z.object({
    q:       z.string(),
    options: z.array(z.string()),
    correct: z.number().int().min(0).max(3),
  })).optional(),
});

const ModulePatchSchema = z.object({
  moduleIndex:       z.number().int().min(0),
  moduleTitle:       z.string().optional(),
  moduleDescription: z.string().optional(),
  learningObjectives:z.array(z.string()).optional(),
  keyTerms: z.array(z.object({ term: z.string(), definition: z.string() })).optional(),
  lessonPatches: z.array(LessonPatchSchema).optional(),
});

const AcademyPatchSchema = z.object({
  academyName:         z.string().optional(),
  tagline:             z.string().optional(),
  targetAudience:      z.string().optional(),
  difficultyLevel:     z.enum(["beginner", "intermediate", "advanced"]).optional(),
  totalEstimatedHours: z.number().optional(),
  certificateTitle:    z.string().optional(),
  themeVariant:  z.enum(["midnight", "amber", "emerald", "rose", "violet", "solar"]).optional(),
  layoutVariant: z.enum(["centered", "split", "minimal"]).optional(),
  landingPage: z.object({
    headline:         z.string().optional(),
    subheadline:      z.string().optional(),
    problemStatement: z.string().optional(),
    features: z.array(z.object({ title: z.string(), description: z.string() })).optional(),
    cta: z.string().optional(),
  }).optional(),
  pricing: z.array(z.object({
    name:     z.string(),
    priceUsd: z.number(),
    period:   z.enum(["once", "monthly", "yearly"]),
    features: z.array(z.string()),
  })).optional(),
  seoMeta: z.object({
    title:       z.string().optional(),
    description: z.string().optional(),
    keywords:    z.array(z.string()).optional(),
  }).optional(),
  onboardingSteps:  z.array(z.string()).optional(),
  curriculumPatches:z.array(ModulePatchSchema).optional(),
});

const PatchResponseSchema = z.object({
  academyPatch:    AcademyPatchSchema.optional(),
  siteConfigPatch: SiteConfigSchema.partial().optional(),
  summary:         z.string(),
});

// ── Server-side merge helpers ────────────────────────────────────────────────

function applyAcademyPatch(
  academy: AcademyPackage,
  patch: z.infer<typeof AcademyPatchSchema>,
): AcademyPackage {
  const { curriculumPatches, landingPage, seoMeta, pricing, onboardingSteps, ...topLevel } = patch;
  const updated: AcademyPackage = { ...academy, ...topLevel };

  if (landingPage)     updated.landingPage    = { ...academy.landingPage,    ...landingPage };
  if (pricing)         updated.pricing        = pricing;
  if (onboardingSteps) updated.onboardingSteps = onboardingSteps;
  if (seoMeta)         updated.seoMeta        = { ...academy.seoMeta, ...seoMeta };

  if (curriculumPatches?.length) {
    const curriculum = academy.curriculum.map((m) => ({ ...m, lessons: m.lessons.map((l) => ({ ...l })) }));
    for (const mp of curriculumPatches) {
      const { moduleIndex, lessonPatches, ...modFields } = mp;
      if (moduleIndex < 0 || moduleIndex >= curriculum.length) continue;
      Object.assign(curriculum[moduleIndex], modFields);
      if (lessonPatches) {
        for (const lp of lessonPatches) {
          const { lessonIndex, ...lessonFields } = lp;
          if (lessonIndex < 0 || lessonIndex >= curriculum[moduleIndex].lessons.length) continue;
          Object.assign(curriculum[moduleIndex].lessons[lessonIndex], lessonFields);
        }
      }
    }
    updated.curriculum = curriculum;
  }

  return AcademyPackageSchema.parse(updated);
}

function applySiteConfigPatch(
  base: SiteConfig,
  patch: Partial<SiteConfig>,
): SiteConfig {
  const merged = { ...base, ...patch };
  return SiteConfigSchema.parse(merged);
}

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();

  let parsedInput: { academy: AcademyPackage; instruction: string; siteConfig?: SiteConfig } | undefined;
  try {
    const body = await req.json() as unknown;
    parsedInput = RequestSchema.parse(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid request";
    return new Response(JSON.stringify({ error: message }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const { academy, instruction, siteConfig } = parsedInput;

  // Wrap in SSE stream so keep-alive pings prevent EpicGlobal / nginx from
  // closing the connection while DeepSeek is generating the response.
  const stream = new ReadableStream({
    async start(controller) {
      const ping = setInterval(() => {
        try { controller.enqueue(encoder.encode(": ping\n\n")); } catch { /* closed */ }
      }, 15_000);

      try {

    // Trim lesson notes to a short stub before serialising — the model doesn't
    // need to read 500-word prose to write a patch, and sending it bloats the
    // prompt beyond DeepSeek's reliable JSON-generation threshold in production.
    const academyContext = {
      ...academy,
      curriculum: academy.curriculum.map((mod) => ({
        ...mod,
        lessons: mod.lessons.map((l) => ({
          ...l,
          notes: l.notes ? l.notes.slice(0, 120) + (l.notes.length > 120 ? "…" : "") : "",
        })),
      })),
    };

    const { object } = await generateObject({
      model: deepSeekModel,
      schema: PatchResponseSchema,
      schemaName: "AcademyPatch",
      schemaDescription: "Patch object describing only the fields that need to change in the academy and/or site config.",
      mode: "json",
      maxTokens: 6000,
      temperature: 0.1,
      system: `IMPORTANT: Output ONLY a raw JSON object. No code fences, no markdown, no commentary before or after the JSON.

You are the Nexus Director AI — a precise, powerful academy editor with full control over every aspect of the academy content, visual presentation, and website configuration.

Analyse the user's instruction carefully, determine what needs to change, then return only the updated objects.

════════════════════════════════════════════
ACADEMY CONTENT CHANGES
════════════════════════════════════════════
Triggers: anything about curriculum, modules, lessons, notes, quizzes, takeaways, difficulty, theme, layout, hours, certificate

CURRICULUM OPERATIONS:
- "add a module" → add a full module with lessons, learningObjectives, keyTerms
- "remove/delete module X" → remove that module entirely
- "reorder modules" → rearrange module array per instruction
- "add a lesson to module X" → append a complete lesson with notes, takeaways, quiz
- "merge modules X and Y" → combine into one with all lessons
- "split lesson X" → divide one lesson into two logical halves

LESSON OPERATIONS:
- "rewrite notes for..." → produce full, dense markdown notes grounded in source material
- "add key takeaways to all lessons" → generate 5–7 per lesson from existing notes
- "add action items to all lessons" → generate 3–4 concrete actions per lesson
- "add quiz questions to..." → add/replace quiz for specific or all lessons
- "add learning objectives to all modules" → generate 3–5 per module
- "expand the glossary for module X" → add 4–8 keyTerms entries
- "format all notes" → reformat every lesson's notes with proper markdown structure
- "improve the notes for..." → rewrite specific lesson notes to be more thorough

NOTES FORMAT STANDARD (when writing or reformatting notes):
  # [Lesson Title]
  ## [Major Concept 1]
  Full teaching prose (2–4 paragraphs). Ground in source material. Use:
  - **bold** for key terms
  - *italics* for titles/names
  - > blockquotes for key statements
  - Numbered lists for sequences/frameworks
  - Bullet lists for supporting points
  - --- for major thematic breaks
  ## [Major Concept 2]
  ## Key Principles (synthesise the lesson's core insights)

VISUAL / PRESENTATION CHANGES:
- themeVariant: Set to "midnight" | "amber" | "emerald" | "rose" | "violet" | "solar"
  Respond to: "change the theme", "use amber colours", "make it feel more [adjective]", "switch to [colour] theme"
  Guidance: midnight=tech/dark, amber=business/faith/warm, emerald=health/wellness, rose=personal dev, violet=programming/design, solar=beginner/broad
- layoutVariant: "centered" | "split" | "minimal"
  Respond to: "split the hero", "minimal layout", "centered design"
- difficultyLevel: "beginner" | "intermediate" | "advanced"
- totalEstimatedHours: Update when adding/removing content
- certificateTitle: Rename the completion certificate

METADATA CHANGES:
- academyName / tagline: Rebrand or rename the academy
- targetAudience: Refine the ideal student description
- seoMeta: Update title, description, keywords
- onboardingSteps: Modify the getting-started flow
- pricing: Adjust tier names, prices, periods, feature lists

════════════════════════════════════════════
SITE CONFIG CHANGES
════════════════════════════════════════════
Triggers: anything about the landing page, website, social, footer, banner, instructor, testimonials, FAQ, CTA button

- testimonials: Add/edit student testimonials — each needs name, role, quote, rating (1–5)
  Respond to: "add testimonials", "add 3 student reviews", "add social proof"
- faqItems: Add/edit FAQ questions and answers
  Respond to: "add FAQ", "add common questions"
- instructorBio: Set instructor name, professional title, bio paragraph, avatarInitials (2 uppercase letters)
  Respond to: "add instructor bio", "set the instructor details"
- announcementBar: Short bold top-of-page banner (max 80 chars)
  Respond to: "add a banner", "add announcement", "add urgency"
- ctaOverride: Override all CTA button text sitewide
  Respond to: "change the button text", "update the CTA"
- socialLinks: Set website, twitter, youtube, instagram, linkedin (full https:// URLs only)
  Respond to: "add social links", "set social media"
- footerText: Custom copyright/tagline in the footer

════════════════════════════════════════════
OUTPUT RULES
════════════════════════════════════════════
- Return "academyPatch" field if academy content changed, "siteConfigPatch" if site config changed, or BOTH if both changed
- Preserve ALL unchanged fields EXACTLY — do not drop modules, lessons, or config sections
- Always write a concise one-sentence "summary" of exactly what you changed
- Never invent facts not grounded in the existing academy content or explicit user instruction
- If the instruction is ambiguous, make the most useful interpretation and describe what you did in the summary

════════════════════════════════════════════
OUTPUT FORMAT — patch only what changes
════════════════════════════════════════════
Return "academyPatch" with ONLY the top-level academy fields that need to change:
- Scalar fields (academyName, themeVariant, etc.) — include only if changing
- curriculumPatches: array of { moduleIndex (0-based), ...only changed module fields, lessonPatches: [{ lessonIndex (0-based), ...only changed lesson fields }] }
  Do NOT echo unchanged lesson or module data — include only what changes.
- pricing / onboardingSteps / seoMeta: include the full replacement array/object ONLY if changing

Return "siteConfigPatch" with ONLY the site config keys that need to change.

Always write a concise one-sentence "summary" of exactly what changed.`,
      prompt: [
        "CURRENT ACADEMY (notes trimmed for brevity — you have full write access when patching):",
        JSON.stringify(academyContext),
        "",
        "CURRENT SITE CONFIG:",
        JSON.stringify(siteConfig ?? {}),
        "",
        "USER INSTRUCTION:",
        instruction,
      ].join("\n"),
    });

    // Merge patches server-side and return full objects to the client
    let updatedAcademy: AcademyPackage | undefined;
    let updatedSiteConfig: SiteConfig | undefined;

    if (object.academyPatch) {
      updatedAcademy = applyAcademyPatch(academy, object.academyPatch);
    }

    if (object.siteConfigPatch) {
      updatedSiteConfig = applySiteConfigPatch(
        siteConfig ?? SiteConfigSchema.parse({}),
        object.siteConfigPatch,
      );
    }

        clearInterval(ping);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          academy:    updatedAcademy,
          siteConfig: updatedSiteConfig,
          summary:    object.summary,
        })}\n\n`));
      } catch (error) {
        clearInterval(ping);
        const message = error instanceof Error ? error.message : "Assistant failed";
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
      "X-Accel-Buffering": "no",
    },
  });
}
