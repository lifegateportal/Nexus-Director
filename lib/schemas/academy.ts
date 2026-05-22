import { z } from "zod";

export const ProduceInputSchema = z.object({
  title: z.string(),
  summary: z.string(),
  assets: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      type: z.string(),
      durationMs: z.number().optional(),
      tags: z.array(z.string()).default([]),
    })
  ),
  workflow: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      intent: z.string(),
    })
  ),
  executionPlan: z.array(
    z.object({
      step: z.number(),
      title: z.string(),
      action: z.string(),
      expectedOutcome: z.string(),
    })
  ),
  entities: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      category: z.string(),
    })
  ),
  visualDirection: z.string(),
  rawTranscript: z.string().optional(),
  deliveryInstructions: z.string().optional(),
});

export const AcademyPackageSchema = z.object({
  academyName: z.string(),
  tagline: z.string(),
  targetAudience: z.string(),
  difficultyLevel: z.enum(["beginner", "intermediate", "advanced"]).default("intermediate"),
  totalEstimatedHours: z.number().default(0),
  certificateTitle: z.string().default(""),
  themeVariant: z.enum(["midnight", "amber", "emerald", "rose", "violet", "solar"]).default("midnight"),
  layoutVariant: z.enum(["centered", "split", "minimal"]).default("centered"),
  landingPage: z.object({
    headline: z.string(),
    subheadline: z.string(),
    problemStatement: z.string(),
    features: z.array(
      z.object({
        title: z.string(),
        description: z.string(),
      })
    ),
    cta: z.string(),
  }),
  pricing: z.array(
    z.object({
      name: z.string(),
      priceUsd: z.number(),
      period: z.enum(["once", "monthly", "yearly"]),
      features: z.array(z.string()),
    })
  ),
  curriculum: z.array(
    z.object({
      moduleTitle: z.string(),
      moduleDescription: z.string(),
      learningObjectives: z.array(z.string()).default([]),
      keyTerms: z.array(
        z.object({
          term: z.string(),
          definition: z.string(),
        })
      ).default([]),
      lessons: z.array(
        z.object({
          title: z.string(),
          type: z.enum(["video", "reading", "quiz", "exercise"]),
          durationMinutes: z.number(),
          description: z.string(),
          notes: z.string().default(""),
          keyTakeaways: z.array(z.string()).default([]),
          actionItems: z.array(z.string()).default([]),
          quiz: z.array(
            z.object({
              q: z.string(),
              options: z.array(z.string()),
              correct: z.number().int().min(0).max(3),
            })
          ).default([]),
        })
      ),
    })
  ),
  seoMeta: z.object({
    title: z.string(),
    description: z.string(),
    keywords: z.array(z.string()),
  }),
  onboardingSteps: z.array(z.string()),
});

export type ProduceInput = z.infer<typeof ProduceInputSchema>;
export type AcademyPackage = z.infer<typeof AcademyPackageSchema>;

// ── Fragmented generation schemas ─────────────────────────────────────────────
// Phase 1: full academy structure with lightweight lesson stubs (no notes/quiz).
// Keeps DeepSeek Phase 1 output well under 8K tokens.

const LessonOutlineSchema = z.object({
  title: z.string(),
  type: z.enum(["video", "reading", "quiz", "exercise"]),
  durationMinutes: z.number(),
  description: z.string(),
});

export const AcademyShellSchema = z.object({
  academyName: z.string(),
  tagline: z.string(),
  targetAudience: z.string(),
  difficultyLevel: z.enum(["beginner", "intermediate", "advanced"]).default("intermediate"),
  totalEstimatedHours: z.number().default(0),
  certificateTitle: z.string().default(""),
  themeVariant: z.enum(["midnight", "amber", "emerald", "rose", "violet", "solar"]).default("midnight"),
  layoutVariant: z.enum(["centered", "split", "minimal"]).default("centered"),
  landingPage: z.object({
    headline: z.string(),
    subheadline: z.string(),
    problemStatement: z.string(),
    features: z.array(z.object({ title: z.string(), description: z.string() })),
    cta: z.string(),
  }),
  pricing: z.array(z.object({
    name: z.string(),
    priceUsd: z.number(),
    period: z.enum(["once", "monthly", "yearly"]),
    features: z.array(z.string()),
  })),
  curriculum: z.array(z.object({
    moduleTitle: z.string(),
    moduleDescription: z.string(),
    learningObjectives: z.array(z.string()).default([]),
    keyTerms: z.array(z.object({ term: z.string(), definition: z.string() })).default([]),
    lessonOutlines: z.array(LessonOutlineSchema),
  })),
  seoMeta: z.object({
    title: z.string(),
    description: z.string(),
    keywords: z.array(z.string()),
  }),
  onboardingSteps: z.array(z.string()),
});

// Phase 2: full lesson content for a single module (per-module API call).
export const ModuleLessonsSchema = z.object({
  lessons: z.array(z.object({
    title: z.string(),
    type: z.enum(["video", "reading", "quiz", "exercise"]),
    durationMinutes: z.number(),
    description: z.string(),
    notes: z.string().default(""),
    keyTakeaways: z.array(z.string()).default([]),
    actionItems: z.array(z.string()).default([]),
    quiz: z.array(z.object({
      q: z.string(),
      options: z.array(z.string()),
      correct: z.number().int().min(0).max(3),
    })).default([]),
  })),
});

export type AcademyShell = z.infer<typeof AcademyShellSchema>;
export type ModuleLessons = z.infer<typeof ModuleLessonsSchema>;
